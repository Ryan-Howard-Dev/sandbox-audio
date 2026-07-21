import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  FastForward,
  Loader2,
  ListOrdered,
  Pause,
  Play,
  Repeat,
  ScrollText,
  Shuffle,
  SkipBack,
  SkipForward,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { useAudioFSM } from '../sandboxLayer1';
import type { RepeatMode } from '../queuePersistence';
import type { MixRadioSession } from '../playerMixRadio';
import type { CastState } from '../castState';
import type { SyncStatePayload } from '../tier34/connectProtocol';
import { displayTransportLabel, proxiedArtworkUrl } from '../displaySanitize';
import { formatTime, themeBadgeOutlineClass } from '../stations/theme';
import { applyHeroDisplayFromSettingsEvent, loadHeroDisplayMode } from '../heroDisplaySettings';
import {
  resolvePlaybackCoverArt,
  resolvePlaybackCoverArtFallback,
  resolvePlayerBarDisplay,
  resolvePlayerBarHasTrack,
  playbackArtStabilizeScope,
  stabilizePlaybackArtSrc,
} from '../playerBarTrackMeta';
import { seedGradient } from '../seedGradient';
import { isAndroid } from '../platformEnv';
import { getPlaybackVolumeCap } from '../sandboxSettings';
import { useVerticalPanExpand } from '../mobile/useVerticalPanExpand';
import { preferFreshMobileResolve, hasActiveMobileResolvers } from '../mobileResolverRegistry';
import { useTranslation } from '../i18n';
import { tapHaptic } from '../uiTapFeedback';
import { usePlaybackResolveElapsed } from '../hooks/usePlaybackResolveElapsed';
import { resolvePlaybackFidelityLabel } from '../trackFidelityLabel';
import PlayerBarMoreMenu from './PlayerBarMoreMenu';
import PlayerArtistLink from './PlayerArtistLink';

export interface PlayerBarProps {
  audio: ReturnType<typeof useAudioFSM>;
  artworkUrl: string;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  thumbUp: boolean;
  thumbDown: boolean;
  castState: CastState;
  onOpenCastPicker: () => void;
  onShuffleToggle: () => void;
  onRepeatCycle: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onThumbUp: () => void;
  onThumbDown: () => void;
  queueOpen: boolean;
  queueCount: number;
  onToggleQueue: () => void;
  lyricsOpen: boolean;
  onToggleLyrics: () => void;
  sleepTimerOpen: boolean;
  onToggleSleepTimer: () => void;
  sleepTimerLabel: string | null;
  connectRemote?: boolean;
  remoteMirror?: SyncStatePayload | null;
  onRemoteTogglePlay?: () => void;
  onRemoteSeek?: (seconds: number) => void;
  onRemoteSetVolume?: (level: number) => void;
  onRemoteToggleMute?: () => void;
  onEnterCarMode?: () => void;
  onOpenHero?: () => void;
  /** Overrides default aria-label when the mini bar opens home vs now playing. */
  openHeroAriaLabel?: string;
  mixRadioEnabled?: boolean;
  onArtistMix?: () => void;
  onTrackRadio?: () => void;
  mixRadioSession?: MixRadioSession | null;
  saveMixRadioEnabled?: boolean;
  onSaveMixRadioToPlaylist?: () => void;
  /** When set, overrides local (non-connect) play/seek/time display. */
  localPlaybackOverride?: {
    currentTimeSeconds: number;
    isPlaying: boolean;
    onTogglePlay: () => void;
    onSeek: (seconds: number) => void;
  };
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
  onDismissStuck?: () => void;
  resumeQueueCount?: number;
  onResumeQueue?: () => void;
  downloadEnabled?: boolean;
  onDownloadTrack?: () => void;
  /** When true, bar is positioned by MobilePlayerShell (not viewport-fixed). */
  embedded?: boolean;
  /** Android flex-column dock — no position:fixed (OEM WebView safe). */
  inlineDock?: boolean;
  /** Full now-playing open: title + progress only, tap to collapse. */
  infoStripOnly?: boolean;
  /** Tidal-style combined dock mini row (play + skip forward only). */
  tidalMini?: boolean;
  /** Discovery station — skip-forward only, no queue/scrub/shuffle. */
  discoverySkipOnly?: boolean;
  /** Podcast episode — chapter navigation in the transport row. */
  isPodcast?: boolean;
  podcastChapterTitle?: string | null;
  hasPodcastChapters?: boolean;
  onPodcastPrevChapter?: () => void;
  onPodcastNextChapter?: () => void;
  onOpenPodcastChapters?: () => void;
  canPodcastPrevChapter?: boolean;
  canPodcastNextChapter?: boolean;
  onSkipPodcastAd?: () => void;
  podcastSkipAdHint?: string;
  podcastPlaybackSpeed?: number;
  onCyclePodcastSpeed?: () => void;
  podcastSmartSpeedEnabled?: boolean;
  onTogglePodcastSmartSpeed?: () => void;
  podcastVoiceBoostEnabled?: boolean;
  onTogglePodcastVoiceBoost?: () => void;
  episodeVolumeBoostDb?: number;
  onCycleEpisodeVolumeBoost?: () => void;
  podcastSkipAdChaptersEnabled?: boolean;
  onTogglePodcastSkipAdChapters?: () => void;
  /** True while a tap is resolving/connecting — UI feedback only. */
  resolvePending?: boolean;
}

