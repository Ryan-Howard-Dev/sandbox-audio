/**
 * Play pipeline — tier-ordered resolve then load envelope.
 */

import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
import { resolveMediaEnvelope } from './sandboxLayer1';
import { isAirGapEnabled } from './airGapMode';
import {
  searchBuiltinPackAddons,
  searchDebrid,
  searchProxy,
  searchUserManifestAddons,
} from './addons/searchProviders';
import { getEnabledAddons } from './addonStorage';
import { loadShowExperimentalIntegrations } from './sandboxSettings';
import { getTier34BaseUrl, tier34DhtResolve, isTier34ReachableCached } from './tier34/client';
import { logTierResolution } from './tierResolutionLog';
import {
  allowCatalogPreviewPlayback,
  canResolveFullStreams,
  catalogPlayUrlFromPreview,
} from './catalogDirect';
import { catalogTrackIdFromEnvelope, isCatalogTrackId } from './catalogTrackId';
import { catalogStreamDurationMismatch } from './catalogPlaybackDuration';
import { catalogLookupUrl } from './catalogApi';
import { fetchCatalogApiResults } from './catalogFetch';
import {
  hasSandboxServerBase,
  isCatalogPreviewUrl,
  CATALOG_PREVIEW_DURATION_SECONDS,
  preferDirectMediaUrls,
  proxiedPlaybackUrl,
  coalesceArtworkUrl,
} from './displaySanitize';
import { lockerArtistMatches } from './lockerStorage';
import {
  getCachedPlayEnvelope,
  playCacheKey,
  setCachedPlayEnvelope,
} from './playUrlCache';
import {
  fidelityAllowsCandidate,
  fidelityRank,
} from './fidelityPolicy';
import { loadFidelityPolicy } from './sandboxSettings';
import {
  envelopeFromResolved,
  resolvePlaybackSource,
  buildPlayQueries,
} from './hybridResolution';
import {
  isLocalDevicePlayUrl,
  isOfflineUnplayableStreamUrl,
  localDevicePlayUrlReachable,
} from './nativeExoStreamResolver';
import { isAndroid } from './platformEnv';
import {
  registerMobileResolver as registerMobileResolverAddon,
  tryMobileResolve,
  preferFreshMobileResolve,
  type MobileResolverAddon,
} from './mobileResolverRegistry';

export type { MobileResolverAddon };
export { registerMobileResolverAddon as registerMobileResolver, tryMobileResolve };

const TIER_TIMEOUT_MS = 10_000;
const PARALLEL_QUERY_DEADLINE_MS = 18_000;

async function firstResolvedTierQuery(
  queries: string[],
  catalogMeta: MediaEnvelope,
  backendUrl: string,
): Promise<MediaEnvelope | null> {
  if (queries.length === 0) return null;
  if (queries.length === 1) {
    return resolveTiersForQuery(queries[0]!, catalogMeta, backendUrl);
  }

  return new Promise((resolve) => {
    let pending = queries.length;
    let settled = false;
    const timer = globalThis.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(null);
    }, PARALLEL_QUERY_DEADLINE_MS);

    for (const query of queries) {
      void resolveTiersForQuery(query, catalogMeta, backendUrl)
        .then((resolved) => {
          if (settled) return;
          if (
            resolved?.url &&
            (!isCatalogEnvelope(catalogMeta) ||
              catalogTierMatchesPlayback(catalogMeta, resolved))
          ) {
            settled = true;
            clearTimeout(timer);
            resolve(mergeResolvedPlayable(catalogMeta, resolved));
            return;
          }
          pending -= 1;
          if (pending <= 0) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        })
        .catch(() => {
          pending -= 1;
          if (!settled && pending <= 0) {
            settled = true;
            clearTimeout(timer);
            resolve(null);
          }
        });
    }
  });
}

function candidateToEnvelope(candidate: CandidateSource): MediaEnvelope {
  try {
    return resolveMediaEnvelope([candidate], candidate.id);
  } catch {
    return {
      envelopeId: candidate.id,
      title: candidate.metadata?.title ?? 'Unknown Title',
      artist: candidate.metadata?.artist ?? 'Unknown Artist',
      url: candidate.uri ?? '',
      durationSeconds: candidate.metadata?.durationSeconds ?? 0,
      provider: candidate.provider,
      transport: candidate.transport,
      sourceId: candidate.id,
      mimeType: candidate.mimeType,
      artworkUrl: candidate.metadata?.artworkUrl,
      releaseYear: candidate.metadata?.releaseYear,
    };
  }
}

