/**
 * Direct public catalog providers — used on Capacitor native (no dev proxy)
 * and as a web fallback when /api/catalog/* is unavailable.
 */

import { isCapacitorNative, isTauri } from './platformEnv';
import { loadShowExperimentalIntegrations } from './sandboxSettings';
import { prefsGetItem } from './prefsStorage';
import { getTier34BaseUrl, isTier34ReachableCached } from './tier34/client';

const CATALOG_PREVIEW_DEV_KEY = 'sandbox_catalog_preview_dev';

export const ITUNES_SEARCH = 'https://itunes.apple.com/search';
export const ITUNES_LOOKUP = 'https://itunes.apple.com/lookup';
export const APPLE_CHARTS_RSS =
  'https://rss.applemarketingtools.com/api/v2/us/music/most-played';

export function preferDirectCatalog(): boolean {
  return isCapacitorNative() || isTauri();
}

/** True when tier 3/4 full-stream resolution has a live Sandbox Server (recent /health OK). */
export function canResolveFullStreams(): boolean {
  return Boolean(getTier34BaseUrl().trim()) && isTier34ReachableCached();
}

/**
 * Dev-only iTunes 30s preview playback — off by default.
 * Enable via Settings → Experimental integrations or `sandbox_catalog_preview_dev=1`.
 */
export function allowCatalogPreviewPlayback(): boolean {
  if (loadShowExperimentalIntegrations()) return true;
  try {
    return prefsGetItem(CATALOG_PREVIEW_DEV_KEY) === '1';
  } catch {
    return false;
  }
}

/** iTunes preview CDN URL — empty unless dev preview mode is explicitly enabled. */
export function catalogPlayUrlFromPreview(previewUrl?: string | null): string {
  if (!allowCatalogPreviewPlayback()) return '';
  return previewUrl?.trim() ?? '';
}

/** Direct iTunes artwork CDN URL — safe for <img> on Tauri/Capacitor (no CORS). */
export function catalogArtworkUrl(
  artworkUrl100?: string | null,
  artworkUrl60?: string | null,
): string | undefined {
  const raw = artworkUrl100?.trim() || artworkUrl60?.trim();
  if (!raw) return undefined;
  if (/600x600/i.test(raw)) return raw;
  return raw
    .replace(/(\d+)x(\d+)bb\.(jpg|jpeg|png|webp)/i, '600x600bb.$3')
    .replace(/(\d+)x(\d+)\.(jpg|jpeg|png|webp)/i, '600x600.$3')
    .replace('100x100bb.jpg', '600x600bb.jpg')
    .replace('100x100.jpg', '600x600.jpg')
    .replace('60x60bb.jpg', '600x600bb.jpg');
}

/** Reliable list-thumb size — 100×100 iTunes tiles load everywhere; 600×600 can 404. */
export function catalogThumbArtworkUrl(url?: string | null): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  if (!/mzstatic\.com/i.test(raw)) return raw;
  if (/100x100bb/i.test(raw)) return raw;
  return raw
    .replace(/600x600bb/i, '100x100bb')
    .replace(/(\d+)x(\d+)bb\.(jpg|jpeg|png|webp)/i, '100x100bb.$3')
    .replace(/(\d+)x(\d+)\.(jpg|jpeg|png|webp)/i, '100x100.$3');
}

/** True when bundled Express/Vite serves /cover-proxy and /audio-proxy on the page origin. */
export function hasSameOriginMediaProxy(): boolean {
  return hasSameOriginCatalogProxy();
}

/**
 * Native shells cannot resolve app-relative proxy paths without a configured Sandbox Server.
 * Use direct HTTPS CDN URLs instead (img/audio elements do not need CORS).
 */
export function preferDirectMediaUrls(): boolean {
  if (isCapacitorNative()) return true;
  if (isTauri() && !hasSameOriginMediaProxy()) return true;
  return false;
}

export function hasSandboxServerBase(): boolean {
  return Boolean(getTier34BaseUrl().trim());
}

