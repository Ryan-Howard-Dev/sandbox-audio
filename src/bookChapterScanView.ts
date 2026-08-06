/**
 * What the chapter section on a book's shelf should be showing.
 *
 * Pulled out of the component because it is the part that can be wrong. There are seven answers
 * and they are decided by a header read that may still be in flight, a stored finding from weeks
 * ago, a scan running now, and a refusal that means one of four different things. That is a
 * decision worth a test, and a component in this project cannot have one — the suite is node, and
 * the render would only ever be checked by eye on a phone.
 *
 * The ordering rule this encodes is the same one the player uses: a file that states its chapters
 * is authoritative, a scan is inference, and the two are never merged. Merging them would put a
 * guessed mark between two stated ones with nothing on screen to say which was which.
 */
import type { ChapterScanOutcome, ChapterScanUnavailable } from './bookChapterScan';

export type ChapterSectionState =
  /** The file is still being read. Draw nothing rather than a heading over an empty list. */
  | { kind: 'loading' }
  /** The book's own chapter table. */
  | { kind: 'stated' }
  /** What a scan heard, for a book that states nothing. */
  | { kind: 'found' }
  /** A scan is running now. */
  | { kind: 'scanning' }
  /** A scan could be run and has not been. */
  | { kind: 'offer' }
  /** Nothing to show, but something to say. */
  | { kind: 'note'; note: ChapterScanNote }
  /** Nothing to show and nothing worth saying. */
  | { kind: 'hidden' };

/**
 * Why there are no chapters.
 *
 * 'none' and every unavailable reason are kept apart all the way to the screen, because collapsing
 * them is the failure bookChapterScan exists to prevent: "I listened and this book announces
 * nothing" and "I could not listen" are opposite answers that both arrive as an empty list.
 */
export type ChapterScanNote = 'none' | ChapterScanUnavailable;

export interface ChapterSectionInput {
  /** Chapters read out of the file. Null while the read is in flight. */
  stated: readonly unknown[] | null;
  /** Whether a scan is on offer here at all. */
  allowScan: boolean;
  /** Marks a scan produced, from this session or a stored finding. */
  scannedMarks: readonly unknown[];
  scanning: boolean;
  /** True when a scan could run and has not. */
  offered: boolean;
  /** This session's conclusion. Null when the marks came from the store. */
  outcome: ChapterScanOutcome | null;
  /** True once this book has an answer, from any session. */
  scanned: boolean;
}

export function chapterSectionState(input: ChapterSectionInput): ChapterSectionState {
  if (input.stated === null) return { kind: 'loading' };
  if (input.stated.length > 0) return { kind: 'stated' };
  // Without the offer this is the component as it was before scanning existed: most audiobooks
  // carry no chapter table, and that is simply the end of it.
  if (!input.allowScan) return { kind: 'hidden' };

  if (input.scannedMarks.length > 0) return { kind: 'found' };
  /*
   * Scanning is checked before the offer rather than after. Both can read true for a moment while
   * the store is being consulted, and showing a button that starts a second decode of a book
   * already being decoded is the worse of the two mistakes.
   */
  if (input.scanning) return { kind: 'scanning' };
  if (input.offered) return { kind: 'offer' };

  const note = noteFor(input.outcome, input.scanned);
  return note ? { kind: 'note', note } : { kind: 'hidden' };
}

function noteFor(outcome: ChapterScanOutcome | null, scanned: boolean): ChapterScanNote | null {
  if (outcome?.status === 'unavailable') {
    // Not a failure worth reporting: on a platform with no scanner there was never a button, and a
    // line explaining the absence of something never offered is noise on every book.
    return outcome.reason === 'no-scanner' ? null : outcome.reason;
  }
  /*
   * A stored finding of nothing still says so. Once a scan has run, its offer disappears, and
   * without this line the button would read as one that did nothing at all.
   */
  return scanned ? 'none' : null;
}
