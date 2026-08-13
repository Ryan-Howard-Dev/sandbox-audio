/**
 * Queue restore and durable save for the shell — boot rehydrate, pending seek after restore,
 * page-lifecycle snapshot, and live saveQueueState. Extracted from sandboxLayer3 with no JSX.
 *
 * Call sites must match the old positions: useShellQueueRestore at restore, then
 * useShellQueuePersistWrites (seek + lifecycle) where those effects lived, then the audiobook
 * progress effect, then useShellQueueSave. Collapsing them into one early hook would pull
 * seek/save ahead of heal / Android resume and change load-bearing registration order.
 *
 * Resume-prompt helpers live in useShellQueueResume and must be called after handlePlayAlbum
 * exists — otherwise the shell hits a temporal dead zone.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type {
  AudioFsmState,
  CandidateSource,
  MediaEnvelope,
  UseAudioFSMResult,
} from '../sandboxLayer1';
import {
  getLockerEntriesSnapshot,
  warmLockerCache,
} from '../lockerStorage';
import { isNativeExoAudible, lastPlayIntentToEnvelope, loadLastPlayIntent } from '../lastPlayIntent';
import { nativeExoPlaybackStatus } from '../androidNativePlayback';
import { bumpPlayGeneration, currentPlayGeneration } from '../playIntent';
import { getAllPlayHistory, loadLastQueue } from '../playHistory';
import {
  initQueuePersistenceLifecycle,
  loadQueueState,
  persistableCurrentTrackId,
  rehydrateQueueState,
  savePlaybackPositionSnapshot,
  saveQueueState,
  shouldAutoRestorePlayerOnLoad,
  shouldRestoreLastPlayIntentOnLoad,
  shouldSkipPlayerRestoreOnLoad,
  type RepeatMode,
} from '../queuePersistence';
import {
  loadConnectRolePref,
  loadNetworkSyncEnabled,
  resolveConnectRole,
} from '../sandboxSettings';

type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  opts?: { autoPlay?: boolean },
) => Promise<boolean> | boolean | void | Promise<void>;

type QueueRestorePending = { seekTo: number; envelopeId: string };

/**
 * How often the playhead alone is written down.
 *
 * Matches the audiobook progress writer. Long enough that it costs nothing, short enough that
 * resuming after a crash lands within a few seconds of where listening stopped.
 */
const POSITION_SAVE_INTERVAL_MS = 5000;

export type ShellQueueRestoreArgs = {
  audio: UseAudioFSMResult;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setHomeAwaitingUserResume: Dispatch<SetStateAction<boolean>>;
  playEnvelopeRef: MutableRefObject<PlayEnvelopeFn>;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioStateRef: MutableRefObject<AudioFsmState>;
  playGenerationRef: MutableRefObject<number>;
};

