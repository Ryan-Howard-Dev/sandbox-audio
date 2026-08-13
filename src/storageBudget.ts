/**
 * Keeping the key/value store below the ceiling, rather than discovering the ceiling.
 *
 * Browsers cap an origin's localStorage at around ten megabytes and refuse every write past it.
 * There is an eviction pass for that moment, but arriving there at all is the problem: writes are
 * refused in the order they happen to be attempted, so what actually gets dropped is whatever the
 * app tried to save next. On a real phone that was the play queue, the play history and the
 * listening sessions, none of which can be rebuilt, while several megabytes of artist discography
 * and chart responses sat there safely, all of which can.
 *
 * So the caches are trimmed on the way up. Above a high-water mark, evictable entries are dropped
 * largest first until the store is back under a comfortable target, which leaves plenty of room
 * for the writes that matter and asks nothing of the person using the app.
 *
 * Only caches are ever removed. Anything the app cannot rebuild from the network or the disk is
 * out of scope here: where that data needs a limit it has its own, counted in entries, close to
 * the code that understands what an entry means.
 */

import { EVICTABLE_KEY_PREFIXES } from './prefsStorage';

/**
 * What a browser will actually hold. Measured rather than assumed: a phone in this state reported
 * exactly 10.00MB and refused everything after it.
 */
export const STORAGE_CEILING_BYTES = 10 * 1024 * 1024;

/** Start trimming here. Two thirds of the ceiling leaves room for a burst of real writes. */
export const TRIM_ABOVE_BYTES = Math.round(STORAGE_CEILING_BYTES * 0.65);

/**
 * Trim down to here, not merely to just under the mark.
 *
 * Stopping at the threshold would mean the next cache write crosses it again, and the app would
 * spend the rest of the session trimming a few kilobytes at a time on every write.
 */
export const TRIM_TARGET_BYTES = Math.round(STORAGE_CEILING_BYTES * 0.45);

/**
 * How often to look again.
 *
 * Caches grow while somebody browses, so a check at startup alone would miss the session that
 * actually fills the store. Cheap enough at this interval that it does not matter.
 */
export const STORAGE_TRIM_INTERVAL_MS = 5 * 60 * 1000;

export type StorageEntry = { key: string; bytes: number };

/** Two bytes per character, which is how these are stored, and near enough for a budget. */
export function entryBytes(key: string, value: string): number {
  return (key.length + value.length) * 2;
}

export function measureStorage(store: Storage): { total: number; entries: StorageEntry[] } {
  const entries: StorageEntry[] = [];
  let total = 0;
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (key == null) continue;
    const bytes = entryBytes(key, store.getItem(key) ?? '');
    entries.push({ key, bytes });
    total += bytes;
  }
  return { total, entries };
}

export function isEvictableKey(key: string): boolean {
  return EVICTABLE_KEY_PREFIXES.some((prefix) => key.startsWith(prefix));
}

/**
 * Which entries to drop, and in which order. Pure, so the decision can be asserted without a store.
 *
 * Largest first: the point is to get back under the target in as few removals as possible, and a
 * cache that is large is a cache that costs the most to keep. Nothing not evictable is ever
 * considered, so a store made entirely of real data trims nothing and simply stays where it is.
 */
export function planStorageTrim(
  entries: readonly StorageEntry[],
  options: {
    trimAbove?: number;
    trimTarget?: number;
    evictable?: (key: string) => boolean;
  } = {},
): string[] {
  const trimAbove = options.trimAbove ?? TRIM_ABOVE_BYTES;
  const trimTarget = options.trimTarget ?? TRIM_TARGET_BYTES;
  const evictable = options.evictable ?? isEvictableKey;

  let total = entries.reduce((sum, e) => sum + e.bytes, 0);
  if (total <= trimAbove) return [];

  const candidates = entries
    .filter((e) => evictable(e.key))
    .sort((a, b) => b.bytes - a.bytes || a.key.localeCompare(b.key));

  const drop: string[] = [];
  for (const candidate of candidates) {
    if (total <= trimTarget) break;
    drop.push(candidate.key);
    total -= candidate.bytes;
  }
  return drop;
}

export type StorageTrimResult = {
  before: number;
  after: number;
  removed: string[];
};

/**
 * Bring the store back under budget. Safe to call often; does nothing when there is room.
 *
 * Reports what it did rather than doing it silently: a store that keeps needing this is saying
 * something about how much the caches have grown, and that should be visible somewhere.
 */
export function trimStorageToBudget(
  store: Storage | null = typeof localStorage === 'undefined' ? null : localStorage,
  options: Parameters<typeof planStorageTrim>[1] = {},
): StorageTrimResult {
  if (!store) return { before: 0, after: 0, removed: [] };
  try {
    const { total, entries } = measureStorage(store);
    const removed = planStorageTrim(entries, options);
    if (removed.length === 0) return { before: total, after: total, removed: [] };

    for (const key of removed) {
      try {
        store.removeItem(key);
      } catch {
        /* a key that will not budge is not worth failing the whole trim over */
      }
    }
    const after = measureStorage(store).total;
    // warn rather than info: the Android bridge forwards warn and error to the device log and
    // drops the rest, so info here is a diagnostic that cannot be read on the one platform where
    // the store actually fills up. Matches how the rest of the app reports itself.
    console.warn(
      `[Sandbox] storage trimmed ${(total / 1048576).toFixed(2)}MB -> ${(after / 1048576).toFixed(2)}MB, dropped ${removed.length} cache entries`,
    );
    return { before: total, after, removed };
  } catch {
    // Storage can be unavailable entirely (private mode, disabled). Not being able to measure is
    // not a reason to break startup.
    return { before: 0, after: 0, removed: [] };
  }
}

/** How full the store is, for anything that wants to show or log it. */
export function storageUsage(store: Storage | null = typeof localStorage === 'undefined' ? null : localStorage): {
  bytes: number;
  fraction: number;
} {
  if (!store) return { bytes: 0, fraction: 0 };
  try {
    const { total } = measureStorage(store);
    return { bytes: total, fraction: total / STORAGE_CEILING_BYTES };
  } catch {
    return { bytes: 0, fraction: 0 };
  }
}
