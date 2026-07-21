import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Cast,
  ChevronDown,
  ListMusic,
  Palette,
  Share2,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { AudioFsmState } from '../sandboxLayer1';
import type { RepeatMode } from '../queuePersistence';
import type { MixRadioSession } from '../playerMixRadio';
import type { CastState } from '../castState';
import { displayTransportLabel } from '../displaySanitize';
import { resolvePlaybackCoverArt } from '../playerBarTrackMeta';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { useTranslation } from '../i18n';
import { loadFidelityPolicy } from '../sandboxSettings';
import { isAndroid } from '../platformEnv';
import { hasActiveMobileResolvers, preferFreshMobileResolve } from '../mobileResolverRegistry';
import { usePlaybackResolveElapsed } from '../hooks/usePlaybackResolveElapsed';
import { resolvePlaybackFidelityLabel } from '../trackFidelityLabel';
import {
  applyHeroDisplayFromSettingsEvent,
  loadHeroDisplayMode,
  resolveHeroShowShades,
} from '../heroDisplaySettings';
import { useTrackUniverseStyle } from '../hooks/useTrackUniverseStyle';
import { useVinylVisualStyle } from '../vinylVisualSettings';
import { getGenreBucketForTrack } from '../vinylGenreThemes';
import {
  shouldCollapseFromDownwardPan,
  verticalPanVelocity,
} from '../mobile/verticalPanGesture';
import HomeHeroPlayer from './HomeHeroPlayer';
import StemSlidersPanel from './StemSlidersPanel';
import MobileHomeVinylSettingsSheet from '../mobile/MobileHomeVinylSettingsSheet';
import PodcastPlayerControls from './podcasts/PodcastPlayerControls';

export interface MobileNowPlayingViewProps {
  open: boolean;
  onClose: () => void;
  profileName: string;
  onOpenProfile?: () => void;
  title: string;
  artist: string;
  album?: string;
  albumArt: string;
  explicit?: boolean;
  envelope: MediaEnvelope | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
  isBusy?: boolean;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  onShuffleToggle: () => void;
  onRepeatCycle: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  onRestart?: () => void;
  onOpenLyrics: () => void;
  onOpenCast: () => void;
  onOpenQueue?: () => void;
  castState: CastState;
  playingFromLabel: string;
  onGoToVinyl?: () => void;
  mixRadioEnabled?: boolean;
  onArtistMix?: () => void;
  onTrackRadio?: () => void;
  mixRadioSession?: MixRadioSession | null;
  saveMixRadioEnabled?: boolean;
  onSaveMixRadioToPlaylist?: () => void;
  onToggleSleepTimer?: () => void;
  sleepTimerOpen?: boolean;
  sleepTimerLabel?: string | null;
  onEnterCarMode?: () => void;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
  resumeQueueCount?: number;
  onResumeQueue?: () => void;
  downloadEnabled?: boolean;
  onDownloadTrack?: () => void;
  showMobileShell?: boolean;
  onCancelResolve?: () => void;
  audioState?: AudioFsmState;
  stemSliders?: import('./StemSlidersPanel').StemSlidersPanelProps;
  isPodcast?: boolean;
  podcastPlaybackSpeed?: number;
  onCyclePodcastSpeed?: () => void;
  podcastSmartSpeedEnabled?: boolean;
  onTogglePodcastSmartSpeed?: () => void;
  podcastVoiceBoostEnabled?: boolean;
  onTogglePodcastVoiceBoost?: () => void;
  episodeVolumeBoostDb?: number;
  onCycleEpisodeVolumeBoost?: () => void;
  onOpenPodcastChapters?: () => void;
  hasPodcastChapters?: boolean;
  podcastSkipAdChaptersEnabled?: boolean;
  onTogglePodcastSkipAdChapters?: () => void;
  onSkipPodcastAd?: () => void;
  podcastSkipAdHint?: string;
  thumbUp?: boolean;
  thumbDown?: boolean;
  onThumbUp?: () => void;
  onThumbDown?: () => void;
}