function proxyStreamUrl(rawUrl: string, backendUrl: string): string {
  if (!rawUrl?.trim()) return rawUrl;
  const base = backendUrl.replace(/\/$/, '');
  if (rawUrl.startsWith('/api/')) {
    return base ? `${base}${rawUrl}` : rawUrl;
  }
  if (/^https?:\/\//i.test(rawUrl)) {
    if (!base) {
      if (preferDirectMediaUrls() || !hasSandboxServerBase()) return rawUrl;
    }
    if (base) {
      return `${base}/api/proxy/stream?url=${encodeURIComponent(rawUrl)}`;
    }
    return rawUrl;
  }
  return base ? `${base}/api/proxy/stream?url=${encodeURIComponent(rawUrl)}` : rawUrl;
}

function needsProxyStream(env: MediaEnvelope): boolean {
  const url = env.url?.trim() ?? '';
  return (
    env.provider === 'proxy' ||
    env.transport === 'proxy' ||
    (env.provider === 'stream-proxy' && env.transport === 'stream-proxy') ||
    url.startsWith('/api/')
  );
}

function needsDebridStream(env: MediaEnvelope): boolean {
  return env.provider === 'debrid' && env.transport === 'debrid';
}

export function isFullStreamEnvelope(env: MediaEnvelope): boolean {
  const url = env.url?.trim();
  if (!url) return false;
  if (isCatalogPreviewUrl(url)) return false;
  if (
    needsProxyStream(env) ||
    needsDebridStream(env) ||
    env.provider === 'local-vault' ||
    env.provider === 'stream-cache' ||
    env.provider === 'indexeddb' ||
    env.provider === 'blob' ||
    env.provider === 'webtorrent' ||
    env.provider === 'ipfs' ||
    env.provider === 'dht-swarm' ||
    env.transport === 'p2p'
  ) {
    return true;
  }
  return !isCatalogPreviewUrl(url);
}

/** True when applying `next` would replace a full stream with a catalog preview. */
export function isPlaybackDowngrade(
  current: MediaEnvelope | null | undefined,
  next: MediaEnvelope,
): boolean {
  if (!current?.url?.trim()) return false;
  if (current.envelopeId !== next.envelopeId) return false;
  return isFullStreamEnvelope(current) && !isFullStreamEnvelope(next);
}

const MIN_TIER_MATCH_SCORE = 0.38;

/** iTunes / Apple Music catalog track id (numeric or catalog-{id}). */
export function isCatalogSourceId(sourceId?: string | null): boolean {
  return isCatalogTrackId(sourceId);
}

/** Catalog playback row — sourceId or envelopeId encodes an Apple track id. */
export function isCatalogEnvelope(env: MediaEnvelope): boolean {
  return (
    isCatalogSourceId(env.sourceId) || Boolean(catalogTrackIdFromEnvelope(env))
  );
}

function catalogTierPlaybackAllowed(resolved: MediaEnvelope): boolean {
  if (resolved.resolutionSource === 'mobile') return true;
  if (!requiresSandboxServer(resolved)) return true;
  return canResolveFullStreams() && isTier34ReachableCached();
}

function catalogTierMatchesPlayback(
  catalogMeta: MediaEnvelope,
  resolved: MediaEnvelope,
): boolean {
  if (!isCatalogEnvelope(catalogMeta)) return true;
  return (
    resolvedStreamMatchesCatalog(catalogMeta, resolved) &&
    catalogTierPlaybackAllowed(resolved)
  );
}

/** Reject tier/full-stream hits whose resolved metadata diverges from catalog identity. */
export function resolvedStreamMatchesCatalog(
  catalog: MediaEnvelope,
  resolved: MediaEnvelope,
): boolean {
  if (!resolved.url?.trim()) return false;
  if (resolved.resolutionSource === 'mobile') return true;
  if (isCatalogPreviewUrl(resolved.url)) return allowCatalogPreviewPlayback();

  const catalogArtist = catalog.artist?.trim() ?? '';
  const resolvedArtist = resolved.artist?.trim() ?? '';
  if (catalogArtist && resolvedArtist) {
    const artistSim = diceCoefficient(catalogArtist, resolvedArtist);
    if (artistSim < 0.55) return false;
  }

  const catalogTitle = catalog.title?.trim() ?? '';
  const resolvedTitle = resolved.title?.trim() ?? '';
  if (catalogTitle && resolvedTitle) {
    const titleSim = diceCoefficient(catalogTitle, resolvedTitle);
    const minTitleSim = normalizeMatchText(catalogTitle).replace(/\s+/g, '').length <= 6 ? 0.92 : 0.78;
    if (titleSim < minTitleSim) return false;
  }

  const catalogDur = catalog.durationSeconds ?? 0;
  const resolvedDur = resolved.durationSeconds ?? 0;
  if (catalogDur > 45 && resolvedDur > 0) {
    const ratio = resolvedDur / catalogDur;
    if (ratio < 0.72 || ratio > 1.28) return false;
  }

  return true;
}

