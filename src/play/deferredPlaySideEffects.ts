import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { resolveEnvelopeReplayGainDb } from '../replayGainPlayback';
import {
  applyAggressivePrefetchIfEnabled,
  storeStreamCacheAfterPlay,
} from '../streamCache';
import { tier34SpectralCheck, tier34HealDeadSource } from '../tier34/client';
import { shouldRunAggressiveCacheOnNetwork } from '../networkPlayPolicy';
import { executeTrack, isPlaybackDowngrade } from '../playbackPipeline';

import type { PrefetchProgressToastDetail } from '../prefetchProgressNotify';

export type DeferredPlaySideEffectsInput = {
  seedEnvelope: MediaEnvelope;
  playable: MediaEnvelope;
  candidates?: CandidateSource[];
  hadAttachedTier: boolean;
  preferFreshMobile: boolean;
  mobileActive: boolean;
  loadAggressiveCache: boolean;
  notifyPrefetchProgress?: (detail: PrefetchProgressToastDetail) => void;
  dismissPrefetchProgress?: (prefetchId: string) => void;
  seedArtwork?: string;
};

/** Runs replay-gain lookup, spectral validation, and offline cache after audible start. */
export async function runDeferredPlaySideEffects(
  input: DeferredPlaySideEffectsInput,
): Promise<MediaEnvelope> {
  let playable = input.playable;

  if (playable.replayGainDb == null) {
    const replayGainDb = await resolveEnvelopeReplayGainDb(playable);
    playable = { ...playable, replayGainDb };
  }

  const skipSpectral =
    input.hadAttachedTier ||
    playable.provider === 'local-vault' ||
    playable.url?.includes('/api/proxy/stream') ||
    playable.resolutionSource === 'mobile' ||
    (input.preferFreshMobile && input.mobileActive);

  if (
    !skipSpectral &&
    playable.url &&
    (playable.provider === 'stream-proxy' ||
      playable.provider === 'proxy' ||
      playable.provider === 'debrid')
  ) {
    const spec = await tier34SpectralCheck(
      playable.url,
      playable.title,
      playable.artist,
    );
    if (!spec.accepted) {
      const healed = await tier34HealDeadSource(playable);
      if (healed?.url) {
        const retried = await executeTrack(
          input.seedArtwork && !healed.artworkUrl
            ? { ...healed, artworkUrl: input.seedArtwork }
            : healed,
          input.candidates,
        );
        if (!isPlaybackDowngrade(playable, retried)) playable = retried;
      }
    }
  }

  if (input.loadAggressiveCache && shouldRunAggressiveCacheOnNetwork()) {
    playable = await applyAggressivePrefetchIfEnabled(
      playable,
      input.candidates,
      input.notifyPrefetchProgress,
      input.dismissPrefetchProgress,
    );
  }

  storeStreamCacheAfterPlay(playable);
  return playable;
}
