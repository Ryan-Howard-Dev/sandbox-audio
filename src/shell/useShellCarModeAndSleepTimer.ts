/**
 * Car Mode entry/exit (with its back-button history dance) plus sleep-timer wiring — voice-action
 * registration, the expire/wake-alarm callbacks, and the remaining-time label. Extracted from
 * sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position, right after useShellMediaSessionWiring — it reads
 * shortcutCtxRef.current inside a voice-action callback, so shortcutCtxRef must already exist by
 * then (moved up from its old position, still the same render, no behaviour change).
 */

import { useCallback, useEffect, useMemo, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { useShellMediaSessionWiring } from './useShellNowPlaying';
import {
  enterCarMode as activateCarMode,
  exitCarMode as deactivateCarMode,
  isCarModeActive,
  registerCarVoiceActions,
} from '../carMode';
import {
  formatSleepRemaining,
  getSleepTimerSnapshot,
  registerSleepTimerCallbacks,
  subscribeSleepTimer,
} from '../sleepTimer';
import type { CandidateSource } from '../sandboxLayer1';

type ShortcutCtxRef = ReturnType<typeof useShellMediaSessionWiring>['shortcutCtxRef'];
type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
) => Promise<boolean> | void;

export type UseShellCarModeAndSleepTimerArgs = {
  isTV: boolean;
  isCarMode: boolean;
  closeMobileSearch: () => void;
  setNavOpen: Dispatch<SetStateAction<boolean>>;
  setQueueDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setLyricsDrawerOpen: Dispatch<SetStateAction<boolean>>;
  setSleepTimerPanelOpen: Dispatch<SetStateAction<boolean>>;
  setCastPickerOpen: Dispatch<SetStateAction<boolean>>;
  carHistoryPushedRef: MutableRefObject<boolean>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  shortcutCtxRef: ShortcutCtxRef;
  audio: UseAudioFSMResult;
  sendConnectCommand: (cmd: { cmd: string; volume?: number }) => void;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  playEnvelopeRef: MutableRefObject<PlayEnvelopeFn>;
  isConnectRemoteRef: MutableRefObject<boolean>;
  sleepTimerTick: number;
  setSleepTimerTick: Dispatch<SetStateAction<number>>;
};

export function useShellCarModeAndSleepTimer({
  isTV,
  isCarMode,
  closeMobileSearch,
  setNavOpen,
  setQueueDrawerOpen,
  setLyricsDrawerOpen,
  setSleepTimerPanelOpen,
  setCastPickerOpen,
  carHistoryPushedRef,
  t,
  shortcutCtxRef,
  audio,
  sendConnectCommand,
  findHitCandidates,
  playEnvelopeRef,
  isConnectRemoteRef,
  sleepTimerTick,
  setSleepTimerTick,
}: UseShellCarModeAndSleepTimerArgs) {
  const handleEnterCarMode = useCallback(() => {
    if (isTV || isCarModeActive()) return;
    setNavOpen(false);
    closeMobileSearch();
    setQueueDrawerOpen(false);
    setLyricsDrawerOpen(false);
    setSleepTimerPanelOpen(false);
    setCastPickerOpen(false);
    activateCarMode();
  }, [isTV, closeMobileSearch]);

  const handleExitCarMode = useCallback(() => {
    if (!isCarModeActive()) return;
    deactivateCarMode();
    if (carHistoryPushedRef.current) {
      carHistoryPushedRef.current = false;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!isCarMode || isTV || carHistoryPushedRef.current) return;
    window.history.pushState({ sandboxCarMode: true }, '');
    carHistoryPushedRef.current = true;
  }, [isCarMode, isTV]);

  useEffect(() => {
    if (!isCarMode) return;
    const onPopState = () => {
      if (carHistoryPushedRef.current) {
        carHistoryPushedRef.current = false;
        deactivateCarMode();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isCarMode]);

  useEffect(() => {
    return registerCarVoiceActions([
      { id: 'play', label: t('carMode.play'), handler: () => shortcutCtxRef.current.play() },
      { id: 'pause', label: t('carMode.pause'), handler: () => shortcutCtxRef.current.pause() },
      { id: 'next', label: t('carMode.nextTrack'), handler: () => shortcutCtxRef.current.skipForward() },
      { id: 'previous', label: t('carMode.previousTrack'), handler: () => shortcutCtxRef.current.skipBack() },
      { id: 'exit', label: t('carMode.exit'), handler: () => handleExitCarMode() },
    ]);
  }, [handleExitCarMode, t]);

  useEffect(() => {
    return subscribeSleepTimer(() => setSleepTimerTick((tick) => tick + 1));
  }, []);

  useEffect(() => {
    return registerSleepTimerCallbacks({
      onSleepExpire: () => {
        if (isConnectRemoteRef.current) {
          sendConnectCommand({ cmd: 'PAUSE' });
        } else {
          audio.pause();
        }
      },
      onWakeAlarm: (track) => {
        const env: MediaEnvelope = {
          envelopeId: track.envelopeId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          url: track.url ?? '',
          artworkUrl: track.artworkUrl,
          provider: track.provider ?? 'unknown',
          sourceId: track.sourceId,
          durationSeconds: track.durationSeconds ?? 0,
          transport: track.transport ?? 'element-src',
        };
        void playEnvelopeRef.current(env, findHitCandidates(env));
      },
    });
  }, [audio, sendConnectCommand, findHitCandidates]);

  const sleepTimerLabel = useMemo(() => {
    const snap = getSleepTimerSnapshot();
    if (!snap.active) return null;
    return formatSleepRemaining(snap.remainingSeconds, snap.isEventBased, snap.preset);
  }, [sleepTimerTick]);

  return { handleEnterCarMode, handleExitCarMode, sleepTimerLabel };
}