function minTierMatchScore(env: MediaEnvelope): number {
  if (!isCatalogSourceId(env.sourceId)) return MIN_TIER_MATCH_SCORE;
  const compact = normalizeMatchText(env.title ?? '').replace(/\s+/g, '');
  return compact.length <= 6 ? 0.58 : MIN_TIER_MATCH_SCORE;
}

function isGenericStreamArtist(artist: string): boolean {
  const n = normalizeMatchText(artist);
  return (
    n === 'youtube' ||
    n === 'archive org' ||
    n === 'archive' ||
    n === 'unknown artist'
  );
}

function normalizeMatchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/^\d{1,2}[\s.\-_]+/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function diceCoefficient(a: string, b: string): number {
  const aNorm = normalizeMatchText(a);
  const bNorm = normalizeMatchText(b);
  if (!aNorm || !bNorm) return 0;
  if (aNorm === bNorm) return 1;
  if (aNorm.length < 2 || bNorm.length < 2) {
    return aNorm.includes(bNorm) || bNorm.includes(aNorm) ? 0.75 : 0;
  }
  const bigrams = (s: string) => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
    return out;
  };
  const aGrams = bigrams(aNorm);
  const bGrams = bigrams(bNorm);
  let overlap = 0;
  for (const g of aGrams) {
    if (bGrams.has(g)) overlap++;
  }
  return (2 * overlap) / (aGrams.size + bGrams.size);
}

function durationMatchScore(candidateSeconds: number, expectedSeconds: number): number {
  if (candidateSeconds <= 0 || expectedSeconds <= 30) return 0.5;
  const ratio = candidateSeconds / expectedSeconds;
  if (ratio >= 0.88 && ratio <= 1.12) return 1;
  if (ratio >= 0.72 && ratio <= 1.28) return 0.65;
  if (ratio < 0.55 || ratio > 1.45) return 0.05;
  return 0.35;
}

function tierCandidateScore(candidate: CandidateSource, env: MediaEnvelope): number {
  const cTitle = candidate.metadata?.title ?? '';
  const cArtist = candidate.metadata?.artist ?? '';
  const uri = candidate.uri ?? '';
  const eTitle = env.title ?? '';
  const eArtist = env.artist ?? '';
  const eAlbum = env.album ?? '';

  const titleSim = diceCoefficient(eTitle, cTitle);
  const artistSim = diceCoefficient(eArtist, cArtist);
  let score = titleSim * 0.5 + artistSim * 0.35;

  const expectedDuration = env.durationSeconds ?? 0;
  const candidateDuration = candidate.metadata?.durationSeconds ?? 0;
  if (expectedDuration > 45 && candidateDuration > 0) {
    const durScore = durationMatchScore(candidateDuration, expectedDuration);
    score = score * 0.62 + durScore * 0.38;
    if (durScore <= 0.1) score *= 0.35;
  }

  const nTitle = normalizeMatchText(eTitle);
  const nCandidate = normalizeMatchText(`${cTitle} ${uri}`);
  if (nTitle && nCandidate.includes(nTitle)) score = Math.max(score, 0.72);

  const nAlbum = normalizeMatchText(eAlbum);
  if (nAlbum && normalizeMatchText(cTitle).includes(nAlbum)) score += 0.18;
  if (eAlbum && cTitle.toLowerCase().includes(`[${eAlbum.toLowerCase()}]`)) {
    score = Math.max(score, 0.8);
  }

  const uriNorm = normalizeMatchText(uri);
  if (nTitle && uriNorm.includes(nTitle.replace(/\s+/g, ' '))) {
    score = Math.max(score, 0.72);
  }
  if (nTitle && uriNorm.replace(/\s+/g, '').includes(nTitle.replace(/\s+/g, ''))) {
    score = Math.max(score, 0.68);
  }

  const artistTokens = normalizeMatchText(eArtist)
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (artistTokens.length > 0) {
    const blob = normalizeMatchText(`${cTitle} ${cArtist} ${uri}`);
    const artistHits = artistTokens.filter((t) => blob.includes(t)).length;
    if (artistHits >= Math.min(2, artistTokens.length)) {
      score = Math.max(score, 0.55 + artistHits * 0.08);
    }
  }

  if (isGenericStreamArtist(cArtist)) {
    const envBlob = normalizeMatchText(`${eArtist} ${eTitle} ${eAlbum}`);
    const candBlob = normalizeMatchText(`${cTitle} ${uri}`);
    const envTokens = envBlob.split(/\s+/).filter((t) => t.length > 2);
    if (envTokens.length > 0) {
      const tokenHits = envTokens.filter((t) => candBlob.includes(t)).length;
      if (tokenHits >= Math.min(2, envTokens.length)) {
        score = Math.max(score, 0.58 + tokenHits * 0.1);
      }
    }
    if (nTitle && candBlob.includes(nTitle)) score = Math.max(score, 0.78);
  }

  const rank = candidatePlayRank(candidate);
  if (rank >= 70 && nTitle) {
    const candBlob = normalizeMatchText(`${cTitle} ${cArtist} ${uri}`);
    if (candBlob.includes(nTitle)) score = Math.max(score, 0.75);
  }

  return Math.min(score, 1);
}

