/**
 * Hybrid resolution pipeline — single entry point for playback source selection.
 * Order: Locker → Stream Cache → Sandbox Server → Mobile Resolvers → Catalog Preview.
 */

import type { CandidateSource, MediaEnvelope, MediaProvider, MediaTransport } from './sandboxLayer1';
import {
  allowCatalogPreviewPlayback,
  catalogPlayUrlFromPreview,
} from './catalogDirect';
import { catalogTrackIdFromEnvelope } from './catalogTrackId';
import { catalogLookupUrl } from './catalogApi';
import { fetchCatalogApiResults } from './catalogFetch';
import {
  CATALOG_PREVIEW_DURATION_SECONDS,
  isCatalogPreviewUrl,
  proxiedPlaybackUrl,
} from './displaySanitize';
import {
  getCachedStreamForTrack,
  getStreamCacheEnvelope,
  putCachedStream,
  removeCachedStream,
  resolutionQueryFromEnvelope,
} from './streamCache';
import { tryMobileResolve, preferFreshMobileResolve, hasActiveMobileResolvers } from './mobileResolverRegistry';
import { isAndroid } from './platformEnv';
import { isOfflineUnplayableStreamUrl, localDevicePlayUrlReachable } from './nativeExoStreamResolver';
import { getTier34BaseUrl, isServerReachableCached } from './tier34/client';
import { logTierResolution } from './tierResolutionLog';

export type ResolutionSource = 'locker' | 'cache' | 'server' | 'mobile' | 'preview';

export type ResolvedPlaybackSource = {
  uri: string;
  source: ResolutionSource;
  query: string;
  format?: string;
  bitrate?: number;
  provider?: MediaProvider;
  transport?: MediaTransport;
  resolvedAt: number;
  title?: string;
  artist?: string;
  durationSeconds?: number;
};

export const HYBRID_RESOLUTION_ORDER: ResolutionSource[] = [
  'locker',
  'cache',
  'server',
  'mobile',
  'preview',
];

const LAST_RESOLVED_KEY = 'sandbox_last_resolved_source_v1';

type LastResolvedSnapshot = {
  source: ResolutionSource;
  title: string;
  artist: string;
  at: number;
};

export function getResolutionOrder(): ResolutionSource[] {
  return [...HYBRID_RESOLUTION_ORDER];
}

export function getLastResolvedSource(): LastResolvedSnapshot | null {
  try {
    const raw = localStorage.getItem(LAST_RESOLVED_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as LastResolvedSnapshot;
  } catch {
    return null;
  }
}

function noteLastResolved(source: ResolutionSource, track: MediaEnvelope): void {
  const snap: LastResolvedSnapshot = {
    source,
    title: track.title,
    artist: track.artist,
    at: Date.now(),
  };
  localStorage.setItem(LAST_RESOLVED_KEY, JSON.stringify(snap));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event('sandbox-resolution-change'));
  }
}

/** yt-dlp search queries — album-qualified first to avoid wrong-track hits (e.g. FATHER → Follow God). */
function isUsableAlbumForQuery(album: string): boolean {
  const trimmed = album.trim();
  if (!trimmed) return false;
  if (trimmed.includes('...') || trimmed.includes('…')) return false;
  if (trimmed.length > 48) return false;
  return true;
}

export function buildPlayQueries(env: MediaEnvelope): string[] {
  const title = env.title?.trim() ?? '';
  const artist = env.artist?.trim() ?? '';
  const album = env.album?.trim() ?? '';
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || seen.has(trimmed)) return;
    seen.add(trimmed);
    ordered.push(trimmed);
  };

  const albumDistinct = Boolean(album && album.toLowerCase() !== title.toLowerCase());
  const albumUsable = isUsableAlbumForQuery(album);

  if (title && artist && album && albumDistinct && albumUsable) {
    push(`${artist} ${album} ${title}`);
    push(`${artist} ${album} ${title} official audio`);
    push([title, artist, album].join(' '));
  }
  if (title && artist && album && !albumDistinct) {
    push(`${artist} ${title} official audio`);
    push(`${artist} ${title} track`);
  }
  if (title && artist) {
    push(`${artist} ${title}`);
    if (!albumDistinct || !albumUsable) {
      push(`${artist} ${title} official audio`);
    }
  }
  push([title, artist, albumUsable ? album : ''].filter(Boolean).join(' '));

  return ordered;
}

/** Best single yt-dlp query — one native resolve per tap (sequential multi-query was ~14s lag). */
export function primaryMobilePlayQuery(env: MediaEnvelope): string {
  const queries = buildPlayQueries(env);
  return queries[0] ?? resolutionQueryFromEnvelope(env);
}

