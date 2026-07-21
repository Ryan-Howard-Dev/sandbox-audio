/**
 * User-facing sanitization for catalog CDN / preview URLs (F-Droid / OSS).
 * Internal fetch URLs stay unchanged; only labels and display/proxy paths are adjusted.
 *
 * Capacitor / Tauri shells load from capacitor:// or asset origins — relative
 * /cover-proxy and /audio-proxy only work when a Sandbox Server is configured
 * or when Vite/Express serves same-origin proxies (ports 5173 / 3002).
 */

import {
  allowCatalogPreviewPlayback,
  catalogArtworkUrl,
  hasSameOriginMediaProxy,
  resolveAppProxyUrl,
  useDirectMediaUpstream,
} from './catalogDirect';
import type { MediaEnvelope, MediaProvider, MediaTransport } from './sandboxLayer1';
import { transportLabel } from './sandboxLayer2';

const CATALOG_CDN_HOST_SUFFIXES = ['mzstatic.com'];

function catalogHost(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function hostMatchesSuffixes(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`));
}

export function isCatalogCdnUrl(url: string): boolean {
  const host = catalogHost(url);
  return host != null && hostMatchesSuffixes(host, CATALOG_CDN_HOST_SUFFIXES);
}

/**
 * Last.fm default/logo/branding tiles — NEVER use as album or track cover art.
 * Real covers may still live on lastfm CDN; only reject known branding placeholders.
 */
const LASTFM_BRANDING_COVER_RE = [
  /lastfm\.com\/images\/default/i,
  /last\.fm\/(?:static|images)\/(?:default|avatar|logo)/i,
  /lastfm\.freetls\.fastly\.net\/i\/u\/[^/]+\/2a96cbd8/i,
  /\/2a96cbd8[0-9a-f]{24}/i,
  /player_\d+\.png/i,
  /lastfm.*(?:logo|avatar|default[_-]?album|default[_-]?artist)/i,
];

function unwrapCoverProxyForSanitize(url: string): string {
  try {
    if (url.includes('/cover-proxy') && url.includes('url=')) {
      const u = new URL(url, 'https://sandbox.local');
      const inner = u.searchParams.get('url');
      if (inner) return decodeURIComponent(inner);
    }
  } catch {
    /* keep original */
  }
  return url;
}

/** True when a URL is served from Last.fm CDN — never use as cover art (legal + UX). */
export function isLastFmCoverHostUrl(url: string | undefined | null): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  const unwrapped = unwrapCoverProxyForSanitize(trimmed);
  try {
    const host = new URL(unwrapped).hostname.toLowerCase();
    return (
      host === 'last.fm' ||
      host.endsWith('.last.fm') ||
      host.includes('lastfm.')
    );
  } catch {
    return /last\.?fm/i.test(unwrapped);
  }
}

/** True when a URL is Last.fm branding (red logo square) — unsafe as cover art. */
export function isLastFmBrandingCoverUrl(url: string | undefined | null): boolean {
  const trimmed = url?.trim();
  if (!trimmed) return false;
  const unwrapped = unwrapCoverProxyForSanitize(trimmed);
  if (isLastFmCoverHostUrl(unwrapped)) return true;
  return LASTFM_BRANDING_COVER_RE.some((re) => re.test(unwrapped));
}

/** Drop Last.fm / branding URLs before persisting or displaying cover art. */
export function sanitizeCoverArtUrl(url: string | undefined | null): string | undefined {
  const trimmed = url?.trim();
  if (!trimmed || isLastFmBrandingCoverUrl(trimmed)) return undefined;
  return trimmed;
}

/** iTunes / Apple Music preview clip length shown in UI when tier34 is offline. */
export const CATALOG_PREVIEW_DURATION_SECONDS = 30;

/** 30s catalog preview streams (audio-ssl CDN hosts). */
export function isCatalogPreviewUrl(url: string): boolean {
  const host = catalogHost(url);
  if (!host) return false;
  return host.includes('audio-ssl');
}

/**
 * Apple preview CDN has no CORS — createMediaElementSource() routes silence while
 * currentTime still advances. Use HTMLAudioElement.volume for these URLs instead.
 */
export function needsDirectElementOutput(url: string): boolean {
  return isCatalogPreviewUrl(url);
}

export function displaySourceUri(
  uri: string | null | undefined,
  index?: number,
): string {
  if (!uri?.trim()) return '—';
  const trimmed = uri.trim();
  if (isCatalogPreviewUrl(trimmed)) return 'Preview stream';
  if (isCatalogCdnUrl(trimmed)) {
    return index != null ? `Catalog source #${index + 1}` : 'Catalog stream';
  }
  if (trimmed.length <= 48) return trimmed;
  return `${trimmed.slice(0, 45)}…`;
}

