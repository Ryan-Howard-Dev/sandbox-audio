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

/**
 * Where this track starts, for restarting the one already playing.
 *
 * A track starts at zero unless the whole queue is one album-length stream, in which case it
 * starts wherever the tracks before it left off. Telling those apart matters: skipping back more
 * than a few seconds into a track is supposed to restart it, and that was seeking to the
 * cumulative offset unconditionally. On an ordinary queue of separate files, restarting the third
 * track meant seeking to the length of the first two, which is minutes past the end of a track
 * that is minutes long, so the seek went nowhere and the button did nothing. It only ever appeared
 * to work at the top of a queue, where that sum happens to be zero.
 *
 * The offset is used only when the queue really does share the stream now playing. Anything else
 * restarts at zero, which is what every ordinary queue wants.
 */
export function resolveQueueTrackRestartSeconds(
  queue: MediaEnvelope[],
  index: number,
  currentStreamUrl: string,
): number {
  const url = currentStreamUrl?.trim() ?? '';
  if (!url || queue.length < 2) return 0;
  const sharesOneStream = queue.every((track) => (track.url?.trim() ?? '') === url);
  return sharesOneStream ? cumulativeQueueOffset(queue, Math.max(0, index)) : 0;
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