export function useShellQueueRestore({
  audio,
  setPlayQueue,
  setQueueIndex,
  setShuffleOn,
  setRepeatMode,
  setHomeAwaitingUserResume,
  playEnvelopeRef,
  findHitCandidates,
  audioEnvelopeRef,
  audioStateRef,
  playGenerationRef,
}: ShellQueueRestoreArgs) {
  const queueRestoredRef = useRef(false);
  const queueRestorePendingRef = useRef<QueueRestorePending | null>(null);
  const [queuePersistReady, setQueuePersistReady] = useState(false);

  useEffect(() => {
    if (queueRestoredRef.current) return;
    if (resolveConnectRole(loadConnectRolePref()) === 'remote' && loadNetworkSyncEnabled()) {
      queueRestoredRef.current = true;
      setQueuePersistReady(true);
      return;
    }

    let cancelled = false;

    const lockerEnvelopesFromSnapshot = (): MediaEnvelope[] => {
      const entries = getLockerEntriesSnapshot();
      if (!entries?.length) return [];
      return entries.map((e) => ({
        envelopeId: `local-${e.id}`,
        title: e.title,
        artist: e.artist,
        album: e.albumName,
        url: e.url,
        durationSeconds: e.durationSeconds || 210,
        provider: 'local-vault' as const,
        transport: 'element-src' as const,
        sourceId: e.id,
        artworkUrl: e.albumArt,
        releaseYear: e.releaseYear,
      }));
    };

    const attemptRestore = async () => {
      try {
        await warmLockerCache();
        if (cancelled || queueRestoredRef.current) return;

        const raw = loadQueueState();
        if (!raw) {
          if (shouldRestoreLastPlayIntentOnLoad()) {
            const intent = loadLastPlayIntent();
            if (intent) {
              queueRestoredRef.current = true;
              const env = lastPlayIntentToEnvelope(intent);
              queueRestorePendingRef.current = { seekTo: 0, envelopeId: env.envelopeId };
              setHomeAwaitingUserResume(false);
              void playEnvelopeRef.current(env, findHitCandidates(env), { autoPlay: false });
              return;
            }
          }
          queueRestoredRef.current = true;
          return;
        }

        const restored = rehydrateQueueState(raw, {
          lockerEnvelopes: lockerEnvelopesFromSnapshot(),
          playHistory: getAllPlayHistory(),
        });
        if (!restored || cancelled) {
          queueRestoredRef.current = true;
          return;
        }

        queueRestoredRef.current = true;
        setPlayQueue(restored.playQueue);
        setQueueIndex(restored.queueIndex);
        setShuffleOn(restored.shuffleOn);
        setRepeatMode(restored.repeatMode);

        if (!shouldAutoRestorePlayerOnLoad(raw)) {
          if (
            shouldSkipPlayerRestoreOnLoad() &&
            audioStateRef.current === 'Idle' &&
            !audioEnvelopeRef.current
          ) {
            let nativeStillPlaying = false;
            try {
              const status = await nativeExoPlaybackStatus();
              nativeStillPlaying = isNativeExoAudible(status);
            } catch {
              /* optional */
            }
            if (!nativeStillPlaying) {
              bumpPlayGeneration();
              playGenerationRef.current = currentPlayGeneration();
              audio.stop();
            }
          }
          return;
        }

        const track = restored.currentTrackId
          ? restored.playQueue.find((e) => e.envelopeId === restored.currentTrackId) ??
            restored.playQueue[restored.queueIndex]
          : restored.playQueue[restored.queueIndex];
        if (!track) return;

        queueRestorePendingRef.current = {
          seekTo: restored.currentTimeSeconds,
          envelopeId: track.envelopeId,
        };
        setHomeAwaitingUserResume(false);
        void playEnvelopeRef.current(track, findHitCandidates(track), { autoPlay: false });
      } catch (err) {
        console.warn('[Sandbox] queue restore failed:', err);
        queueRestoredRef.current = true;
      } finally {
        if (!cancelled) setQueuePersistReady(true);
      }
    };

    void attemptRestore();
    return () => {
      cancelled = true;
    };
  }, [findHitCandidates]);

  return { queuePersistReady, queueRestorePendingRef };
}

export type ShellQueuePersistWritesArgs = {
  audio: UseAudioFSMResult;
  queueRestorePendingRef: MutableRefObject<QueueRestorePending | null>;
  isConnectRemoteRef: MutableRefObject<boolean>;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndexRef: MutableRefObject<number>;
  shuffleOnRef: MutableRefObject<boolean>;
  repeatModeRef: MutableRefObject<RepeatMode>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioStateRef: MutableRefObject<AudioFsmState>;
  audioCurrentTimeRef: MutableRefObject<number>;
};

