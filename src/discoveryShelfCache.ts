/**
 * Cache-first storage for discovery shelf rows.
 *
 * Shelves used to mount empty with a spinner and re-fetch on every entry, so walking
 * into Discover (or scrolling it) always showed loading state. Seeding synchronously
 * from this cache lets a shelf paint immediately and refresh quietly in the background.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { MediaEnvelope } from './sandboxLayer1';

const STORE_KEY = 'sandbox_discovery_shelf_cache_v1';
/** Refresh in the background when the cached rows are older than this. */
export const SHELF_STALE_MS = 6 * 60 * 60 * 1000;
const MAX_SHELVES = 40;

type CachedShelf = { rows: MediaEnvelope[]; savedAt: number };

let memory: Record<string, CachedShelf> | null = null;

export function shelfCacheKey(group: string, label: string, limit: number): string {
  return `${group}|${label}|${limit}`;
}

function loadAll(): Record<string, CachedShelf> {
  if (memory) return memory;
  try {
    const raw = prefsGetItem(STORE_KEY);
    memory = raw ? (JSON.parse(raw) as Record<string, CachedShelf>) : {};
  } catch {
    memory = {};
  }
  return memory;
}

function persist(all: Record<string, CachedShelf>): void {
  try {
    // Keep the newest entries only so this never grows without bound.
    const entries = Object.entries(all).sort((a, b) => b[1].savedAt - a[1].savedAt);
    const trimmed = Object.fromEntries(entries.slice(0, MAX_SHELVES));
    memory = trimmed;
    prefsSetItem(STORE_KEY, JSON.stringify(trimmed));
  } catch {
    /* cache is best-effort */
  }
}

/** Synchronous read so a shelf can render on its first paint. */
export function readShelfCache(key: string): CachedShelf | null {
  const hit = loadAll()[key];
  if (!hit || !Array.isArray(hit.rows) || hit.rows.length === 0) return null;
  return hit;
}

export function writeShelfCache(key: string, rows: MediaEnvelope[]): void {
  if (rows.length === 0) return;
  const all = { ...loadAll() };
  // Drop transient blob:/data: artwork — it never survives a reload and would
  // render as a broken tile on the next launch.
  all[key] = {
    savedAt: Date.now(),
    rows: rows.map((row) =>
      row.artworkUrl && /^(blob:|data:)/i.test(row.artworkUrl)
        ? { ...row, artworkUrl: undefined }
        : row,
    ),
  };
  persist(all);
}

export function shelfCacheIsStale(entry: { savedAt: number }, now = Date.now()): boolean {
  return now - entry.savedAt > SHELF_STALE_MS;
}