export default function MobileNowPlayingView({
  open,
  onClose,
  profileName,
  onOpenProfile,
  title,
  artist,
  album,
  albumArt,
  envelope,
  currentTimeSeconds,
  durationSeconds,
  isPlaying,
  isBusy = false,
  shuffleOn,
  repeatMode,
  onShuffleToggle,
  onRepeatCycle,
  onSkipBack,
  onSkipForward,
  onTogglePlay,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onRestart,
  onOpenLyrics,
  onOpenCast,
  onOpenQueue,
  castState,
  playingFromLabel,
  onGoToVinyl,
  mixRadioEnabled,
  onArtistMix,
  onTrackRadio,
  mixRadioSession,
  saveMixRadioEnabled,
  onSaveMixRadioToPlaylist,
  onToggleSleepTimer,
  sleepTimerOpen = false,
  sleepTimerLabel = null,
  onEnterCarMode,
  onGoToArtist,
  onGoToAlbum,
  resumeQueueCount = 0,
  onResumeQueue,
  downloadEnabled = false,
  onDownloadTrack,
  showMobileShell = true,
  onCancelResolve,
  audioState = 'Idle',
  stemSliders,
  isPodcast = false,
  podcastPlaybackSpeed = 1,
  onCyclePodcastSpeed,
  podcastSmartSpeedEnabled = false,
  onTogglePodcastSmartSpeed,
  podcastVoiceBoostEnabled = false,
  onTogglePodcastVoiceBoost,
  episodeVolumeBoostDb = 0,
  onCycleEpisodeVolumeBoost,
  onOpenPodcastChapters,
  hasPodcastChapters = false,
  podcastSkipAdChaptersEnabled = false,
  onTogglePodcastSkipAdChapters,
  onSkipPodcastAd,
  podcastSkipAdHint,
  thumbUp = false,
  thumbDown = false,
  onThumbUp,
  onThumbDown,
}: MobileNowPlayingViewProps) {
  const { t } = useTranslation();

  const [vinylSettingsOpen, setVinylSettingsOpen] = useState(false);
  const [heroDisplay, setHeroDisplay] = useState(loadHeroDisplayMode);
  const displayArt = resolvePlaybackCoverArt(albumArt, envelope);
  const gradientSeed = title?.trim() || album?.trim() || 'Sandbox';
  const hasArt = Boolean(displayArt?.trim());
  const hasTrack = Boolean(title?.trim());
  const trueIdle = !hasTrack;
  const showShades = resolveHeroShowShades(heroDisplay, hasArt);
  const { cssVars: vinylCssVars, vinylClass } = useVinylVisualStyle(envelope);
  const { universeStyle, isArtDriven, isMonochrome } = useTrackUniverseStyle(
    hasArt ? displayArt : undefined,
    gradientSeed,
  );
  const trackGlowStyle = hasTrack
    ? { ...universeStyle, ...vinylCssVars }
    : undefined;
  const artUniverseClass =
    hasTrack && isArtDriven
      ? ` home-vinyl-universe--art-driven${isMonochrome ? ' home-vinyl-universe--art-monochrome' : ''}`
      : '';
  const genreBucket = useMemo(
    () => (hasTrack ? getGenreBucketForTrack(envelope) : null),
    [hasTrack, envelope?.envelopeId, envelope?.title, envelope?.artist],
  );

  const resolveElapsedSeconds = usePlaybackResolveElapsed(audioState, envelope?.envelopeId);

  const mobileOfflineResolve =
    isAndroid() && hasActiveMobileResolvers() && preferFreshMobileResolve();
  const streamLabel = envelope
    ? mobileOfflineResolve
      ? 'MOBILE'
      : displayTransportLabel(
          envelope.provider,
          envelope.transport,
          envelope.url,
          envelope.resolutionSource,
        )
    : null;
  const qualityLabel =
    resolvePlaybackFidelityLabel(envelope, {
      streamLabel,
      t,
      policy: loadFidelityPolicy(),
    }) ?? undefined;

  useEffect(() => {
    const sync = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplay);
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  const handleShare = async () => {
    const text = artist ? `${title} — ${artist}` : title;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title, text });
        return;
      }
    } catch {
      /* user cancelled or unsupported */
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  };

  const [sheetMounted, setSheetMounted] = useState(open);
  const [sheetActive, setSheetActive] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const dragStartY = useRef(0);
  const dragStartT = useRef(0);
  const dragOffset = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLButtonElement>(null);

  const resetSheetTransform = useCallback(() => {
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
    }
    if (backdropRef.current) {
      backdropRef.current.style.opacity = '';
    }
    dragOffset.current = 0;
    setSheetDragging(false);
  }, []);

  useEffect(() => {
    if (open) {
      setSheetMounted(true);
      dragOffset.current = 0;
      setSheetDragging(false);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setSheetActive(true));
      });
      return () => window.cancelAnimationFrame(id);
    }
    setSheetActive(false);
    resetSheetTransform();
    const timer = window.setTimeout(() => setSheetMounted(false), 360);
    return () => window.clearTimeout(timer);
  }, [open, resetSheetTransform]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== 'hidden') return;
      resetSheetTransform();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [resetSheetTransform]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  useDismissableOverlay(open, handleClose);

  const onSheetDragStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0]?.clientY ?? 0;
    dragStartT.current = Date.now();
    dragOffset.current = 0;
    setSheetDragging(true);
  };

  const onSheetDragMove = (e: React.TouchEvent) => {
    const y = e.touches[0]?.clientY ?? dragStartY.current;
    const delta = Math.max(0, y - dragStartY.current);
    dragOffset.current = delta;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translate3d(0, ${delta}px, 0)`;
    }
    if (backdropRef.current) {
      const fade = Math.max(0, 1 - delta / 280);
      backdropRef.current.style.opacity = String(fade);
    }
  };

  const onSheetDragEnd = () => {
    const delta = dragOffset.current;
    const velocity = verticalPanVelocity(delta, Date.now() - dragStartT.current);
    if (shouldCollapseFromDownwardPan(delta, velocity)) {
      handleClose();
      return;
    }
    resetSheetTransform();
  };

  if (!sheetMounted) return null;

  const playFeatured = () => {
    if (isBusy) return;
    onTogglePlay();
  };

  return (
    <>
      <button
        ref={backdropRef}
        type="button"
        className={`mobile-np-backdrop${sheetActive ? ' mobile-np-backdrop--open' : ''}`}
        aria-label={t('nowPlaying.close')}
        onClick={handleClose}
        tabIndex={-1}
      />
      <div
        ref={sheetRef}
        className={`mobile-now-playing mobile-now-playing--sheet mobile-now-playing--unified home-view home-view--stack home-view--active home-view--track-glow home-view--hypnotic-lite home-view--expanded${
          sheetActive ? ' mobile-now-playing--sheet-open' : ''
        }${sheetDragging ? ' mobile-now-playing--sheet-dragging' : ''}${
          !isPodcast && vinylSettingsOpen ? ' mobile-now-playing--vinyl-settings-open' : ''
        }${!isPodcast && showShades ? ' home-view--shades' : ''}${
          !isPodcast && genreBucket ? ` home-genre-${genreBucket}` : ''
        }${!isPodcast && vinylClass ? ` ${vinylClass}` : ''}${
          !isPodcast ? artUniverseClass : ''
        }${isPodcast ? ' mobile-now-playing--podcast' : ''}`}
        style={isPodcast ? undefined : trackGlowStyle}
        role="dialog"
        aria-modal="true"
        aria-label={t('nowPlaying.title')}
        data-genre-bucket={genreBucket ?? undefined}
      >
        <div
          className="mobile-np-drag-zone"
          onTouchStart={onSheetDragStart}
          onTouchMove={onSheetDragMove}
          onTouchEnd={onSheetDragEnd}
          onTouchCancel={onSheetDragEnd}
        >
          <div className="mobile-np-drag-handle" aria-hidden>
            <span />
          </div>
          <header className="mobile-np-header mobile-np-header--unified mobile-np-header--tidal">
            <button
              type="button"
              className="mobile-np-icon-btn touch-manipulation"
              onClick={onOpenProfile}
              aria-label={t('shell.profile', { name: profileName })}
              title={profileName}
            >
              <User className="w-5 h-5" strokeWidth={2} />
            </button>

            <div className="mobile-np-header-center">
              <button
                type="button"
                className="mobile-np-icon-btn touch-manipulation mobile-np-collapse-btn"
                onClick={handleClose}
                aria-label={t('nowPlaying.close')}
              >
                <ChevronDown className="w-6 h-6" strokeWidth={2} />
              </button>
            </div>

            <div className="mobile-np-header-actions">
              <button
                type="button"
                className={`mobile-np-icon-btn touch-manipulation${castState.isActive ? ' mobile-np-icon-btn--active' : ''}`}
                onClick={onOpenCast}
                aria-label={t('player.menu.cast')}
              >
                <Cast className="w-5 h-5" strokeWidth={2} />
              </button>
            </div>
          </header>
        </div>

        <main className="mobile-np-main mobile-np-main--unified">
          <HomeHeroPlayer
            title={title}
            artist={artist}
            album={album}
            albumArt={albumArt}
            state={
              audioState !== 'Idle' && audioState !== 'Failed'
                ? audioState
                : isPlaying
                  ? 'Playing'
                  : hasTrack
                    ? 'Ready'
                    : 'Idle'
            }
            isPlaying={isPlaying}
            hasLoadedTrack={hasTrack}
            trueIdle={trueIdle}
            currentTimeSeconds={currentTimeSeconds}
            durationSeconds={durationSeconds}
            onTogglePlay={onTogglePlay}
            onPlayFeatured={playFeatured}
            onRestart={onRestart ?? (() => onSeek(0))}
            onSeek={onSeek}
            onScrubStart={onScrubStart}
            onScrubEnd={onScrubEnd}
            expanded
            onGoToArtist={onGoToArtist}
            onGoToAlbum={onGoToAlbum}
            envelope={envelope}
            showMobileShell={showMobileShell}
            inlineVinylSettings={false}
            flipOnArtworkTap={!isPodcast}
            heroDisplayMode={heroDisplay}
            onHeroDisplayModeChange={setHeroDisplay}
            onSkipBack={onSkipBack}
            onSkipForward={onSkipForward}
            onShuffleToggle={onShuffleToggle}
            shuffleOn={shuffleOn}
            onRepeatCycle={onRepeatCycle}
            repeatMode={repeatMode}
            fidelityLabel={qualityLabel}
            resolveElapsedSeconds={resolveElapsedSeconds}
            onCancelResolve={onCancelResolve}
            moreMenu={{
              sleepTimerOpen,
              sleepTimerLabel,
              onToggleSleepTimer: onToggleSleepTimer ?? (() => {}),
              castActive: castState.isActive,
              onOpenCastPicker: onOpenCast,
              onEnterCarMode,
              mixRadioEnabled,
              onArtistMix,
              onTrackRadio,
              mixRadioSession,
              saveMixRadioEnabled,
              onSaveMixRadioToPlaylist,
              resumeQueueCount,
              onResumeQueue,
              downloadEnabled,
              onDownloadTrack,
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
            }}
          />
          {stemSliders && !stemSliders.blocked ? (
            <div className="px-4 pb-2">
              <StemSlidersPanel {...stemSliders} />
            </div>
          ) : null}
          {isPodcast && onSkipPodcastAd ? (
            <div className="mobile-np-podcast-controls-wrap pb-2">
              <PodcastPlayerControls
                onSkipAd={onSkipPodcastAd}
                skipAdHint={podcastSkipAdHint}
              />
            </div>
          ) : null}
        </main>

        <footer
          className={`mobile-np-footer mobile-np-footer--unified mobile-np-footer--tidal${isPodcast ? ' mobile-np-footer--podcast' : ''}`}
        >
          <div className="mobile-np-footer-leading">
            {onOpenQueue ? (
              <button
                type="button"
                className="mobile-np-icon-btn touch-manipulation"
                onClick={onOpenQueue}
                aria-label={t('player.queue')}
              >
                <ListMusic className="w-5 h-5" strokeWidth={2} />
              </button>
            ) : (
              <span className="mobile-np-footer-spacer" aria-hidden />
            )}
          </div>
          <div className="mobile-np-footer-context">
            {!isPodcast ? (
              <span className="mobile-np-playing-from">{playingFromLabel}</span>
            ) : null}
          </div>
          <div className="mobile-np-footer-actions">
            {isPodcast && hasPodcastChapters && onOpenPodcastChapters ? (
              <button
                type="button"
                className="mobile-np-lyrics-pill touch-manipulation"
                onClick={onOpenPodcastChapters}
              >
                Chapters
              </button>
            ) : !isPodcast ? (
              <button
                type="button"
                className="mobile-np-lyrics-pill touch-manipulation"
                onClick={onOpenLyrics}
              >
                {t('nowPlaying.lyrics')}
              </button>
            ) : null}
            {!isPodcast ? (
              <button
                type="button"
                className="mobile-np-icon-btn touch-manipulation"
                onClick={() => setVinylSettingsOpen(true)}
                aria-label="Vinyl & colour"
                title="Vinyl & colour"
              >
                <Palette className="w-5 h-5" strokeWidth={2} />
              </button>
            ) : null}
            {onThumbUp ? (
              <button
                type="button"
                className={`mobile-np-icon-btn touch-manipulation${thumbUp ? ' mobile-np-icon-btn--active' : ''}`}
                onClick={onThumbUp}
                aria-label={t('player.thumbsUp')}
                aria-pressed={thumbUp}
                data-thumb="up"
                data-thumb-active={thumbUp ? 'true' : 'false'}
              >
                <ThumbsUp
                  className={`w-5 h-5${thumbUp ? ' fill-current' : ''}`}
                  strokeWidth={2}
                />
              </button>
            ) : null}
            {onThumbDown ? (
              <button
                type="button"
                className={`mobile-np-icon-btn touch-manipulation${thumbDown ? ' mobile-np-icon-btn--active' : ''}`}
                onClick={onThumbDown}
                aria-label={t('player.thumbsDown')}
                aria-pressed={thumbDown}
                data-thumb="down"
                data-thumb-active={thumbDown ? 'true' : 'false'}
              >
                <ThumbsDown
                  className={`w-5 h-5${thumbDown ? ' fill-current' : ''}`}
                  strokeWidth={2}
                />
              </button>
            ) : null}
            <button
              type="button"
              className="mobile-np-icon-btn touch-manipulation"
              onClick={() => void handleShare()}
              aria-label={t('nowPlaying.share')}
            >
              <Share2 className="w-5 h-5" strokeWidth={2} />
            </button>
          </div>
        </footer>

        {!isPodcast ? (
          <MobileHomeVinylSettingsSheet
            open={vinylSettingsOpen}
            onClose={() => setVinylSettingsOpen(false)}
          />
        ) : null}

        {castState.isActive && castState.deviceName ? (
          <p className="mobile-np-cast-label">
            {t('player.castingTo', { device: castState.deviceName })}
          </p>
        ) : null}
      </div>
    </>
  );
}
