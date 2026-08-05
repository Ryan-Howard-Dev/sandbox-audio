/**
 * Now-playing derived state for the shell — lyrics resolve and the media-session /
 * keyboard-shortcut wiring (shortcutCtxRef, registerKeyboardShortcuts, registerMediaSession, and
 * the lock-screen/notification sync effect). Extracted from sandboxLayer3 with no JSX.
 *
 * Two separate hooks, called at their two original (and non-adjacent) positions, rather than one
 * combined hook: useShellLyricsResolve's source position is well before togglePlay/skipBack/
 * skipForward exist, while useShellMediaSessionWiring needs those callbacks plus nowPlayingDisplay
 * and homeArt, which are only computed later. Merging them into a single call would force one of
 * the two to run at the wrong point in the effect order relative to the many unrelated
 * memos/effects that sit between their original positions in SandboxShell.
 *
 * Call useShellLyricsResolve where lyricsEnvelope/resolveActiveLyrics used to be declared (after
 * resolveEnvelopeById exists). Call useShellMediaSessionWiring where shortcutCtxRef used to be
 * declared: after togglePlay/skipBack/skipForward, nowPlayingDisplay, nowPlayingAuthority, and
 * homeArt are computed, and before the car-mode / onboarding / server-setup / SystemLogin early
 * returns. shortcutCtxRef is read by closures declared earlier in the component (the E2E
 * skip-forward probe, car voice actions, useAndroidShellBridges) that only run after mount, so
 * returning it from this hook at the original call site keeps those existing closures valid
 * without moving them.
 *
 * The now-playing display pipeline itself (resolveNowPlayingDisplay, resolveNowPlayingAuthority,
 * book chapter marks / useBookChapterScan, npCurrentTimeSeconds/npDurationSeconds, togglePlay,
 * skipBack/skipForward) stays in sandboxLayer3 — those values fan out into dozens of downstream
 * JSX consumers and each other, so pulling them out here would mean re-threading most of the
 * shell's render-prep state through these hooks' args/return for no isolation benefit. PRESERVE
 * useBookChapterScan and bookChapterMarks exactly as they are in sandboxLayer3 — do not move or
 * change their logic.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ServerStemMixState } from '../hooks/useServerStemMix';
import type { NarrationPlaybackSnapshot } from '../narrationPlayback';
import type { ConnectCommand, ConnectRolePref, SyncStatePayload } from '../tier34/connectProtocol';
import type { PlaybackDisplayFields } from '../playbackSession';
import type { NowPlayingAuthorityDecision } from '../nowPlayingAuthority';
import { EMPTY_LYRICS, resolveTrackLyrics, type ResolvedLyrics } from '../resolveTrackLyrics';
import {
  registerKeyboardShortcuts,
  registerMediaSession,
  syncMediaSessionState,
  type MediaSessionTrackMetadata,
} from '../keyboardShortcuts';
import { syncAndroidBackgroundMedia } from '../backgroundMedia';
import { proxiedArtworkUrl } from '../displaySanitize';

export type ShellLyricsResolveArgs = {
  isConnectRemote: boolean;
  remoteMirror: SyncStatePayload | null;
  resolveEnvelopeById: (envelopeId: string) => MediaEnvelope | null;
  audio: UseAudioFSMResult;
  effectiveConnectRole: ConnectRolePref;
  sendConnectCommand: (command: ConnectCommand) => void;
  serverStemMix: ServerStemMixState;
  lyricsDrawerOpen: boolean;
  mobileNowPlayingOpen: boolean;
  setActiveLyrics: Dispatch<SetStateAction<ResolvedLyrics>>;
};

export function useShellLyricsResolve({
  isConnectRemote,
  remoteMirror,
  resolveEnvelopeById,
  audio,
  effectiveConnectRole,
  sendConnectCommand,
  serverStemMix,
  lyricsDrawerOpen,
  mobileNowPlayingOpen,
  setActiveLyrics,
}: ShellLyricsResolveArgs) {
  const lyricsEnvelope = useMemo(() => {
    if (isConnectRemote && remoteMirror) {
      const id = remoteMirror.currentTrackId;
      if (!id) return null;
      return resolveEnvelopeById(id);
    }
    return audio.envelope;
  }, [isConnectRemote, remoteMirror, audio.envelope, resolveEnvelopeById]);

  const lyricsTitle = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.title ?? ''
    : audio.title;
  const lyricsArtist = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.artist ?? ''
    : audio.artist;
  const lyricsTrackKey = isConnectRemote && remoteMirror
    ? remoteMirror.currentTrackId ?? ''
    : audio.envelope?.envelopeId ?? '';
  const lyricsDuration = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.durationSeconds ?? 0
    : audio.envelope?.durationSeconds ?? audio.durationSeconds ?? 0;
  const lyricsAlbum = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.album ?? ''
    : audio.envelope?.album ?? '';

  const lyricsCurrentTimeSeconds = isConnectRemote && remoteMirror
    ? remoteMirror.currentTimeSeconds
    : audio.currentTimeSeconds;
  const lyricsIsPlaying = isConnectRemote && remoteMirror
    ? remoteMirror.isPlaying
    : audio.state === 'Playing';

  const handleLyricsSeek = useCallback(
    (seconds: number) => {
      if (effectiveConnectRole === 'remote') {
        sendConnectCommand({ cmd: 'SEEK_TO', seconds });
      } else if (serverStemMix.stemMixActive) {
        serverStemMix.seekStemPlayback(seconds);
      } else {
        audio.seek(seconds);
      }
    },
    [effectiveConnectRole, sendConnectCommand, audio, serverStemMix],
  );

  const lyricsResolveTokenRef = useRef(0);

  const resolveActiveLyrics = useCallback(() => {
    const token = ++lyricsResolveTokenRef.current;
    if (!lyricsTrackKey && !lyricsTitle.trim() && !lyricsArtist.trim()) {
      setActiveLyrics(EMPTY_LYRICS);
      return;
    }
    setActiveLyrics({ ...EMPTY_LYRICS, loading: true });
    void resolveTrackLyrics({
      title: lyricsTitle,
      artist: lyricsArtist,
      album: lyricsAlbum,
      durationSeconds: lyricsDuration,
      envelope: lyricsEnvelope,
    }).then((resolved) => {
      if (lyricsResolveTokenRef.current === token) setActiveLyrics(resolved);
    });
  }, [lyricsTrackKey, lyricsTitle, lyricsArtist, lyricsAlbum, lyricsDuration, lyricsEnvelope]);

  useEffect(() => {
    if (!lyricsDrawerOpen && !mobileNowPlayingOpen) return;
    resolveActiveLyrics();
  }, [lyricsDrawerOpen, mobileNowPlayingOpen, lyricsTrackKey, resolveActiveLyrics]);

  return {
    lyricsEnvelope,
    lyricsTitle,
    lyricsArtist,
    lyricsCurrentTimeSeconds,
    lyricsIsPlaying,
    handleLyricsSeek,
    resolveActiveLyrics,
  };
}

export type ShellMediaSessionWiringArgs = {
  audio: UseAudioFSMResult;
  togglePlay: () => void;
  skipBack: () => void;
  skipForward: () => void;
  narrationPlayback: NarrationPlaybackSnapshot | null;
  showMobileShell: boolean;
  openMobileSearch: () => void;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
  setSearchDropdownOpen: Dispatch<SetStateAction<boolean>>;
  isTV: boolean;
  isCarMode: boolean;
  nowPlayingDisplay: PlaybackDisplayFields;
  homeArt: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  authoritativeEnvelope: MediaEnvelope | null;
  artworkUrl: string;
  nowPlayingAuthority: NowPlayingAuthorityDecision;
};

export function useShellMediaSessionWiring({
  audio,
  togglePlay,
  skipBack,
  skipForward,
  narrationPlayback,
  showMobileShell,
  openMobileSearch,
  searchInputRef,
  setSearchDropdownOpen,
  isTV,
  isCarMode,
  nowPlayingDisplay,
  homeArt,
  t,
  authoritativeEnvelope,
  artworkUrl,
  nowPlayingAuthority,
}: ShellMediaSessionWiringArgs) {
  const shortcutCtxRef = useRef({
    togglePlay,
    skipBack,
    skipForward,
    focusSearch: () => {},
    isIdle: (): boolean => true,
    getVolume: (): number => 1,
    setVolume: (_level: number) => {},
    toggleMute: () => {},
    seek: (_seconds: number) => {},
    currentTimeSeconds: (): number => 0,
    durationSeconds: (): number => 0,
    play: () => {},
    pause: () => {},
    getMetadata: () => null as MediaSessionTrackMetadata | null,
  });

  /*
   * The lock screen, the steering wheel and the keyboard all arrive here.
   *
   * For a book or a podcast these buttons already seek by an interval rather than change item —
   * a driver hitting Next reflexively to clear a sponsor read must not lose a ninety minute
   * chapter, and finding the timestamp again on a dashboard is not something to do while moving.
   * See skipForward, spokenSeekIntervals, and spokenWordPlayback.
   *
   * Narration was the one spoken thing left out. It has no envelope at all, so the interval test
   * could never match it and Next fell through to a queue that is empty while a book is being
   * read aloud: the button did nothing. A passage is narration's interval, so that is what it
   * moves. Mirrors what the in-app transport already does with the same two buttons.
   */
  const narrationOwnsOutput = audio.envelope ? null : narrationPlayback;
  shortcutCtxRef.current = {
    togglePlay,
    skipBack: narrationOwnsOutput
      ? () =>
          narrationOwnsOutput.controls.seekToChunk(Math.max(0, narrationOwnsOutput.chunkIndex - 1))
      : skipBack,
    skipForward: narrationOwnsOutput
      ? () =>
          narrationOwnsOutput.controls.seekToChunk(
            Math.min(narrationOwnsOutput.chunkCount - 1, narrationOwnsOutput.chunkIndex + 1),
          )
      : skipForward,
    focusSearch: () => {
      if (showMobileShell) {
        openMobileSearch();
        return;
      }
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      setSearchDropdownOpen(true);
    },
    isIdle: () => audio.state === 'Idle',
    getVolume: () => audio.volume,
    setVolume: audio.setVolume,
    toggleMute: audio.toggleMute,
    seek: audio.seek,
    currentTimeSeconds: () => audio.currentTimeSeconds,
    durationSeconds: () => audio.durationSeconds,
    play: () => {
      void audio.play({ userGesture: true });
    },
    pause: audio.pause,
    getMetadata: () => {
      const title = nowPlayingDisplay.title?.trim();
      const artist = nowPlayingDisplay.artist?.trim();
      if (!title && !artist && audio.state === 'Idle') return null;
      const art =
        (proxiedArtworkUrl(homeArt) ?? homeArt) ||
        (proxiedArtworkUrl(nowPlayingDisplay.artworkUrl) ?? nowPlayingDisplay.artworkUrl);
      return {
        title: title || t('player.unknownTitle'),
        artist: artist || t('player.unknownArtist'),
        album: nowPlayingDisplay.album ?? authoritativeEnvelope?.album,
        artworkUrl: art || undefined,
        envelopeId: nowPlayingDisplay.envelopeId || authoritativeEnvelope?.envelopeId,
      };
    },
  };

  useEffect(() => {
    return registerKeyboardShortcuts(
      {
        togglePlay: () => shortcutCtxRef.current.togglePlay(),
        toggleMute: () => shortcutCtxRef.current.toggleMute(),
        skipBack: () => shortcutCtxRef.current.skipBack(),
        skipForward: () => shortcutCtxRef.current.skipForward(),
        seekRelative: (delta) => {
          const ctx = shortcutCtxRef.current;
          const max = ctx.durationSeconds() || Infinity;
          ctx.seek(Math.max(0, Math.min(ctx.currentTimeSeconds() + delta, max)));
        },
        getVolume: () => shortcutCtxRef.current.getVolume(),
        setVolume: (level) => shortcutCtxRef.current.setVolume(level),
        focusSearch: () => shortcutCtxRef.current.focusSearch(),
        isIdle: () => shortcutCtxRef.current.isIdle(),
      },
      { tvMode: isTV, carMode: isCarMode },
    );
  }, [isTV, isCarMode]);

  useEffect(() => {
    return registerMediaSession({
      play: () => shortcutCtxRef.current.play(),
      pause: () => shortcutCtxRef.current.pause(),
      skipBack: () => shortcutCtxRef.current.skipBack(),
      skipForward: () => shortcutCtxRef.current.skipForward(),
      seekRelative: (delta) => {
        const ctx = shortcutCtxRef.current;
        const max = ctx.durationSeconds() || Infinity;
        ctx.seek(Math.max(0, Math.min(ctx.currentTimeSeconds() + delta, max)));
      },
      getMetadata: () => shortcutCtxRef.current.getMetadata(),
    });
  }, []);

  useEffect(() => {
    const metadata = shortcutCtxRef.current.getMetadata();
    const isPlaying = audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
    /*
     * The lock screen and the notification are drawn from the same fields as the screen, so the
     * hold has to reach them too. Left on the audio layer's own clock they would show the resolving
     * track's length against the held track's title — the bug, one surface further out.
     */
    const holdingNowPlaying = nowPlayingAuthority.source === 'held';
    const positionSeconds = holdingNowPlaying
      ? nowPlayingDisplay.positionSeconds
      : audio.currentTimeSeconds;
    const durationSeconds = holdingNowPlaying
      ? nowPlayingDisplay.durationSeconds || audio.durationSeconds
      : audio.durationSeconds;

    syncMediaSessionState(metadata, isPlaying, positionSeconds, durationSeconds);
    void syncAndroidBackgroundMedia(
      metadata,
      isPlaying,
      positionSeconds * 1000,
      durationSeconds * 1000,
      {
        nativeExoActive:
          audio.nativeExoEffectivePlaying ||
          audio.state === 'Playing' ||
          audio.state === 'Connecting',
      },
    );
  }, [
    audio.state,
    audio.nativeExoEffectivePlaying,
    audio.title,
    audio.artist,
    audio.envelope,
    audio.envelope?.envelopeId,
    audio.envelope?.album,
    audio.envelope?.artworkUrl,
    audio.currentTimeSeconds,
    audio.durationSeconds,
    artworkUrl,
    nowPlayingAuthority.source,
    nowPlayingDisplay.envelopeId,
    nowPlayingDisplay.positionSeconds,
    nowPlayingDisplay.durationSeconds,
  ]);

  return { shortcutCtxRef };
}