export default function PlayerBar({
  audio,
  artworkUrl,
  shuffleOn,
  repeatMode,
  thumbUp,
  thumbDown,
  castState,
  onOpenCastPicker,
  onShuffleToggle,
  onRepeatCycle,
  onSkipBack,
  onSkipForward,
  onThumbUp,
  onThumbDown,
  queueOpen,
  queueCount,
  onToggleQueue,
  lyricsOpen,
  onToggleLyrics,
  sleepTimerOpen,
  onToggleSleepTimer,
  sleepTimerLabel,
  connectRemote,
  remoteMirror,
  onRemoteTogglePlay,
  onRemoteSeek,
  onRemoteSetVolume,
  onRemoteToggleMute,
  onEnterCarMode,
  localPlaybackOverride,
  onOpenHero,
  openHeroAriaLabel,
  mixRadioEnabled,
  onArtistMix,
  onTrackRadio,
  mixRadioSession,
  saveMixRadioEnabled,
  onSaveMixRadioToPlaylist,
  onGoToArtist,
  onGoToAlbum,
  onDismissStuck,
  resumeQueueCount = 0,
  onResumeQueue,
  downloadEnabled = false,
  onDownloadTrack,
  embedded = false,
  inlineDock = false,
  infoStripOnly = false,
  tidalMini = false,
  discoverySkipOnly = false,
  isPodcast = false,
  podcastChapterTitle = null,
  hasPodcastChapters = false,
  onPodcastPrevChapter,
  onPodcastNextChapter,
  onOpenPodcastChapters,
  canPodcastPrevChapter = false,
  canPodcastNextChapter = false,
  onSkipPodcastAd,
  podcastSkipAdHint = '+75s',
  podcastPlaybackSpeed = 1,
  onCyclePodcastSpeed,
  podcastSmartSpeedEnabled = false,
  onTogglePodcastSmartSpeed,
  podcastVoiceBoostEnabled = false,
  onTogglePodcastVoiceBoost,
  episodeVolumeBoostDb = 0,
  onCycleEpisodeVolumeBoost,
  podcastSkipAdChaptersEnabled = false,
  onTogglePodcastSkipAdChapters,
  resolvePending = false,
}: PlayerBarProps) {
  const { t } = useTranslation();
  const longPressRef = useRef<number | null>(null);
  const longPressFiredRef = useRef(false);
  const scrubRafRef = useRef<number | null>(null);
  const scrubbingRef = useRef(false);
  const scrubCommittedRef = useRef(false);
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null);

  const clearLongPress = () => {
    if (longPressRef.current !== null) {
      window.clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  };

  const startLongPress = () => {
    if (!onEnterCarMode) return;
    longPressFiredRef.current = false;
    clearLongPress();
    longPressRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      onEnterCarMode();
    }, 650);
  };

  useEffect(() => () => clearLongPress(), []);
  const track = connectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex] ?? null
    : null;
  const { title: displayTitle, artist: displayArtist, album: displayAlbum } =
    resolvePlayerBarDisplay(
      Boolean(connectRemote),
      track,
      {
        title: audio.title,
        artist: audio.artist,
        state: audio.state,
        envelope: audio.envelope,
      },
    );
  const displayCurrentTime = connectRemote && remoteMirror
    ? remoteMirror.currentTimeSeconds
    : localPlaybackOverride?.currentTimeSeconds ?? audio.currentTimeSeconds;
  const displayDuration =
    connectRemote && remoteMirror && remoteMirror.durationSeconds > 0
      ? remoteMirror.durationSeconds
      : audio.durationSeconds;
  const displayVolume = connectRemote && remoteMirror ? remoteMirror.volume : audio.volume;
  const duration = displayDuration > 0 ? displayDuration : 0;
  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (displayCurrentTime / duration) * 100))
      : 0;
  const isPlaying = connectRemote && remoteMirror
    ? remoteMirror.isPlaying
    : localPlaybackOverride
      ? localPlaybackOverride.isPlaying
      : (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) &&
        audio.state !== 'Resolving' &&
        audio.state !== 'Connecting' &&
        (duration > 0 || displayCurrentTime > 0.4);
  const displayIsPlaying = optimisticPlaying ?? isPlaying;
  const isBusy =
    !connectRemote && (audio.state === 'Resolving' || audio.state === 'Connecting');
  const showConnectPending = resolvePending || isBusy;
  const resolveElapsedSeconds = usePlaybackResolveElapsed(audio.state, audio.envelope?.envelopeId);
  const mobileOfflineResolve =
    isAndroid() && hasActiveMobileResolvers() && preferFreshMobileResolve();
  const streamLabel =
    !connectRemote && mobileOfflineResolve
      ? 'MOBILE'
      : !connectRemote && audio.envelope
        ? displayTransportLabel(
            audio.envelope.provider,
            audio.envelope.transport,
            audio.envelope.url,
            audio.envelope.resolutionSource,
          )
        : connectRemote
          ? t('player.sandboxConnect')
          : null;
  const streamBadgeClass =
    streamLabel === 'MOBILE'
      ? 'text-amber-500/90 border-amber-500/40 bg-amber-500/5'
      : themeBadgeOutlineClass;
  const fidelityLabel = resolvePlaybackFidelityLabel(audio.envelope, {
    streamLabel,
    t,
  });
  const barArt = connectRemote && track
    ? proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl ?? ''
    : resolvePlaybackCoverArt(artworkUrl, audio.envelope);
  const [barArtSrc, setBarArtSrc] = useState(barArt);
  const [barArtFailed, setBarArtFailed] = useState(false);
  const [heroDisplay, setHeroDisplay] = useState(loadHeroDisplayMode);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);

  useEffect(() => {
    setBarArtFailed(false);
    setBarArtSrc((prev) =>
      stabilizePlaybackArtSrc(prev, barArt, playbackArtStabilizeScope(audio.envelope)),
    );
    setScrubValue(0);
    setOptimisticPlaying(null);
  }, [barArt, audio.envelope]);

  useEffect(() => {
    if (optimisticPlaying === null) return;
    if (optimisticPlaying === isPlaying) {
      setOptimisticPlaying(null);
    }
  }, [isPlaying, optimisticPlaying]);

  const transportPending = optimisticPlaying !== null && optimisticPlaying !== isPlaying;

  const [scrubValue, setScrubValue] = useState(progress);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const volumeCap = getPlaybackVolumeCap();
  const volumeMaxPercent = Math.round(volumeCap * 100);
  const volumePercent = Math.round(displayVolume * 100);
  const showMuted = connectRemote ? displayVolume === 0 : audio.isMuted || audio.volume === 0;
  const hasTrack = resolvePlayerBarHasTrack(
    Boolean(connectRemote),
    remoteMirror?.currentTrackId,
    {
      title: audio.title,
      artist: audio.artist,
      state: audio.state,
      envelope: audio.envelope,
    },
  );
  const isCompactMini =
    !infoStripOnly && (Boolean(onOpenHero) || (embedded && inlineDock));
  const showBarCover =
    Boolean(barArtSrc?.trim()) &&
    (isCompactMini || heroDisplay === 'album-cover') &&
    !barArtFailed;
  const barGradientSeed = displayTitle?.trim() || 'Sandbox';
  const swipeExpand = useVerticalPanExpand({
    enabled: Boolean(tidalMini && onOpenHero && !infoStripOnly),
    onExpand: () => onOpenHero?.(),
  });
  const showCompactScrub = (isCompactMini && !tidalMini) || infoStripOnly;
  const showDesktopControls = !isCompactMini && !infoStripOnly;
  const showPlayerScrub = !discoverySkipOnly && (showDesktopControls || showCompactScrub);
  const scheduleScrubVisual = (value: number) => {
    if (scrubRafRef.current !== null) {
      cancelAnimationFrame(scrubRafRef.current);
    }
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      setScrubValue(value);
    });
  };

  const readScrubInput = (input: HTMLInputElement) => parseFloat(input.value);

  const commitScrubSeek = (input: HTMLInputElement) => {
    if (!scrubbingRef.current || scrubCommittedRef.current) return;
    scrubCommittedRef.current = true;
    scrubbingRef.current = false;
    const seconds = (readScrubInput(input) / 100) * duration;
    if (connectRemote && onRemoteSeek) onRemoteSeek(seconds);
    else if (localPlaybackOverride) localPlaybackOverride.onSeek(seconds);
    else audio.seek(seconds);
    setIsScrubbing(false);
    audio.endScrub();
  };

  const cancelScrub = () => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    scrubCommittedRef.current = false;
    setIsScrubbing(false);
    setScrubValue(progress);
    audio.endScrub();
  };

  const primePlayGesture = () => {
    if (connectRemote || localPlaybackOverride || displayIsPlaying) return;
    setOptimisticPlaying(true);
    audio.primePlaybackGesture();
  };

  const primeTransportPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    if (isBusy || !hasTrack || connectRemote || localPlaybackOverride) return;
    if (displayIsPlaying) {
      setOptimisticPlaying(false);
      return;
    }
    primePlayGesture();
  };

  const handleTogglePlay = (e?: React.MouseEvent) => {
    e?.stopPropagation();
    tapHaptic();
    if (isBusy && onDismissStuck) {
      onDismissStuck();
      return;
    }
    if (connectRemote && onRemoteTogglePlay) onRemoteTogglePlay();
    else if (localPlaybackOverride) localPlaybackOverride.onTogglePlay();
    else if (displayIsPlaying) {
      setOptimisticPlaying(false);
      audio.pause();
    } else {
      setOptimisticPlaying(true);
      audio.primePlaybackGesture();
      void audio.play({ userGesture: true });
    }
  };
  useEffect(() => {
    if (!isScrubbing) setScrubValue(progress);
  }, [progress, isScrubbing]);

  useEffect(() => {
    const sync = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplay);
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  const moreMenuPodcastProps = {
    isPodcast,
    podcastPlaybackSpeed,
    onCyclePodcastSpeed,
    podcastSmartSpeedEnabled,
    onTogglePodcastSmartSpeed,
    podcastVoiceBoostEnabled,
    onTogglePodcastVoiceBoost,
    episodeVolumeBoostDb,
    onCycleEpisodeVolumeBoost,
    podcastSkipAdChaptersEnabled,
    onTogglePodcastSkipAdChapters,
  };
  const showLyricsOrChaptersButton =
    !isPodcast || (hasPodcastChapters && Boolean(onOpenPodcastChapters));

  const playerBarStatus = (
    <>
      {fidelityLabel ? (
        <span
          className={`font-mono text-[8px] px-1.5 py-0.5 rounded border uppercase align-middle ${
            fidelityLabel.startsWith('Lossless')
              ? 'text-emerald-400/90 border-emerald-500/40 bg-emerald-500/5'
              : streamBadgeClass
          }`}
        >
          {fidelityLabel}
        </span>
      ) : streamLabel ? (
        <span
          className={`font-mono text-[8px] px-1.5 py-0.5 rounded border uppercase align-middle ${streamBadgeClass}`}
        >
          {streamLabel}
        </span>
      ) : null}
      {!connectRemote && audio.state === 'Failed' ? (
        <span className="text-[var(--danger)]"> · {t('player.error')}</span>
      ) : showConnectPending ? (
        <span className="text-[var(--text-dim)] player-bar-status--connecting">
          {' · '}
          {isPodcast
            ? 'Connecting…'
            : onDismissStuck ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDismissStuck();
                  }}
                  className="underline decoration-dotted underline-offset-2 touch-manipulation"
                  aria-label={t('player.dismissStuck')}
                >
                  {t('player.resolvingElapsed', { seconds: resolveElapsedSeconds })}
                </button>
              ) : (
                t('player.resolvingElapsed', { seconds: resolveElapsedSeconds })
              )}
        </span>
      ) : isPodcast && podcastChapterTitle ? (
        <span className="text-[var(--text-dim)]"> · {podcastChapterTitle}</span>
      ) : !connectRemote && audio.state !== 'Ready' && audio.state !== 'Playing' ? (
        <span> · {audio.state}</span>
      ) : null}
    </>
  );

  const positionClass = inlineDock
    ? 'player-bar--shell-dock w-full shrink-0'
    : embedded
      ? 'fixed left-0 right-0 player-bar--docked-mobile z-50'
      : 'fixed left-0 right-0 bottom-0';

  const dockStyle: React.CSSProperties | undefined =
    embedded && isAndroid() && !inlineDock
      ? {
          position: 'fixed',
          left: 0,
          right: 0,
          top: 'auto',
          bottom: 'calc(var(--mobile-nav-height) + env(safe-area-inset-bottom, 0px))',
          zIndex: 9999,
          transform: 'translateZ(0)',
        }
      : undefined;

  return (
    <footer
      data-testid="player-bar"
      style={dockStyle}
      className={`player-bar player-bar--glass ${positionClass} z-40 shrink-0${
        isCompactMini || infoStripOnly ? ' player-bar--mobile-mini' : ''
      }${tidalMini ? ' player-bar--tidal-mini' : ''}${
        infoStripOnly ? ' player-bar--info-strip' : ''
      }${embedded ? ' player-bar--embedded' : ''}${isAndroid() ? ' player-bar--android' : ''}`}
      onTouchStart={swipeExpand.onTouchStart}
      onTouchMove={swipeExpand.onTouchMove}
      onTouchEnd={swipeExpand.onTouchEnd}
    >
      {tidalMini && !infoStripOnly ? (
        <div className="player-bar-swipe-handle" aria-hidden>
          <span />
        </div>
      ) : null}
      <div
        className={`player-bar-inner max-w-screen-2xl mx-auto${
          tidalMini ? ' player-bar-inner--tidal-mini' : ''
        }`}
      >
        <div
          className={`player-bar-row${tidalMini ? ' player-bar-row--tidal-mini' : ''}`}
        >
          {tidalMini && isCompactMini && !infoStripOnly ? (
            <>
              <button
                type="button"
                onPointerDown={primeTransportPointerDown}
                onClick={handleTogglePlay}
                disabled={!hasTrack}
                className={`player-bar-mini-play player-bar-tidal-lead-play touch-manipulation${
                  displayIsPlaying ? ' is-playing' : ''
                }${transportPending ? ' is-transport-pending' : ''}`}
                aria-label={displayIsPlaying ? t('player.pause') : t('player.play')}
                aria-busy={transportPending}
              >
                {showConnectPending || transportPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                ) : displayIsPlaying ? (
                  <Pause className="w-3.5 h-3.5" strokeWidth={2.25} />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" strokeWidth={2.25} />
                )}
              </button>
              <div
                className="player-bar-track player-bar-track--tidal-mini player-bar-track--hero"
                onPointerDown={startLongPress}
                onPointerUp={clearLongPress}
                onPointerLeave={clearLongPress}
                onPointerCancel={clearLongPress}
                onClick={(e) => {
                  if (longPressFiredRef.current) {
                    e.preventDefault();
                    e.stopPropagation();
                    longPressFiredRef.current = false;
                    return;
                  }
                  if (swipeExpand.consumeSwipeClick()) {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                  }
                  onOpenHero?.();
                }}
                role={onOpenHero ? 'button' : undefined}
                tabIndex={onOpenHero ? 0 : undefined}
                aria-label={
                  onOpenHero
                    ? openHeroAriaLabel ?? t('player.openNowPlaying')
                    : undefined
                }
                onKeyDown={
                  onOpenHero
                    ? (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onOpenHero();
                        }
                      }
                    : undefined
                }
              >
                <div
                  className="player-bar-badge"
                  style={{
                    background: showBarCover ? 'transparent' : seedGradient(barGradientSeed),
                  }}
                  aria-hidden
                >
                  {showBarCover ? (
                    <img
                      src={barArtSrc}
                      alt=""
                      className="player-bar-badge-img"
                      onError={() => {
                        const retry = resolvePlaybackCoverArtFallback(
                          audio.envelope,
                          barArtSrc,
                          artworkUrl,
                        );
                        if (retry && retry !== barArtSrc) {
                          setBarArtSrc(retry);
                          return;
                        }
                        setBarArtFailed(true);
                      }}
                    />
                  ) : null}
                </div>
                <div className="player-bar-track-meta min-w-0">
                  <p className="now-playing-title now-playing-title--sm player-bar-title player-bar-track-title">
                    {displayTitle || t('player.noTrack')}
                  </p>
                </div>
              </div>
              <div className="player-bar-tidal-tail-transport">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSkipForward();
                  }}
                  className="player-bar-mini-btn player-bar-tidal-tail-btn touch-manipulation"
                  aria-label={t('player.skipForward')}
                >
                  <SkipForward className="w-4 h-4" strokeWidth={2} />
                </button>
                {!discoverySkipOnly ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleQueue();
                    }}
                    className={`player-bar-mini-btn player-bar-tidal-tail-btn touch-manipulation${queueOpen ? ' text-accent' : ''}`}
                    aria-label={t('player.queue')}
                    aria-expanded={queueOpen}
                  >
                    <ListOrdered className="w-4 h-4" strokeWidth={2} />
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
          <div
            className={`player-bar-track${isCompactMini ? ' player-bar-track--hero' : ''}`}
            onPointerDown={startLongPress}
            onPointerUp={clearLongPress}
            onPointerLeave={clearLongPress}
            onPointerCancel={clearLongPress}
            onClick={(e) => {
              if (longPressFiredRef.current) {
                e.preventDefault();
                e.stopPropagation();
                longPressFiredRef.current = false;
                return;
              }
              if (swipeExpand.consumeSwipeClick()) {
                e.preventDefault();
                e.stopPropagation();
                return;
              }
              onOpenHero?.();
            }}
            role={onOpenHero ? 'button' : undefined}
            tabIndex={onOpenHero ? 0 : undefined}
            aria-label={
              onOpenHero
                ? infoStripOnly
                  ? t('nowPlaying.close')
                  : openHeroAriaLabel ?? t('player.openNowPlaying')
                : undefined
            }
            onKeyDown={
              onOpenHero
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpenHero();
                    }
                  }
                : undefined
            }
          >
            <div
              className="player-bar-badge"
              style={{
                background: showBarCover ? 'transparent' : seedGradient(barGradientSeed),
              }}
              aria-hidden
            >
              {showBarCover ? (
                <img
                  src={barArtSrc}
                  alt=""
                  className="player-bar-badge-img"
                  onError={() => {
                    const retry = resolvePlaybackCoverArtFallback(
                      audio.envelope,
                      barArtSrc,
                      artworkUrl,
                    );
                    if (retry && retry !== barArtSrc) {
                      setBarArtSrc(retry);
                      return;
                    }
                    setBarArtFailed(true);
                  }}
                />
              ) : null}
            </div>
            <div className="player-bar-track-meta min-w-0">
              <p className="now-playing-title now-playing-title--sm player-bar-title player-bar-track-title">
                {displayTitle || t('player.noTrack')}
              </p>
              {!(tidalMini && isPodcast) ? (
              <p
                className="now-playing-meta now-playing-meta--sm player-bar-meta player-bar-artist-row"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                {onGoToArtist ? (
                  <PlayerArtistLink
                    artist={displayArtist || ''}
                    album={displayAlbum}
                    onGoToArtist={onGoToArtist}
                    onGoToAlbum={onGoToAlbum}
                  />
                ) : (
                  displayArtist || '—'
                )}
              </p>
              ) : showConnectPending ? (
                <p className="now-playing-meta now-playing-meta--sm player-bar-meta player-bar-mini-connecting">
                  {isPodcast ? 'Connecting…' : t('player.resolvingElapsed', { seconds: resolveElapsedSeconds })}
                </p>
              ) : null}
              {!tidalMini ? (
                <p className="now-playing-meta now-playing-meta--sm player-bar-meta player-bar-status-meta player-bar-track-status">
                  {playerBarStatus}
                </p>
              ) : null}
            </div>
          </div>

          {isCompactMini && !infoStripOnly ? (
            <div className="player-bar-mini-transport">
              {!tidalMini && !discoverySkipOnly ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSkipBack();
                  }}
                  className="player-bar-mini-btn touch-manipulation"
                  aria-label={t('player.skipBack')}
                >
                  <SkipBack className="w-4 h-4" strokeWidth={2} />
                </button>
              ) : null}
              <button
                type="button"
                onPointerDown={primeTransportPointerDown}
                onClick={handleTogglePlay}
                disabled={!hasTrack}
                className={`player-bar-mini-play touch-manipulation${displayIsPlaying ? ' is-playing' : ''}${transportPending ? ' is-transport-pending' : ''}`}
                aria-label={displayIsPlaying ? t('player.pause') : t('player.play')}
                aria-busy={transportPending}
              >
                {showConnectPending || transportPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                ) : displayIsPlaying ? (
                  <Pause className="w-3.5 h-3.5" strokeWidth={2.25} />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" strokeWidth={2.25} />
                )}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSkipForward();
                }}
                className="player-bar-mini-btn touch-manipulation"
                aria-label={t('player.skipForward')}
              >
                <SkipForward className="w-4 h-4" strokeWidth={2} />
              </button>
              {tidalMini && !discoverySkipOnly ? (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onThumbUp();
                    }}
                    disabled={!hasTrack}
                    className={`player-bar-mini-btn touch-manipulation${thumbUp ? ' text-accent player-bar-mini-btn--active' : ''}`}
                    aria-label={t('player.thumbsUp')}
                    aria-pressed={thumbUp}
                    data-thumb="up"
                    data-thumb-active={thumbUp ? 'true' : 'false'}
                  >
                    <ThumbsUp
                      className={`w-3.5 h-3.5${thumbUp ? ' fill-current' : ''}`}
                      strokeWidth={2}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onThumbDown();
                    }}
                    disabled={!hasTrack}
                    className={`player-bar-mini-btn touch-manipulation${thumbDown ? ' text-accent player-bar-mini-btn--active' : ''}`}
                    aria-label={t('player.thumbsDown')}
                    aria-pressed={thumbDown}
                    data-thumb="down"
                    data-thumb-active={thumbDown ? 'true' : 'false'}
                  >
                    <ThumbsDown
                      className={`w-3.5 h-3.5${thumbDown ? ' fill-current' : ''}`}
                      strokeWidth={2}
                    />
                  </button>
                </>
              ) : null}
              {!tidalMini ? (
                <span className="player-bar-mini-more-wrap">
                  <PlayerBarMoreMenu
                    open={moreMenuOpen}
                    onOpenChange={setMoreMenuOpen}
                    displayMode={heroDisplay}
                  sleepTimerOpen={sleepTimerOpen}
                  sleepTimerLabel={sleepTimerLabel}
                  onToggleSleepTimer={onToggleSleepTimer}
                  castActive={castState.isActive}
                  onOpenCastPicker={onOpenCastPicker}
                  onEnterCarMode={onEnterCarMode}
                  mixRadioEnabled={mixRadioEnabled}
                  onArtistMix={onArtistMix}
                  onTrackRadio={onTrackRadio}
                  mixRadioSession={mixRadioSession}
                  saveMixRadioEnabled={saveMixRadioEnabled}
                  onSaveMixRadioToPlaylist={onSaveMixRadioToPlaylist}
                  resumeQueueCount={resumeQueueCount}
                  onResumeQueue={onResumeQueue}
                  downloadEnabled={downloadEnabled}
                  onDownloadTrack={onDownloadTrack}
                  {...moreMenuPodcastProps}
                />
              </span>
              ) : null}
            </div>
          ) : null}
            </>
          )}

          {showDesktopControls ? (
          <div className="player-bar-center">
            <div className="player-bar-controls">
              {!discoverySkipOnly ? (
              <button
                type="button"
                onClick={onSkipBack}
                className="player-bar-btn"
                aria-label={t('player.skipBack')}
              >
                <SkipBack className="w-4 h-4" strokeWidth={2} />
              </button>
              ) : null}
              {isPodcast && hasPodcastChapters && onPodcastPrevChapter ? (
                <button
                  type="button"
                  onClick={onPodcastPrevChapter}
                  disabled={!canPodcastPrevChapter}
                  className="player-bar-btn player-bar-btn--chapter"
                  aria-label={t('player.podcast.prevChapter')}
                >
                  <ChevronLeft className="w-4 h-4" strokeWidth={2} />
                </button>
              ) : null}
              <button
                type="button"
                onPointerDown={primeTransportPointerDown}
                onClick={handleTogglePlay}
                disabled={!hasTrack}
                className={`player-bar-btn player-bar-btn--play touch-manipulation${displayIsPlaying ? ' is-playing' : ''}${transportPending ? ' is-transport-pending' : ''}`}
                aria-label={displayIsPlaying ? t('player.pause') : t('player.play')}
                aria-busy={transportPending}
              >
                {showConnectPending || transportPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                ) : displayIsPlaying ? (
                  <Pause className="w-4 h-4" strokeWidth={2} />
                ) : (
                  <Play className="w-4 h-4 ml-0.5" strokeWidth={2} />
                )}
              </button>
              <button
                type="button"
                onClick={onSkipForward}
                className="player-bar-btn"
                aria-label={t('player.skipForward')}
              >
                <SkipForward className="w-4 h-4" strokeWidth={2} />
              </button>
              {isPodcast && onSkipPodcastAd ? (
                <button
                  type="button"
                  onClick={onSkipPodcastAd}
                  className="player-bar-btn player-bar-btn--skip-ad"
                  aria-label={`Skip ad — ${podcastSkipAdHint}`}
                  title="Skip ad — cannot remove ads from the stream; seeks forward"
                >
                  <FastForward className="w-4 h-4" strokeWidth={2} />
                </button>
              ) : null}
              {isPodcast && hasPodcastChapters && onPodcastNextChapter ? (
                <button
                  type="button"
                  onClick={onPodcastNextChapter}
                  disabled={!canPodcastNextChapter}
                  className="player-bar-btn player-bar-btn--chapter"
                  aria-label={t('player.podcast.nextChapter')}
                >
                  <ChevronRight className="w-4 h-4" strokeWidth={2} />
                </button>
              ) : null}
              {!discoverySkipOnly ? (
              <>
              <button
                type="button"
                onClick={onShuffleToggle}
                className={`player-bar-btn ${shuffleOn ? 'text-accent' : ''}`}
                aria-label={t('player.shuffle')}
              >
                <Shuffle className="w-4 h-4" strokeWidth={2} />
              </button>
              <button
                type="button"
                onClick={onRepeatCycle}
                className={`player-bar-btn relative ${repeatMode !== 'none' ? 'text-accent' : ''}`}
                aria-label={t('player.repeat')}
              >
                <Repeat className="w-4 h-4" strokeWidth={2} />
                {repeatMode === 'one' && (
                  <span className="absolute -top-0.5 -right-0.5 text-[7px] font-bold text-accent">
                    1
                  </span>
                )}
              </button>
              <span className="player-bar-center-divider" aria-hidden />
              <button
                type="button"
                onClick={onThumbUp}
                disabled={!hasTrack}
                className={`player-bar-btn ${thumbUp ? 'text-accent' : ''}`}
                aria-label={t('player.thumbsUp')}
                aria-pressed={thumbUp}
                data-thumb="up"
                data-thumb-active={thumbUp ? 'true' : 'false'}
              >
                <ThumbsUp
                  className={`w-4 h-4${thumbUp ? ' fill-current' : ''}`}
                  strokeWidth={2}
                />
              </button>
              <button
                type="button"
                onClick={onThumbDown}
                disabled={!hasTrack}
                className={`player-bar-btn ${thumbDown ? 'text-accent' : ''}`}
                aria-label={t('player.thumbsDown')}
                aria-pressed={thumbDown}
                data-thumb="down"
                data-thumb-active={thumbDown ? 'true' : 'false'}
              >
                <ThumbsDown
                  className={`w-4 h-4${thumbDown ? ' fill-current' : ''}`}
                  strokeWidth={2}
                />
              </button>
              </>
              ) : null}
            </div>
            <div className="player-bar-now-playing min-w-0">
              <p className="now-playing-title now-playing-title--sm player-bar-title">
                {displayTitle || t('player.noTrack')}
              </p>
              <p className="now-playing-meta now-playing-meta--sm player-bar-meta player-bar-artist-meta">
                {onGoToArtist ? (
                  <PlayerArtistLink
                    artist={displayArtist || ''}
                    album={displayAlbum}
                    onGoToArtist={onGoToArtist}
                    onGoToAlbum={onGoToAlbum}
                  />
                ) : (
                  displayArtist || '—'
                )}
              </p>
              <p className="now-playing-meta now-playing-meta--sm player-bar-meta player-bar-status-meta">
                {playerBarStatus}
              </p>
            </div>
          </div>
          ) : null}

          {showDesktopControls ? (
          <div className="player-bar-volume">
            <button
              type="button"
              onClick={() => {
                if (connectRemote && onRemoteToggleMute) onRemoteToggleMute();
                else audio.toggleMute();
              }}
              className="player-bar-volume-btn touch-manipulation"
              aria-label={showMuted ? t('player.unmute') : t('player.mute')}
            >
              {showMuted ? (
                <VolumeX className="w-4 h-4" strokeWidth={2} />
              ) : (
                <Volume2 className="w-4 h-4" strokeWidth={2} />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={volumeMaxPercent}
              step={1}
              value={volumePercent}
              onChange={(e) => {
                const level = parseInt(e.target.value, 10) / 100;
                if (connectRemote && onRemoteSetVolume) onRemoteSetVolume(level);
                else audio.setVolume(level);
              }}
              className="player-bar-volume-slider touch-manipulation"
              aria-label={t('player.volume')}
              aria-valuemin={0}
              aria-valuemax={volumeMaxPercent}
              aria-valuenow={volumePercent}
              aria-valuetext={t('player.volumePercent', { percent: volumePercent })}
            />
            {showLyricsOrChaptersButton ? (
              <button
                type="button"
                onClick={
                  isPodcast && hasPodcastChapters && onOpenPodcastChapters
                    ? onOpenPodcastChapters
                    : onToggleLyrics
                }
                disabled={!hasTrack}
                className={`player-bar-volume-btn touch-manipulation ${
                  isPodcast && hasPodcastChapters ? '' : lyricsOpen ? 'text-accent' : ''
                }`}
                aria-label={
                  isPodcast && hasPodcastChapters
                    ? t('player.podcast.chapters')
                    : t('player.lyrics')
                }
                aria-expanded={isPodcast && hasPodcastChapters ? undefined : lyricsOpen}
              >
                {isPodcast && hasPodcastChapters ? (
                  <ListOrdered className="w-4 h-4" strokeWidth={2} />
                ) : (
                  <ScrollText className="w-4 h-4" strokeWidth={2} />
                )}
              </button>
            ) : null}
            <span className="player-bar-queue-wrap">
              {!discoverySkipOnly ? (
              <button
                type="button"
                onClick={onToggleQueue}
                className={`player-bar-volume-btn touch-manipulation ${queueOpen ? 'text-accent' : ''}`}
                aria-label={t('player.queue')}
                aria-expanded={queueOpen}
              >
                <ListOrdered className="w-4 h-4" strokeWidth={2} />
              </button>
              ) : null}
              {queueCount > 0 && !discoverySkipOnly ? (
                <span
                  className="player-bar-queue-count"
                  aria-label={t('player.queueCount', { count: queueCount })}
                >
                  {queueCount}
                </span>
              ) : null}
            </span>
            <span className="player-bar-more-wrap">
              {sleepTimerLabel ? (
                <span
                  className="player-bar-sleep-chip"
                  aria-label={t('player.sleepTimerActive', { label: sleepTimerLabel })}
                >
                  {sleepTimerLabel}
                </span>
              ) : null}
              <PlayerBarMoreMenu
                open={moreMenuOpen}
                onOpenChange={setMoreMenuOpen}
                displayMode={heroDisplay}
                sleepTimerOpen={sleepTimerOpen}
                sleepTimerLabel={sleepTimerLabel}
                onToggleSleepTimer={onToggleSleepTimer}
                castActive={castState.isActive}
                onOpenCastPicker={onOpenCastPicker}
                onEnterCarMode={onEnterCarMode}
                mixRadioEnabled={mixRadioEnabled}
                onArtistMix={onArtistMix}
                onTrackRadio={onTrackRadio}
                mixRadioSession={mixRadioSession}
                saveMixRadioEnabled={saveMixRadioEnabled}
                onSaveMixRadioToPlaylist={onSaveMixRadioToPlaylist}
                resumeQueueCount={resumeQueueCount}
                onResumeQueue={onResumeQueue}
                downloadEnabled={downloadEnabled}
                onDownloadTrack={onDownloadTrack}
                {...moreMenuPodcastProps}
              />
            </span>
          </div>
          ) : null}
        </div>

        {castState.isActive && castState.deviceName ? (
          <p
            className="font-mono uppercase text-accent text-center tracking-[0.1em] py-0.5"
            style={{ fontSize: '0.6rem' }}
          >
            {t('player.castingTo', { device: castState.deviceName })}
          </p>
        ) : null}

        {!showPlayerScrub ? null : (
        <div className={`player-bar-scrub${showCompactScrub ? ' player-bar-scrub--compact' : ''}`}>
          <span className="player-bar-time">{formatTime(displayCurrentTime)}</span>
          <input
            type="range"
            min={0}
            max={100}
            step={0.1}
            value={scrubValue}
            onChange={(e) => {
              if (!scrubbingRef.current) return;
              scheduleScrubVisual(parseFloat(e.target.value));
            }}
            onInput={(e) => {
              if (!scrubbingRef.current) return;
              scheduleScrubVisual(parseFloat(e.currentTarget.value));
            }}
            onPointerDown={(e) => {
              scrubCommittedRef.current = false;
              scrubbingRef.current = true;
              setIsScrubbing(true);
              audio.beginScrub();
              scheduleScrubVisual(readScrubInput(e.currentTarget));
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* optional */
              }
            }}
            onPointerMove={(e) => {
              if (!scrubbingRef.current) return;
              scheduleScrubVisual(readScrubInput(e.currentTarget));
            }}
            onPointerUp={(e) => {
              commitScrubSeek(e.currentTarget);
              try {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                  e.currentTarget.releasePointerCapture(e.pointerId);
                }
              } catch {
                /* ignore */
              }
            }}
            onPointerCancel={cancelScrub}
            onLostPointerCapture={(e) => {
              if (scrubbingRef.current && !scrubCommittedRef.current) {
                commitScrubSeek(e.currentTarget);
              }
            }}
            className="player-scrub flex-1 min-w-0 touch-manipulation"
            aria-label={t('player.seek')}
          />
          <span className="player-bar-time">{formatTime(displayDuration)}</span>
        </div>
        )}
      </div>
    </footer>
  );
}