/** Second-chance query when album-qualified search misses (shorter invidious/ytsearch string). */
export function mobileFallbackPlayQuery(env: MediaEnvelope): string | null {
  const title = env.title?.trim() ?? '';
  const artist = env.artist?.trim() ?? '';
  if (!title || !artist) return null;
  const bare = `${artist} ${title}`;
  const primary = primaryMobilePlayQuery(env);
  return bare !== primary ? bare : null;
}

function isLocalProvider(provider: MediaProvider): boolean {
  return (
    provider === 'local-vault' ||
    provider === 'stream-cache' ||
    provider === 'indexeddb' ||
    provider === 'blob'
  );
}

function lockerFromTrack(track: MediaEnvelope): ResolvedPlaybackSource | null {
  const url = track.url?.trim() ?? '';
  if (!url) return null;
  if (url.startsWith('blob:')) {
    const lockerProvider =
      track.provider === 'local-vault' ||
      track.provider === 'indexeddb' ||
      track.provider === 'blob';
    if (!lockerProvider || isAndroid()) return null;
  } else if (isOfflineUnplayableStreamUrl(url)) {
    return null;
  }
  if (track.provider === 'local-vault' || track.provider === 'indexeddb' || track.provider === 'blob') {
    return {
      uri: url,
      source: 'locker',
      query: resolutionQueryFromEnvelope(track),
      provider: track.provider,
      transport: track.transport,
      resolvedAt: Date.now(),
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
    };
  }
  return null;
}

function lockerFromCandidates(
  track: MediaEnvelope,
  candidates?: CandidateSource[],
): ResolvedPlaybackSource | null {
  for (const c of candidates ?? []) {
    if (c.provider !== 'local-vault') continue;
    const uri = c.uri?.trim();
    if (!uri) continue;
    // Stale locker metadata (revoked blob: or dead tier34 proxy) must not block mobile resolve.
    if (uri.startsWith('blob:')) continue;
    if (isOfflineUnplayableStreamUrl(uri)) continue;
    return {
      uri,
      source: 'locker',
      query: resolutionQueryFromEnvelope(track),
      provider: 'local-vault',
      transport: c.transport,
      resolvedAt: Date.now(),
      title: c.metadata?.title ?? track.title,
      artist: c.metadata?.artist ?? track.artist,
      durationSeconds: c.metadata?.durationSeconds ?? track.durationSeconds,
    };
  }
  return null;
}

async function cacheFromTrack(track: MediaEnvelope): Promise<ResolvedPlaybackSource | null> {
  if (preferFreshMobileResolve() && !isLocalProvider(track.provider)) {
    return null;
  }
  const query = resolutionQueryFromEnvelope(track);
  const uriHit = getCachedStreamForTrack(track);
  if (uriHit?.uri && !isCatalogPreviewUrl(uriHit.uri) && !isOfflineUnplayableStreamUrl(uriHit.uri)) {
    if (/^file:\/\//i.test(uriHit.uri)) {
      const reachable = await localDevicePlayUrlReachable(uriHit.uri);
      if (!reachable) {
        removeCachedStream(uriHit.query);
      } else {
        return {
          uri: uriHit.uri,
          source: 'cache',
          query,
          resolvedAt: uriHit.resolvedAt,
        };
      }
    } else {
      return {
        uri: uriHit.uri,
        source: 'cache',
        query,
        resolvedAt: uriHit.resolvedAt,
      };
    }
  }

  const blobHit = await getStreamCacheEnvelope(track);
  if (blobHit?.url?.trim()) {
    return {
      uri: blobHit.url,
      source: 'cache',
      query,
      provider: 'stream-cache',
      transport: 'element-src',
      resolvedAt: Date.now(),
      title: blobHit.title,
      artist: blobHit.artist,
      durationSeconds: blobHit.durationSeconds,
    };
  }
  return null;
}

async function serverFromTrack(
  track: MediaEnvelope,
  candidates?: CandidateSource[],
): Promise<ResolvedPlaybackSource | null> {
  const base = getTier34BaseUrl().trim();
  if (!base || !isServerReachableCached()) return null;

  const { resolveSandboxServerStream } = await import('./playbackPipeline');
  const env = await resolveSandboxServerStream(track, candidates);
  if (!env?.url?.trim() || isCatalogPreviewUrl(env.url)) return null;

  const query = resolutionQueryFromEnvelope(track);
  putCachedStream({ query, uri: env.url, source: 'server' });
  logTierResolution({
    query: buildPlayQueries(track)[0] ?? '',
    tier: 3,
    provider: 'hybrid-server',
    outcome: 'hit',
    detail: env.provider,
  });

  return {
    uri: env.url,
    source: 'server',
    query,
    provider: env.provider,
    transport: env.transport,
    resolvedAt: Date.now(),
    title: env.title,
    artist: env.artist,
    durationSeconds: env.durationSeconds,
  };
}