function candidatePlayRank(candidate: CandidateSource): number {
  const fidelity = fidelityRank(candidate);
  if (candidate.provider === 'local-vault') return 100 + fidelity;
  if (candidate.provider === 'stream-cache') return 90 + fidelity;
  if (candidate.provider === 'debrid' || candidate.transport === 'debrid') return 80 + fidelity;
  if (
    candidate.provider === 'proxy' ||
    candidate.provider === 'stream-proxy' ||
    candidate.transport === 'proxy' ||
    candidate.transport === 'stream-proxy'
  ) {
    return 70 + fidelity;
  }
  if (
    candidate.provider === 'webtorrent' ||
    candidate.provider === 'ipfs' ||
    candidate.provider === 'dht-swarm' ||
    candidate.transport === 'p2p'
  ) {
    return 65 + fidelity;
  }
  const url = candidate.uri?.trim();
  if (url && isCatalogPreviewUrl(url)) return 10 + fidelity;
  return 40 + fidelity;
}

/** Prefer tier 3/4 full streams over catalog previews in attached sources. */
function pickBestPlayCandidate(
  candidates: CandidateSource[],
  env: MediaEnvelope,
): CandidateSource | null {
  const policy = loadFidelityPolicy();
  const viable = candidates.filter((c) => {
    const url = c.uri?.trim();
    if (!url) return false;
    if (isCatalogPreviewUrl(url)) return false;
    if (!fidelityAllowsCandidate(c, policy)) return false;
    if (isCatalogSourceId(env.sourceId)) {
      const cArtist = c.metadata?.artist ?? '';
      if (env.artist?.trim() && cArtist.trim()) {
        if (diceCoefficient(env.artist, cArtist) < 0.55) return false;
      }
    }
    return true;
  });
  if (viable.length === 0) return null;

  const ranked = viable
    .map((hit) => ({
      hit,
      score: tierCandidateScore(hit, env),
      rank: candidatePlayRank(hit),
    }))
    .sort(
      (a, b) =>
        b.rank - a.rank ||
        b.score - a.score ||
        a.hit.priority - b.hit.priority,
    );

  const best = ranked[0];
  if (!best) return null;
  if (best.rank >= 70) return best.hit;
  if (viable.length === 1 && best.score >= 0.22) return best.hit;
  return best.score >= minTierMatchScore(env) ? best.hit : null;
}

function withProxiedUrl(playable: MediaEnvelope, backendUrl: string): MediaEnvelope {
  if (!playable.url) return playable;
  const serverOnline = Boolean(backendUrl.trim()) && isTier34ReachableCached();
  /** yt-dlp mobile returns direct googlevideo/file URLs for native Exo — do not strip offline. */
  const trustMobileDirect =
    playable.resolutionSource === 'mobile' &&
    /^https?:\/\//i.test(playable.url) &&
    !playable.url.includes('/api/proxy/stream');

  if (trustMobileDirect) {
    return playable;
  }

  if (needsProxyStream(playable)) {
    if (!serverOnline) {
      if (isOfflineUnplayableStreamUrl(playable.url)) {
        return { ...playable, url: '' };
      }
      return playable;
    }
    return { ...playable, url: proxyStreamUrl(playable.url, backendUrl) };
  }
  if (!serverOnline && isOfflineUnplayableStreamUrl(playable.url)) {
    return { ...playable, url: '' };
  }
  return { ...playable, url: proxiedPlaybackUrl(playable.url) };
}

function previewUrlFromCandidates(candidates?: CandidateSource[]): string | null {
  for (const candidate of candidates ?? []) {
    const uri = candidate.uri?.trim();
    if (uri && isCatalogPreviewUrl(uri)) return uri;
  }
  return null;
}

