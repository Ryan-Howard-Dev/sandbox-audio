/**
 * Queue prefetch — resolve upcoming tracks into session cache and warm audio buffers.
 */

import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
/*
 * The app's own repeat vocabulary. This module used to declare its own inline, spelling the
 * off state 'off' while every other module says 'none', so no caller of it ever typechecked.
 * Nothing here reads that state — only 'all' is tested — so adopting the shared type changes
 * no behaviour, it just stops the lie.
 */
import type { RepeatMode } from './queuePersistence';
import { executeTrack, isFullStreamEnvelope } from './playbackPipeline';
import { isCellularNetwork } from './networkPlayPolicy';
import { loadStreamCacheEnabled } from './sandboxSettings';
import {
  findLockerEntryForTrack,
  getLockerEntriesSnapshot,
  refreshLockerEntryPlayUrl,
  resolveLockerEnvelopeForPlayback,
} from './lockerStorage';
import { resolveNativeExoStreamUrlAsync } from './nativeExoStreamResolver';
import { lookupLockerReplayGainDb } from './replayGainPlayback';
import { coalesceArtworkUrl, isCatalogPreviewUrl } from './displaySanitize';
import {
  isLocalDevicePlayUrl,
  isOfflineUnplayableStreamUrl,
} from './nativeExoStreamResolver';
import { preferFreshMobileResolve } from './mobileResolverRegistry';
import { EXPIRY_SAFETY_MARGIN_MS, parseStreamExpiry } from './resolvedStreamCache';
import {
  getCachedPlayEnvelope,
  playCacheKey,
} from './playUrlCache';
import {
  getCachedStreamForTrack,
  getStreamCacheEnvelope,
  isEnvelopeStreamCached,
  silentPrefetchTrackIntoStreamCache,
} from './streamCache';
import { tier34StagePlaybackQueue } from './tier34/client';

/** Rolling native/JS prefetch window — must exceed 2 so locked-screen playback survives OEM WebView throttle. */
const PREFETCH_AHEAD = 5;
const STREAM_CACHE_PREFETCH_AHEAD_CELLULAR = 1;
const STREAM_CACHE_PREFETCH_AHEAD_WIFI = 2;
const inFlight = new Map<string, Promise<MediaEnvelope | null>>();
const streamCachePrefetchInFlight = new Set<string>();

export { PREFETCH_AHEAD };

export function getSyncCachedPlayable(env: MediaEnvelope): MediaEnvelope | null {
  const cached = getCachedPlayEnvelope(playCacheKey(env));
  const url = cached?.url?.trim() ?? '';
  if (
    url &&
    isFullStreamEnvelope(cached!) &&
    !isOfflineUnplayableStreamUrl(url)
  ) {
    return cached;
  }

  const streamHit = getCachedStreamForTrack(env);
  const streamUrl = streamHit?.uri?.trim() ?? '';
  if (
    streamUrl &&
    isLocalDevicePlayUrl(streamUrl) &&
    !isCatalogPreviewUrl(streamUrl) &&
    !isOfflineUnplayableStreamUrl(streamUrl)
  ) {
    return {
      ...env,
      url: streamUrl,
      transport: env.transport ?? 'element-src',
    };
  }

  return null;
}

type InstantPlayableOptions = {
  /** Background prefetch may reuse URI/session cache even when playback prefers fresh mobile resolve. */
  forPrefetch?: boolean;
};

