/**
 * A scrubber that spans the chapter you are in, not the fourteen hours around it.
 *
 * A full-width bar across a whole audiobook is not merely awkward, it is mechanically unusable.
 * Fourteen hours is 50,400 seconds; a phone gives that bar something like 1,000 pixels, so one
 * pixel is roughly fifty seconds. A thumb cannot reliably land inside forty pixels, which means
 * the smallest deliberate movement anyone can make on that bar moves the book by half an hour.
 * The control is drawn at a precision the hand cannot supply, so people stop touching it and
 * navigate by the jump buttons instead — which is the tell that the bar was never doing its job.
 *
 * Scoped to one chapter the same bar becomes usable: a twenty minute chapter is 1.2 seconds per
 * pixel, and a thumb-width lands within a sentence or two of where it was aimed. Where the book
 * sits as a whole belongs in text beside it, because that is a thing to read rather than a thing
 * to aim at.
 *
 * Deliberately pure and numeric. It formats nothing and translates nothing: the view owns the
 * words, this owns the arithmetic, and the arithmetic is the part worth testing.
 */

/** A chapter boundary, as M4B atoms, podcast feeds and multi-file books all eventually resolve to. */
export interface ChapterMark {
  /** Offset from the start of the whole asset. */
  startSeconds: number;
  title?: string;
}

export interface ChapterWindow {
  /** 0-based, so the view adds one to say "Chapter 6". */
  index: number;
  count: number;
  title: string;
  /** Absolute offset of this chapter's first second. */
  startSeconds: number;
  /** How long this chapter runs. Never zero — a zero-length window would be a bar you cannot use. */
  durationSeconds: number;
  /** Position within the chapter, which is what the bar draws. */
  positionSeconds: number;
  /** Left in this chapter. The number people actually plan around: can I finish before my stop? */
  remainingSeconds: number;
  /** Through the whole asset, 0..100, for the text line rather than the bar. */
  overallPercent: number;
  /** Left in the whole asset. */
  overallRemainingSeconds: number;
}

/**
 * Put the marks in order and drop the ones that cannot be true.
 *
 * M4B parsing already normalises, but podcast chapters arrive from whatever a publisher's feed
 * happened to contain, and one negative offset would put the binary search into a window that
 * starts after it ends.
 */
export function normaliseMarks(chapters: readonly ChapterMark[]): ChapterMark[] {
  const clean = chapters
    .filter((c) => Number.isFinite(c.startSeconds) && c.startSeconds >= 0)
    .sort((a, b) => a.startSeconds - b.startSeconds);
  const out: ChapterMark[] = [];
  for (const mark of clean) {
    const previous = out[out.length - 1];
    // Two chapters at the same second means one of them has no duration to scrub.
    if (previous && Math.abs(previous.startSeconds - mark.startSeconds) < 0.001) continue;
    out.push(mark);
  }
  return out;
}

/**
 * Which chapter a position falls in.
 *
 * Binary search because a long non-fiction book runs to several hundred chapters and this is
 * called on every position tick. Anything before the first mark counts as the first chapter:
 * front matter that a publisher did not label is still part of chapter one as far as the listener
 * is concerned.
 */
export function chapterIndexAt(chapters: readonly ChapterMark[], positionSeconds: number): number {
  if (chapters.length === 0) return -1;
  const at = Number.isFinite(positionSeconds) ? positionSeconds : 0;
  let low = 0;
  let high = chapters.length - 1;
  let found = 0;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if (chapters[mid]!.startSeconds <= at) {
      found = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return found;
}

export interface ChapterWindowInput {
  positionSeconds: number;
  /** The whole asset. Zero or negative means not yet known. */
  durationSeconds: number;
  chapters: readonly ChapterMark[];
  /** Already sorted and deduped, so a caller in a render loop can skip the work. */
  preNormalised?: boolean;
}

/**
 * The chapter-scoped view of a position, or null to keep the ordinary bar.
 *
 * Null in three cases, all of them "the global bar is already the right control":
 *
 *  - fewer than two chapters, where the chapter *is* the asset;
 *  - no known total while in the last chapter, since its end is the asset's end and we do not
 *    know where that is;
 *  - a window that would come out at zero length.
 *
 * Returning null rather than a degenerate window matters. A bar that spans an unknown length is
 * the failure this module exists to remove, and inventing one here to avoid a branch in the view
 * would put it straight back.
 */
export function resolveChapterWindow(input: ChapterWindowInput): ChapterWindow | null {
  const chapters = input.preNormalised
    ? (input.chapters as ChapterMark[])
    : normaliseMarks(input.chapters);
  if (chapters.length < 2) return null;

  const total = Number.isFinite(input.durationSeconds) ? input.durationSeconds : 0;
  const position = Math.max(
    0,
    Number.isFinite(input.positionSeconds) ? input.positionSeconds : 0,
  );
  const index = chapterIndexAt(chapters, position);
  const start = chapters[index]!.startSeconds;
  const next = chapters[index + 1];

  // The end of the last chapter is the end of the book, which an unfinished stream has not told
  // us yet. Better the plain bar than one whose right-hand edge is a guess.
  const end = next ? next.startSeconds : total;
  if (!next && total <= 0) return null;

  const durationSeconds = end - start;
  if (!(durationSeconds > 0)) return null;

  // Clamp rather than trust: a position past the end of the last chapter happens routinely in the
  // final second of playback, and would otherwise draw a bar past its own track.
  const positionSeconds = Math.max(0, Math.min(durationSeconds, position - start));

  return {
    index,
    count: chapters.length,
    title: chapters[index]!.title?.trim() ?? '',
    startSeconds: start,
    durationSeconds,
    positionSeconds,
    remainingSeconds: Math.max(0, durationSeconds - positionSeconds),
    overallPercent: total > 0 ? Math.max(0, Math.min(100, (position / total) * 100)) : 0,
    overallRemainingSeconds: total > 0 ? Math.max(0, total - position) : 0,
  };
}

/**
 * Where a scrub inside the chapter lands in the asset.
 *
 * The bar hands back a position in its own frame; playback only understands absolute seconds.
 * Clamped to the chapter so a drag to the far right stops at the chapter's last second rather
 * than falling into the next one, which would be a scrub that silently changed chapter.
 */
export function absoluteSeekFromChapter(
  window: ChapterWindow,
  chapterRelativeSeconds: number,
): number {
  const within = Math.max(
    0,
    Math.min(
      window.durationSeconds,
      Number.isFinite(chapterRelativeSeconds) ? chapterRelativeSeconds : 0,
    ),
  );
  return window.startSeconds + within;
}

/**
 * Chapter marks from a list of durations, for books held as one file per chapter.
 *
 * A multi-file book already plays each chapter as its own track, so its bar is chapter-scoped by
 * accident. This exists for the places that want the whole book's shape anyway — the "chapter 6
 * of 41" line, and the sleep timer needing to know when the current one ends.
 */
export function marksFromDurations(
  parts: readonly { durationSeconds: number; title?: string }[],
): ChapterMark[] {
  const marks: ChapterMark[] = [];
  let running = 0;
  for (const part of parts) {
    marks.push({ startSeconds: running, title: part.title });
    const length = Number.isFinite(part.durationSeconds) ? Math.max(0, part.durationSeconds) : 0;
    running += length;
  }
  return marks;
}