async function resolveCatalogPreviewUrl(env: MediaEnvelope): Promise<string | null> {
  const trackId = catalogTrackIdFromEnvelope(env);
  if (!trackId) return null;
  try {
    const items = await fetchCatalogApiResults(catalogLookupUrl({ id: trackId }));
    const preview = items[0]?.previewUrl?.trim();
    return preview || null;
  } catch {
    return null;
  }
}

async function finalizeCatalogPreviewPlayback(
  catalogMeta: MediaEnvelope,
  playable: MediaEnvelope,
  candidates?: CandidateSource[],
): Promise<MediaEnvelope> {
  if (!allowCatalogPreviewPlayback()) {
    return {
      ...catalogMeta,
      url: '',
      artworkUrl: coalesceArtworkUrl(catalogMeta.artworkUrl, playable.artworkUrl),
    };
  }

  const existing = playable.url?.trim() ?? '';
  if (existing && isFullStreamEnvelope(playable) && !isCatalogPreviewUrl(existing)) {
    return playable;
  }

  let preview: string | null = null;
  if (existing && isCatalogPreviewUrl(existing)) {
    preview = existing;
  } else {
    preview =
      catalogPlayUrlFromPreview(existing) ||
      previewUrlFromCandidates(candidates) ||
      (await resolveCatalogPreviewUrl(catalogMeta));
  }
  if (!preview) return { ...catalogMeta, url: '' };

  return {
    ...catalogMeta,
    url: proxiedPlaybackUrl(preview),
    provider: 'https',
    transport: 'element-src',
    durationSeconds: CATALOG_PREVIEW_DURATION_SECONDS,
    artworkUrl: coalesceArtworkUrl(catalogMeta.artworkUrl, playable.artworkUrl),
  };
}

/** Keep catalog metadata when upgrading preview → full stream. */
function mergeResolvedPlayable(
  base: MediaEnvelope,
  resolved: MediaEnvelope,
): MediaEnvelope {
  const catalogDuration =
    base.durationSeconds && base.durationSeconds > 30 ? base.durationSeconds : 0;
  const resolvedDuration =
    resolved.durationSeconds && resolved.durationSeconds > 30
      ? resolved.durationSeconds
      : 0;
  let durationSeconds =
    resolvedDuration || catalogDuration || base.durationSeconds || resolved.durationSeconds;

  const resolvedUrl = resolved.url?.trim() ?? '';
  if (resolvedUrl && isCatalogPreviewUrl(resolvedUrl)) {
    durationSeconds = CATALOG_PREVIEW_DURATION_SECONDS;
  } else if (catalogDuration > 45 && resolvedDuration > 0) {
    const ratio = resolvedDuration / catalogDuration;
    if (ratio >= 0.88 && ratio <= 1.12) {
      durationSeconds = catalogDuration;
    } else if (catalogStreamDurationMismatch(resolvedDuration, catalogDuration)) {
      durationSeconds = catalogDuration;
    } else {
      durationSeconds = resolvedDuration;
    }
  } else if (resolvedDuration > 0) {
    durationSeconds = resolvedDuration;
  }

  return {
    ...resolved,
    title: base.title || resolved.title,
    artist: base.artist || resolved.artist,
    album: base.album ?? resolved.album,
    artworkUrl: coalesceArtworkUrl(base.artworkUrl, resolved.artworkUrl),
    releaseYear: base.releaseYear ?? resolved.releaseYear,
    durationSeconds,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      window.setTimeout(() => reject(new Error('tier timeout')), ms),
    ),
  ]);
}

type TierStep = {
  tier: number;
  provider: string;
  run: () => Promise<CandidateSource[]>;
};

async function tryTierStep(
  step: TierStep,
  env: MediaEnvelope,
  query: string,
): Promise<{ hit: CandidateSource; tier: number; provider: string } | null> {
  try {
    const hits = await withTimeout(step.run(), TIER_TIMEOUT_MS);
    const best = pickBestPlayCandidate(hits, env);
    if (best) {
      logTierResolution({
        query,
        tier: step.tier,
        provider: step.provider,
        outcome: 'hit',
        detail: `matched ${best.metadata?.title ?? best.id}`,
      });
      return { hit: best, tier: step.tier, provider: step.provider };
    }
    logTierResolution({
      query,
      tier: step.tier,
      provider: step.provider,
      outcome: 'miss',
      detail:
        hits.length > 0
          ? `${hits.length} candidate(s) rejected (preview or low title match)`
          : undefined,
    });
    return null;
  } catch (e) {
    logTierResolution({
      query,
      tier: step.tier,
      provider: step.provider,
      outcome: 'error',
      detail: String(e),
    });
    return null;
  }
}