/** Session or IndexedDB stream cache — skips tier resolve when hit. */
export async function tryInstantPlayable(
  env: MediaEnvelope,
  options?: InstantPlayableOptions,
): Promise<MediaEnvelope | null> {
  const sync = getSyncCachedPlayable(env);
  if (sync) {
    logInstantOutcome(env, 'hit:play-cache');
    return sync;
  }

  const remoteOnMobile =
    !options?.forPrefetch &&
    preferFreshMobileResolve() &&
    env.provider !== 'local-vault' &&
    env.provider !== 'stream-cache' &&
    env.provider !== 'indexeddb' &&
    env.provider !== 'blob';

  if (!isEnvelopeStreamCached(env)) {
    // Nothing warmed this track. Either prefetch has not reached it yet, or stream caching is
    // switched off in settings — in which case this whole path can never hit and the play tap
    // always pays for a full resolve.
    logInstantOutcome(env, remoteOnMobile ? 'miss:not-cached (fresh-preferred)' : 'miss:not-cached');
    return null;
  }
  {
    const stream = await getStreamCacheEnvelope(env);
    const streamUrl = stream?.url?.trim() ?? '';
    if (streamUrl && !isOfflineUnplayableStreamUrl(streamUrl)) {
      /*
       * The play path used to throw this away outright whenever a fresh mobile resolve was
       * preferred, so every tap and every skip paid the full ~15s extraction even though prefetch
       * had already resolved the track seconds earlier. The caution was right — a dead URL fails
       * silently and looks like a broken app — but it was written when nothing could tell a live
       * URL from an expired one.
       *
       * These URLs state their own deadline, so the question is answerable: reuse it when it can
       * be shown to still be good, re-resolve when it cannot. A URL with no stated expiry is not
       * proof of freshness, so that case still re-resolves rather than gambling.
       */
      if (!remoteOnMobile) {
        logInstantOutcome(env, 'hit:stream-cache');
        return stream;
      }
      const expiresAt = parseStreamExpiry(streamUrl);
      if (expiresAt != null && expiresAt - EXPIRY_SAFETY_MARGIN_MS > Date.now()) {
        logInstantOutcome(env, 'hit:stream-cache (expiry ok)');
        return stream;
      }
      logInstantOutcome(
        env,
        expiresAt == null
          ? 'miss:no-stated-expiry — cannot prove fresh, re-resolving'
          : `miss:expired ${Math.round((expiresAt - Date.now()) / 1000)}s left`,
      );
      return null;
    }
    logInstantOutcome(env, 'miss:cached-but-unplayable-url');
  }
  return null;
}

/**
 * Why a play tap did or did not skip resolution.
 *
 * The difference between an instant play and a fifteen-second wait is one branch here, and from
 * outside the app both look identical apart from the delay. Naming the branch is what turns
 * "still slow" into a specific thing to fix.
 */
function logInstantOutcome(env: MediaEnvelope, outcome: string): void {
  console.warn(
    `[tryInstantPlayable] ${outcome} track="${env.artist} — ${env.title}" provider=${env.provider}`,
  );
}

async function applyLockerShortcut(env: MediaEnvelope): Promise<MediaEnvelope> {
  let playable = env;

  if (playable.provider === 'local-vault') {
    const resolved = await resolveLockerEnvelopeForPlayback(playable);
    if (resolved?.url?.trim()) return resolved;
    if (playable.sourceId) {
      const freshUrl = await refreshLockerEntryPlayUrl(playable.sourceId);
      if (freshUrl) playable = { ...playable, url: freshUrl };
      const lockerRg = await lookupLockerReplayGainDb(playable.sourceId);
      if (lockerRg != null) playable = { ...playable, replayGainDb: lockerRg };
    }
    return playable;
  }

  const lockerEntry = findLockerEntryForTrack(
    playable.title,
    playable.artist,
    playable.album,
    getLockerEntriesSnapshot(),
  );
  if (!lockerEntry) return playable;

  const freshUrl = await refreshLockerEntryPlayUrl(lockerEntry.id);
  if (!freshUrl) return playable;

  const lockerRg = await lookupLockerReplayGainDb(lockerEntry.id);
  return {
    envelopeId: `local-${lockerEntry.id}`,
    title: lockerEntry.title,
    artist: lockerEntry.artist,
    album: lockerEntry.albumName ?? playable.album,
    url: freshUrl,
    durationSeconds: lockerEntry.durationSeconds || playable.durationSeconds,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: lockerEntry.id,
    artworkUrl: coalesceArtworkUrl(lockerEntry.albumArt, playable.artworkUrl),
    releaseYear: lockerEntry.releaseYear ?? playable.releaseYear,
    replayGainDb: lockerRg ?? undefined,
  };
}

/** Resolve a playable envelope (tier 3/4/addons) without spectral verification. */
export async function resolvePlayableEnvelope(
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  options?: InstantPlayableOptions,
): Promise<MediaEnvelope | null> {
  const instant = await tryInstantPlayable(env, options);
  if (instant) return instant;

  let playable = await applyLockerShortcut(env);

  const url = playable.url?.trim() ?? '';
  if (url && !isCatalogPreviewUrl(url) && isFullStreamEnvelope(playable)) {
    return playable;
  }

  playable = await executeTrack(playable, candidates);
  if (!playable.url?.trim() || !isFullStreamEnvelope(playable)) return null;
  return playable;
}

