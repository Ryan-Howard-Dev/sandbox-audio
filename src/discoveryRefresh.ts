/**
 * Discovery-refresh policy for the podcast "trending" and audiobook "featured" shelves.
 *
 * Reshuffling/refetching on every visit is wasteful. Instead we cache the resolved set and only
 * refresh after a user-chosen interval (default 3 days), so the shelf stays stable between visits
 * but still updates periodically. Setting: Settings → Podcasts/Audiobooks → Discovery refresh.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const DISCOVERY_REFRESH_KEY = 'sandbox_discovery_refresh_days';
export const DISCOVERY_REFRESH_CHANGE_EVENT = 'sandbox-discovery-refresh-change';

/** 0 = every visit; otherwise the number of days a cached discovery set is kept. */
export type DiscoveryRefreshDays = 0 | 3 | 7;

const DEFAULT_REFRESH_DAYS: DiscoveryRefreshDays = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export function loadDiscoveryRefreshDays(): DiscoveryRefreshDays {
  const raw = prefsGetItem(DISCOVERY_REFRESH_KEY);
  const n = raw != null ? Number(raw) : NaN;
  return n === 0 || n === 3 || n === 7 ? (n as DiscoveryRefreshDays) : DEFAULT_REFRESH_DAYS;
}

export function saveDiscoveryRefreshDays(days: DiscoveryRefreshDays): void {
  prefsSetItem(DISCOVERY_REFRESH_KEY, String(days));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(DISCOVERY_REFRESH_CHANGE_EVENT));
  }
}

type DiscoveryCacheEntry<T> = { at: number; days: number; value: T };

/**
 * Return a cached discovery set if it's still within the refresh window, otherwise call
 * `fetcher`, cache the result, and return it. Cache is persisted per `cacheKey` so it survives
 * app restarts. With days=0 (every visit) the fetcher always runs.
 */
export async function getCachedDiscovery<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  isEmpty: (value: T) => boolean,
): Promise<T> {
  const days = loadDiscoveryRefreshDays();
  const storageKey = `sandbox_discovery_cache:${cacheKey}`;

  if (days > 0) {
    const raw = prefsGetItem(storageKey);
    if (raw) {
      try {
        const entry = JSON.parse(raw) as DiscoveryCacheEntry<T>;
        const fresh = Date.now() - entry.at < days * DAY_MS && entry.days === days;
        if (fresh && !isEmpty(entry.value)) return entry.value;
      } catch {
        /* fall through to refetch */
      }
    }
  }

  const value = await fetcher();
  if (days > 0 && !isEmpty(value)) {
    try {
      prefsSetItem(
        storageKey,
        JSON.stringify({ at: Date.now(), days, value } satisfies DiscoveryCacheEntry<T>),
      );
    } catch {
      /* quota — non-fatal */
    }
  }
  return value;
}
