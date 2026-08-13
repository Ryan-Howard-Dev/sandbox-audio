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
import {
  currentNativeQueueWriteGeneration,
  nativeQueueWritesSuperseded,
} from './nativeQueueWrites';

/** Rolling native/JS prefetch window — must exceed 2 so locked-screen playback survives OEM WebView throttle. */
const PREFETCH_AHEAD = 5;
const STREAM_CACHE_PREFETCH_AHEAD_CELLULAR = 1;
const STREAM_CACHE_PREFETCH_AHEAD_WIFI = 2;
/**
 * How long one queue position may hold up the ones behind it before it is skipped.
 *
 * Ordering the enqueue means a position that never resolves would block everything after it, and
 * the cost of that is the lookahead for the rest of the window, heard as a gap between every
 * following track. So there is a limit. It just has to be longer than a resolve actually takes.
 *
 * This was six seconds, which is a locker figure. A streamed track is not read off the disk, it is
 * extracted, and that was measured on a real phone at just under forty seconds for one track. So
 * every streamed position was written off as a hole before it had any chance of arriving, its late
 * result was dropped as stale, and nothing was ever queued ahead -- which is the gap between online
 * tracks this was supposed to close, made worse.
 *
 * A minute is comfortably clear of the slowest resolve seen and still bounded, so a genuinely dead
 * position costs one hole rather than the rest of the window.
 */
const ORDERED_ENQUEUE_TIMEOUT_MS = 60000;

/**
 * Which prefetch run may add to the native queue. Only the newest.
 *
 * Ordering the release within a run is not enough once a second run can start before the first has
 * finished resolving, which is exactly what skipping does. Both runs then release in their own
 * correct order, into the same queue, interleaved. Measured on device: two skips in quick
 * succession left the player holding positions 2, 7, 4, 5, 6, 3 where it should have held 2 to 7.
 *
 * Separate from the priming generation on purpose. Priming is a long walk down the rest of the
 * queue and prefetch fires on every index change, so sharing one token would have each advance
 * cancel the run that provides the depth.
 */
let prefetchEnqueueGeneration = 0;
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
 * Which priming run is allowed to enqueue. Only the newest one is.
 *
 * Module scope rather than per call because the whole point is that a later run invalidates an
 * earlier one, and the two have no other way to know about each other.
 */
let primeRunGeneration = 0;

/**
 * Enqueue the rest of a locker album into native Exo queue (content:// on Android).
 * Works with gapless on or off — native Exo auto-advances within its queue even when
 * the WebView is throttled (lock screen / pocket).
 *
 * Only one run may be enqueueing at a time, and a new run supersedes whatever was still going.
 *
 * This is called on every track advance and walks the whole remaining queue, so on a sixty track
 * queue the run for track two was still resolving when the run for track three started. Both then
 * appended to the same serialised enqueue chain, interleaved, and native Exo takes queue order
 * from the order the calls arrive in. The result was a native queue in a different order to the
 * JS one: measured on device, a radio queue played its JS positions 0, 2, 4, 60, 5, 1, 3 before
 * settling, which is heard as the player wandering back to tracks it has already played.
 *
 * Ordering within a single run was never the problem, so the fix is only to stop two of them
 * overlapping. Each resolve checks the generation both before enqueueing and after awaiting,
 * because the await is where a newer run gets its chance to start.
 */
