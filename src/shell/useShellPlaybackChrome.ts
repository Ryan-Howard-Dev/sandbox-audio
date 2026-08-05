/**
 * Playback chrome presence for the shell — locker featured idle pick, hasActivePlayback,
 * mobile player-pending clearing, and the Android home-vinyl / now-playing Exo nudge effects.
 * Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the same position where lockerFeatured / hasActivePlayback used to live:
 * after queue persistence is ready and before useShellNowPlayingDisplay, which needs both
 * lockerFeatured and hasActivePlayback as inputs.
 */

import {
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import {
  getLockerEntriesSnapshot,
  inferArtistFromAlbumFolder,
  resolveLockerEntryGroupArt,
} from '../lockerStorage';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { isAndroid } from '../platformEnv';
import { resolveConnectRole } from '../sandboxSettings';
import type { StationId } from './shellNav';

export type ShellPlaybackChromeArgs = {
  audio: UseAudioFSMResult;
  lockerEnvelopes: MediaEnvelope[];
  homeAwaitingUserResume: boolean;
  queuePersistReady: boolean;
  effectiveConnectRole: ReturnType<typeof resolveConnectRole> | null;
  remoteMirrorCurrentTrackId: string | null | undefined;
  androidNativePlaybackLive: boolean;
  showMobileShell: boolean;
  mobilePlayerPending: boolean;
  setMobilePlayerPending: Dispatch<SetStateAction<boolean>>;
  mobileNowPlayingOpen: boolean;
  station: StationId;
};

export function useShellPlaybackChrome({
  audio,
  lockerEnvelopes,
  homeAwaitingUserResume,
  queuePersistReady,
  effectiveConnectRole,
  remoteMirrorCurrentTrackId,
  androidNativePlaybackLive,
  showMobileShell,
  mobilePlayerPending,
  setMobilePlayerPending,
  mobileNowPlayingOpen,
  station,
}: ShellPlaybackChromeArgs) {
  const lockerFeatured = useMemo(() => {
    if (audio.envelope || homeAwaitingUserResume || !queuePersistReady) return null;
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return null;
    const recent = [...entries].sort((a, b) => b.addedAt - a.addedAt)[0];
    if (!recent) return null;
    return {
      envelopeId: `local-${recent.id}`,
      title: recent.title,
      artist: inferArtistFromAlbumFolder(recent.albumName ?? '', recent.artist),
      album: recent.albumName,
      artworkUrl: resolveLockerEntryGroupArt(recent, entries),
      url: recent.url,
      durationSeconds: recent.durationSeconds || 210,
      provider: 'local-vault' as const,
      transport: 'element-src' as const,
      sourceId: recent.id,
    };
  }, [audio.envelope, lockerEnvelopes, homeAwaitingUserResume, queuePersistReady]);

  const hasActivePlayback =
    effectiveConnectRole === 'remote'
      ? Boolean(remoteMirrorCurrentTrackId)
      : Boolean(audio.envelope) ||
        audio.state === 'Playing' ||
        audio.state === 'Ready' ||
        audio.state === 'Resolving' ||
        audio.state === 'Connecting' ||
        audio.state === 'Failed' ||
        androidNativePlaybackLive;

  useEffect(() => {
    if (!showMobileShell) return;
    if (hasActivePlayback) {
      setMobilePlayerPending(false);
      return;
    }
    if (
      mobilePlayerPending &&
      audio.state === 'Idle' &&
      !audio.envelope &&
      effectiveConnectRole !== 'remote'
    ) {
      setMobilePlayerPending(false);
    }
  }, [
    showMobileShell,
    hasActivePlayback,
    mobilePlayerPending,
    audio.state,
    audio.envelope,
    effectiveConnectRole,
  ]);

  /** Android: one nudge per track when Exo has a native-playable URL (home vinyl). */
  const androidHomePlayNudgeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showMobileShell || !isAndroid()) return;
    if (!audio.nativeExoActive) return;
    const env = audio.envelope;
    const url = env?.url?.trim() ?? '';
    if (!url) return;
    if (url.startsWith('blob:')) return;
    if (env?.envelopeId && isPodcastEnvelopeId(env.envelopeId)) return;
    if (audio.state === 'Failed') return;
    if (audio.state === 'Playing' || audio.state === 'Idle') {
      androidHomePlayNudgeRef.current = null;
      return;
    }
    if (audio.state !== 'Connecting') return;
    const key = env.envelopeId;
    if (androidHomePlayNudgeRef.current === key) return;
    androidHomePlayNudgeRef.current = key;
    audio.primePlaybackGesture();
    void audio.play({ userGesture: true });
  }, [
    showMobileShell,
    audio.state,
    audio.envelope?.envelopeId,
    audio.envelope?.url,
    audio.nativeExoActive,
    audio,
  ]);

  /** Resume ExoPlayer when now-playing opens with a resolved URL but native state is idle. */
  useEffect(() => {
    if (!mobileNowPlayingOpen || !showMobileShell) return;
    if (station === 'home') return;
    const env = audio.envelope;
    if (!env?.url?.trim()) return;
    if (env.envelopeId && isPodcastEnvelopeId(env.envelopeId)) return;
    if (
      audio.state === 'Playing' ||
      audio.state === 'Resolving' ||
      audio.state === 'Connecting'
    ) {
      return;
    }
    audio.primePlaybackGesture();
    void audio.play();
  }, [
    mobileNowPlayingOpen,
    showMobileShell,
    station,
    audio.envelope?.envelopeId,
    audio.envelope?.url,
    audio.state,
    audio,
  ]);

  const homeHasLoadedTrack =
    hasActivePlayback ||
    Boolean(audio.envelope?.envelopeId?.trim()) ||
    (!showMobileShell && !homeAwaitingUserResume && Boolean(lockerFeatured));

  return {
    lockerFeatured,
    hasActivePlayback,
    homeHasLoadedTrack,
  };
}
