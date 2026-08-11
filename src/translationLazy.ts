/**
 * Which passages to translate next, and which to leave alone.
 *
 * Translating a whole book to show one page of it is minutes of work for something the reader will
 * probably close, and on a phone it is minutes of battery. So it translates the passage in view and
 * a little ahead, and stops.
 *
 * The failure this exists to prevent is the one the app it is modelled on had to go back and fix:
 * a fast scroll fires a request per passage it flies past, and by the time they answer the reader
 * is somewhere else entirely, having spent the whole budget on pages nobody looked at. Requests are
 * batched, capped, biased forward, and never issued for something already done or already asked
 * for.
 *
 * Pure. It decides; the caller does the asking.
 */

export interface LazyWindowInput {
  /** How many passages the chapter has. */
  total: number;
  /** Where the reader is. */
  index: number;
  /** Indices already translated. */
  done: ReadonlySet<number>;
  /** Indices requested and not yet answered. */
  inFlight: ReadonlySet<number>;
  /** Indices that failed in a way not worth retrying — a missing model, say. */
  refused?: ReadonlySet<number>;
}

export interface LazyWindowOptions {
  /**
   * How far ahead to translate. Enough that reading at a normal pace never waits, small enough
   * that a scroll past ten pages does not commit to translating them.
   */
  ahead?: number;
  /**
   * How far back. Small and non-zero: a reader who glances up a paragraph should not find the pane
   * blank behind them, but nobody re-reads a chapter backwards.
   */
  behind?: number;
  /** Most passages to ask for at once, so one answer arrives soon rather than all of them late. */
  batch?: number;
}

export const DEFAULT_AHEAD = 6;
export const DEFAULT_BEHIND = 2;
export const DEFAULT_BATCH = 4;

/**
 * The next passages worth translating, nearest first.
 *
 * Nearest first matters: the reader is looking at `index`, and a batch that starts six passages
 * ahead fills in the wrong end of the window while the visible one is still blank.
 */
export function nextTranslationBatch(
  input: LazyWindowInput,
  options: LazyWindowOptions = {},
): number[] {
  const ahead = options.ahead ?? DEFAULT_AHEAD;
  const behind = options.behind ?? DEFAULT_BEHIND;
  const batch = options.batch ?? DEFAULT_BATCH;

  if (input.total <= 0 || batch <= 0) return [];

  const index = clamp(input.index, 0, input.total - 1);
  const first = Math.max(0, index - behind);
  const last = Math.min(input.total - 1, index + ahead);

  const wanted: number[] = [];
  for (let i = first; i <= last; i += 1) {
    if (input.done.has(i)) continue;
    if (input.inFlight.has(i)) continue;
    if (input.refused?.has(i)) continue;
    wanted.push(i);
  }

  // Nearest to the reader first, and forward before backward at equal distance: the next paragraph
  // is needed sooner than the previous one, which has already been read.
  wanted.sort((a, b) => {
    const da = Math.abs(a - index);
    const db = Math.abs(b - index);
    if (da !== db) return da - db;
    return b - a;
  });

  return wanted.slice(0, batch);
}

/**
 * True when the passage in view has nothing to show yet.
 *
 * Distinguished from "the window is not full" so a pane can show a quiet spinner exactly when the
 * reader is actually looking at an empty half, and stay still the rest of the time.
 */
export function isWaitingOnVisible(input: LazyWindowInput): boolean {
  const index = clamp(input.index, 0, Math.max(0, input.total - 1));
  if (input.total <= 0) return false;
  if (input.done.has(index)) return false;
  if (input.refused?.has(index)) return false;
  return true;
}

/**
 * Drop translations far outside the window.
 *
 * A long book translated end to end is a large object held for a reader who has moved on. Kept
 * generous — several windows' worth — because re-translating something the reader scrolls back to
 * is far more annoying than the memory it saves.
 */
export function pruneTranslations<T>(
  cache: ReadonlyMap<number, T>,
  index: number,
  keepRadius = 60,
): Map<number, T> {
  const kept = new Map<number, T>();
  for (const [key, value] of cache) {
    if (Math.abs(key - index) <= keepRadius) kept.set(key, value);
  }
  return kept;
}

function clamp(value: number, low: number, high: number): number {
  if (Number.isNaN(value)) return low;
  return Math.min(high, Math.max(low, value));
}

/**
 * Where the reader is, from a stored reading position.
 *
 * charOffset is authoritative and chunkIndex is not: documents are re-chunked on open so improved
 * chunking reaches old imports, which means a stored chunk index can point at different text after
 * an update. Counting characters finds the passage that actually holds the offset.
 */
export function chunkIndexForOffset(
  chunkLengths: readonly number[],
  charOffset: number | undefined,
  fallbackIndex = 0,
): number {
  if (charOffset == null || charOffset < 0) return clampIndex(fallbackIndex, chunkLengths.length);
  let running = 0;
  for (let i = 0; i < chunkLengths.length; i += 1) {
    running += chunkLengths[i];
    if (charOffset < running) return i;
  }
  return Math.max(0, chunkLengths.length - 1);
}

function clampIndex(value: number, length: number): number {
  if (length <= 0) return 0;
  return Math.min(length - 1, Math.max(0, value));
}