async function raceTierHits(
  steps: TierStep[],
  env: MediaEnvelope,
  query: string,
): Promise<{ hit: CandidateSource; tier: number; provider: string } | null> {
  if (steps.length === 0) return null;
  const controllers = steps.map((step) => tryTierStep(step, env, query));

  return new Promise((resolve) => {
    let pending = controllers.length;
    let resolved = false;
    for (const p of controllers) {
      void p.then((result) => {
        if (resolved) return;
        if (result) {
          resolved = true;
          resolve(result);
          return;
        }
        pending -= 1;
        if (pending === 0) resolve(null);
      });
    }
  });
}

function buildTierSteps(query: string, backendUrl: string): {
  proxyStep: TierStep;
  debridStep: TierStep;
  addonSteps: TierStep[];
} {
  const proxyStep: TierStep = {
    tier: 3,
    provider: 'proxy',
    run: () => searchProxy(query, backendUrl),
  };
  const debridStep: TierStep = {
    tier: 4,
    provider: 'debrid',
    run: () => searchDebrid(query, backendUrl),
  };
  const addonSteps: TierStep[] = [];
  if (loadShowExperimentalIntegrations()) {
    addonSteps.push({
      tier: 2,
      provider: 'addons-builtin',
      run: () => searchBuiltinPackAddons(query),
    });
  }
  const hasUserAddons = getEnabledAddons().some((a) => !a.builtIn && a.manifestUrl);
  if (hasUserAddons) {
    addonSteps.push({
      tier: 2,
      provider: 'addons-manifest',
      run: () => searchUserManifestAddons(query),
    });
  }
  return { proxyStep, debridStep, addonSteps };
}

async function resolveTiersForQuery(
  query: string,
  env: MediaEnvelope,
  backendUrl: string,
): Promise<MediaEnvelope | null> {
  const { proxyStep, debridStep, addonSteps } = buildTierSteps(query, backendUrl);

  if (loadFidelityPolicy() === 'LOSSLESS') {
    const debridHit = await tryTierStep(debridStep, env, query);
    if (debridHit) return candidateToEnvelope(debridHit.hit);
    const winner = await raceTierHits([proxyStep, ...addonSteps], env, query);
    if (!winner) return null;
    return candidateToEnvelope(winner.hit);
  }

  const winner = await raceTierHits([proxyStep, debridStep, ...addonSteps], env, query);
  if (!winner) return null;
  return candidateToEnvelope(winner.hit);
}

async function resolveDhtMesh(
  env: MediaEnvelope,
  backendUrl: string,
): Promise<MediaEnvelope | null> {
  if (isAirGapEnabled() || !backendUrl.trim()) return null;
  try {
    const resolved = await withTimeout(
      tier34DhtResolve(env.title, env.artist, env.sourceId),
      TIER_TIMEOUT_MS,
    );
    if (!resolved?.url || isCatalogPreviewUrl(resolved.url)) return null;
    logTierResolution({
      query: `${env.artist} ${env.title}`.trim(),
      tier: 4,
      provider: 'dht-swarm',
      outcome: 'hit',
      detail: resolved.provider ?? 'mesh',
    });
    return mergeResolvedPlayable(env, resolved);
  } catch (e) {
    logTierResolution({
      query: `${env.artist} ${env.title}`.trim(),
      tier: 4,
      provider: 'dht-swarm',
      outcome: 'error',
      detail: String(e),
    });
    return null;
  }
}

/**
 * Sandbox Server tier resolve (proxy / debrid / addons / DHT) — hybrid pipeline step 3.
 */
export async function resolveSandboxServerStream(
  env: MediaEnvelope,
  candidates?: CandidateSource[],
): Promise<MediaEnvelope | null> {
  const backendUrl = getTier34BaseUrl();
  const catalogMeta = { ...env };

  const attached = pickBestPlayCandidate(candidates ?? [], catalogMeta);
  if (attached) {
    const attachedEnv = candidateToEnvelope(attached);
    if (catalogTierMatchesPlayback(catalogMeta, attachedEnv)) {
      logTierResolution({
        query: buildPlayQueries(env)[0] ?? '',
        tier: attached.provider === 'debrid' ? 4 : 3,
        provider: 'candidates',
        outcome: 'hit',
        detail: 'reused attached tier source',
      });
      return mergeResolvedPlayable(catalogMeta, attachedEnv);
    }
  }

  const queries = buildPlayQueries(env);
  const resolved = await firstResolvedTierQuery(queries, catalogMeta, backendUrl);
  if (resolved?.url) {
    return resolved;
  }

  const dhtResolved = await resolveDhtMesh(catalogMeta, backendUrl);
  if (dhtResolved?.url && catalogTierMatchesPlayback(catalogMeta, dhtResolved)) {
    return dhtResolved;
  }

  const fallbackCandidate = pickBestPlayCandidate(candidates ?? [], catalogMeta);
  if (fallbackCandidate) {
    const fallbackEnv = candidateToEnvelope(fallbackCandidate);
    if (catalogTierMatchesPlayback(catalogMeta, fallbackEnv)) {
      return mergeResolvedPlayable(catalogMeta, fallbackEnv);
    }
  }

  return null;
}

