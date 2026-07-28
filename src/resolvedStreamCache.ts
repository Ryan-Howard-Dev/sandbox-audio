/**
 * Remember stream URLs we already resolved.
 *
 * Turning a catalog row into something playable means running yt-dlp on the phone, and measured on
 * device that takes about fifteen seconds from tap to sound. Nothing about it is cheap: it is a
 * network round trip plus extraction, serialised behind a queue so two taps cannot run at once.
 * Replaying the same track, or skipping back to it, paid the full cost again every time.
 *
 * The resolved URLs are reusable, and they say so themselves — a Google video URL carries an
 * `expire` parameter, a Unix timestamp after which the signature is refused. Caching against that
 * stated deadline is honest in a way a guessed TTL is not: too short and the cache never helps,
 * too long and playback dies partway through a track with no obvious cause.
 *
 * Persisted, because the expensive case is opening the app and playing the song you were just
 * listening to, and an in-memory cache is empty exactly then.
 */

const STORAGE_KEY = 'sandbox_resolved_stream_cache_v1';

/**
 * Discarded this long before the URL's own expiry.
 *
 * A URL accepted with one minute left starts a track it cannot finish, and the failure arrives
 * mid-song as a stall rather than at the point of use. Five minutes covers a typical track.
 */
export const EXPIRY_SAFETY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Ceiling for URLs that do not state an expiry.
 *
 * Unknown is not the same as forever. Half an hour is long enough to make repeat plays and skips
 * free, short enough that a stale entry corrects itself within one sitting.
 */
export const DEFAULT_TTL_MS = 30 * 60 * 1000;

/** Bounded so a long session cannot grow this without limit. */
export const MAX_ENTRIES = 200;

export interface ResolvedStream {
  uri: string;
  watchUrl?: string;
  bitrate: number;
  format: string;
}

interface CacheEntry extends ResolvedStream {
  /** Absolute epoch ms after which this must not be handed out. */
  expiresAt: number;
  /** Last read or write, for eviction. */
  touchedAt: number;
}

let memory: Map<string, CacheEntry> | null = null;

function normalizeKey(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * When the URL itself says it stops working, in epoch ms.
 *
 * Read from the URL rather than assumed: the issuer is the only party that knows, and it puts the
 * answer in the query string. Values are seconds, and implausible ones are ignored rather than
 * trusted — a malformed `expire` that parses to 1970 would poison the entry permanently, and one
 * far in the future would keep a dead URL forever.
 */
export function parseStreamExpiry(uri: string, now = Date.now()): number | null {
  const match = /[?&]expire=(\d{9,13})\b/.exec(uri);
  if (!match) return null;
  const raw = Number(match[1]);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  // 13 digits is already milliseconds; 10 is seconds, which is what these URLs use.
  const ms = match[1]!.length >= 13 ? raw : raw * 1000;
  if (ms <= now) return null;
  // A year out is not a real expiry on a signed media URL; treat it as unstated.
  if (ms > now + 365 * 24 * 60 * 60 * 1000) return null;
  return ms;
}

function load(): Map<string, CacheEntry> {
  if (memory) return memory;
  memory = new Map();
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, CacheEntry>;
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry?.uri && Number.isFinite(entry.expiresAt)) memory.set(key, entry);
      }
    }
  } catch {
    // A corrupt or unavailable store is a cold cache, never a failure to play.
  }
  return memory;
}

function persist(map: Map<string, CacheEntry>): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    // Full or blocked storage costs speed, not correctness.
  }
}

/** A usable stream for this query, or null when there is none worth trusting. */
export function getCachedResolvedStream(
  query: string,
  now = Date.now(),
): ResolvedStream | null {
  const key = normalizeKey(query);
  if (!key) return null;
  const map = load();
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expiresAt - EXPIRY_SAFETY_MARGIN_MS <= now) {
    map.delete(key);
    persist(map);
    return null;
  }
  entry.touchedAt = now;
  return {
    uri: entry.uri,
    watchUrl: entry.watchUrl,
    bitrate: entry.bitrate,
    format: entry.format,
  };
}

/** Remember a freshly resolved stream. Entries with nothing usable are not stored. */
export function cacheResolvedStream(
  query: string,
  resolved: ResolvedStream | null | undefined,
  now = Date.now(),
): void {
  const key = normalizeKey(query);
  if (!key || !resolved?.uri?.trim()) return;
  // file:// is already on disk; the locker owns that lifetime and it has no expiry to respect.
  if (resolved.uri.startsWith('file://')) return;

  const stated = parseStreamExpiry(resolved.uri, now);
  const expiresAt = stated ?? now + DEFAULT_TTL_MS;
  // Nothing to gain from storing something already inside the safety margin.
  if (expiresAt - EXPIRY_SAFETY_MARGIN_MS <= now) return;

  const map = load();
  map.set(key, { ...resolved, expiresAt, touchedAt: now });

  if (map.size > MAX_ENTRIES) {
    // Oldest touch first, so the tracks being listened to are the ones that survive.
    const ordered = [...map.entries()].sort((a, b) => a[1].touchedAt - b[1].touchedAt);
    for (const [staleKey] of ordered.slice(0, map.size - MAX_ENTRIES)) map.delete(staleKey);
  }
  persist(map);
}

/** Drop everything — for a settings-level "clear cache", and to isolate tests. */
export function clearResolvedStreamCache(): void {
  memory = null;
  try {
    globalThis.localStorage?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Forget what is in memory and read the store again on next use.
 *
 * The state a relaunch starts from, and the only way to prove the persisted half works without
 * asserting on the storage format from outside.
 */
export function reloadResolvedStreamCache(): void {
  memory = null;
}

/** Entries currently held, expired ones included. Diagnostics only. */
export function resolvedStreamCacheSize(): number {
  return load().size;
}