function prefetchKey(env: MediaEnvelope): string {
  return playCacheKey(env);
}

/** Background resolve + optional URL callback for audio prebuffer. */
export function prefetchPlayableEnvelope(
  env: MediaEnvelope,
  candidates: CandidateSource[] | undefined,
  onResolvedUrl?: (url: string, envelope: MediaEnvelope) => void,
): void {
  const key = prefetchKey(env);
  const cached = getSyncCachedPlayable(env);
  if (cached?.url) {
    onResolvedUrl?.(cached.url, env);
    return;
  }

  const existing = inFlight.get(key);
  if (existing) {
    void existing.then((resolved) => {
      if (resolved?.url) onResolvedUrl?.(resolved.url, env);
    });
    return;
  }

  const job = resolvePlayableEnvelope(env, candidates, { forPrefetch: true })
    .then((resolved) => {
      if (resolved?.url) onResolvedUrl?.(resolved.url, resolved);
      return resolved;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, job);
}

export type QueuePrefetchInput = {
  playQueue: MediaEnvelope[];
  queueIndex: number;
  repeatMode: RepeatMode;
  findCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
};

export type PrefetchQueueInput = QueuePrefetchInput & {
  onResolvedUrl: (url: string, envelope: MediaEnvelope) => void;
};

/**
 * Enqueue the rest of a locker album into native Exo queue (content:// on Android).
 * Works with gapless on or off — native Exo auto-advances within its queue even when
 * the WebView is throttled (lock screen / pocket).
 */
export async function primeLockerNativeQueue(
  tracks: MediaEnvelope[],
  fromIndex: number,
  onResolvedUrl: (url: string, envelope: MediaEnvelope) => void,
  awaitNativeEnqueue?: () => Promise<void>,
): Promise<void> {
  if (fromIndex >= tracks.length - 1) return;
  for (let i = fromIndex + 1; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track || track.provider !== 'local-vault') continue;
    let resolved = await resolveLockerEnvelopeForPlayback(track);
    if (!resolved?.url?.trim()) {
      resolved = await resolveLockerEnvelopeForPlayback(track);
    }
    if (!resolved?.url?.trim()) continue;
    const exoUrl = await resolveNativeExoStreamUrlAsync(resolved);
    if (exoUrl) onResolvedUrl(exoUrl, resolved);
  }
  if (awaitNativeEnqueue) {
    await awaitNativeEnqueue();
  }
}

/** @deprecated Use primeLockerNativeQueue */
export const primeLockerGaplessQueue = primeLockerNativeQueue;

export function isLockerVaultPlayQueue(queue: MediaEnvelope[]): boolean {
  return queue.length > 0 && queue.every((t) => t.provider === 'local-vault');
}

/**
 * Which queue positions are worth resolving ahead of time, in priority order.
 *
 * Pure so the wrap-around and the back-skip case can be asserted without driving real resolves,
 * which is how the previous track came to be left out for as long as it was.
 */
export function prefetchQueueIndices(
  queueIndex: number,
  queueLength: number,
  repeatMode: string,
  ahead = PREFETCH_AHEAD,
): number[] {
  if (queueLength <= 0) return [];
  const indices: number[] = [];
  for (let offset = 1; offset <= ahead; offset++) {
    let idx = queueIndex + offset;
    if (idx >= queueLength) {
      if (repeatMode === 'all') idx = idx - queueLength;
      else break;
    }
    if (idx >= 0 && idx < queueLength && idx !== queueIndex && !indices.includes(idx)) {
      indices.push(idx);
    }
  }

  /*
   * The previous track, last. A forward-only window guarantees that skipping back is slow, and
   * back is the skip most likely to be pressed at all — it is what someone reaches for when they
   * did not want the track that just started. Last in the list because it is one track against
   * several ahead, and the ones ahead are still the common case.
   */
  const previous =
    queueIndex - 1 >= 0 ? queueIndex - 1 : repeatMode === 'all' ? queueLength - 1 : -1;
  if (previous >= 0 && previous < queueLength && previous !== queueIndex && !indices.includes(previous)) {
    indices.push(previous);
  }
  return indices;
}

