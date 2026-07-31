/**
 * Unified catalog fetch — same-origin proxy on web dev, direct iTunes on native.
 */

import { isAirGapEnabled } from './airGapMode';
import { catalogChartsUrl } from './catalogApi';
import {
  fetchDirectChartsPayload,
  hasSameOriginCatalogProxy,
  preferDirectCatalog,
  translateDirectCatalogUrl,
  type ChartFetchFilters,
  type ChartRssPayload,
} from './catalogDirect';
import { DEFAULT_FETCH_TIMEOUT_MS, fetchWithTimeout, isJsonLikeContentType } from './fetchWithTimeout';
import { isCapacitorNative } from './platformEnv';

/** Emulator/slow-device iTunes lookups need more headroom than desktop dev proxy. */
const NATIVE_CATALOG_FETCH_TIMEOUT_MS = 35_000;
const NATIVE_CATALOG_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CatalogProviderItem {
  wrapperType?: string;
  kind?: string;
  artistId?: number;
  collectionId?: number;
  trackId?: number;
  artistName?: string;
  collectionName?: string;
  collectionType?: string;
  trackCount?: number;
  trackName?: string;
  trackNumber?: number;
  discNumber?: number;
  releaseDate?: string;
  artworkUrl100?: string;
  artworkUrl60?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  trackExplicitness?: string;
  collectionExplicitness?: string;
}

function catalogFetchUrls(relativeUrl: string): string[] {
  const direct = translateDirectCatalogUrl(relativeUrl);
  if (isAirGapEnabled()) return [];
  if (preferDirectCatalog()) {
    return direct ? [direct] : [];
  }
  if (hasSameOriginCatalogProxy()) {
    return direct ? [relativeUrl, direct] : [relativeUrl];
  }
  return direct ? [direct] : [];
}

/*
 * Why a catalog fetch came back with nothing.
 *
 * Every failure here used to collapse to the same empty array: a refused connection, an HTTP
 * error, an HTML captive-portal reply, and a genuine zero-result query were indistinguishable to
 * the caller and to the user, who is told "no matches for this query" either way. That is how a
 * search returning nothing on a device with working network went unexplained — there was no signal
 * to read anywhere in the stack.
 */
function catalogFetchHost(url: string): string {
  try {
    return new URL(url, 'https://localhost').host || 'relative';
  } catch {
    return 'unparsed';
  }
}

export async function fetchCatalogApiResults(url: string): Promise<CatalogProviderItem[]> {
  if (isAirGapEnabled()) return [];
  const urls = catalogFetchUrls(url);
  if (urls.length === 0) {
    console.warn(`[catalogFetch] no candidate urls for ${url} — nothing was requested`);
    return [];
  }
  const timeoutMs = isCapacitorNative()
    ? NATIVE_CATALOG_FETCH_TIMEOUT_MS
    : DEFAULT_FETCH_TIMEOUT_MS;
  const attempts = isCapacitorNative() ? NATIVE_CATALOG_RETRIES : 1;
  const outcomes: string[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const fetchUrl of urls) {
      const host = catalogFetchHost(fetchUrl);
      try {
        const res = await fetchWithTimeout(fetchUrl, undefined, timeoutMs);
        if (!res.ok) {
          outcomes.push(`${host} http=${res.status}`);
          continue;
        }
        const contentType = res.headers.get('content-type') ?? '';
        if (!isJsonLikeContentType(contentType)) {
          outcomes.push(`${host} contentType=${contentType || 'none'}`);
          continue;
        }
        const data = (await res.json()) as { results?: CatalogProviderItem[] };
        const results = data.results ?? [];
        if (results.length > 0) return results;
        outcomes.push(`${host} ok-but-empty`);
      } catch (err) {
        outcomes.push(`${host} threw=${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (attempt < attempts - 1) {
      await sleep(1500 * (attempt + 1));
    }
  }
  console.warn(`[catalogFetch] empty for ${url} after ${outcomes.join(' | ')}`);
  return [];
}

export async function fetchCatalogChartsPayload(
  limit: number,
  filters?: ChartFetchFilters,
): Promise<ChartRssPayload | null> {
  if (isAirGapEnabled()) return null;

  if (preferDirectCatalog() || !hasSameOriginCatalogProxy()) {
    const direct = await fetchDirectChartsPayload(limit, filters, (input, init) =>
      fetchWithTimeout(input, init),
    );
    if (direct) return direct;
  }

  if (hasSameOriginCatalogProxy()) {
    try {
      const res = await fetchWithTimeout(catalogChartsUrl(limit, filters));
      if (res.ok) {
        return (await res.json()) as ChartRssPayload;
      }
    } catch {
      /* fall through to direct */
    }
  }

  return fetchDirectChartsPayload(limit, filters, (input, init) =>
    fetchWithTimeout(input, init),
  );
}