/** Prefix app-relative proxy paths with the configured Sandbox Server URL. */
export function resolveAppProxyUrl(relativePath: string): string {
  if (!relativePath.startsWith('/')) return relativePath;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return relativePath;
  // Tier34 exposes /api/proxy/stream; bundled Express (3002/5173) serves /audio-proxy.
  if (relativePath.startsWith('/audio-proxy')) {
    try {
      const parsed = new URL(relativePath, 'http://local');
      const target = parsed.searchParams.get('url');
      if (target?.trim()) {
        return `${base}/api/proxy/stream?url=${encodeURIComponent(target.trim())}`;
      }
    } catch {
      /* fall through */
    }
  }
  return `${base}${relativePath}`;
}

/**
 * Use direct HTTPS CDN URLs for <img> artwork on native / bundled shells.
 * tier34 (:3001) does not expose /cover-proxy (only Express :3002 / Vite :5173 do),
 * and img loads do not need CORS — routing mzstatic through tier34 breaks album art.
 */
export function useDirectMediaUpstream(): boolean {
  return preferDirectMediaUrls();
}

/** Vite dev / bundled Express serve same-origin /api/catalog/*. */
export function hasSameOriginCatalogProxy(): boolean {
  if (typeof window === 'undefined') return false;
  const port = window.location.port;
  return port === '5173' || port === '3002';
}

/** Map /api/catalog/* to iTunes or Apple charts upstream. Charts need fetchCatalogChartsData. */
export function translateDirectCatalogUrl(relativeUrl: string): string | null {
  if (!relativeUrl.startsWith('/api/catalog/')) return null;
  try {
    const parsed = new URL(relativeUrl, 'http://local');
    const params = parsed.searchParams;
    if (parsed.pathname === '/api/catalog/search') {
      return `${ITUNES_SEARCH}?${params.toString()}`;
    }
    if (parsed.pathname === '/api/catalog/lookup') {
      return `${ITUNES_LOOKUP}?${params.toString()}`;
    }
  } catch {
    return null;
  }
  return null;
}

export interface ChartRssGenre {
  genreId?: string;
  name?: string;
}

export interface ChartRssSong {
  id?: string;
  name?: string;
  artistName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  contentAdvisoryRating?: string;
  genres?: ChartRssGenre[];
}

export interface ChartRssPayload {
  feed?: { results?: ChartRssSong[] };
}

export interface ChartFetchFilters {
  genre?: string;
  yearMin?: number;
  yearMax?: number;
}

/** Fetch Apple Marketing Tools chart RSS (mirrors server.ts filtering). */
export async function fetchDirectChartsPayload(
  limit: number,
  filters?: ChartFetchFilters,
  fetchFn: typeof fetch = fetch,
): Promise<ChartRssPayload | null> {
  const rawLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 25;
  const genreFilter = filters?.genre;
  const yearMin = filters?.yearMin;
  const yearMax = filters?.yearMax;
  const needsFilter =
    Boolean(genreFilter) || yearMin !== undefined || yearMax !== undefined;
  const fetchLimit = needsFilter ? Math.max(rawLimit, 100) : rawLimit;

  try {
    const target = `${APPLE_CHARTS_RSS}/${fetchLimit}/songs.json`;
    const res = await fetchFn(target, { headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const data = (await res.json()) as ChartRssPayload;
    if (!needsFilter) return data;

    const filtered = (data.feed?.results ?? []).filter((song) => {
      if (yearMin !== undefined || yearMax !== undefined) {
        const year = parseInt(String(song.releaseDate ?? '').slice(0, 4), 10);
        if (!Number.isFinite(year)) return false;
        if (yearMin !== undefined && year < yearMin) return false;
        if (yearMax !== undefined && year > yearMax) return false;
      }
      if (genreFilter) {
        const ids = new Set((song.genres ?? []).map((g) => g.genreId).filter(Boolean));
        if (!ids.has(genreFilter)) return false;
      }
      return true;
    });

    return {
      ...data,
      feed: {
        ...data.feed,
        results: filtered.slice(0, rawLimit),
      },
    };
  } catch {
    return null;
  }
}