export async function primeLockerNativeQueue(
  tracks: MediaEnvelope[],
  fromIndex: number,
  onResolvedUrl: (url: string, envelope: MediaEnvelope) => void,
  awaitNativeEnqueue?: () => Promise<void>,
): Promise<void> {
  if (fromIndex >= tracks.length - 1) return;
  const generation = ++primeRunGeneration;
  const writeToken = currentNativeQueueWriteGeneration();
  // Superseded by a newer priming run, or by the queue being reset out from under this one.
  const superseded = () =>
    generation !== primeRunGeneration || nativeQueueWritesSuperseded(writeToken);

  for (let i = fromIndex + 1; i < tracks.length; i++) {
    if (superseded()) return;
    const track = tracks[i];
    if (!track || track.provider !== 'local-vault') continue;
    let resolved = await resolveLockerEnvelopeForPlayback(track);
    if (!resolved?.url?.trim()) {
      resolved = await resolveLockerEnvelopeForPlayback(track);
    }
    if (!resolved?.url?.trim()) continue;
    const exoUrl = await resolveNativeExoStreamUrlAsync(resolved);
    if (superseded()) return;
    if (exoUrl) onResolvedUrl(exoUrl, resolved);
  }
  if (awaitNativeEnqueue && !superseded()) {
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

/**
 * Which prefetched positions may also be handed to the native queue.
 *
 * Native Exo's queue is linear and enqueueNext appends, so anything enqueued is something that
 * will be played, in the position it was added at. The prefetch list is not a play order: it wraps
 * around under repeat-all, and it deliberately ends with the previous track so that skipping back
 * is quick. Both are the right things to resolve and the wrong things to enqueue.
 *
 * Enqueueing them is what put a track from the far end of the queue into the middle of playback.
 * Measured on device: a radio queue playing its position 0 also enqueued position 60, because
 * under repeat-all the track "before" the first one is the last one, and it was duly played sixth.
 * From the listener's chair the player had wandered off to something already heard.
 *
 * Only the contiguous run forward from where playback is now is a play order, so only that is
 * allowed through. Everything else is still resolved; it just warms the cache without joining the
 * queue, which is all a back-skip needed from it in the first place.
 */
export function enqueueableQueueIndices(
  queueIndex: number,
  queueLength: number,
  ahead = PREFETCH_AHEAD,
): number[] {
  const indices: number[] = [];
  for (let offset = 1; offset <= ahead; offset++) {
    const idx = queueIndex + offset;
    // No wrap. Where the queue really does loop, the advance handles it and priming follows.
    if (idx >= queueLength) break;
    indices.push(idx);
  }
  return indices;
}

/**
 * Hold results back until every earlier position has been dealt with, then let them go.
 *
 * The queue positions are resolved together so nothing waits its turn to start, but native Exo
 * takes queue order from the order calls arrive in, so they cannot be handed over as they land.
 * A cursor walks the window and only moves past a position once that position has settled, either
 * with a url or with nothing.
 *
 * Extracted so the awkward cases can be asserted directly: results arriving backwards, a position
 * that never resolves, and a run that gets overtaken by a newer one. All three happened on a real
 * phone and none of them are reachable from a test that has to go through a resolver.
 */
export function createOrderedRelease(
  forward: readonly number[],
  onResolvedUrl: (url: string, envelope: MediaEnvelope) => void,
  isSuperseded: () => boolean = () => false,
): { settle: (index: number, value: { url: string; envelope: MediaEnvelope } | null) => void } {
  const slots = new Map<number, { url: string; envelope: MediaEnvelope } | null>();
  let cursor = 0;

  const release = () => {
    while (cursor < forward.length) {
      const idx = forward[cursor]!;
      if (!slots.has(idx)) return;
      const slot = slots.get(idx);
      if (slot) onResolvedUrl(slot.url, slot.envelope);
      cursor += 1;
    }
  };

  return {
    settle(index, value) {
      // An overtaken run stops contributing. Its late arrivals describe a window the listener has
      // already moved past, and adding them now is precisely what put them out of order.
      if (isSuperseded() || slots.has(index)) return;
      slots.set(index, value);
      release();
    },
  };
}

/** Prefetch the next N tracks in the play queue. */
export function prefetchUpcomingQueueTracks(input: PrefetchQueueInput): void {
  const { playQueue, queueIndex, repeatMode, findCandidates, onResolvedUrl } = input;
  if (playQueue.length === 0) return;

  const indices = prefetchQueueIndices(queueIndex, playQueue.length, repeatMode);
  const forward = enqueueableQueueIndices(queueIndex, playQueue.length);
  const forwardSet = new Set(forward);

  /*
   * Resolve the window at once, hand it to the queue strictly in order.
   *
   * These resolves finish in whatever order they finish in: a cached track calls back immediately,
   * a cold one calls back when the network is done. Passing each straight through added them to
   * the native queue in completion order rather than queue order, and a cold track surrounded by
   * warm ones landed after them. Measured on device: positions 2 to 5 were cached and went in at
   * once, position 1 was not and was played sixth.
   *
   * Resolving them one after another would order them but would also serialise the network, and
   * on streamed tracks that is the whole gap between songs. So they run together and the results
   * are released through a cursor that only moves forward, which keeps order without making
   * anything wait its turn to start.
   */
  const generation = ++prefetchEnqueueGeneration;
  const writeToken = currentNativeQueueWriteGeneration();
  const { settle } = createOrderedRelease(
    forward,
    onResolvedUrl,
    () =>
      generation !== prefetchEnqueueGeneration || nativeQueueWritesSuperseded(writeToken),
  );

  for (const idx of indices) {
    const track = playQueue[idx];
    if (!track) continue;
    if (!forwardSet.has(idx)) {
      // Wrapped positions and the previous track: warmed, never queued. See above.
      prefetchPlayableEnvelope(track, findCandidates(track));
      continue;
    }
    /*
     * A track that never resolves must not hold the rest back, or one dead entry costs the
     * lookahead for everything behind it and every following gap.
     */
    const timer = setTimeout(() => settle(idx, null), ORDERED_ENQUEUE_TIMEOUT_MS);
    prefetchPlayableEnvelope(track, findCandidates(track), (url, envelope) => {
      clearTimeout(timer);
      settle(idx, { url, envelope });
    });
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
