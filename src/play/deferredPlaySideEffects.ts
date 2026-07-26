import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { resolveEnvelopeReplayGainDb } from '../replayGainPlayback';
import { shouldBackfillLockerTrackGain } from '../replayGainIngest';
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

    // 0 means "no gain stored", which is every locker row imported before ingest measured
    // loudness correctly. Analyse this one track in the background so the next play of it is
    // normalised; without this those rows would take the flat fallback forever, since a library
    // that is already imported never gets re-imported. Fire-and-forget: it must not delay
    // playback, and the result deliberately does not apply to the track currently playing.
    if (shouldBackfillLockerTrackGain({ ...playable, replayGainDb })) {
      const sourceId = playable.sourceId!;
      void import('../lockerStorage')
        .then((m) => m.backfillLockerTrackGain(sourceId))
        .catch(() => undefined);
    }
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
