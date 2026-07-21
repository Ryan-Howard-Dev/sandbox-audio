import type { MediaEnvelope } from './sandboxLayer1';
import { getSyncCachedPlayable } from './trackPrefetch';

/** File offset for a queue index when tracks share one album-length stream. */
export function cumulativeQueueOffset(
  queue: MediaEnvelope[],
  index: number,
): number {
  let offset = 0;
  for (let i = 0; i < index; i += 1) {
    const d = queue[i]?.durationSeconds ?? 0;
    if (d > 0) offset += d;
  }
  return offset;
}

export function resolveQueueTrackSeekTarget(
  queue: MediaEnvelope[],
  index: number,
): number {
  return cumulativeQueueOffset(queue, Math.max(0, index));
}

/** Seek within the current stream instead of re-resolving (shared URL / album upload). */
export function shouldSeekQueueTrackInPlace(
  queue: MediaEnvelope[],
  currentIndex: number,
  targetIndex: number,
  currentStreamUrl: string,
  _streamSeconds: number,
  _catalogSeconds: number,
): boolean {
  if (targetIndex < 0 || targetIndex >= queue.length || targetIndex === currentIndex) {
    return false;
  }
  const current = queue[currentIndex];
  const target = queue[targetIndex];
  if (!current || !target) return false;

  const cached = getSyncCachedPlayable(target);
  const targetUrl = cached?.url?.trim() || target.url?.trim();
  if (!currentStreamUrl?.trim() || !targetUrl) return false;
  return currentStreamUrl.trim() === targetUrl;
}
