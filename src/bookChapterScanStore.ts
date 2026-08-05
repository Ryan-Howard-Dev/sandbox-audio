/**
 * Remembering what a scan found, so a book is listened to once.
 *
 * Scanning decodes the whole recording. On the thirty hour book this feature exists for that is
 * minutes of work and a meaningful amount of battery, so the answer has to outlive the session —
 * and so does the *absence* of an answer, because "this book announces no chapters" is a real
 * finding and re-deriving it every time the player opens would be the most expensive way possible
 * to learn nothing.
 *
 * What is deliberately not cached is a failure that could go the other way. A missing model gets
 * installed; a decode that fell over might not next time. Those are asked again. See
 * isScanRetryable.
 */
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { ChapterMark } from './chapterScrubber';
import { isScanRetryable, marksFromScan, type ChapterScanOutcome } from './bookChapterScan';

const STORE_KEY = 'sandbox_book_chapter_scans';
/** Bumped when the detection changes, so old findings are re-derived rather than trusted. */
export const SCAN_RESULT_VERSION = 1;
const MAX_ROWS = 500;

export interface StoredScan {
  /** Empty when the book was scanned and announces nothing. */
  marks: ChapterMark[];
  scannedAt: number;
  version: number;
}

type Store = Record<string, StoredScan>;

function readStore(): Store {
  try {
    const raw = prefsGetItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeStore(store: Store): void {
  try {
    const keys = Object.keys(store);
    const trimmed =
      keys.length <= MAX_ROWS
        ? store
        : Object.fromEntries(
            keys
              .sort((a, b) => (store[b]!.scannedAt ?? 0) - (store[a]!.scannedAt ?? 0))
              .slice(0, MAX_ROWS)
              .map((k) => [k, store[k]!]),
          );
    prefsSetItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* a lost finding is a rescan, never an error worth surfacing */
  }
}

/**
 * What a previous scan found, or null when this book has not been scanned by this version.
 *
 * An empty marks array is a real answer — the book was listened to and announces nothing — and is
 * returned as such rather than as null, which is what stops it being scanned again forever.
 */
export function loadScan(bookId: string): StoredScan | null {
  const id = bookId?.trim();
  if (!id) return null;
  const row = readStore()[id];
  if (!row || row.version !== SCAN_RESULT_VERSION) return null;
  return row;
}

/**
 * Write down what a scan concluded, when it concluded anything.
 *
 * Returns whether it was stored. A retryable failure is not: caching "no model installed" would
 * mean installing the model changed nothing.
 */
export function rememberScan(
  bookId: string,
  outcome: ChapterScanOutcome,
  now: number = Date.now(),
): boolean {
  const id = bookId?.trim();
  if (!id) return false;
  if (isScanRetryable(outcome)) return false;
  /*
   * 'not-worth-it' and 'no-scanner' are stored as an empty result on purpose. Neither will change
   * on this device for this file, and asking again would decode the book to reach the same
   * refusal.
   */
  const store = readStore();
  store[id] = {
    marks: marksFromScan(outcome),
    scannedAt: now,
    version: SCAN_RESULT_VERSION,
  };
  writeStore(store);
  return true;
}

export function forgetScan(bookId: string): void {
  const id = bookId?.trim();
  if (!id) return;
  const store = readStore();
  if (!(id in store)) return;
  delete store[id];
  writeStore(store);
}

/** Test seam — prefs-backed state would otherwise carry between tests. */
export function clearScanStoreForTests(): void {
  try {
    prefsSetItem(STORE_KEY, '{}');
  } catch {
    /* nothing to clear */
  }
}
