/**
 * YouTube / web search supplement for tracks missing from the iTunes catalog
 * (leaks, previews, unofficial uploads).
 */

import { isAirGapEnabled } from './airGapMode';
import { searchProxy } from './addons/searchProviders';
import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
import type { CatalogSearchResult, CatalogTrack } from './searchCatalog';
import { expandFuzzyQueryCorrections, needsWebTrackSupplement, parseCombinedTrackQuery } from './searchCatalog';
import { getTier34BaseUrl } from './tier34/client';
import { searchViaYoutubeWebMobile } from './pipedMobile';
import { raceTimeout } from './fetchWithTimeout';
import {
  isYtDlpMobileNativeAvailable,
  searchViaYtDlpMobile,
  type YtDlpMobileSearchHit,
} from './ytDlpMobile';

/** Hard cap for one user search — show partial results or timeout error after this. */
export const WEB_SEARCH_MAX_WAIT_MS = 75_000;
/** Leak/cover queries — yt-dlp cold start on device can exceed 50s. */
export const WEB_LEAK_SEARCH_MAX_WAIT_MS = 90_000;
/** Per-query attempt — yt-dlp cold init can take 20–30s on first search. */
const WEB_QUERY_TIMEOUT_MS = 20_000;
const WEB_LEAK_QUERY_TIMEOUT_MS = 55_000;
const MAX_PARALLEL_WEB_QUERIES = 4;

export type FetchWebCatalogOptions = {
  /** Called whenever new web hits are merged (progressive UI). */
  onPartial?: (tracks: CatalogTrack[]) => void;
  maxWaitMs?: number;
};

function normalizeWebText(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[¥$,]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function queryTokens(query: string): string[] {
  return normalizeWebText(query).split(' ').filter((t) => t.length > 1);
}

const WEB_SEARCH_ARTIST_FALLBACK = 'Unknown artist';
export function buildWebSearchQueries(rawQuery: string): string[] {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const q = value.trim().replace(/\s+/g, ' ');
    const key = normalizeWebText(q);
    if (q.length < 2 || !key || seen.has(key)) return;
    seen.add(key);
    out.push(q);
  };

  push(trimmed);
  push(trimmed.replace(/\bdollar sign\b/gi, '$'));
  push(trimmed.replace(/\s*[-–—]\s*/g, ' '));
  push(normalizeWebText(trimmed));

  const tokens = queryTokens(trimmed);
  if (tokens.length >= 3) {
    const shortArtists = new Set(['kanye', 'ye', 'drake', 'jay', 'travis', 'kendrick']);
    const last = tokens[tokens.length - 1];
    const first = tokens[0];
    if (last && shortArtists.has(last)) {
      const title = tokens
        .slice(0, -1)
        .map((t) => (t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t))
        .join(' ');
      push(`${last === 'ye' || last === 'kanye' ? 'Kanye West' : last} ${title}`);
      push(`${title} ${last}`);
    }
    if (first && shortArtists.has(first)) {
      const title = tokens
        .slice(1)
        .map((t) => (t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t))
        .join(' ');
      push(`${first === 'ye' || first === 'kanye' ? 'Kanye West' : first} ${title}`);
      push(`${title} ${first}`);
    }
  }

  const dash = trimmed.match(/^(.+?)\s*[-–—]\s*(.+)$/);
  if (dash) {
    const artists = dash[1].trim();
    const title = dash[2].trim();
    push(`${title} ${artists}`);
    push(`${title} ${artists.replace(/[¥$,]/g, ' ')}`);
    for (const artist of expandArtistBilling(artists)) {
      push(`${artist} ${title}`);
    }
  }

  const hasYe = tokens.some((t) => t === 'ye' || t.startsWith('kany'));
  const titleish = tokens.filter(
    (t) => !['ye', 'ty', 'dolla', 'sign', 'ign', 'kanye', 'west', 'kany'].includes(t),
  );
  if (hasYe && titleish.length > 0) {
    const focusTokens = titleish.filter(
      (t) => !['dollar', 'sign', 'ty', 'dolla', 'ign'].includes(t),
    );
    const focusParts = focusTokens.length > 0 ? focusTokens : titleish;
    const focus = focusParts
      .map((t) => (t.length > 0 ? t.charAt(0).toUpperCase() + t.slice(1) : t))
      .join(' ');
    push(`Kanye West ${focus}`);
    push(`Ye ${focus}`);
    push(`${focus} Kanye West`);
  }

  const combined = parseCombinedTrackQuery(trimmed);
  if (combined) {
    push(`${combined.artist} ${combined.title}`);
    push(`${combined.title} ${combined.artist}`);
    if (/kany|ye/i.test(combined.artist)) {
      push(`Kanye West ${combined.title}`);
      push(`Ye ${combined.title}`);
    }
  }

  const collapsed = trimmed.replace(/\bback\s*street\b/gi, 'backstreet');
  const hasBackstreet = /backstreet/i.test(collapsed);
  const hasKanye = /\b(kanye|ye)\b/i.test(collapsed);
  const hasCover = /\bcover|karaoke|covered\b/i.test(collapsed);
  if (hasBackstreet && (hasKanye || hasCover)) {
    push('Kanye West Backstreet Boys I Want It That Way cover');
    push('Kanye West I Want It That Way karaoke');
    push('Ye Backstreet Boys cover');
    push('Kanye Backstreet Boys karaoke Mark Zuckerberg');
  }
  if (/want.*that.*way/i.test(collapsed) && hasKanye) {
    push('Kanye West I Want It That Way cover');
    push('Ye I Want It That Way karaoke');
  }
  if (hasKanye && hasBackstreet) {
    push('Kanye West backstreet boys cover');
    push('kanye backstreet boys i want it that way');
  }

  for (const corrected of expandFuzzyQueryCorrections(trimmed)) {
    push(corrected);
  }

  return out.slice(0, 12);
}

