/**
 * Lane A P1 — batch Wi‑Fi prefetch for albums/playlists before travel (cellular playback later).
 */

import type { CandidateSource, MediaEnvelope } from './sandboxLayer1';
import { isWifiNetwork } from './networkPlayPolicy';
import { pullMissingLockerBlobsFromRemote } from './lockerSync';
import { prefetchFullTrack, type AggressivePrefetchResult } from './streamCache';

export type PrepareForTravelResult = {
  prefetched: number;
  skippedLocal: number;
  failed: number;
  syncPulled: number;
  blockedReason?: 'cellular' | 'empty' | 'offline';
};

function needsTravelPrefetch(env: MediaEnvelope): boolean {
  if (!env.envelopeId?.trim()) return false;
  return !(
    env.provider === 'local-vault' ||
    env.provider === 'stream-cache' ||
    env.provider === 'indexeddb' ||
    env.provider === 'blob'
  );
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex;
      nextIndex += 1;
      results[i] = await fn(items[i]!, i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function countPrefetchOutcome(result: AggressivePrefetchResult): 'prefetched' | 'skippedLocal' | 'failed' {
  if ('reason' in result) {
    if (result.reason === 'local' || result.reason === 'disabled') {
      return 'skippedLocal';
    }
    return 'failed';
  }
  return result.fromCache ? 'skippedLocal' : 'prefetched';
}

/**
 * On Wi‑Fi: cache remote tracks to IndexedDB + pull locker sync blobs.
 * Skips tracks already in locker or stream cache.
 */
export async function prepareTracksForTravel(
  tracks: MediaEnvelope[],
  options?: {
    findCandidates?: (env: MediaEnvelope) => CandidateSource[];
    concurrency?: number;
    onProgress?: (done: number, total: number, title?: string) => void;
    skipLockerSync?: boolean;
  },
): Promise<PrepareForTravelResult> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { prefetched: 0, skippedLocal: 0, failed: 0, syncPulled: 0, blockedReason: 'offline' };
  }
  if (!isWifiNetwork()) {
    return { prefetched: 0, skippedLocal: 0, failed: 0, syncPulled: 0, blockedReason: 'cellular' };
  }

  const unique = tracks.filter((t, i, arr) => {
    if (!t?.envelopeId) return false;
    return arr.findIndex((x) => x.envelopeId === t.envelopeId) === i;
  });
  if (unique.length === 0) {
    return { prefetched: 0, skippedLocal: 0, failed: 0, syncPulled: 0, blockedReason: 'empty' };
  }

  let syncPulled = 0;
  if (!options?.skipLockerSync) {
    try {
      const sync = await pullMissingLockerBlobsFromRemote();
      syncPulled = sync.pulled;
    } catch {
      /* optional — tier34 may be unreachable */
    }
  }

  const toPrefetch = unique.filter(needsTravelPrefetch);
  const skippedLocal = unique.length - toPrefetch.length;
  if (toPrefetch.length === 0) {
    return { prefetched: 0, skippedLocal, failed: 0, syncPulled };
  }

  let prefetched = 0;
  let failed = 0;
  let done = 0;
  const concurrency = Math.max(1, Math.min(3, options?.concurrency ?? 2));

  await mapWithConcurrency(toPrefetch, concurrency, async (track) => {
    const result = await prefetchFullTrack(track, {
      candidates: options?.findCandidates?.(track),
    });
    const outcome = countPrefetchOutcome(result);
    if (outcome === 'prefetched') prefetched += 1;
    else if (outcome === 'failed') failed += 1;
    done += 1;
    options?.onProgress?.(done, toPrefetch.length, track.title);
  });

  return { prefetched, skippedLocal, failed, syncPulled };
}

export { needsTravelPrefetch };