const PROVIDER_LABELS: Partial<Record<MediaProvider, string>> = {
  'archive-org': 'archive',
  'jamendo': 'jamendo',
  'stream-proxy': 'proxy',
  proxy: 'proxy',
  debrid: 'debrid',
  webtorrent: 'p2p',
  ipfs: 'ipfs',
  soulseek: 'soulseek',
  'local-vault': 'local',
  indexeddb: 'local',
  blob: 'local',
  'dht-swarm': 'swarm',
  http: 'stream',
  https: 'stream',
};

export function displayProviderLabel(
  provider: MediaProvider | string,
  uri?: string | null,
): string {
  if (uri && (isCatalogPreviewUrl(uri) || isCatalogCdnUrl(uri))) return 'catalog';
  return PROVIDER_LABELS[provider as MediaProvider] ?? String(provider);
}

export function displayTransportLabel(
  provider: MediaProvider,
  transport: MediaTransport,
  uri?: string | null,
  resolutionSource?: MediaEnvelope['resolutionSource'],
): 'SERVER' | 'MOBILE' | 'LOCKER' | 'CACHE' | 'PREVIEW' | 'LOCAL' | 'HTTP' | 'PROXY' | 'DEBRID' | 'STREAM' | null {
  if (resolutionSource === 'locker') return 'LOCKER';
  if (resolutionSource === 'cache') return 'CACHE';
  if (resolutionSource === 'server') return 'SERVER';
  if (resolutionSource === 'mobile') return 'MOBILE';
  if (resolutionSource === 'preview') return 'PREVIEW';
  if (uri && isCatalogPreviewUrl(uri)) {
    return allowCatalogPreviewPlayback() ? 'PREVIEW' : null;
  }
  if (uri && /^file:\/\//i.test(uri.trim())) return 'MOBILE';
  const base = transportLabel(provider, transport);
  if (base === 'LOCAL') {
    if (provider === 'stream-cache') return 'CACHE';
    if (provider === 'local-vault' || provider === 'indexeddb' || provider === 'blob') {
      return 'LOCKER';
    }
  }
  if (base === 'PROXY' || base === 'DEBRID') return 'SERVER';
  return base;
}

/** Row/player duration — full catalog length unless dev preview mode is actively playing a clip. */
export function catalogPreviewDurationSeconds(
  fullDurationSeconds?: number,
  options?: { previewUrl?: string | null; playUrl?: string | null; fullStreamAvailable?: boolean },
): number | undefined {
  if (options?.fullStreamAvailable) return fullDurationSeconds;
  const playUrl = options?.playUrl?.trim();
  if (playUrl && isCatalogPreviewUrl(playUrl) && allowCatalogPreviewPlayback()) {
    return CATALOG_PREVIEW_DURATION_SECONDS;
  }
  return fullDurationSeconds;
}

const DISPLAY_FEAT_SUFFIX_RE =
  /\s*[\(\[]\s*(?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[\)\]]|\s+(?:feat\.?|ft\.?|featuring|with)\s+.+$/i;

const TRACK_TITLE_FEAT_CAPTURE_RE =
  /\((?:feat\.?|ft\.?|featuring|with)\s+([^)]+)\)|\[(?:feat\.?|ft\.?|featuring|with)\s+([^\]]+)\]|\b(?:feat\.?|ft\.?|featuring|with)\s+(.+)$/i;

/** Featured artist billing embedded in a track title, e.g. "(feat. Jay-Z & Travis Scott)". */
export function featuredArtistsFromTrackTitle(title: string): string | null {
  const match = title.match(TRACK_TITLE_FEAT_CAPTURE_RE);
  const raw = match?.[1] ?? match?.[2] ?? match?.[3];
  const feat = raw?.trim().replace(/\s*[\]\)]+$/, '').trim();
  return feat || null;
}

/** Strip leading track numbers like "09 I Love Kanye" → "I Love Kanye". */
export function displayTrackTitle(title: string): string {
  const trimmed = title.trim();
  const stripped = trimmed.replace(/^\d{1,2}[\s.\-_]+/i, '').trim();
  return stripped || trimmed;
}

/** Apple Music–style title line — no feat./ft. suffix (credits live on artist line). */
export function displayLockerTrackTitle(title: string): string {
  const base = displayTrackTitle(title);
  const cleaned = base.replace(DISPLAY_FEAT_SUFFIX_RE, '').trim();
  return cleaned || base;
}

/** First non-empty, non–Last.fm artwork URL in the fallback chain. */
export function coalesceArtworkUrl(
  ...urls: (string | undefined | null)[]
): string | undefined {
  for (const url of urls) {
    const safe = sanitizeCoverArtUrl(url);
    if (safe) return safe;
  }
  return undefined;
}

