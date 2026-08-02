/**
 * Podcast player controls for the shell — speed, smart speed, voice boost, Skip Ad,
 * chapter nav, resume, and auto-complete. Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the same position in SandboxShell where the podcast effects used to
 * live: several later effects (cast, queue, Connect) rely on registration order.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import { isAndroid } from '../platformEnv';
import { resumeAtSeconds } from '../resumeRewind';
import {
  cyclePodcastPlaybackSpeed,
  loadPodcastPlaybackSpeed,
  loadPodcastSmartSpeedEnabled,
  loadPodcastSkipAdChaptersEnabled,
  loadPodcastVoiceBoostEnabled,
  savePodcastSmartSpeedEnabled,
  savePodcastSkipAdChaptersEnabled,
  savePodcastVoiceBoostEnabled,
  PODCAST_SETTINGS_CHANGE_EVENT,
} from '../podcastSettings';
import {
  isPodcastEnvelopeId,
  parsePodcastEpisodeId,
  parsePodcastFeedId,
  findEpisode,
  findSubscription,
  updateEpisodeChapters,
  updateSubscriptionMeta,
  PODCASTS_CHANGE_EVENT,
  getEpisodeResumePosition,
  getEpisodeResumeSavedAt,
  saveEpisodeResumePosition,
  markEpisodeCompleted,
  maybeAutoCompleteEpisode,
} from '../podcastStorage';
import {
  seekSecondsForNextChapter,
  seekSecondsForPreviousChapter,
  type PodcastChapter,
} from '../podcastChapters';
import { resolvePodcastChapters } from '../podcastChapterResolution';
import { seekTargetAfterAdChapter, seekTargetForManualAdSkip, manualAdSkipHint } from '../podcastAdSkip';
import {
  cycleEpisodeVolumeBoostDb,
  loadEpisodeVolumeBoostDb,
} from '../podcastEpisodeBoost';
import { syncPodcastRulesToTier34 } from '../podcastRulesSync';
import { resolveVoiceBoostEnabled } from '../podcastVoiceBoost';
import { startPodcastSmartSpeed, type PodcastSmartSpeedController } from '../podcastSmartSpeedController';

export function useShellPodcastControls(
  audio: UseAudioFSMResult,
  audioCurrentTimeRef: MutableRefObject<number>,
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>,
) {
  const podcastResumeAppliedRef = useRef<string | null>(null);
  const podcastAdSkipLastAtRef = useRef(0);
  const podcastSmartSpeedRef = useRef<PodcastSmartSpeedController | null>(null);
  const [podcastPlaybackSpeed, setPodcastPlaybackSpeed] = useState(loadPodcastPlaybackSpeed);
  const [podcastSmartSpeedEnabled, setPodcastSmartSpeedEnabled] = useState(
    loadPodcastSmartSpeedEnabled,
  );
  const [podcastVoiceBoostEnabled, setPodcastVoiceBoostEnabled] = useState(
    loadPodcastVoiceBoostEnabled,
  );
  const [podcastSkipAdChaptersEnabled, setPodcastSkipAdChaptersEnabled] = useState(
    loadPodcastSkipAdChaptersEnabled,
  );
  const [podcastChapters, setPodcastChapters] = useState<PodcastChapter[]>([]);
  const [episodeVolumeBoostDb, setEpisodeVolumeBoostDb] = useState(0);

  useEffect(() => {
    const onSettings = () => {
      setPodcastPlaybackSpeed(loadPodcastPlaybackSpeed());
      setPodcastSmartSpeedEnabled(loadPodcastSmartSpeedEnabled());
      setPodcastVoiceBoostEnabled(loadPodcastVoiceBoostEnabled());
      setPodcastSkipAdChaptersEnabled(loadPodcastSkipAdChaptersEnabled());
    };
    window.addEventListener(PODCAST_SETTINGS_CHANGE_EVENT, onSettings);
    return () => window.removeEventListener(PODCAST_SETTINGS_CHANGE_EVENT, onSettings);
  }, []);

  useEffect(() => {
    podcastSmartSpeedRef.current?.stop();
    podcastSmartSpeedRef.current = null;

    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId) || !podcastSmartSpeedEnabled) {
      return;
    }
    // Native Exo on Android has no Web Audio analyser — Smart Speed rate wobble fights setPlaybackSpeed.
    if (isAndroid() && (audio.nativeExoActive || !audio.getPlaybackLevelAnalyser())) {
      return;
    }
    const playing = audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
    if (!playing) return;

    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;

    podcastSmartSpeedRef.current = startPodcastSmartSpeed({
      episodeId,
      audioUrl: env.url?.trim() ?? '',
      analyser: audio.getPlaybackLevelAnalyser(),
      getUserPlaybackRate: () => loadPodcastPlaybackSpeed(),
      setPlaybackRate: (rate) => audio.setPlaybackRate(rate),
      getCurrentTimeSeconds: () => audio.currentTimeSeconds,
      seek: (seconds) => audio.seek(seconds),
      isPlaying: () => audio.state === 'Playing' || audio.nativeExoEffectivePlaying,
    });

    return () => {
      podcastSmartSpeedRef.current?.stop();
      podcastSmartSpeedRef.current = null;
    };
  }, [
    audio,
    audio.envelope?.envelopeId,
    audio.state,
    audio.nativeExoEffectivePlaying,
    audio.nativeExoActive,
    podcastSmartSpeedEnabled,
  ]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const rate = loadPodcastPlaybackSpeed();
    setPodcastPlaybackSpeed(rate);
    audio.setPlaybackRate(rate);
  }, [audio, audio.envelope?.envelopeId]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) {
      setPodcastChapters([]);
      return;
    }
    const feedId = parsePodcastFeedId(env.envelopeId);
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!feedId || !episodeId) return;
    const ep = findEpisode(feedId, episodeId);
    if (!ep) {
      setPodcastChapters([]);
      return;
    }
    if (ep.chapters?.length) {
      setPodcastChapters(ep.chapters);
      return;
    }
    const feedUrl = findSubscription(feedId)?.feedUrl ?? '';
    let cancelled = false;
    void resolvePodcastChapters(ep, feedUrl).then((chapters) => {
      if (cancelled) return;
      setPodcastChapters(chapters);
      if (chapters.length > 0) updateEpisodeChapters(feedId, episodeId, chapters);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.envelope?.envelopeId]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) {
      setEpisodeVolumeBoostDb(0);
      return;
    }
    const feedId = parsePodcastFeedId(env.envelopeId);
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    setPodcastVoiceBoostEnabled(resolveVoiceBoostEnabled(feedId));
    setEpisodeVolumeBoostDb(episodeId ? loadEpisodeVolumeBoostDb(episodeId) : 0);
    audio.refreshPodcastPlaybackChain();
  }, [audio, audio.envelope?.envelopeId]);

  useEffect(() => {
    const onPodcasts = () => {
      const env = audio.envelope;
      if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
      const feedId = parsePodcastFeedId(env.envelopeId);
      setPodcastVoiceBoostEnabled(resolveVoiceBoostEnabled(feedId));
      audio.refreshPodcastPlaybackChain();
    };
    window.addEventListener(PODCASTS_CHANGE_EVENT, onPodcasts);
    return () => window.removeEventListener(PODCASTS_CHANGE_EVENT, onPodcasts);
  }, [audio]);

  const handleCyclePodcastSpeed = useCallback(() => {
    const next = cyclePodcastPlaybackSpeed(podcastPlaybackSpeed);
    setPodcastPlaybackSpeed(next);
    audio.setPlaybackRate(next);
  }, [audio, podcastPlaybackSpeed]);

  const handleTogglePodcastSmartSpeed = useCallback(() => {
    const next = !loadPodcastSmartSpeedEnabled();
    savePodcastSmartSpeedEnabled(next);
    setPodcastSmartSpeedEnabled(next);
  }, []);

  const handleTogglePodcastSkipAdChapters = useCallback(() => {
    const next = !loadPodcastSkipAdChaptersEnabled();
    savePodcastSkipAdChaptersEnabled(next);
    setPodcastSkipAdChaptersEnabled(next);
  }, []);

  const handleTogglePodcastVoiceBoost = useCallback(() => {
    const env = audio.envelope;
    const feedId = env ? parsePodcastFeedId(env.envelopeId) : null;
    const current = feedId
      ? resolveVoiceBoostEnabled(feedId)
      : loadPodcastVoiceBoostEnabled();
    const next = !current;
    if (feedId && findSubscription(feedId)?.voiceBoostDefault !== undefined) {
      updateSubscriptionMeta(feedId, { voiceBoostDefault: next });
      void syncPodcastRulesToTier34();
    } else {
      savePodcastVoiceBoostEnabled(next);
    }
    setPodcastVoiceBoostEnabled(next);
    audio.refreshPodcastPlaybackChain();
  }, [audio]);

  const handleCycleEpisodeVolumeBoost = useCallback(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;
    const next = cycleEpisodeVolumeBoostDb(episodeId);
    setEpisodeVolumeBoostDb(next);
    audio.applyPodcastEpisodeVolumeBoostDb(next);
  }, [audio]);

  const handlePodcastPrevChapter = useCallback(() => {
    audio.seek(seekSecondsForPreviousChapter(podcastChapters, audio.currentTimeSeconds));
  }, [audio, podcastChapters]);

  const handlePodcastNextChapter = useCallback(() => {
    const sec = seekSecondsForNextChapter(podcastChapters, audio.currentTimeSeconds);
    if (sec != null) audio.seek(sec);
  }, [audio, podcastChapters]);

  const handleSkipPodcastAd = useCallback(() => {
    const duration =
      audio.streamDurationSeconds ||
      audio.durationSeconds ||
      audio.envelope?.durationSeconds ||
      0;
    const target = seekTargetForManualAdSkip(
      podcastChapters,
      audio.currentTimeSeconds,
      duration > 0 ? duration : undefined,
    );
    audio.seek(target);
  }, [audio, podcastChapters]);

  const podcastSkipAdHint = useMemo(
    () => manualAdSkipHint(podcastChapters, audio.currentTimeSeconds),
    [podcastChapters, audio.currentTimeSeconds],
  );

  useEffect(() => {
    if (!podcastSkipAdChaptersEnabled || podcastChapters.length === 0) return;
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const playing = audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
    if (!playing) return;

    const target = seekTargetAfterAdChapter(podcastChapters, audio.currentTimeSeconds);
    if (target == null) return;

    const now = performance.now();
    if (now - podcastAdSkipLastAtRef.current < 800) return;
    podcastAdSkipLastAtRef.current = now;
    audio.seek(target);
  }, [
    audio,
    audio.currentTimeSeconds,
    audio.envelope?.envelopeId,
    audio.state,
    audio.nativeExoEffectivePlaying,
    podcastChapters,
    podcastSkipAdChaptersEnabled,
  ]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) {
      podcastResumeAppliedRef.current = null;
      return;
    }
    if (audio.state !== 'Ready' && audio.state !== 'Playing') return;
    if (podcastResumeAppliedRef.current === env.envelopeId) return;
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;
    const saved = getEpisodeResumePosition(episodeId);
    /*
     * Resume a little before where you stopped, not exactly on it.
     *
     * An exact resume drops you mid-sentence, which after three days away means rewinding by
     * hand before you can follow anything. The amount is small on purpose: enough to recover
     * the sentence, not enough to make you listen again to a minute you already heard.
     */
    const pos = resumeAtSeconds(saved, getEpisodeResumeSavedAt(episodeId), 'podcast');
    if (pos > 3) audio.seek(pos);
    podcastResumeAppliedRef.current = env.envelopeId;
  }, [audio, audio.state, audio.envelope?.envelopeId]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;
    const save = () => {
      const episodeIdInner = parsePodcastEpisodeId(audio.envelope?.envelopeId ?? '');
      if (!episodeIdInner) return;
      if (audio.state === 'Playing' || audio.state === 'Ready') {
        const pos = audioCurrentTimeRef.current;
        const dur =
          audio.streamDurationSeconds ||
          audio.durationSeconds ||
          audio.envelope?.durationSeconds ||
          0;
        if (maybeAutoCompleteEpisode(episodeIdInner, pos, dur)) return;
        saveEpisodeResumePosition(episodeIdInner, pos);
      }
    };
    const interval = window.setInterval(save, 5000);
    return () => {
      clearInterval(interval);
      save();
    };
  }, [audio.envelope?.envelopeId, audio.state, audio]);

  useEffect(() => {
    return audio.subscribeEnded(() => {
      const env = audioEnvelopeRef.current;
      if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
      const episodeId = parsePodcastEpisodeId(env.envelopeId);
      if (episodeId) markEpisodeCompleted(episodeId);
    });
  }, [audio]);

  return {
    podcastPlaybackSpeed,
    podcastSmartSpeedEnabled,
    podcastVoiceBoostEnabled,
    podcastSkipAdChaptersEnabled,
    podcastChapters,
    episodeVolumeBoostDb,
    handleCyclePodcastSpeed,
    handleTogglePodcastSmartSpeed,
    handleTogglePodcastSkipAdChapters,
    handleTogglePodcastVoiceBoost,
    handleCycleEpisodeVolumeBoost,
    handlePodcastPrevChapter,
    handlePodcastNextChapter,
    handleSkipPodcastAd,
    podcastSkipAdHint,
  };
}
