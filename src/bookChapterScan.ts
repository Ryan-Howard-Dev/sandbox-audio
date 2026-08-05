/**
 * Finding a book's chapters by listening to it.
 *
 * The last piece, joining the three that already exist: silences propose the boundaries
 * (silenceScan), a keyword spotter confirms which of them a narrator announced, and
 * spokenChapterDetect decides what that adds up to. This is the orchestration and the honesty.
 *
 * The honesty is the part worth reading. There are two ways to come back with no chapters and
 * they mean opposite things:
 *
 *   'none'        — the book was scanned and it genuinely has no announced chapters. An
 *                   interview, a lecture, a novel read without headings. Correct and final.
 *   'unavailable' — nothing could be looked at. No scanner on this platform, no model
 *                   installed, a file the decoder refused. Nothing has been learned.
 *
 * Collapsing those two into an empty list is exactly the failure that hid the getLong bug for
 * months: every ranged read returned byte zero, found no chapter table there, and reported a book
 * with no chapters — which is indistinguishable from the truthful answer. A caller that cannot
 * tell "I looked and there is nothing" from "I could not look" will cache the wrong one forever.
 */
import { silencesFromFrameDb, type SilenceSpan } from './silenceScan';
import {
  DEFAULT_DETECTION,
  CHAPTER_KEYWORDS,
  detectChapters,
  keywordPassFraction,
  keywordWindows,
  type ChapterDetectionSettings,
  type DetectedChapter,
  type KeywordHit,
} from './spokenChapterDetect';

export interface ScannedSilences {
  silences: SilenceSpan[];
  durationSeconds: number;
  frameSeconds: number;
}

/** Why nothing could be looked at. Each is a different thing to tell somebody. */
export type ChapterScanUnavailable =
  | 'no-scanner'
  | 'no-model'
  | 'decode-failed'
  | 'not-worth-it';

export type ChapterScanOutcome =
  | { status: 'chapters'; chapters: DetectedChapter[]; scannedFraction: number }
  | { status: 'none' }
  | { status: 'unavailable'; reason: ChapterScanUnavailable };

export interface ChapterScanDeps {
  /** Decode and measure loudness. Null when there is no scanner on this platform. */
  scanSilences: (uri: string) => Promise<ScannedSilences | null>;
  /**
   * Listen for the announcing words at the given windows.
   *
   * Null means the spotter could not run at all — no model installed, most likely. An empty
   * array means it ran and heard nothing, which is a real answer about the book.
   */
  spotKeywords: (
    uri: string,
    windows: Array<{ startSeconds: number; endSeconds: number }>,
    keywords: readonly string[],
  ) => Promise<KeywordHit[] | null>;
}

/**
 * Refuse the keyword pass beyond this share of the book.
 *
 * The whole saving is that a spotter only listens at a few hundred short windows rather than to
 * thirty hours. A recording with pauses everywhere — a halting speaker, a badly edited file —
 * produces so many candidates that the saving evaporates, and grinding through most of a long
 * book to find nothing is worse than declining. keywordPassFraction reports the ratio so this is
 * decided on a number rather than a hope.
 */
export const MAX_KEYWORD_PASS_FRACTION = 0.25;

export interface ChapterScanOptions {
  detection?: ChapterDetectionSettings;
  keywords?: readonly string[];
  maxKeywordPassFraction?: number;
}

/**
 * Scan a book for chapters it never wrote down.
 *
 * Ordered so the cheap thing always runs first and the expensive thing may not run at all: decode
 * and measure once, decide from the pauses whether a keyword pass is even worth it, and only then
 * ask the spotter.
 */
export async function scanBookChapters(
  uri: string,
  deps: ChapterScanDeps,
  options: ChapterScanOptions = {},
): Promise<ChapterScanOutcome> {
  const target = uri?.trim() ?? '';
  if (!target) return { status: 'unavailable', reason: 'decode-failed' };

  const detection = options.detection ?? DEFAULT_DETECTION;
  const keywords = options.keywords ?? CHAPTER_KEYWORDS;
  const maxFraction = options.maxKeywordPassFraction ?? MAX_KEYWORD_PASS_FRACTION;

  let scanned: ScannedSilences | null;
  try {
    scanned = await deps.scanSilences(target);
  } catch {
    return { status: 'unavailable', reason: 'decode-failed' };
  }
  if (!scanned) return { status: 'unavailable', reason: 'no-scanner' };

  const windows = keywordWindows(scanned.silences, detection);
  /*
   * No long pauses at all is a real answer, not a failure. A continuous recording with no breaks
   * has no chapter boundaries to find, and saying 'none' lets the caller stop asking.
   */
  if (windows.length === 0) return { status: 'none' };

  const fraction = keywordPassFraction(windows, scanned.durationSeconds);
  if (fraction > maxFraction) return { status: 'unavailable', reason: 'not-worth-it' };

  let hits: KeywordHit[] | null;
  try {
    hits = await deps.spotKeywords(target, windows, keywords);
  } catch {
    return { status: 'unavailable', reason: 'no-model' };
  }
  // Null is "could not listen"; an empty array is "listened, heard nothing announced".
  if (hits === null) return { status: 'unavailable', reason: 'no-model' };

  const chapters = detectChapters(
    { silences: scanned.silences, hits, durationSeconds: scanned.durationSeconds },
    detection,
  );
  if (chapters.length === 0) return { status: 'none' };
  return { status: 'chapters', chapters, scannedFraction: fraction };
}

/**
 * Turn a scan result into chapter marks, or nothing.
 *
 * Deliberately loses the distinction that scanBookChapters kept: by the time marks reach the
 * player, 'none' and 'unavailable' both mean the plain bar. Keeping them apart matters for
 * deciding whether to scan again, which is the caller's business, not the bar's.
 */
export function marksFromScan(
  outcome: ChapterScanOutcome,
): Array<{ startSeconds: number; title: string }> {
  if (outcome.status !== 'chapters') return [];
  return outcome.chapters.map((chapter) => ({
    startSeconds: chapter.startSeconds,
    // A spotted word is not a chapter title. It is evidence that a chapter starts here, and the
    // view numbers them; writing "chapter" into the name would be stating the evidence as a fact.
    title: '',
  }));
}

/** Whether asking again could plausibly give a different answer. */
export function isScanRetryable(outcome: ChapterScanOutcome): boolean {
  if (outcome.status !== 'unavailable') return false;
  // A missing model can be installed and a decode can be retried; a book with pauses everywhere
  // will have them next time too, and no scanner will not appear on this platform.
  return outcome.reason === 'no-model' || outcome.reason === 'decode-failed';
}

/** Re-export so a caller wiring the device path has one import. */
export { silencesFromFrameDb };