function expandArtistBilling(billing: string): string[] {
  const cleaned = billing
    .replace(/[¥$]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const artists = new Set<string>();
  if (cleaned) artists.add(cleaned);
  if (/ye|kanye|¥/i.test(billing)) {
    artists.add('Kanye West');
    artists.add('Ye');
  }
  if (/ty dolla/i.test(billing)) {
    artists.add('Ty Dolla $ign');
  }
  return [...artists];
}

function parseYoutubeMusicTitle(rawTitle: string): { title: string; artist: string } {
  let cleaned = rawTitle
    .replace(/\s*\((official audio|official video|lyrics|audio|visualizer|hq|hd)[^)]*\)/gi, '')
    .replace(/\s*\[[^\]]+\]/g, '')
    .trim();
  cleaned = cleaned.replace(/\s*(?:\(|\[)?(?:feat\.?|ft\.?|featuring)[^)\]]*(?:\)|\])?/gi, '').trim();

  const split = cleaned.match(/^(.+?)\s*[-–—|:]\s*(.+)$/);
  if (split) {
    const left = split[1].trim();
    const right = split[2].trim();
    if (left.length >= 2 && right.length >= 2) {
      const leftNorm = normalizeWebText(left);
      const rightNorm = normalizeWebText(right);
      const rightLooksLikeArtists =
        /\b(kanye|ye|west|dolla|sign|ty)\b/.test(rightNorm) ||
        right.includes('¥') ||
        right.includes('$');
      const leftLooksLikeTitle =
        /\b(dress|melrose|cover|karaoke|remix|leak)\b/.test(leftNorm) ||
        left.split(/\s+/).length >= 3;
      if (rightLooksLikeArtists && leftLooksLikeTitle) {
        return { title: left, artist: right };
      }
      if (left.length <= 40 && right.length <= 40) {
        return { artist: left, title: right };
      }
    }
  }
  return { title: cleaned || rawTitle.trim(), artist: WEB_SEARCH_ARTIST_FALLBACK };
}

/** @internal test hook */
export function parseYoutubeMusicTitleForTest(raw: string) {
  return parseYoutubeMusicTitle(raw);
}

function extractWatchUrl(candidate: CandidateSource): string | undefined {
  const uri = candidate.uri?.trim();
  if (!uri) return undefined;
  if (/youtube\.com|youtu\.be/i.test(uri)) return uri;
  try {
    const parsed = new URL(uri, 'http://localhost');
    const nested = parsed.searchParams.get('url');
    if (nested && /youtube\.com|youtu\.be/i.test(nested)) return nested;
  } catch {
    /* ignore */
  }
  return undefined;
}

function youtubeThumb(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

function extractVideoId(watchUrl: string, fallbackId?: string): string | undefined {
  const trimmed = watchUrl.trim();
  const watch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watch?.[1]) return watch[1];
  const short = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short?.[1]) return short[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(fallbackId ?? '')) return fallbackId;
  return undefined;
}

