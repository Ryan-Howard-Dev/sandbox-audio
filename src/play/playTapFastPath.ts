import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { isCatalogPreviewUrl } from '../displaySanitize';
import { isOfflineUnplayableStreamUrl } from '../nativeExoStreamResolver';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { getSyncCachedPlayable } from '../trackPrefetch';
import {
  resolveQueueTrackSeekTarget,
  shouldSeekQueueTrackInPlace,
} from '../queueNavigation';

export { isImmediateLocalPlayable } from './ensureLockerPlayable';

export function needsMobileResolveEarly(
  env: MediaEnvelope,
  candidates?: CandidateSource[],
): boolean {
  if (isPodcastEnvelopeId(env.envelopeId)) return false;
  if (
    env.provider === 'local-vault' ||
    env.provider === 'stream-cache' ||
    env.provider === 'indexeddb' ||
    env.provider === 'blob'
  ) {
    return false;
  }
  const url = env.url?.trim() ?? '';
  return (
    !url ||
    isCatalogPreviewUrl(url) ||
    isOfflineUnplayableStreamUrl(url)
  );
}

export function readSyncCachedFastPath(env: MediaEnvelope): MediaEnvelope | null {
  if (isPodcastEnvelopeId(env.envelopeId)) return null;
  return getSyncCachedPlayable(env);
}

export type QueueInPlaceSeekInput = {
  playQueue: MediaEnvelope[];
  queueIndex: number;
  targetQueueIdx: number;
  currentUrl: string;
  streamDurationSeconds: number;
  envelopeDurationSeconds: number;
};

export function tryQueueInPlaceSeek(input: QueueInPlaceSeekInput): number | null {
  if (input.targetQueueIdx < 0) return null;
  if (
    !shouldSeekQueueTrackInPlace(
      input.playQueue,
      input.queueIndex,
      input.targetQueueIdx,
      input.currentUrl,
      input.streamDurationSeconds,
      input.envelopeDurationSeconds,
    )
  ) {
    return null;
  }
  return resolveQueueTrackSeekTarget(input.playQueue, input.targetQueueIdx);
}