export function useShellQueuePersistWrites({
  audio,
  queueRestorePendingRef,
  isConnectRemoteRef,
  playQueueRef,
  queueIndexRef,
  shuffleOnRef,
  repeatModeRef,
  audioEnvelopeRef,
  audioStateRef,
  audioCurrentTimeRef,
}: ShellQueuePersistWritesArgs) {
  useEffect(() => {
    const pending = queueRestorePendingRef.current;
    if (!pending) return;
    // The boot-time restore's own load runs async (warmLockerCache, rehydrateQueueState, etc.)
    // and can still be in flight — or already superseded — by the time the user manually taps a
    // different track. Without this check, whichever track next reaches Ready/Playing gets the
    // restore's stale seek+pause applied to IT instead, killing playback the user just started
    // (seconds after tapping play, for a track that has nothing to do with the restore). Only
    // discard once we have DEFINITIVE evidence of a mismatch (a different envelope actually
    // loaded) — a still-null/loading envelope just means the intended restore hasn't landed yet.
    if (audio.envelope && audio.envelope.envelopeId !== pending.envelopeId) {
      queueRestorePendingRef.current = null;
      return;
    }
    if (audio.state === 'Failed') {
      queueRestorePendingRef.current = null;
      return;
    }
    if (audio.state !== 'Ready' && audio.state !== 'Playing') return;
    if (!audio.envelope || audio.envelope.envelopeId !== pending.envelopeId) return;

    const { seekTo } = pending;
    queueRestorePendingRef.current = null;

    if (seekTo > 0) audio.seek(seekTo);
    if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) audio.pause();
  }, [audio.state, audio.envelope?.envelopeId, audio]);

  useEffect(() => {
    return initQueuePersistenceLifecycle(() => {
      if (isConnectRemoteRef.current) return null;
      return {
        playQueue: playQueueRef.current,
        queueIndex: queueIndexRef.current,
        shuffleOn: shuffleOnRef.current,
        repeatMode: repeatModeRef.current,
        currentTrackId: persistableCurrentTrackId(
          audioEnvelopeRef.current?.envelopeId,
          audioStateRef.current,
        ),
        currentTimeSeconds: audioCurrentTimeRef.current,
        wasPlaying: audioStateRef.current === 'Playing',
      };
    });
  }, []);

  /*
   * The moving playhead, on a timer and off the render path.
   *
   * Reads the same lifecycle snapshot the pagehide flush uses, so there is one description of what
   * a saved queue is rather than two that can drift.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (isConnectRemoteRef.current) return;
      if (audioStateRef.current !== 'Playing') return;
      savePlaybackPositionSnapshot();
    }, POSITION_SAVE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);
}

/**
 * Live saveQueueState. Call after the audiobook progress effect so registration order is unchanged.
 *
 * Deliberately not keyed on the position. This effect used to list audio.currentTimeSeconds among
 * its dependencies, so it re-ran at the playback poll rate -- 450ms on the Android native path,
 * against a 400ms save debounce, meaning the debounce always expired first and the whole queue was
 * serialised and written to storage about twice a second for as long as anything was playing.
 *
 * What is saved here is the shape of the session: which queue, which position in it, which track,
 * playing or not. Those change when somebody does something. The playhead is written separately on
 * a timer, off the render path entirely.
 */
export function useShellQueueSave({
  audio,
  playQueue,
  queueIndex,
  shuffleOn,
  repeatMode,
  queuePersistReady,
  isConnectRemoteRef,
  audioCurrentTimeRef,
}: {
  audio: UseAudioFSMResult;
  playQueue: MediaEnvelope[];
  queueIndex: number;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  queuePersistReady: boolean;
  isConnectRemoteRef: MutableRefObject<boolean>;
  audioCurrentTimeRef: MutableRefObject<number>;
}) {
  useEffect(() => {
    if (!queuePersistReady || isConnectRemoteRef.current) return;
    saveQueueState({
      playQueue,
      queueIndex,
      shuffleOn,
      repeatMode,
      currentTrackId: persistableCurrentTrackId(audio.envelope?.envelopeId, audio.state),
      // From the ref, so a save triggered by a real change still records a truthful position
      // without the position itself being what triggers saves.
      currentTimeSeconds: audioCurrentTimeRef.current,
      wasPlaying: audio.state === 'Playing',
    });
  }, [
    queuePersistReady,
    playQueue,
    queueIndex,
    shuffleOn,
    repeatMode,
    audio.envelope?.envelopeId,
    audio.state,
  ]);
}

export type ShellQueueResumeArgs = {
  playQueue: MediaEnvelope[];
  audioState: AudioFsmState;
  handlePlayAlbum: (tracks: MediaEnvelope[]) => void | Promise<void>;
  setHomeAwaitingUserResume: Dispatch<SetStateAction<boolean>>;
};

/**
 * Resume-queue prompt helpers. Call after handlePlayAlbum is declared.
 */
export function useShellQueueResume({
  playQueue,
  audioState,
  handlePlayAlbum,
  setHomeAwaitingUserResume,
}: ShellQueueResumeArgs) {
  const homeLastQueue = playQueue.length > 0 ? playQueue : loadLastQueue();

  const handleResumeLastQueue = useCallback(() => {
    if (homeLastQueue.length === 0) return;
    setHomeAwaitingUserResume(false);
    handlePlayAlbum(homeLastQueue);
  }, [homeLastQueue, handlePlayAlbum, setHomeAwaitingUserResume]);

  const resumeQueueCandidate = playQueue.length > 0 ? playQueue : loadLastQueue();
  const showResumeQueuePrompt =
    resumeQueueCandidate.length > 0 && audioState === 'Idle';

  return {
    homeLastQueue,
    handleResumeLastQueue,
    resumeQueueCandidate,
    showResumeQueuePrompt,
  };
}