/** Prefetch the next N tracks in the play queue. */
export function prefetchUpcomingQueueTracks(input: PrefetchQueueInput): void {
  const { playQueue, queueIndex, repeatMode, findCandidates, onResolvedUrl } = input;
  if (playQueue.length === 0) return;

  const indices = prefetchQueueIndices(queueIndex, playQueue.length, repeatMode);

  for (const idx of indices) {
    const track = playQueue[idx];
    if (!track) continue;
    prefetchPlayableEnvelope(track, findCandidates(track), onResolvedUrl);
  }

  prefetchUpcomingIntoStreamCache(input);
}

function collectUpcomingQueueIndices(
  input: QueuePrefetchInput,
  maxAhead: number,
  startOffset = 1,
): number[] {
  const { playQueue, queueIndex, repeatMode } = input;
  const indices: number[] = [];
  for (let offset = startOffset; offset <= maxAhead; offset++) {
    let idx = queueIndex + offset;
    if (idx >= playQueue.length) {
      if (repeatMode === 'all') idx = idx - playQueue.length;
      else break;
    }
    if (idx >= 0 && idx < playQueue.length) indices.push(idx);
  }
  return indices;
}

/**
 * Silently prefetch upcoming queue tracks into IndexedDB stream cache while playback runs.
 * Cellular: next track only. Wi‑Fi: next two tracks.
 */
export function prefetchUpcomingIntoStreamCache(input: QueuePrefetchInput): void {
  if (!loadStreamCacheEnabled()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const maxAhead = isCellularNetwork()
    ? STREAM_CACHE_PREFETCH_AHEAD_CELLULAR
    : STREAM_CACHE_PREFETCH_AHEAD_WIFI;
  const { findCandidates } = input;
  const indices = collectUpcomingQueueIndices(input, maxAhead);

  for (const idx of indices) {
    const track = input.playQueue[idx];
    if (!track?.envelopeId) continue;
    if (
      track.provider === 'local-vault' ||
      track.provider === 'stream-cache' ||
      track.provider === 'indexeddb' ||
      track.provider === 'blob'
    ) {
      continue;
    }
    if (isEnvelopeStreamCached(track)) continue;
    if (streamCachePrefetchInFlight.has(track.envelopeId)) continue;

    streamCachePrefetchInFlight.add(track.envelopeId);
    void silentPrefetchTrackIntoStreamCache(track, findCandidates(track))
      .catch(() => undefined)
      .finally(() => {
        streamCachePrefetchInFlight.delete(track.envelopeId);
      });
  }
}

function collectUpcomingTracks(input: QueuePrefetchInput, includeCurrent: boolean): MediaEnvelope[] {
  const { playQueue, queueIndex, repeatMode } = input;
  const indices: number[] = [];
  const startOffset = includeCurrent ? 0 : 1;
  for (let offset = startOffset; offset <= PREFETCH_AHEAD; offset++) {
    let idx = queueIndex + offset;
    if (idx >= playQueue.length) {
      if (repeatMode === 'all') idx = idx - playQueue.length;
      else if (offset === 0) continue;
      else break;
    }
    if (idx >= 0 && idx < playQueue.length) indices.push(idx);
  }
  const seen = new Set<string>();
  const tracks: MediaEnvelope[] = [];
  for (const idx of indices) {
    const track = playQueue[idx];
    if (!track?.envelopeId || seen.has(track.envelopeId)) continue;
    seen.add(track.envelopeId);
    tracks.push(track);
  }
  return tracks;
}

/** Report active playback queue to tier34 for tmpfs RAM staging (server-side). */
export function stageUpcomingQueueOnTier34(input: QueuePrefetchInput): void {
  const tracks = collectUpcomingTracks(input, true);
  if (tracks.length === 0) return;

  const envelopeIds = tracks.map((t) => t.envelopeId).filter(Boolean);
  const trackIds = tracks
    .map((t) => t.sourceId?.trim())
    .filter((id): id is string => Boolean(id));

  void tier34StagePlaybackQueue({ envelopeIds, trackIds });
}