function hitToCatalogTrack(
  hit: {
    id: string;
    title: string;
    artist: string;
    watchUrl: string;
    durationSeconds?: number;
  },
): CatalogTrack | null {
  const watchUrl = hit.watchUrl.trim();
  const videoId = extractVideoId(watchUrl, hit.id);
  if (!videoId) return null;

  const parsed = parseYoutubeMusicTitle(hit.title);
  const artist =
    hit.artist &&
    hit.artist !== 'YouTube' &&
    hit.artist !== 'YouTube Music' &&
    hit.artist !== WEB_SEARCH_ARTIST_FALLBACK
      ? hit.artist
      : parsed.artist;
  const title = parsed.title || hit.title;

  return {
    kind: 'track',
    id: `youtube-${videoId}`,
    title,
    artist,
    artworkUrl: youtubeThumb(videoId),
    durationSeconds: hit.durationSeconds,
    envelope: {
      envelopeId: `youtube-${videoId}`,
      title,
      artist,
      url: watchUrl,
      durationSeconds: hit.durationSeconds ?? 210,
      provider: 'proxy',
      transport: 'proxy',
      sourceId: videoId,
      artworkUrl: youtubeThumb(videoId),
    },
  };
}

function candidateToHit(candidate: CandidateSource, index: number): YtDlpMobileSearchHit | null {
  const watchUrl = extractWatchUrl(candidate);
  const title = candidate.metadata?.title?.trim();
  if (!watchUrl || !title) return null;
  const videoId = extractVideoId(watchUrl, candidate.id);
  if (!videoId) return null;
  return {
    id: videoId,
    title,
    artist: candidate.metadata?.artist?.trim() || WEB_SEARCH_ARTIST_FALLBACK,
    watchUrl,
    durationSeconds: candidate.metadata?.durationSeconds,
  };
}

async function searchProxyOnce(query: string): Promise<CatalogTrack[]> {
  const base = getTier34BaseUrl().trim();
  if (!base) return [];
  const candidates = await searchProxy(query, base);
  const tracks: CatalogTrack[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const hit = candidateToHit(candidate, index);
    if (!hit) continue;
    const track = hitToCatalogTrack(hit);
    if (track) tracks.push(track);
  }
  return tracks;
}

async function searchMobileOnce(query: string): Promise<CatalogTrack[]> {
  if (!isYtDlpMobileNativeAvailable()) return [];
  const hits = await searchViaYtDlpMobile(query, 8);
  const tracks: CatalogTrack[] = [];
  for (const hit of hits) {
    const track = hitToCatalogTrack(hit);
    if (track) tracks.push(track);
  }
  return tracks;
}

async function searchPipedOnce(query: string): Promise<CatalogTrack[]> {
  const hits = await searchViaYoutubeWebMobile(query, 8);
  const tracks: CatalogTrack[] = [];
  for (const hit of hits) {
    const track = hitToCatalogTrack(hit);
    if (track) tracks.push(track);
  }
  return tracks;
}

async function searchOneQuery(
  q: string,
  forceWeb: boolean,
  timeoutMs: number,
): Promise<CatalogTrack[]> {
  const [mobile, piped, proxy] = await Promise.all([
    isYtDlpMobileNativeAvailable()
      ? raceTimeout(searchMobileOnce(q), timeoutMs)
      : Promise.resolve(null),
    raceTimeout(searchPipedOnce(q), timeoutMs),
    raceTimeout(searchProxyOnce(q), timeoutMs),
  ]);
  const mobileTracks = mobile ?? [];
  const pipedTracks = piped ?? [];
  const proxyTracks = proxy ?? [];
  if (forceWeb && mobileTracks.length > 0) return mobileTracks;
  return [...mobileTracks, ...pipedTracks, ...proxyTracks];
}

function mergeTracksIntoMap(
  merged: Map<string, CatalogTrack>,
  batch: CatalogTrack[],
): void {
  for (const track of batch) {
    const videoId = track.id.replace(/^youtube-/, '');
    if (!videoId || merged.has(videoId)) continue;
    merged.set(videoId, track);
  }
}

function rankedWebTracks(
  merged: Map<string, CatalogTrack>,
  query: string,
  limit = 8,
): CatalogTrack[] {
  return [...merged.values()]
    .sort((a, b) => trackRelevance(b, query) - trackRelevance(a, query))
    .slice(0, limit);
}

const WEB_NOISE_TOKENS = new Set(['dollar', 'sign', 'ty', 'dolla', 'ign']);

