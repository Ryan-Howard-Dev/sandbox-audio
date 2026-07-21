/**
 * Wi‑Fi-only background prefetch — warm upcoming queue without blocking cellular play.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { isWifiNetwork } from './networkPlayPolicy';
import { loadStreamCacheEnabled } from './sandboxSettings';
import { silentPrefetchTrackIntoStreamCache } from './streamCache';
import {
  prefetchPlayableEnvelope,
  type QueuePrefetchInput,
} from './trackPrefetch';

const WIFI_QUEUE_PREFETCH_AHEAD = 5;
const wifiPrefetchInFlight = new Set<string>();

export function prefetchUpcomingOnWifi(
  input: QueuePrefetchInput,
  options?: { maxAhead?: number },
): void {
  if (!isWifiNetwork()) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const maxAhead = options?.maxAhead ?? WIFI_QUEUE_PREFETCH_AHEAD;
  const { playQueue, queueIndex, repeatMode, findCandidates } = input;
  if (playQueue.length === 0) return;

  const indices: number[] = [];
  for (let offset = 1; offset <= maxAhead; offset++) {
    let idx = queueIndex + offset;
    if (idx >= playQueue.length) {
      if (repeatMode === 'all') idx = idx - playQueue.length;
      else break;
    }
    if (idx >= 0 && idx < playQueue.length) indices.push(idx);
  }

  for (const idx of indices) {
    const track = playQueue[idx];
    if (!track?.envelopeId) continue;
    prefetchPlayableEnvelope(track, findCandidates(track));
  }
}

/** Full IndexedDB cache for upcoming tracks — Wi‑Fi only, non-blocking. */
export function cacheUpcomingOnWifi(
  input: QueuePrefetchInput,
  options?: { maxAhead?: number },
): void {
  if (!isWifiNetwork() || !loadStreamCacheEnabled()) return;

  const maxAhead = options?.maxAhead ?? WIFI_QUEUE_PREFETCH_AHEAD;
  const { playQueue, queueIndex, repeatMode, findCandidates } = input;
  if (playQueue.length === 0) return;

  for (let offset = 1; offset <= maxAhead; offset++) {
    let idx = queueIndex + offset;
    if (idx >= playQueue.length) {
      if (repeatMode === 'all') idx = idx - playQueue.length;
      else break;
    }
    const track = playQueue[idx];
    if (!track?.envelopeId) continue;
    if (wifiPrefetchInFlight.has(track.envelopeId)) continue;
    if (
      track.provider === 'local-vault' ||
      track.provider === 'stream-cache' ||
      track.provider === 'indexeddb'
    ) {
      continue;
    }

    wifiPrefetchInFlight.add(track.envelopeId);
    void silentPrefetchTrackIntoStreamCache(track, findCandidates(track))
      .catch(() => undefined)
      .finally(() => {
        wifiPrefetchInFlight.delete(track.envelopeId);
      });
  }
}
