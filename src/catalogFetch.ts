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

export async function fetchCatalogApiResults(url: string): Promise<CatalogProviderItem[]> {
  if (isAirGapEnabled()) return [];
  const urls = catalogFetchUrls(url);
  const timeoutMs = isCapacitorNative()
    ? NATIVE_CATALOG_FETCH_TIMEOUT_MS
    : DEFAULT_FETCH_TIMEOUT_MS;
  const attempts = isCapacitorNative() ? NATIVE_CATALOG_RETRIES : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    for (const fetchUrl of urls) {
      try {
        const res = await fetchWithTimeout(fetchUrl, undefined, timeoutMs);
        if (!res.ok) continue;
        const contentType = res.headers.get('content-type') ?? '';
        if (!isJsonLikeContentType(contentType)) continue;
        const data = (await res.json()) as { results?: CatalogProviderItem[] };
        const results = data.results ?? [];
        if (results.length > 0) return results;
      } catch {
        /* try next URL */
      }
    }
    if (attempt < attempts - 1) {
      await sleep(1500 * (attempt + 1));
    }
  }
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