export {
  hasSandboxServerBase,
  preferDirectMediaUrls,
  resolveAppProxyUrl,
  useDirectMediaUpstream,
} from './catalogDirect';

function isTheAudioDbUrl(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith('.theaudiodb.com');
  } catch {
    return false;
  }
}

/** Same-origin Vite/Express (3002/5173) serves /cover-proxy; avoid routing to tier34 :3001. */
function resolveCoverProxyPath(relativePath: string): string {
  if (hasSameOriginMediaProxy()) return relativePath;
  return resolveAppProxyUrl(relativePath);
}

/** Unwrap app-relative cover proxy paths to the upstream HTTPS URL when possible. */
function unwrapCoverProxyUrl(url: string): string {
  if (!url.startsWith('/cover-proxy') && !url.startsWith('/coverart')) return url;
  try {
    const parsed = new URL(url, 'http://local');
    if (parsed.pathname.endsWith('/cover-proxy')) {
      const target = parsed.searchParams.get('url')?.trim();
      if (target) return target;
    }
    if (parsed.pathname.startsWith('/coverart')) {
      return `https://coverartarchive.org${parsed.pathname.replace(/^\/coverart/, '')}${parsed.search}`;
    }
  } catch {
    /* keep original */
  }
  return url;
}

function directDisplayArtworkUrl(url: string): string {
  if (isCatalogCdnUrl(url)) return catalogArtworkUrl(url) ?? url;
  return upgradeInsecureRemoteArtUrl(url);
}

/** WebView mixed-content blocks http:// images on https:// origins (Tauri asset protocol). */
function upgradeInsecureRemoteArtUrl(url: string): string {
  if (!url.startsWith('http://')) return url;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return url;
  } catch {
    return url;
  }
  return url.replace(/^http:\/\//i, 'https://');
}

/** Normalize artwork URLs for equality checks (unwrap /cover-proxy?url=… wrappers). */
export function canonicalArtworkSrc(url: string | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  return unwrapCoverProxyUrl(url.trim());
}

export function proxiedArtworkUrl(url: string | undefined): string | undefined {
  if (!url?.trim()) return url;
  let trimmed = url.trim();
  // Never surface Last.fm logos / default tiles as covers (legal + UX).
  if (isLastFmBrandingCoverUrl(trimmed)) return undefined;
  // Session blob/data URLs are already loadable — proxying breaks error recovery.
  if (trimmed.startsWith('blob:') || trimmed.startsWith('data:')) return trimmed;
  if (typeof window === 'undefined') return directDisplayArtworkUrl(trimmed);

  if (trimmed.startsWith('/cover-proxy') || trimmed.startsWith('/coverart')) {
    const unwrapped = unwrapCoverProxyUrl(trimmed);
    if (unwrapped !== trimmed) {
      trimmed = unwrapped;
    } else if (hasSameOriginMediaProxy()) {
      return resolveCoverProxyPath(trimmed);
    } else {
      return undefined;
    }
  }

  if (trimmed.startsWith('https://coverartarchive.org')) {
    if (useDirectMediaUpstream() || !hasSameOriginMediaProxy()) return trimmed;
    return resolveCoverProxyPath(
      trimmed.replace('https://coverartarchive.org', '/coverart'),
    );
  }
  if (trimmed.startsWith('http://coverartarchive.org')) {
    const https = trimmed.replace('http://', 'https://');
    if (useDirectMediaUpstream() || !hasSameOriginMediaProxy()) return https;
    return resolveCoverProxyPath(https.replace('https://coverartarchive.org', '/coverart'));
  }

  // iTunes mzstatic — <img> loads do not need CORS; never route through tier34 cover-proxy.
  if (isCatalogCdnUrl(trimmed)) {
    return directDisplayArtworkUrl(trimmed);
  }

  if (isTheAudioDbUrl(trimmed)) return upgradeInsecureRemoteArtUrl(trimmed);

  if (hasSameOriginMediaProxy()) {
    return resolveCoverProxyPath(`/cover-proxy?url=${encodeURIComponent(trimmed)}`);
  }

  return upgradeInsecureRemoteArtUrl(trimmed);
}

export function proxiedPlaybackUrl(url: string): string {
  if (!url?.trim()) return url;
  const trimmed = url.trim();
  if (typeof window === 'undefined') return trimmed;
  // HTMLAudioElement loads cross-origin CDN previews without CORS — never proxy these.
  if (isCatalogPreviewUrl(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/audio-proxy')) {
    return resolveAppProxyUrl(trimmed);
  }
  return trimmed;
}