function relevanceTokenInHay(token: string, hay: string): boolean {
  if (WEB_NOISE_TOKENS.has(token)) return true;
  if (hay.includes(token)) return true;
  if (token === 'ye' && (hay.includes('kanye') || hay.includes(' ye '))) return true;
  if (token.startsWith('kany') && hay.includes('ye')) return true;
  return false;
}

function trackRelevance(track: CatalogTrack, query: string): number {
  const tokens = queryTokens(query).filter((t) => !WEB_NOISE_TOKENS.has(t));
  if (!tokens.length) return 0;
  const hay = normalizeWebText(`${track.artist} ${track.title}`);
  let score = 0;
  for (const token of tokens) {
    if (relevanceTokenInHay(token, hay)) score += 100;
  }
  if (tokens.every((t) => relevanceTokenInHay(t, hay))) score += 200;
  return score;
}

function canRunWebSearch(): boolean {
  if (isAirGapEnabled()) return false;
  return true;
}

export { canRunWebSearch };

/** Media envelopes for tier-3 streamable search hits. */
export async function fetchWebSearchEnvelopes(query: string): Promise<MediaEnvelope[]> {
  const tracks = await fetchWebCatalogTracks(query);
  return tracks
    .map((track) => track.envelope)
    .filter((env): env is MediaEnvelope => Boolean(env?.url?.trim()));
}

/** Query YouTube via on-device yt-dlp and/or Sandbox Server proxy resolve. */
export async function fetchWebCatalogTracks(
  query: string,
  options?: FetchWebCatalogOptions,
): Promise<CatalogTrack[]> {
  if (!canRunWebSearch()) return [];

  const forceWeb = needsWebTrackSupplement(query);
  const maxWaitMs = options?.maxWaitMs ?? WEB_SEARCH_MAX_WAIT_MS;
  const deadline = Date.now() + maxWaitMs;
  const perQueryTimeout = forceWeb ? WEB_LEAK_QUERY_TIMEOUT_MS : WEB_QUERY_TIMEOUT_MS;
  const queries = buildWebSearchQueries(query);
  const merged = new Map<string, CatalogTrack>();

  const emitPartial = () => {
    const ranked = rankedWebTracks(merged, query);
    if (ranked.length > 0) options?.onPartial?.(ranked);
  };

  const runBatch = async (batch: string[]) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || batch.length === 0) return;
    const timeout = Math.min(perQueryTimeout, remaining);
    const results = await Promise.all(
      batch.map((q) => searchOneQuery(q, forceWeb, timeout)),
    );
    for (const hits of results) {
      mergeTracksIntoMap(merged, hits);
    }
    if (merged.size > 0) emitPartial();
  };

  await runBatch(queries.slice(0, 1));
  const primary = rankedWebTracks(merged, query);
  if (primary.length > 0 && trackRelevance(primary[0]!, query) >= 200) {
    return primary;
  }

  const rest = queries.slice(1, MAX_PARALLEL_WEB_QUERIES);
  if (rest.length > 0 && Date.now() < deadline) {
    await runBatch(rest);
    const ranked = rankedWebTracks(merged, query);
    if (ranked.length > 0 && trackRelevance(ranked[0]!, query) >= 200) {
      return ranked;
    }
  }

  if (merged.size === 0 && queries.length > MAX_PARALLEL_WEB_QUERIES && Date.now() < deadline) {
    await runBatch(queries.slice(MAX_PARALLEL_WEB_QUERIES, MAX_PARALLEL_WEB_QUERIES + 2));
  }

  return rankedWebTracks(merged, query);
}

export function mergeWebCatalogResults(
  catalog: CatalogSearchResult,
  webTracks: CatalogTrack[],
  query: string,
): CatalogSearchResult {
  if (!webTracks.length) return catalog;

  const seen = new Set(
    catalog.tracks.map((t) => normalizeWebText(`${t.artist} ${t.title}`)),
  );
  const extra: CatalogTrack[] = [];
  for (const track of webTracks) {
    const key = normalizeWebText(`${track.artist} ${track.title}`);
    if (seen.has(key)) continue;
    seen.add(key);
    extra.push(track);
  }

  const combined = [...extra, ...catalog.tracks]
    .sort((a, b) => trackRelevance(b, query) - trackRelevance(a, query))
    .slice(0, 12);

  return {
    ...catalog,
    tracks: combined.slice(0, 8),
    suggestions: catalog.suggestions.length > 0 ? catalog.suggestions : [`${query} (web)`],
  };
}
