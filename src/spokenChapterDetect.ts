/**
 * Chapter boundaries for a book that states none.
 *
 * Every audiobook on the device this was built against carries no chapter table in any format:
 * the M4B path finds no `chpl`, the ID3 path finds no `CHAP`, and the largest of them is a single
 * MP3 running past thirty hours. Those are exactly the books a chapter-scoped bar exists for, and
 * exactly the books nothing so far can help. The marks have to be found in the audio.
 *
 * The signal is a narrator saying "chapter fourteen". Chapterize-Audiobooks does this by
 * transcribing the whole book and searching the transcript, which works and costs a full ASR pass
 * over thirty hours. Two cheaper facts make that unnecessary:
 *
 *   A chapter break is always preceded by a pause far longer than a sentence gap. Voice activity
 *   detection finds those for a fraction of the cost of recognition, and there are perhaps a few
 *   hundred of them in a book rather than a few hundred thousand words.
 *
 *   Confirming a break needs about five words, not a transcript. Keyword spotting answers "was
 *   'chapter' said in this second" directly, and only has to run at the candidates the pause
 *   detector already found.
 *
 * So this module is the arithmetic between those two: given silences and keyword hits, decide
 * where the chapters are. Deliberately pure, with no engine and no audio, because the judgement
 * calls here are what decide whether the feature is any good and they are the part worth testing.
 *
 * The governing rule is the same one the rest of this feature follows: no chapters is a fine
 * answer, and a wrong chapter list is worse than none. A listener who taps chapter nine and lands
 * in the middle of chapter seven trusts nothing on the screen afterwards.
 */

/** A stretch of silence, as a voice activity detector reports it. */
export interface SilenceSpan {
  startSeconds: number;
  endSeconds: number;
}

/** A spotted word, with the confidence the spotter attached to it. */
export interface KeywordHit {
  /** When the word was said. */
  atSeconds: number;
  /** Which word — 'chapter', 'prologue', 'epilogue', 'part'. Lowercased by the caller. */
  keyword: string;
  /** 0..1. Spotters are tunable and a low-confidence hit is a guess, not a chapter. */
  score: number;
}

export interface DetectedChapter {
  startSeconds: number;
  /** Which word opened it, so the view can say "Chapter" rather than invent a number. */
  keyword: string;
  score: number;
}

export interface ChapterDetectionSettings {
  /**
   * A pause shorter than this is punctuation, not a chapter.
   *
   * Sentence gaps run to about a second and paragraph gaps to two. Chapter breaks in produced
   * audiobooks are longer again, and this sits above the paragraph range deliberately: including
   * paragraph gaps would offer thousands of candidates and make the keyword pass as expensive as
   * the transcription it replaces.
   */
  minSilenceSeconds: number;
  /**
   * How soon after the pause the word must be said.
   *
   * A narrator announces the chapter immediately. A mention of the word "chapter" a minute into
   * the prose is somebody talking about a chapter, not the start of one.
   */
  keywordWindowSeconds: number;
  /** Below this the spotter is guessing. */
  minScore: number;
  /**
   * No chapter is shorter than this.
   *
   * Guards the case where a narrator says "chapter" twice in the opening line — "chapter one" and
   * then the chapter's own title. Two marks a second apart are one chapter.
   */
  minChapterSeconds: number;
  /**
   * Refuse to report more than this many.
   *
   * A detection that finds four hundred chapters in a ten hour book has locked onto something that
   * is not a chapter announcement, and the honest response is to report nothing at all.
   */
  maxChapters: number;
}

export const DEFAULT_DETECTION: ChapterDetectionSettings = {
  minSilenceSeconds: 2,
  keywordWindowSeconds: 6,
  minScore: 0.5,
  minChapterSeconds: 60,
  maxChapters: 200,
};

/** Words that open a chapter. Lowercase, matched exactly against what the spotter was given. */
export const CHAPTER_KEYWORDS = [
  'chapter',
  'prologue',
  'epilogue',
  'introduction',
  'part',
  'book',
  'afterword',
  'foreword',
] as const;

/**
 * Where the keyword pass should listen.
 *
 * One window per long pause, starting at the pause's end. This is the whole saving: a thirty hour
 * book has a few hundred of these, so the spotter runs over perhaps twenty minutes of audio rather
 * than thirty hours.
 */