async function mobileFromTrack(track: MediaEnvelope): Promise<ResolvedPlaybackSource | null> {
  const cacheQuery = resolutionQueryFromEnvelope(track);
  const queries = buildPlayQueries(track).slice(0, 3);

  const tryOne = async (query: string): Promise<ResolvedPlaybackSource | null> => {
    const uri = await tryMobileResolve(query);
    if (!uri) return null;
    putCachedStream({ query: cacheQuery, uri, source: 'mobile' });
    logTierResolution({
      query,
      tier: 2,
      provider: 'mobile-resolver',
      outcome: 'hit',
      detail: 'on-device addon',
    });
    return {
      uri,
      source: 'mobile',
      query: cacheQuery,
      provider: 'https',
      transport: 'element-src',
      resolvedAt: Date.now(),
      title: track.title,
      artist: track.artist,
      durationSeconds: track.durationSeconds,
    };
  };

  for (const query of queries) {
    const hit = await tryOne(query);
    if (hit) return hit;
  }
  return null;
}

async function previewFromTrack(track: MediaEnvelope): Promise<ResolvedPlaybackSource | null> {
  if (!allowCatalogPreviewPlayback()) return null;

  const trackId = catalogTrackIdFromEnvelope(track);
  let preview: string | null = null;
  const existing = track.url?.trim();
  if (existing && isCatalogPreviewUrl(existing)) {
    preview = existing;
  } else if (existing) {
    preview = catalogPlayUrlFromPreview(existing) || null;
  }
  if (!preview && trackId) {
    try {
      const items = await fetchCatalogApiResults(catalogLookupUrl({ id: trackId }));
      preview = items[0]?.previewUrl?.trim() || null;
    } catch {
      preview = null;
    }
  }
  if (!preview) return null;

  return {
    uri: proxiedPlaybackUrl(preview),
    source: 'preview',
    query: resolutionQueryFromEnvelope(track),
    provider: 'https',
    transport: 'element-src',
    resolvedAt: Date.now(),
    durationSeconds: CATALOG_PREVIEW_DURATION_SECONDS,
    title: track.title,
    artist: track.artist,
  };
}

/**
 * Auto-select playback source — no manual mode switch.
 * Never throws; returns null when all steps fail.
 */
export async function resolvePlaybackSource(
  track: MediaEnvelope,
  candidates?: CandidateSource[],
): Promise<ResolvedPlaybackSource | null> {
  const catalogMeta = { ...track };

  if (isLocalProvider(catalogMeta.provider) && catalogMeta.url?.trim()) {
    const hit = lockerFromTrack(catalogMeta);
    if (hit) {
      noteLastResolved('locker', catalogMeta);
      return hit;
    }
  }

  const lockerCandidate = lockerFromCandidates(catalogMeta, candidates);
  if (lockerCandidate) {
    noteLastResolved('locker', catalogMeta);
    return lockerCandidate;
  }

  const androidMobileFirst =
    isAndroid() &&
    hasActiveMobileResolvers() &&
    !isLocalProvider(catalogMeta.provider);

  if (preferFreshMobileResolve() || androidMobileFirst) {
    const mobileHit = await mobileFromTrack(catalogMeta);
    if (mobileHit) {
      noteLastResolved('mobile', catalogMeta);
      return mobileHit;
    }
  }

  if (preferFreshMobileResolve()) {
    return null;
  } else {
    const cacheHit = await cacheFromTrack(catalogMeta);
    if (cacheHit) {
      noteLastResolved('cache', catalogMeta);
      return cacheHit;
    }

    const serverHit = await serverFromTrack(catalogMeta, candidates);
    if (serverHit) {
      noteLastResolved('server', catalogMeta);
      return serverHit;
    }

    const mobileHit = await mobileFromTrack(catalogMeta);
    if (mobileHit) {
      noteLastResolved('mobile', catalogMeta);
      return mobileHit;
    }
  }

  const previewHit = await previewFromTrack(catalogMeta);
  if (previewHit) {
    noteLastResolved('preview', catalogMeta);
    return previewHit;
  }

  return null;
}

export const HYBRID_OFFLINE_MESSAGE =
  'Playback source unavailable. Install a mobile resolver, reconnect to Sandbox Server, or download media to Locker.';

export function envelopeFromResolved(
  base: MediaEnvelope,
  resolved: ResolvedPlaybackSource,
): MediaEnvelope {
  return {
    ...base,
    url: resolved.uri,
    provider: resolved.provider ?? base.provider,
    transport: resolved.transport ?? base.transport,
    title: resolved.title ?? base.title,
    artist: resolved.artist ?? base.artist,
    durationSeconds: resolved.durationSeconds ?? base.durationSeconds,
    resolutionSource: resolved.source,
  };
}
