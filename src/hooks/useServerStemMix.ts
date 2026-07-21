/**
 * Main-player stem mix — server-cached Demucs stems only (no on-play separation).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  DEFAULT_STEM_GAIN_STATE,
  disposeServerStemPlaybackEngine,
  getServerStemPlaybackEngine,
  type StemGainState,
} from '../stemPlaybackEngine';
import {
  fetchStemUrlsForTrack,
  stemUrlsComplete,
  type StemKind,
} from '../stemSeparation';
import { isBatterySaverEnabled } from '../batterySaverSettings';
import { resolveStemTrackId } from '../stemTrackId';

export type ServerStemMixState = {
  stemsAvailable: boolean;
  stemsLoading: boolean;
  stemMixEnabled: boolean;
  setStemMixEnabled: (enabled: boolean) => void;
  gains: StemGainState;
  setStemGain: (kind: StemKind, db: number, muted: boolean) => void;
  stemMixActive: boolean;
  stemTimeSeconds: number;
  stemPlaying: boolean;
  toggleStemPlayback: () => void;
  seekStemPlayback: (seconds: number) => void;
};

type Options = {
  envelope: MediaEnvelope | null;
  currentTimeSeconds: number;
  mainIsPlaying: boolean;
  /** Native Exo / audiophile / Connect remote cannot use Web Audio stem mix. */
  stemMixBlocked: boolean;
  onStemMixActivate?: () => void;
  onStemMixDeactivate?: () => void;
  /** Called when stem mix disables and main playback was playing at enable time. */
  resumeMainPlayback?: () => void;
};

export function useServerStemMix({
  envelope,
  currentTimeSeconds,
  mainIsPlaying,
  stemMixBlocked,
  onStemMixActivate,
  onStemMixDeactivate,
  resumeMainPlayback,
}: Options): ServerStemMixState {
  const [stemsAvailable, setStemsAvailable] = useState(false);
  const [stemsLoading, setStemsLoading] = useState(false);
  const [stemMixEnabled, setStemMixEnabledState] = useState(false);
  const [gains, setGains] = useState<StemGainState>(() => structuredClone(DEFAULT_STEM_GAIN_STATE));
  const [stemTimeSeconds, setStemTimeSeconds] = useState(0);
  const [stemPlaying, setStemPlaying] = useState(false);

  const trackIdRef = useRef<string | null>(null);
  const engineRef = useRef(getServerStemPlaybackEngine());
  const resumeMainOnDeactivateRef = useRef(false);
  const startTimeRef = useRef(0);

  const stemMixActive = stemMixEnabled && stemsAvailable && !stemMixBlocked;

  useEffect(() => {
    const trackId = resolveStemTrackId(envelope);
    trackIdRef.current = trackId;
    setStemMixEnabledState(false);
    setStemsAvailable(false);
    setStemPlaying(false);
    engineRef.current.disposeStems();

    if (!trackId || stemMixBlocked) return;

    let cancelled = false;
    setStemsLoading(true);
    void fetchStemUrlsForTrack(trackId)
      .then((urls) => {
        if (cancelled) return;
        setStemsAvailable(stemUrlsComplete(urls));
      })
      .finally(() => {
        if (!cancelled) setStemsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [envelope?.envelopeId, envelope?.sourceId, stemMixBlocked]);

  const loadAndStart = useCallback(
    async (seekTo: number, play: boolean) => {
      const trackId = trackIdRef.current;
      if (!trackId) return false;
      const urls = await fetchStemUrlsForTrack(trackId);
      if (!stemUrlsComplete(urls)) return false;
      const engine = engineRef.current;
      if (!engine.load(urls)) return false;
      engine.setGains(gains);
      engine.seek(seekTo);
      if (play) {
        await engine.play();
        setStemPlaying(true);
      } else {
        setStemPlaying(false);
      }
      return true;
    },
    [gains],
  );

  const setStemMixEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled && (!stemsAvailable || stemMixBlocked)) return;

      if (enabled) {
        resumeMainOnDeactivateRef.current = mainIsPlaying;
        startTimeRef.current = currentTimeSeconds;
        onStemMixActivate?.();
        setStemMixEnabledState(true);
        void loadAndStart(currentTimeSeconds, mainIsPlaying);
        return;
      }

      engineRef.current.pause();
      setStemPlaying(false);
      setStemMixEnabledState(false);
      onStemMixDeactivate?.();
      if (resumeMainOnDeactivateRef.current) {
        resumeMainOnDeactivateRef.current = false;
        resumeMainPlayback?.();
      }
    },
    [
      stemsAvailable,
      stemMixBlocked,
      mainIsPlaying,
      currentTimeSeconds,
      onStemMixActivate,
      onStemMixDeactivate,
      resumeMainPlayback,
      loadAndStart,
    ],
  );

  useEffect(() => {
    if (!stemMixActive) {
      setStemTimeSeconds(currentTimeSeconds);
      return;
    }
    const useLowPowerClock =
      isBatterySaverEnabled() ||
      (typeof document !== 'undefined' && document.visibilityState === 'hidden');

    if (useLowPowerClock) {
      const tick = () => {
        setStemTimeSeconds(engineRef.current.getCurrentTime());
        setStemPlaying(engineRef.current.isPlaying());
      };
      tick();
      const id = window.setInterval(tick, 1000);
      return () => window.clearInterval(id);
    }

    let raf = 0;
    const tick = () => {
      setStemTimeSeconds(engineRef.current.getCurrentTime());
      setStemPlaying(engineRef.current.isPlaying());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stemMixActive, currentTimeSeconds]);

  useEffect(() => {
    return () => {
      disposeServerStemPlaybackEngine();
    };
  }, []);

  const toggleStemPlayback = useCallback(() => {
    const engine = engineRef.current;
    if (!engine.isLoaded()) return;
    if (engine.isPlaying()) {
      engine.pause();
      setStemPlaying(false);
    } else {
      void engine.play().then(() => setStemPlaying(true));
    }
  }, []);

  const seekStemPlayback = useCallback((seconds: number) => {
    engineRef.current.seek(seconds);
    setStemTimeSeconds(seconds);
  }, []);

  const setStemGain = useCallback(
    (kind: StemKind, db: number, muted: boolean) => {
      setGains((prev) => {
        const next = { ...prev, [kind]: { db, muted } };
        if (stemMixActive) engineRef.current.setGain(kind, db, muted);
        return next;
      });
    },
    [stemMixActive],
  );

  return {
    stemsAvailable,
    stemsLoading,
    stemMixEnabled,
    setStemMixEnabled,
    gains,
    setStemGain,
    stemMixActive,
    stemTimeSeconds,
    stemPlaying,
    toggleStemPlayback,
    seekStemPlayback,
  };
}
