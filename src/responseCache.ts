/**
 * Local response cache — stale-while-revalidate for read-heavy network data.
 * Uses prefsStorage (respects Data Persistence). Never store secrets or API keys.
 */

import { prefsGetItem, prefsRemoveItem, prefsSetItem } from './prefsStorage';

export const DEFAULT_FRESH_TTL_MS = 60 * 60 * 1000;
export const DEFAULT_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;
/** Quick browse shelves (new music, charts shortcuts) — refresh several times per day. */
export const EXPLORE_QUICK_FRESH_TTL_MS = 6 * 60 * 60 * 1000;
export const LYRICS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export const CACHE_KEYS = {
  FOLLOWED_FEED: 'sandbox_followed_feed_cache_v1',
  TIER34_FEED: 'sandbox_tier34_feed_cache_v1',
  FEED_FALLBACK: 'sandbox_feed_fallback_cache_v1',
  CHART_TRACKS: 'sandbox_chart_tracks_cache_v1',
  CATALOG_SEARCH: 'sandbox_catalog_search_cache_v1',
  ARTIST_DISCOGRAPHY: 'sandbox_artist_discography_cache_v3',
  EXPLORE: 'sandbox_explore_cache_v2',
  LYRICS: 'sandbox_lyrics_cache_v1',
  MB_ARTIST_FEED: 'sandbox_mb_artist_feed_cache_v1',
  SONIC_DNA: 'sandbox_sonic_dna_cache_v1',
} as const;

const STATIC_CACHE_KEYS = [
  CACHE_KEYS.FOLLOWED_FEED,
  CACHE_KEYS.TIER34_FEED,
  CACHE_KEYS.FEED_FALLBACK,
  CACHE_KEYS.CHART_TRACKS,
] as const;

const PREFIX_CACHE_KEYS = [
  CACHE_KEYS.CATALOG_SEARCH,
  CACHE_KEYS.ARTIST_DISCOGRAPHY,
  CACHE_KEYS.EXPLORE,
  CACHE_KEYS.LYRICS,
  CACHE_KEYS.MB_ARTIST_FEED,
  CACHE_KEYS.SONIC_DNA,
] as const;

interface ResponseCacheEnvelope<T> {
  data: T;
  fetchedAt: number;
  ttlMs: number;
}

export interface CacheReadResult<T> {
  data: T;
  fetchedAt: number;
  isFresh: boolean;
  isStale: boolean;
}

export function cacheKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function prefixedCacheKey(prefix: string, part: string): string {
  return `${prefix}:${cacheKeyPart(part)}`;
}

export function readResponseCache<T>(
  key: string,
  options?: { staleMaxMs?: number },
): CacheReadResult<T> | null {
  const staleMaxMs = options?.staleMaxMs ?? DEFAULT_STALE_MAX_MS;
  try {
    const raw = prefsGetItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResponseCacheEnvelope<T>;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || parsed.data === undefined) return null;
    const age = Date.now() - parsed.fetchedAt;
    const ttlMs = parsed.ttlMs ?? DEFAULT_FRESH_TTL_MS;
    if (age > staleMaxMs) return null;
    return {
      data: parsed.data,
      fetchedAt: parsed.fetchedAt,
      isFresh: age < ttlMs,
      isStale: age >= ttlMs,
    };
  } catch {
    return null;
  }
}

export function writeResponseCache<T>(
  key: string,
  data: T,
  ttlMs = DEFAULT_FRESH_TTL_MS,
): void {
  const payload: ResponseCacheEnvelope<T> = {
    data,
    fetchedAt: Date.now(),
    ttlMs,
  };
  try {
    prefsSetItem(key, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

function removePrefixedCaches(prefix: string, storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith(`${prefix}:`)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

/** Clear feed, catalog, explore, lyrics, and artist-image caches. */
export function clearAllAppCaches(): void {
  for (const key of STATIC_CACHE_KEYS) {
    prefsRemoveItem(key);
  }
  try {
    for (const prefix of PREFIX_CACHE_KEYS) {
      removePrefixedCaches(prefix, localStorage);
      removePrefixedCaches(prefix, sessionStorage);
    }
    localStorage.removeItem('sandbox_artist_image_cache');
    sessionStorage.removeItem('sandbox_artist_image_cache');
  } catch {
    /* ignore */
  }
}

export function formatCacheTimestamp(fetchedAt: number, lang?: string): string {
  try {
    return new Date(fetchedAt).toLocaleString(lang, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return new Date(fetchedAt).toLocaleString();
  }
}

const LEGACY_DISCOGRAPHY_V1_PREFIX = 'sandbox_artist_discography_cache_v1:';
const LEGACY_DISCOGRAPHY_V2_PREFIX = 'sandbox_artist_discography_cache_v2:';

/** iTunes sparse billing ids / alias names that cached empty or wrong discographies. */
const BAD_ARTIST_DISCOGRAPHY_CACHE_MARKERS = [
  'kanye omari west',
  '6776577113',
  'artist-6776577113',
] as const;

function purgeBadArtistDiscographyCacheKeys(storage: Storage): void {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key) continue;
    const lower = key.toLowerCase();
    if (
      key.startsWith(LEGACY_DISCOGRAPHY_V1_PREFIX) ||
      key.startsWith(LEGACY_DISCOGRAPHY_V2_PREFIX)
    ) {
      keys.push(key);
      continue;
    }
    if (!key.startsWith(`${CACHE_KEYS.ARTIST_DISCOGRAPHY}:`)) continue;
    if (BAD_ARTIST_DISCOGRAPHY_CACHE_MARKERS.some((marker) => lower.includes(marker))) {
      keys.push(key);
    }
  }
  for (const key of keys) storage.removeItem(key);
}

/** Drop stale v1/v2 artist discography keys and bad Kanye alias cache entries. */
export function migrateLegacyResponseCaches(): void {
  try {
    for (const storage of [localStorage, sessionStorage]) {
      purgeBadArtistDiscographyCacheKeys(storage);
    }
  } catch {
    /* ignore */
  }
}
