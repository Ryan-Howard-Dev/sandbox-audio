/**
 * Cast + cinema-cast sync for the shell — session/state subscriptions, auto-cast on load,
 * envelope mirroring while casting, and cinema-cast publish. Extracted from sandboxLayer3
 * with no JSX.
 *
 * Call this hook at the same position in SandboxShell where the cast effects used to live:
 * several later effects (queue prefetch, exo transition, Connect) rely on registration order.
 * Cast UI state (castMode / speakerCast / castPickerOpen) stays in the shell so early
 * consumers (back stack, TV key handlers) keep their declaration order.
 */

import {
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import { resolveCastStreamUrl } from '../castStreamResolver';
import {
  isSpeakerCastActive,
  loadAutoCastEnabled,
  loadDefaultCastDevice,
  startCastToDevice,
  subscribeCastState,
  syncCastEnvelope,
  type CastState,
} from '../castState';
import {
  publishCinemaCast,
  subscribeCastSession,
  type CinemaCastMode,
} from '../cinemaCast';
import { loadFidelityPolicy } from '../sandboxSettings';

export type ShellCastRuntimeArgs = {
  audio: UseAudioFSMResult;
  artworkUrl: string;
  playQueue: MediaEnvelope[];
  queueIndex: number;
  setCastMode: Dispatch<SetStateAction<CinemaCastMode>>;
  setSpeakerCast: Dispatch<SetStateAction<CastState>>;
  speakerCast: CastState;
  audioCurrentTimeRef: MutableRefObject<number>;
};

export function useShellCastRuntime({
  audio,
  artworkUrl,
  playQueue,
  queueIndex,
  setCastMode,
  setSpeakerCast,
  speakerCast,
  audioCurrentTimeRef,
}: ShellCastRuntimeArgs) {
  useEffect(() => subscribeCastSession(setCastMode), []);

  useEffect(() => subscribeCastState(setSpeakerCast), []);

  const wasCastingRef = useRef(false);
  useEffect(() => {
    if (wasCastingRef.current && !speakerCast.isActive && audio.envelope) {
      void audio.play();
    }
    wasCastingRef.current = speakerCast.isActive;
  }, [speakerCast.isActive, audio]);

  useEffect(() => {
    if (!loadAutoCastEnabled()) return;
    const device = loadDefaultCastDevice();
    if (!device || isSpeakerCastActive()) return;
    const env = audio.envelope;
    if (!env) return;
    void startCastToDevice(device, env, {
      title: audio.title,
      artist: audio.artist,
      artworkUrl: artworkUrl || env.artworkUrl,
      isPlaying: audio.state === 'Playing',
      currentTimeSeconds: audio.currentTimeSeconds,
      durationSeconds: audio.durationSeconds,
    });
  }, []);

  useEffect(() => {
    if (!speakerCast.isActive || !audio.envelope) return;
    if (speakerCast.deviceType !== 'remote_cast') {
      if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) audio.pause();
    }
    void syncCastEnvelope(
      audio.envelope,
      {
        title: audio.title,
        artist: audio.artist,
        artworkUrl: artworkUrl || audio.envelope.artworkUrl,
        isPlaying: audio.state === 'Playing',
        currentTimeSeconds: audioCurrentTimeRef.current,
        durationSeconds: audio.durationSeconds,
      },
      speakerCast.deviceType === 'remote_cast' && playQueue.length > 0
        ? { queue: playQueue, index: queueIndex }
        : undefined,
    );
  }, [
    speakerCast.isActive,
    speakerCast.deviceType,
    audio.envelope,
    audio.envelope?.envelopeId,
    audio.envelope?.url,
    audio.envelope?.sourceId,
    audio.title,
    audio.artist,
    audio.state,
    audio.durationSeconds,
    artworkUrl,
    playQueue,
    queueIndex,
  ]);

  useEffect(() => {
    if (!speakerCast.isActive || audio.state !== 'Playing') return;
    const id = window.setInterval(() => {
      if (!audio.envelope) return;
      void syncCastEnvelope(
        audio.envelope,
        {
          title: audio.title,
          artist: audio.artist,
          artworkUrl: artworkUrl || audio.envelope.artworkUrl,
          isPlaying: true,
          currentTimeSeconds: audioCurrentTimeRef.current,
          durationSeconds: audio.durationSeconds,
        },
        speakerCast.deviceType === 'remote_cast' && playQueue.length > 0
          ? { queue: playQueue, index: queueIndex }
          : undefined,
      );
    }, 1500);
    return () => window.clearInterval(id);
  }, [
    speakerCast.isActive,
    speakerCast.deviceType,
    audio.state,
    audio.envelope?.envelopeId,
    audio.title,
    audio.artist,
    audio.durationSeconds,
    artworkUrl,
    playQueue,
    queueIndex,
  ]);

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      void (async () => {
        const resolvedUrl = await resolveCastStreamUrl(audio.envelope ?? null);
        if (cancelled) return;
        publishCinemaCast({
          title: audio.title || 'Sovereign Music Console',
          artist: audio.artist || 'Ready to cast',
          albumArt: artworkUrl || audio.envelope?.artworkUrl,
          isPlaying: audio.state === 'Playing',
          currentTimeSeconds: audioCurrentTimeRef.current,
          durationSeconds: audio.durationSeconds,
          fidelity: loadFidelityPolicy(),
          streamUrl: resolvedUrl ?? undefined,
        });
      })();
    };
    publish();
    const intervalId =
      audio.state === 'Playing' ? window.setInterval(publish, 1500) : undefined;
    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [
    audio.title,
    audio.artist,
    audio.state,
    audio.durationSeconds,
    audio.envelope,
    audio.envelope?.url,
    audio.envelope?.artworkUrl,
    audio.envelope?.provider,
    audio.envelope?.sourceId,
    audio.envelope?.envelopeId,
    artworkUrl,
  ]);
}