/**
 * Resolve playable URL across tiers (3 ∥ 4 → addons → attached full-stream candidates).
 * Never throws — returns resolved full stream or empty url (honest failure without tier34).
 */
export async function executeTrack(
  env: MediaEnvelope,
  candidates?: CandidateSource[],
): Promise<MediaEnvelope> {
  const backendUrl = getTier34BaseUrl();
  const cacheKey = playCacheKey(env);
  const catalogMeta = { ...env };
  const cached = getCachedPlayEnvelope(cacheKey);
  if (cached?.url && isFullStreamEnvelope(cached)) {
    const cachedNeedsServer = requiresSandboxServer(cached);
    let staleLocalFile = false;
    if (isLocalDevicePlayUrl(cached.url) && isAndroid()) {
      staleLocalFile = !(await localDevicePlayUrlReachable(cached.url));
    }
    const skipCached =
      staleLocalFile ||
      (preferFreshMobileResolve() && !isLocalDevicePlayUrl(cached.url)) ||
      isOfflineUnplayableStreamUrl(cached.url) ||
      (cachedNeedsServer && (!getTier34BaseUrl().trim() || !isTier34ReachableCached()));
    if (
      !skipCached &&
      (!isCatalogSourceId(catalogMeta.sourceId) ||
        resolvedStreamMatchesCatalog(catalogMeta, cached))
    ) {
      return withProxiedUrl(mergeResolvedPlayable(catalogMeta, cached), backendUrl);
    }
  }

  let playable = { ...env };
  const rawUrl = playable.url?.trim() ?? '';
  const hasViableFullStreamCandidate = (candidates ?? []).some((c) => {
    const uri = c.uri?.trim();
    if (!uri || isCatalogPreviewUrl(uri)) return false;
    if (!isCatalogEnvelope(catalogMeta)) return true;
    return catalogTierMatchesPlayback(catalogMeta, candidateToEnvelope(c));
  });
  if (
    rawUrl &&
    isCatalogPreviewUrl(rawUrl) &&
    (allowCatalogPreviewPlayback()
      ? canResolveFullStreams() && hasViableFullStreamCandidate
      : true)
  ) {
    playable = { ...playable, url: '' };
  } else if (rawUrl.startsWith('blob:') && playable.provider !== 'local-vault') {
    playable = { ...playable, url: '' };
  }

  if (
    playable.provider === 'local-vault' ||
    playable.provider === 'stream-cache' ||
    playable.provider === 'indexeddb' ||
    playable.provider === 'blob'
  ) {
    return playable;
  }

  if (
    playable.url &&
    isFullStreamEnvelope(playable) &&
    catalogTierMatchesPlayback(catalogMeta, playable) &&
    !isOfflineUnplayableStreamUrl(playable.url)
  ) {
    if (needsProxyStream(playable)) {
      return withProxiedUrl(playable, backendUrl);
    }
    if (needsDebridStream(playable)) {
      return playable;
    }
    return withProxiedUrl(playable, backendUrl);
  }

  if (
    playable.url &&
    isFullStreamEnvelope(playable) &&
    isCatalogEnvelope(catalogMeta)
  ) {
    playable = { ...playable, url: '' };
  }

  const hybrid = await resolvePlaybackSource(
    playable.url ? playable : catalogMeta,
    candidates,
  );
  if (hybrid?.uri) {
    playable = envelopeFromResolved(catalogMeta, hybrid);
    if (
      isCatalogEnvelope(catalogMeta) &&
      !isCatalogPreviewUrl(playable.url ?? '') &&
      !catalogTierMatchesPlayback(catalogMeta, playable) &&
      hybrid.source !== 'preview' &&
      hybrid.source !== 'mobile'
    ) {
      return { ...catalogMeta, url: '', artworkUrl: coalesceArtworkUrl(catalogMeta.artworkUrl, playable.artworkUrl) };
    }
    const resolved = withProxiedUrl(playable, backendUrl);
    if (
      isCatalogEnvelope(catalogMeta) &&
      !isCatalogPreviewUrl(resolved.url ?? '') &&
      !catalogTierMatchesPlayback(catalogMeta, resolved) &&
      hybrid.source !== 'mobile'
    ) {
      return { ...catalogMeta, url: '', artworkUrl: coalesceArtworkUrl(catalogMeta.artworkUrl, playable.artworkUrl) };
    }
    if (
      !requiresSandboxServer(resolved) ||
      (backendUrl.trim() && isTier34ReachableCached())
    ) {
      if (isFullStreamEnvelope(resolved)) {
        setCachedPlayEnvelope(cacheKey, resolved);
      }
      return resolved;
    }
    return { ...playable, url: '' };
  }

  return finalizeCatalogPreviewPlayback(catalogMeta, playable, candidates);
}

