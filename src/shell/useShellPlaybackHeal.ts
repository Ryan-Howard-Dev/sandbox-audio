/**
 * Playback failure recovery for the shell — Failed-state heal (mobile re-resolve, locker refresh,
 * podcast retry, tier34 heal), truncated-stream recovery, the stuck-resolve (Resolving/Connecting)
 * watchdog, and the playback-error toast. Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the same position in SandboxShell where these effects used to live: after the
 * queue restore (useShellQueueRestore) and the Android app-resume / wired-DAC-stability effects,
 * but before useShellQueuePersistWrites and the queue-persist write effects. Those persistence
 * writes read audio state that the heal effects above them may have just mutated (stop/seek/heal),
 * so moving this hook after persistence would let a stale pre-heal snapshot get written; moving it
 * before queue restore would let it race a restore that hasn't set audio.envelope yet.
 */

import { useCallback, useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { AudioFsmState, CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import { refreshLockerEntryPlayUrl } from '../lockerStorage';
import { buildHealAttemptKey, resolveHealAction } from '../play/playbackHealPolicy';
import { attemptDeadLockerReacquire } from '../lockerDeadTrackReacquire';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { resolvePodcastEnvelopeForPlayback } from '../podcastPlayback';
import { catalogTrackIdFromEnvelope } from '../catalogTrackId';
import {
  tier34HealDeadSource,
  getTier34BaseUrl,
  isTier34ReachableCached,
} from '../tier34/client';
import { hasActiveMobileResolvers, getLastMobileResolveError, ensureYtDlpMobileReady } from '../mobileResolverRegistry';
import { bumpPlayGeneration, currentPlayGeneration, formatMobilePlaybackError } from '../playIntent';

const PLAYBACK_RESOLVE_STUCK_TIMEOUT_MS = 90_000;
const PLAYBACK_CONNECT_STUCK_TIMEOUT_MS = 30_000;

type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  opts?: { autoPlay?: boolean },
) => Promise<boolean> | boolean | void | Promise<void>;

export type ShellPlaybackHealArgs = {
  audio: UseAudioFSMResult;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioStateRef: MutableRefObject<AudioFsmState>;
  audioCurrentTimeRef: MutableRefObject<number>;
  handlePlayEnvelope: PlayEnvelopeFn;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  showAppToast: (msg: string, durationMs?: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  setMobilePlayerPending: Dispatch<SetStateAction<boolean>>;
  playGenerationRef: MutableRefObject<number>;
};

export function useShellPlaybackHeal({
  audio,
  audioEnvelopeRef,
  audioStateRef,
  audioCurrentTimeRef,
  handlePlayEnvelope,
  findHitCandidates,
  showAppToast,
  t,
  setMobilePlayerPending,
  playGenerationRef,
}: ShellPlaybackHealArgs) {
  const failedPlaybackToastGenRef = useRef<number | null>(null);
  const healAttemptRef = useRef<string | null>(null);

  useEffect(() => {
    const onPlaybackError = (event: Event) => {
      const detail = (event as CustomEvent<{ envelopeId?: string }>).detail;
      const envId = detail?.envelopeId ?? audioEnvelopeRef.current?.envelopeId;
      if (envId && isPodcastEnvelopeId(envId)) return;
      const gen = currentPlayGeneration();
      if (failedPlaybackToastGenRef.current === gen) return;
      failedPlaybackToastGenRef.current = gen;
      showAppToast(t('artist.playbackExoFailed'), 3800);
    };
    window.addEventListener('sandbox-playback-error', onPlaybackError);
    return () => window.removeEventListener('sandbox-playback-error', onPlaybackError);
  }, [showAppToast, t]);

  useEffect(() => {
    if (audio.state !== 'Failed' || !audio.envelope) return;
    const gen = currentPlayGeneration();
    const env = audio.envelope;
    const savedPos = audioCurrentTimeRef.current;
    let cancelled = false;

    const showFailedToastOnce = () => {
      if (failedPlaybackToastGenRef.current === gen) return;
      failedPlaybackToastGenRef.current = gen;
      if (isPodcastEnvelopeId(env.envelopeId)) {
        showAppToast(
          t('player.podcastPlaybackFailed'),
          3800,
        );
        setMobilePlayerPending(false);
        return;
      }
      const base = getTier34BaseUrl().trim();
      const mobileActive = hasActiveMobileResolvers();
      const catalogTrack = catalogTrackIdFromEnvelope(env);
      const needsServer =
        env.provider !== 'local-vault' &&
        env.provider !== 'stream-cache' &&
        env.provider !== 'indexeddb' &&
        env.provider !== 'blob';
      if (mobileActive) {
        const mobileErr = getLastMobileResolveError();
        showAppToast(
          mobileErr
            ? `Playback failed: ${formatMobilePlaybackError(mobileErr)}`
            : t('artist.playbackExoFailed'),
          3800,
        );
      } else if (catalogTrack && needsServer) {
        showAppToast(t('artist.playbackSandboxRequired'), 3800);
      } else if (!base && needsServer) {
        showAppToast(t('artist.playbackSandboxRequired'), 3800);
      } else if (!isTier34ReachableCached()) {
        showAppToast(t('artist.playbackSandboxRequired'), 3800);
      } else {
        showAppToast(t('artist.playbackUnavailable'), 3800);
      }
      setMobilePlayerPending(false);
    };

    const seekAfterHealIfNeeded = () => {
      if (savedPos <= 1.5) return;
      window.setTimeout(() => {
        if (cancelled) return;
        if (audioStateRef.current === 'Failed' || audioStateRef.current === 'Idle') return;
        audio.seek(savedPos);
      }, 1200);
    };

    void (async () => {
      try {
        audio.primePlaybackGesture();
        await audio.play();
        if (cancelled || audioStateRef.current !== 'Failed') return;

        const healAction = resolveHealAction(env, healAttemptRef.current, {
          mobileResolverActive: hasActiveMobileResolvers(),
        });
        if (healAction.kind === 'fail') {
          showFailedToastOnce();
          audio.stop();
          return;
        }
        healAttemptRef.current = buildHealAttemptKey(env);
        if (healAction.kind === 'mobile-re-resolve') {
          ensureYtDlpMobileReady();
          const retryEnv: MediaEnvelope = { ...env, url: '' };
          await handlePlayEnvelope(retryEnv, findHitCandidates(env));
          seekAfterHealIfNeeded();
          if (cancelled || audioStateRef.current !== 'Failed') return;
          showFailedToastOnce();
          audio.stop();
          return;
        }
        if (healAction.kind === 'local-refresh') {
          const freshUrl = await refreshLockerEntryPlayUrl(healAction.sourceId);
          if (cancelled) return;
          if (freshUrl) {
            await handlePlayEnvelope({ ...env, url: freshUrl });
            seekAfterHealIfNeeded();
          } else if (await attemptDeadLockerReacquire(env.title, env.artist, env.album)) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                title: env.title,
              }),
              5000,
            );
          } else {
            showFailedToastOnce();
            audio.stop();
          }
          return;
        }
        if (healAction.kind === 'podcast-retry') {
          healAttemptRef.current = buildHealAttemptKey(env);
          try {
            const playable = await resolvePodcastEnvelopeForPlayback(env);
            if (cancelled) return;
            await handlePlayEnvelope(playable);
            seekAfterHealIfNeeded();
            if (cancelled || audioStateRef.current !== 'Failed') return;
          } catch (err) {
            console.warn('[sandboxLayer3] podcast heal failed:', err);
          }
          showFailedToastOnce();
          audio.stop();
          return;
        }
        if (healAction.kind === 'tier34-heal') {
          const healed = await tier34HealDeadSource(env);
          if (cancelled) return;
          if (healed?.url) {
            await handlePlayEnvelope(healed, findHitCandidates(healed));
            seekAfterHealIfNeeded();
          } else {
            showFailedToastOnce();
            audio.stop();
          }
          return;
        }
        showFailedToastOnce();
        audio.stop();
      } catch (err) {
        console.warn('[sandboxLayer3] playback heal failed:', err);
        if (!cancelled) {
          showFailedToastOnce();
          audio.stop();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audio.state, audio.envelope, handlePlayEnvelope, findHitCandidates, showAppToast, t, audio]);

  /** Re-resolve when Exo hits end-of-stream but catalog duration says the track continues. */
  useEffect(() => {
    let cancelled = false;
    const onTruncated = (event: Event) => {
      const detail = (event as CustomEvent<{ positionSecs: number; streamDurSecs: number; catalogDurSecs: number }>).detail;
      const env = audioEnvelopeRef.current;
      if (!env || env.provider === 'local-vault') return;
      const healKey = `truncated:${env.envelopeId}`;
      if (healAttemptRef.current === healKey) return;
      healAttemptRef.current = healKey;
      const savedPos = Math.max(0, detail?.positionSecs ?? audioCurrentTimeRef.current);
      void (async () => {
        const healed = await tier34HealDeadSource(env);
        if (cancelled) return;
        const playable = healed?.url ? healed : env;
        await handlePlayEnvelope(playable, findHitCandidates(playable));
        if (savedPos > 1.5) {
          window.setTimeout(() => {
            if (cancelled) return;
            audio.seek(savedPos);
          }, 800);
        }
      })();
    };
    window.addEventListener('sandbox-playback-truncated', onTruncated);
    return () => {
      cancelled = true;
      window.removeEventListener('sandbox-playback-truncated', onTruncated);
    };
  }, [audio, handlePlayEnvelope, findHitCandidates]);

  useEffect(() => {
    if (audio.state !== 'Resolving' && audio.state !== 'Connecting') return;
    const envelopeId = audio.envelope?.envelopeId ?? '';
    const stuckState = audio.state;
    const timeoutMs =
      stuckState === 'Resolving'
        ? PLAYBACK_RESOLVE_STUCK_TIMEOUT_MS
        : PLAYBACK_CONNECT_STUCK_TIMEOUT_MS;
    const generation = currentPlayGeneration();
    const timer = window.setTimeout(() => {
      if (currentPlayGeneration() !== generation) return;
      if (audioStateRef.current !== stuckState) return;
      console.warn('[playback] playback stuck timed out for', envelopeId, stuckState);
      bumpPlayGeneration();
      playGenerationRef.current = currentPlayGeneration();
      audio.failResolve();
      setMobilePlayerPending(false);
      showAppToast(t('player.resolveTimedOut'), 3800);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [audio.state, audio.envelope?.envelopeId, audio, showAppToast, t]);

  const handleDismissStuckPlayback = useCallback(() => {
    bumpPlayGeneration();
    playGenerationRef.current = currentPlayGeneration();
    setMobilePlayerPending(false);
    audio.failResolve();
  }, [audio, playGenerationRef, setMobilePlayerPending]);

  return { handleDismissStuckPlayback };
}