export function keywordWindows(
  silences: readonly SilenceSpan[],
  settings: ChapterDetectionSettings = DEFAULT_DETECTION,
): Array<{ startSeconds: number; endSeconds: number }> {
  const windows: Array<{ startSeconds: number; endSeconds: number }> = [];
  for (const silence of silences) {
    const length = silence.endSeconds - silence.startSeconds;
    if (!(length >= settings.minSilenceSeconds)) continue;
    windows.push({
      startSeconds: silence.endSeconds,
      endSeconds: silence.endSeconds + settings.keywordWindowSeconds,
    });
  }
  /*
   * The opening of the book is a candidate even though no pause precedes it. Chapter one starts at
   * the beginning, and a detector that misses it reports a book whose first chapter is chapter two.
   */
  if (windows.length > 0 && windows[0]!.startSeconds > 0) {
    windows.unshift({ startSeconds: 0, endSeconds: settings.keywordWindowSeconds });
  }
  return windows;
}

/**
 * The chapters, or an empty list.
 *
 * Empty is a real answer and the common one. A book with no announced chapters — an interview, a
 * lecture recording, a novel read without headings — genuinely has none, and the plain bar is
 * correct for it.
 *
 * Silence alone never produces a chapter. Long pauses happen at scene breaks, section breaks and
 * wherever a narrator took a drink, and a list built from them would be plausible, wrong, and
 * impossible for a listener to tell apart from a real one until they used it.
 */
export function detectChapters(
  input: {
    silences: readonly SilenceSpan[];
    hits: readonly KeywordHit[];
    /** Total length, so a hit past the end can be discarded. */
    durationSeconds: number;
  },
  settings: ChapterDetectionSettings = DEFAULT_DETECTION,
): DetectedChapter[] {
  const duration = Number.isFinite(input.durationSeconds) ? input.durationSeconds : 0;

  /** Pause ends, plus the start of the book, as the only places a chapter may begin. */
  const boundaries = [0];
  for (const silence of input.silences) {
    const length = silence.endSeconds - silence.startSeconds;
    if (length >= settings.minSilenceSeconds) boundaries.push(silence.endSeconds);
  }

  const candidates: DetectedChapter[] = [];
  for (const hit of input.hits) {
    if (!(hit.score >= settings.minScore)) continue;
    if (!Number.isFinite(hit.atSeconds) || hit.atSeconds < 0) continue;
    if (duration > 0 && hit.atSeconds > duration) continue;
    const keyword = hit.keyword?.trim().toLowerCase() ?? '';
    if (!(CHAPTER_KEYWORDS as readonly string[]).includes(keyword)) continue;

    /*
     * Attach the hit to the pause it followed, and use the pause's end as the chapter start. The
     * word is said a moment after the chapter begins, so seeking to the word itself would clip
     * the first syllable of every chapter in the book.
     */
    const boundary = latestBoundaryBefore(boundaries, hit.atSeconds);
    if (boundary === null) continue;
    if (hit.atSeconds - boundary > settings.keywordWindowSeconds) continue;
    candidates.push({ startSeconds: boundary, keyword, score: hit.score });
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => a.startSeconds - b.startSeconds || b.score - a.score);

  // Collapse marks too close together — "chapter one" followed by the chapter's own title is one
  // chapter, and so is a word spotted twice at the same boundary.
  const kept: DetectedChapter[] = [];
  for (const candidate of candidates) {
    const previous = kept[kept.length - 1];
    if (previous && candidate.startSeconds - previous.startSeconds < settings.minChapterSeconds) {
      // Keep whichever the spotter was more sure of, at the earlier of the two positions.
      if (candidate.score > previous.score) {
        kept[kept.length - 1] = { ...candidate, startSeconds: previous.startSeconds };
      }
      continue;
    }
    kept.push(candidate);
  }

  // Too many means it locked onto something that is not a chapter announcement.
  if (kept.length > settings.maxChapters) return [];
  // One is not a chapter list; see audiobookChapterSource for the same rule at the other end.
  if (kept.length < 2) return [];
  return kept;
}

/** The latest boundary at or before a time, or null when the time precedes every boundary. */
function latestBoundaryBefore(boundaries: readonly number[], atSeconds: number): number | null {
  let best: number | null = null;
  for (const boundary of boundaries) {
    if (boundary <= atSeconds && (best === null || boundary > best)) best = boundary;
  }
  return best;
}

/**
 * How much audio the keyword pass has to listen to, as a fraction of the book.
 *
 * Reported so the decision to run it can be made on a number rather than a hope. A book whose
 * windows add up to most of its length has pauses everywhere, the saving has evaporated, and it
 * is better to decline than to spend an hour of somebody's battery finding out.
 */
export function keywordPassFraction(
  windows: readonly { startSeconds: number; endSeconds: number }[],
  durationSeconds: number,
): number {
  if (!(durationSeconds > 0)) return 1;
  let total = 0;
  for (const w of windows) total += Math.max(0, w.endSeconds - w.startSeconds);
  return Math.min(1, total / durationSeconds);
}
