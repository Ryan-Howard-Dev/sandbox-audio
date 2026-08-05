/**
 * Play-session bookkeeping — session envelope/peak-seconds tracking, the flush-on-unmount and
 * scrobble-on-ended listeners, now-playing scrobbling, taste-feedback sync, and the "listening
 * this month" home preview. Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position, right after useShellSkipControls. It only reads refs
 * that already exist by then (sessionEnvelopeRef, sessionPeakSecondsRef, audioEnvelopeRef,
 * audioDurationRef, audioCurrentTimeRef) — no forward-reference concerns.
 */

import { useEffect, useMemo, useState, type MutableRefObject } from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import { recordPlay, recordPlaySession, subscribePlayHistory } from '../playHistory';
import { subscribeTasteFeedback } from '../tasteFeedback';
import { formatMinutesHuman, getListeningStats } from '../listeningAnalytics';
import { scrobbleNowPlaying, scrobbleTrack } from '../scrobble';

export type UseShellPlaySessionEffectsArgs = {
  audio: UseAudioFSMResult;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioDurationRef: MutableRefObject<number>;
  audioCurrentTimeRef: MutableRefObject<number>;
  sessionEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  sessionPeakSecondsRef: MutableRefObject<number>;
  flushPlaySession: (completed?: boolean) => void;
  syncThumbsFromFeedback: (envelopeId?: string) => void;
};

export function useShellPlaySessionEffects({
  audio,
  audioEnvelopeRef,
  audioDurationRef,
  audioCurrentTimeRef,
  sessionEnvelopeRef,
  sessionPeakSecondsRef,
  flushPlaySession,
  syncThumbsFromFeedback,
}: UseShellPlaySessionEffectsArgs) {
  useEffect(() => {
    if (audio.envelope) {
      sessionEnvelopeRef.current = audio.envelope;
    }
  }, [audio.envelope?.envelopeId]);

  useEffect(() => {
    if (!audio.envelope) return;
    sessionPeakSecondsRef.current = Math.max(
      sessionPeakSecondsRef.current,
      audio.currentTimeSeconds,
    );
  }, [audio.envelope?.envelopeId, audio.currentTimeSeconds]);

  useEffect(() => {
    const envelopeId = audio.envelope?.envelopeId;
    return () => {
      if (envelopeId) flushPlaySession(false);
    };
  }, [audio.envelope?.envelopeId, flushPlaySession]);

  useEffect(() => {
    return audio.subscribeEnded(() => {
      const env = audioEnvelopeRef.current;
      if (env) {
        const peak = Math.max(
          sessionPeakSecondsRef.current,
          audioDurationRef.current || audioCurrentTimeRef.current,
        );
        sessionPeakSecondsRef.current = peak;
        recordPlaySession(env, peak, true);
        void scrobbleTrack(env, Math.floor(peak * 1000));
        sessionPeakSecondsRef.current = 0;
        sessionEnvelopeRef.current = env;
        recordPlay(env);
      }
    });
  }, [audio]);

  useEffect(() => {
    if (audio.state !== 'Playing' || !audio.envelope) return;
    void scrobbleNowPlaying(audio.envelope);
  }, [audio.state, audio.envelope?.envelopeId]);

  const [listeningTick, setListeningTick] = useState(0);
  useEffect(() => subscribePlayHistory(() => setListeningTick((t) => t + 1)), []);

  useEffect(() => {
    syncThumbsFromFeedback(audio.envelope?.envelopeId);
  }, [audio.envelope?.envelopeId, syncThumbsFromFeedback]);

  useEffect(
    () =>
      subscribeTasteFeedback(() => {
        syncThumbsFromFeedback(audio.envelope?.envelopeId);
      }),
    [audio.envelope?.envelopeId, syncThumbsFromFeedback],
  );

  const homeListeningPreview = useMemo(() => {
    void listeningTick;
    const stats = getListeningStats('month');
    return {
      minutesLabel: formatMinutesHuman(stats.minutesListened),
      topArtist: stats.topArtists[0]?.label,
      sessionCount: stats.sessionCount,
    };
  }, [listeningTick]);

  return { homeListeningPreview };
}