/** Ensure catalog track playback URL matches its sourceId — no preview fallback in production. */
export async function ensureCatalogPlaybackIdentity(
  catalogMeta: MediaEnvelope,
  playable: MediaEnvelope,
  candidates?: CandidateSource[],
): Promise<MediaEnvelope> {
  if (!isCatalogSourceId(catalogMeta.sourceId) && !catalogTrackIdFromEnvelope(catalogMeta)) {
    return playable;
  }
  const url = playable.url?.trim() ?? '';
  if (url && isCatalogPreviewUrl(url) && !allowCatalogPreviewPlayback()) {
    return { ...playable, url: '' };
  }
  if (!url) return playable;
  if (isCatalogPreviewUrl(url)) {
    if (!allowCatalogPreviewPlayback()) return { ...playable, url: '' };
    const verified = await resolveCatalogPreviewUrl(catalogMeta);
    if (verified) {
      return finalizeCatalogPreviewPlayback(catalogMeta, { ...playable, url: verified }, candidates);
    }
    return { ...playable, url: '' };
  }
  if (resolvedStreamMatchesCatalog(catalogMeta, playable)) return playable;
  return playable;
}

/** Keep UI + queue identity aligned with the hit the user tapped (async resolve may rewrite metadata). */
export function preserveTappedEnvelopeIdentity(
  tapped: MediaEnvelope,
  resolved: MediaEnvelope,
): MediaEnvelope {
  const catalogDuration =
    tapped.durationSeconds && tapped.durationSeconds > 0
      ? tapped.durationSeconds
      : resolved.durationSeconds;
  const lockerResolved = resolved.provider === 'local-vault' && Boolean(resolved.sourceId);
  const tappedArtist = tapped.artist?.trim() ?? '';
  const resolvedArtist = resolved.artist?.trim() ?? '';
  const preferLockerArtist =
    lockerResolved &&
    resolvedArtist.length > 0 &&
    tappedArtist.length > 0 &&
    !lockerArtistMatches(tappedArtist, resolvedArtist);
  const preferLockerAlbum =
    lockerResolved &&
    Boolean(resolved.album?.trim()) &&
    Boolean(tapped.album?.trim()) &&
    normalizeLockerAlbumKey(tapped.album!) !== normalizeLockerAlbumKey(resolved.album!);
  return {
    ...resolved,
    envelopeId: tapped.envelopeId,
    title: tapped.title?.trim() || resolved.title,
    artist: preferLockerArtist ? resolved.artist : tappedArtist || resolved.artist,
    album: preferLockerAlbum ? resolved.album : tapped.album?.trim() || resolved.album,
    artworkUrl: coalesceArtworkUrl(tapped.artworkUrl, resolved.artworkUrl),
    sourceId:
      lockerResolved && resolved.sourceId
        ? resolved.sourceId
        : (tapped.sourceId ?? resolved.sourceId),
    durationSeconds: catalogDuration,
  };
}

function normalizeLockerAlbumKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
}

function requiresSandboxServer(env: MediaEnvelope): boolean {
  if (needsProxyStream(env) || needsDebridStream(env)) return true;
  const url = env.url?.trim() ?? '';
  if (!url) return false;
  if (url.startsWith('/api/')) return true;
  if (url.includes('/api/proxy/stream') && !/^https?:\/\//i.test(url)) return true;
  return false;
}

export function isSwarmTrack(env: MediaEnvelope): boolean {
  return (
    env.provider === 'dht-swarm' ||
    env.provider === 'webtorrent' ||
    env.transport === 'p2p' ||
    env.envelopeId.includes('webtorrent') ||
    env.envelopeId.includes('ipfs')
  );
}
