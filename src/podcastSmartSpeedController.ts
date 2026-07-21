/**
 * Overcast-style Smart Speed — shortens silences by raising playback rate through quiet
 * sections (Web Audio analyser) and skipping long gaps when a precomputed map exists.
 */

import {
  ensureSilenceRegionsForEpisode,
  findSilenceRegionAt,
  measureAnalyserRms,
  PODCAST_SILENCE_RMS_THRESHOLD,
  type SilenceRegion,
} from './podcastSilenceAnalysis';

const ATTACK_MS = 140;
const RELEASE_MS = 100;
/** Extra speed multiplier applied on top of the user's podcast speed during silence. */
const SILENCE_RATE_MULTIPLIER = 2.15;
const MAX_PLAYBACK_RATE = 3;
/** Skip ahead when a cached silence gap exceeds this length (native / offline path). */
const LONG_SILENCE_SKIP_MS = 900;

export type PodcastSmartSpeedController = {
  stop: () => void;
};

export function startPodcastSmartSpeed(opts: {
  episodeId: string;
  audioUrl: string;
  analyser: AnalyserNode | null;
  getUserPlaybackRate: () => number;
  setPlaybackRate: (rate: number) => void;
  getCurrentTimeSeconds: () => number;
  seek: (seconds: number) => void;
  isPlaying: () => boolean;
}): PodcastSmartSpeedController {
  let stopped = false;
  let rafId = 0;
  let inSilence = false;
  let quietSince = 0;
  let loudSince = 0;
  let lastSeekSkipAt = 0;
  let silenceRegions: SilenceRegion[] = [];
  const scratch = new Uint8Array(2048);

  void ensureSilenceRegionsForEpisode(opts.episodeId, opts.audioUrl).then((regions) => {
    if (!stopped) silenceRegions = regions;
  });

  const applyRate = () => {
    const user = opts.getUserPlaybackRate();
    const mult = inSilence ? SILENCE_RATE_MULTIPLIER : 1;
    opts.setPlaybackRate(Math.min(MAX_PLAYBACK_RATE, Math.max(0.5, user * mult)));
  };

  const tick = () => {
    if (stopped) return;
    rafId = requestAnimationFrame(tick);

    if (!opts.isPlaying()) {
      inSilence = false;
      quietSince = 0;
      loudSince = 0;
      if (opts.analyser) applyRate();
      return;
    }

    const now = performance.now();
    const t = opts.getCurrentTimeSeconds();
    const region = findSilenceRegionAt(silenceRegions, t);
    if (
      region &&
      (region.endSeconds - region.startSeconds) * 1000 >= LONG_SILENCE_SKIP_MS &&
      now - lastSeekSkipAt > 600
    ) {
      opts.seek(Math.max(0, region.endSeconds - 0.06));
      lastSeekSkipAt = now;
      inSilence = false;
      if (opts.analyser) applyRate();
      return;
    }

    // Native Exo on Android has no Web Audio analyser — rate wobble fights setPlaybackSpeed.
    if (!opts.analyser) return;

    const rms = measureAnalyserRms(opts.analyser, scratch);
    if (rms < PODCAST_SILENCE_RMS_THRESHOLD) {
      if (!quietSince) quietSince = now;
      loudSince = 0;
      if (!inSilence && now - quietSince >= ATTACK_MS) {
        inSilence = true;
        applyRate();
      }
    } else {
      if (!loudSince) loudSince = now;
      quietSince = 0;
      if (inSilence && now - loudSince >= RELEASE_MS) {
        inSilence = false;
        applyRate();
      }
    }
  };

  rafId = requestAnimationFrame(tick);

  return {
    stop: () => {
      stopped = true;
      if (rafId) cancelAnimationFrame(rafId);
      inSilence = false;
      opts.setPlaybackRate(opts.getUserPlaybackRate());
    },
  };
}
