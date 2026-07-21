import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronDown,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  Shuffle,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
} from 'lucide-react';
import type { RepeatMode } from '../queuePersistence';
import MobileHomeVinylSettingsSheet from '../mobile/MobileHomeVinylSettingsSheet';
import { shouldShowMobileHomeVinylSettings } from '../mobile/mobileHomeVinylLogic';
import type { AudioFsmState, MediaEnvelope } from '../sandboxLayer1';
import {
  applyHeroDisplayFromSettingsEvent,
  loadHeroDisplayMode,
  resolveHeroShowShades,
  type HeroDisplayMode,
  toggleHeroDisplayMode,
} from '../heroDisplaySettings';
import { displayHeroArtist, shouldShowAlbumPoster } from '../homeHeroPlayerLogic';
import {
  playbackArtStabilizeScope,
  resolvePlaybackCoverArt,
  resolvePlaybackCoverArtFallback,
  stabilizePlaybackArtSrc,
} from '../playerBarTrackMeta';
import { useVerticalPanExpand } from '../mobile/useVerticalPanExpand';
import { seedGradient } from '../seedGradient';
import { getGenreBucketForTrack } from '../vinylGenreThemes';
import { useTrackUniverseStyle } from '../hooks/useTrackUniverseStyle';
import { useVinylVisualStyle } from '../vinylVisualSettings';
import VinylHero, { type VinylHeroSize } from './VinylHero';
import PlayerArtistLink from './PlayerArtistLink';
import PlayerBarMoreMenu, { type PlayerBarMoreMenuProps } from './PlayerBarMoreMenu';
import ResolvingPlaybackBanner from './ResolvingPlaybackBanner';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { formatTime } from '../stations/theme';
import { useTranslation } from '../i18n';
import { tapHaptic } from '../uiTapFeedback';

export type HomeHeroMoreMenuConfig = Omit<
  PlayerBarMoreMenuProps,
  'open' | 'onOpenChange' | 'displayMode'
>;

type HomeProgressSliderProps = {
  duration: number;
  durationSeconds: number;
  currentTimeSeconds: number;
  progress: number;
  onSeek: (seconds: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  blockClassName?: string;
  sliderClassName?: string;
  timesClassName?: string;
  timesPosition?: 'above' | 'below';
  fidelityRow?: React.ReactNode;
  ariaLabel: string;
};

function scrubValueFromPointer(input: HTMLInputElement, clientX: number): number {
  const rect = input.getBoundingClientRect();
  if (rect.width <= 0) return parseFloat(input.value);
  const min = parseFloat(input.min) || 0;
  const max = parseFloat(input.max) || 100;
  const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  return min + ratio * (max - min);
}

function HomeProgressSlider({
  duration,
  durationSeconds,
  currentTimeSeconds,
  progress,
  onSeek,
  onScrubStart,
  onScrubEnd,
  blockClassName = 'home-progress-block',
  sliderClassName = 'home-progress-slider',
  timesClassName = 'home-progress-times',
  timesPosition = 'above',
  fidelityRow,
  ariaLabel,
}: HomeProgressSliderProps) {
  const [scrubValue, setScrubValue] = useState(progress);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const scrubbingRef = useRef(false);
  const committedRef = useRef(false);
  const scrubRafRef = useRef<number | null>(null);
  const lastScrubValueRef = useRef(progress);
  const activePointerIdRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isScrubbing) {
      setScrubValue(progress);
      lastScrubValueRef.current = progress;
    }
  }, [progress, isScrubbing]);

  const displayTime =
    isScrubbing && duration > 0 ? (scrubValue / 100) * duration : currentTimeSeconds;

  const scheduleScrubVisual = (value: number) => {
    if (scrubRafRef.current !== null) cancelAnimationFrame(scrubRafRef.current);
    scrubRafRef.current = requestAnimationFrame(() => {
      scrubRafRef.current = null;
      setScrubValue(value);
    });
  };

  const applyScrubValue = (input: HTMLInputElement, value: number) => {
    const clamped = Math.max(0, Math.min(100, value));
    lastScrubValueRef.current = clamped;
    input.value = String(clamped);
    scheduleScrubVisual(clamped);
  };

  const handleScrubInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!scrubbingRef.current) return;
    applyScrubValue(e.target, parseFloat(e.target.value));
  };

  const startScrub = (e: React.PointerEvent<HTMLInputElement>) => {
    committedRef.current = false;
    scrubbingRef.current = true;
    activePointerIdRef.current = e.pointerId;
    setIsScrubbing(true);
    onScrubStart?.();
    applyScrubValue(e.currentTarget, scrubValueFromPointer(e.currentTarget, e.clientX));
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* optional — improves Android drag delivery */
    }
  };

  const moveScrub = (e: React.PointerEvent<HTMLInputElement>) => {
    if (!scrubbingRef.current || e.buttons === 0) return;
    applyScrubValue(e.currentTarget, scrubValueFromPointer(e.currentTarget, e.clientX));
  };

  const commitScrub = (input: HTMLInputElement) => {
    if (!scrubbingRef.current || committedRef.current) return;
    committedRef.current = true;
    scrubbingRef.current = false;
    activePointerIdRef.current = null;
    const v = lastScrubValueRef.current;
    setScrubValue(v);
    setIsScrubbing(false);
    if (duration > 0) onSeek((v / 100) * duration);
    onScrubEnd?.();
  };

  const cancelScrub = () => {
    if (!scrubbingRef.current) return;
    scrubbingRef.current = false;
    committedRef.current = false;
    activePointerIdRef.current = null;
    setIsScrubbing(false);
    setScrubValue(progress);
    lastScrubValueRef.current = progress;
    onScrubEnd?.();
  };

  const finishScrubPointer = (e: React.PointerEvent<HTMLInputElement>) => {
    commitScrub(e.currentTarget);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLInputElement>) => {
    // Android WebView often ends drags via lostpointercapture instead of pointerup.
    if (
      scrubbingRef.current &&
      !committedRef.current &&
      activePointerIdRef.current === e.pointerId
    ) {
      commitScrub(e.currentTarget);
    }
    activePointerIdRef.current = null;
  };

  const times = (
    <div className={timesClassName}>
      <span>{formatTime(displayTime)}</span>
      <span>{formatTime(durationSeconds)}</span>
    </div>
  );

  return (
    <div className={blockClassName}>
      {fidelityRow}
      {timesPosition === 'above' ? times : null}
      <input
        type="range"
        min={0}
        max={100}
        step={0.1}
        value={scrubValue}
        onChange={handleScrubInput}
        onInput={handleScrubInput}
        onPointerDown={startScrub}
        onPointerMove={moveScrub}
        onPointerUp={finishScrubPointer}
        onPointerCancel={cancelScrub}
        onLostPointerCapture={handleLostPointerCapture}
        className={`${sliderClassName} touch-manipulation`}
        aria-label={ariaLabel}
      />
      {timesPosition === 'below' ? times : null}
    </div>
  );
}

export interface HomeHeroPlayerProps {
  title: string;
  artist: string;
  album?: string;
  albumArt: string;
  state: AudioFsmState;
  isPlaying: boolean;
  hasLoadedTrack: boolean;
  trueIdle: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  onTogglePlay: () => void;
  onPlayFeatured: () => void;
  onRestart: () => void;
  onSeek: (seconds: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  compact?: boolean;
  expanded?: boolean;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
  envelope?: MediaEnvelope | null;
  onExpand?: () => void;
  onCollapse?: () => void;
  showMobileShell?: boolean;
  vinylSize?: VinylHeroSize;
  className?: string;
  /** When set, overrides internal hero display prefs (mobile home sync). */
  heroDisplayMode?: HeroDisplayMode;
  /** Synchronous parent sync when the home vinyl toggle is tapped. */
  onHeroDisplayModeChange?: (mode: HeroDisplayMode) => void;
  onSkipBack?: () => void;
  onSkipForward?: () => void;
  moreMenu?: HomeHeroMoreMenuConfig;
  shuffleOn?: boolean;
  onShuffleToggle?: () => void;
  repeatMode?: RepeatMode;
  onRepeatCycle?: () => void;
  /** Centered under progress bar (Tidal-style now playing). */
  fidelityLabel?: string;
  resolveElapsedSeconds?: number;
  onCancelResolve?: () => void;
  /** Render the floating album/vinyl toggle over the artwork. Default true (home). */
  inlineVinylSettings?: boolean;
  /** Tap the artwork to flip album cover ↔ vinyl (expanded now-playing). */
  flipOnArtworkTap?: boolean;
}

export default function HomeHeroPlayer({
  title,
  artist,
  album,
  albumArt,
  state,
  isPlaying,
  hasLoadedTrack,
  trueIdle,
  currentTimeSeconds,
  durationSeconds,
  onTogglePlay,
  onPlayFeatured,
  onRestart,
  onSeek,
  onScrubStart,
  onScrubEnd,
  compact = false,
  expanded = false,
  onGoToArtist,
  onGoToAlbum,
  envelope = null,
  onExpand,
  onCollapse,
  showMobileShell = false,
  vinylSize,
  className = '',
  heroDisplayMode: heroDisplayModeProp,
  onHeroDisplayModeChange,
  onSkipBack,
  onSkipForward,
  moreMenu,
  shuffleOn = false,
  onShuffleToggle,
  repeatMode = 'none',
  onRepeatCycle,
  fidelityLabel,
  resolveElapsedSeconds = 0,
  onCancelResolve,
  inlineVinylSettings = true,
  flipOnArtworkTap = false,
}: HomeHeroPlayerProps) {
  const { t } = useTranslation();
  const [vinylSettingsOpen, setVinylSettingsOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [optimisticPlaying, setOptimisticPlaying] = useState<boolean | null>(null);
  const displayIsPlaying = optimisticPlaying ?? isPlaying;

  useEffect(() => {
    if (optimisticPlaying === null) return;
    if (optimisticPlaying === isPlaying) {
      setOptimisticPlaying(null);
    }
  }, [isPlaying, optimisticPlaying]);

  const handleHeroTogglePlay = () => {
    tapHaptic();
    if (hasLoadedTrack) {
      setOptimisticPlaying(!displayIsPlaying);
      onTogglePlay();
      return;
    }
    onPlayFeatured();
  };
  const displayArt = resolvePlaybackCoverArt(albumArt, envelope);
  const [posterArtSrc, setPosterArtSrc] = useState(displayArt);
  const hasArt = Boolean((displayArt || posterArtSrc)?.trim());
  const [heroDisplayLocal, setHeroDisplayLocal] = useState(loadHeroDisplayMode);
  const heroDisplay = heroDisplayModeProp ?? heroDisplayLocal;
  const isPodcast = Boolean(
    envelope?.envelopeId && isPodcastEnvelopeId(envelope.envelopeId),
  );
  const effectiveHeroDisplay = isPodcast ? 'album-cover' : heroDisplay;
  const showAlbumPoster = shouldShowAlbumPoster(effectiveHeroDisplay, hasArt, trueIdle);
  const showShades = isPodcast
    ? false
    : resolveHeroShowShades(effectiveHeroDisplay, hasArt, { idleHome: trueIdle });
  const gradientSeed = title?.trim() || album?.trim() || 'Sandbox';
  const heroArtist = displayHeroArtist(artist, album);
  const duration = durationSeconds > 0 ? durationSeconds : 0;
  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTimeSeconds / duration) * 100))
      : currentTimeSeconds > 0
        ? 1
        : 0;
  const pausedSpin =
    !isPlaying && state === 'Ready' && hasLoadedTrack;
  const vinylActive = hasLoadedTrack;
  const { cssVars: vinylCssVars, vinylClass } = useVinylVisualStyle(envelope);
  const { universeStyle, isArtDriven, isMonochrome } = useTrackUniverseStyle(
    hasArt ? displayArt : undefined,
    gradientSeed,
  );
  const genreBucket = useMemo(
    () => (trueIdle ? null : getGenreBucketForTrack(envelope)),
    [trueIdle, envelope?.envelopeId, envelope?.title, envelope?.artist],
  );
  const resolvedVinylSize = vinylSize ?? (compact ? 'compact' : 'home');
  const hideResolveBanner =
    expanded ||
    Boolean(envelope?.envelopeId && isPodcastEnvelopeId(envelope.envelopeId));

  useEffect(() => {
    const scope = playbackArtStabilizeScope(envelope);
    setPosterArtSrc((prev) => stabilizePlaybackArtSrc(prev, displayArt, scope));
  }, [displayArt, envelope]);

  useEffect(() => {
    if (heroDisplayModeProp != null) return;
    const sync = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplayLocal);
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, [heroDisplayModeProp]);

  useEffect(() => {
    const openFromE2e = () => setVinylSettingsOpen(true);
    window.addEventListener('sandbox-e2e-open-vinyl-settings', openFromE2e);
    return () => window.removeEventListener('sandbox-e2e-open-vinyl-settings', openFromE2e);
  }, []);

  const trackGlowStyle = !trueIdle
    ? { ...universeStyle, ...vinylCssVars }
    : undefined;
  const artUniverseClass =
    !trueIdle && isArtDriven
      ? ` home-vinyl-universe--art-driven${isMonochrome ? ' home-vinyl-universe--art-monochrome' : ''}`
      : '';
  const showVinylSettings =
    inlineVinylSettings &&
    shouldShowMobileHomeVinylSettings(showMobileShell, hasLoadedTrack, trueIdle);
  const canCollapse = Boolean(onCollapse && expanded);
  const toggleHeroDisplay = () => {
    const next = toggleHeroDisplayMode();
    setHeroDisplayLocal(next);
    onHeroDisplayModeChange?.(next);
  };
  const flipEnabled = Boolean(
    flipOnArtworkTap && expanded && !compact && hasLoadedTrack && !isPodcast,
  );
  const heroDisplayToggleLabel = showAlbumPoster
    ? t('settings.architect.heroDisplayVinylShades')
    : t('settings.architect.heroDisplayAlbumCover');
  const showHeroTransport =
    showMobileShell &&
    hasLoadedTrack &&
    !trueIdle &&
    (onSkipBack ||
      onSkipForward ||
      moreMenu ||
      onShuffleToggle ||
      onRepeatCycle);
  const tidalNowPlaying = expanded && showMobileShell && !compact;
  const compactExpand = useVerticalPanExpand({
    enabled: Boolean(compact && onExpand),
    onExpand: () => onExpand?.(),
  });

  return (
    <div
      className={`home-center-column${expanded ? ' home-center-column--expanded' : ''}${
        tidalNowPlaying ? ' home-center-column--tidal-np' : ''
      } ${className}`.trim()}
    >
      <div
        className="home-hero-stage"
        onClick={
          compact && onExpand
            ? (e) => {
                if (compactExpand.consumeSwipeClick()) {
                  e.preventDefault();
                  e.stopPropagation();
                  return;
                }
                onExpand();
              }
            : flipEnabled
              ? () => toggleHeroDisplay()
              : undefined
        }
        onTouchStart={compact ? compactExpand.onTouchStart : undefined}
        onTouchMove={compact ? compactExpand.onTouchMove : undefined}
        onTouchEnd={compact ? compactExpand.onTouchEnd : undefined}
        onKeyDown={
          compact && onExpand
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onExpand();
                }
              }
            : flipEnabled
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    toggleHeroDisplay();
                  }
                }
              : undefined
        }
        role={(compact && onExpand) || flipEnabled ? 'button' : undefined}
        tabIndex={(compact && onExpand) || flipEnabled ? 0 : undefined}
        aria-label={
          compact && onExpand
            ? t('player.openNowPlaying')
            : flipEnabled
              ? heroDisplayToggleLabel
              : undefined
        }
      >
        {showVinylSettings ? (
          <span className="home-hero-stage-spacer" aria-hidden />
        ) : null}
        <div
          className={`home-vinyl-universe${
            vinylActive ? ' home-vinyl-universe--active' : ''
          }${showShades && !showAlbumPoster ? ' home-vinyl-universe--shades' : ''}${
            showAlbumPoster ? ' home-vinyl-universe--poster' : ''
          }${vinylClass ? ` ${vinylClass}` : ''}${artUniverseClass}${
            expanded ? ' home-vinyl-universe--expanded' : ''
          }`}
          style={trackGlowStyle}
        >
          {canCollapse ? (
            <button
              type="button"
              className="home-vinyl-collapse touch-manipulation"
              onClick={onCollapse}
              aria-label={t('nowPlaying.close')}
            >
              <ChevronDown className="w-5 h-5" strokeWidth={2} />
            </button>
          ) : null}
          {showAlbumPoster ? (
            <div className="home-hero-poster-wrap shrink-0" style={trackGlowStyle}>
              <img
                src={posterArtSrc}
                alt=""
                className="home-hero-poster"
                data-testid="home-hero-poster"
                onError={(e) => {
                  const retry = resolvePlaybackCoverArtFallback(
                    envelope,
                    posterArtSrc,
                    albumArt,
                  );
                  if (retry && retry !== posterArtSrc) {
                    setPosterArtSrc(retry);
                    return;
                  }
                  const img = e.currentTarget;
                  img.style.background = seedGradient(gradientSeed);
                  img.removeAttribute('src');
                }}
              />
            </div>
          ) : (
            <VinylHero
              title={gradientSeed}
              artworkUrl={trueIdle || !hasArt ? undefined : posterArtSrc}
              playing={isPlaying}
              pausedSpin={pausedSpin}
              showShades={showShades}
              size={resolvedVinylSize}
              discClassName={vinylClass}
              discStyle={trackGlowStyle}
              stabilizeScope={playbackArtStabilizeScope(envelope)}
            />
          )}
        </div>
        {showVinylSettings ? (
          <button
            type="button"
            onClick={() => setVinylSettingsOpen(true)}
            className="home-hero-display-toggle touch-manipulation"
            aria-label={t('home.vinylSettingsTitle')}
            aria-expanded={vinylSettingsOpen}
            data-testid="home-vinyl-settings-btn"
          >
            <SlidersHorizontal className="w-4 h-4" strokeWidth={2} />
          </button>
        ) : null}
      </div>

      {trueIdle ? (
        <p className="home-idle-welcome">{t('home.welcomeTagline')}</p>
      ) : (
        <div className="home-featured-meta">
          {!hideResolveBanner && state === 'Resolving' ? (
            <div className="home-connecting-banner-slot home-connecting-banner-slot--visible">
              <ResolvingPlaybackBanner
                state={state}
                elapsedSeconds={resolveElapsedSeconds}
                onCancel={onCancelResolve}
                compact={compact}
              />
            </div>
          ) : null}
          <h1 className="home-hero-title">{title}</h1>
          {heroArtist ? (
            onGoToArtist ? (
              <PlayerArtistLink
                artist={heroArtist}
                album={album}
                onGoToArtist={onGoToArtist}
                onGoToAlbum={onGoToAlbum}
                className="home-hero-artist"
                align="center"
              />
            ) : (
              <p className="home-hero-artist">{heroArtist}</p>
            )
          ) : null}

          {!compact && (
            <>
              {tidalNowPlaying ? (
                <HomeProgressSlider
                  duration={duration}
                  durationSeconds={durationSeconds}
                  currentTimeSeconds={currentTimeSeconds}
                  progress={progress}
                  onSeek={onSeek}
                  onScrubStart={onScrubStart}
                  onScrubEnd={onScrubEnd}
                  blockClassName="home-progress-block home-progress-block--tidal"
                  timesClassName="home-progress-times home-progress-times--tidal"
                  timesPosition="below"
                  fidelityRow={
                    fidelityLabel ? (
                      <div className="home-progress-fidelity-row">
                        <span className="home-progress-fidelity">{fidelityLabel}</span>
                      </div>
                    ) : null
                  }
                  ariaLabel={t('home.progress')}
                />
              ) : null}
              <div className="home-controls-outer">
                <div
                  className={`home-controls-group${showHeroTransport ? ' home-controls-group--transport' : ''}${tidalNowPlaying ? ' home-controls-group--tidal' : ''}`}
                >
                  {showHeroTransport && onShuffleToggle ? (
                    <button
                      type="button"
                      onClick={onShuffleToggle}
                      className={`home-hero-transport-btn touch-manipulation${shuffleOn ? ' home-hero-transport-btn--active' : ''}`}
                      aria-label={t('player.shuffle')}
                    >
                      <Shuffle className="w-4 h-4" strokeWidth={2} />
                    </button>
                  ) : null}
                  {showHeroTransport && onSkipBack ? (
                    <button
                      type="button"
                      onClick={onSkipBack}
                      className="home-hero-transport-btn touch-manipulation"
                      aria-label={t('player.skipBack')}
                      data-testid="home-hero-skip-back"
                    >
                      <SkipBack className="w-4 h-4" strokeWidth={2} />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={handleHeroTogglePlay}
                    className={`home-console-play touch-manipulation${showHeroTransport ? ' home-console-play--transport' : ''}${tidalNowPlaying ? ' home-console-play--tidal' : ''}${optimisticPlaying !== null && optimisticPlaying !== isPlaying ? ' home-console-play--pending' : ''}`}
                    aria-label={displayIsPlaying ? t('player.pause') : t('player.play')}
                    aria-busy={optimisticPlaying !== null && optimisticPlaying !== isPlaying}
                  >
                    {displayIsPlaying ? (
                      <Pause className="w-4 h-4" strokeWidth={2.5} />
                    ) : (
                      <Play className="w-4 h-4" strokeWidth={2.5} />
                    )}
                    {!showHeroTransport ? (
                      <span>{displayIsPlaying ? t('home.pause') : t('home.play')}</span>
                    ) : null}
                  </button>
                  {showHeroTransport && onSkipForward ? (
                    <button
                      type="button"
                      onClick={onSkipForward}
                      className="home-hero-transport-btn touch-manipulation"
                      aria-label={t('player.skipForward')}
                      data-testid="home-hero-skip-forward"
                    >
                      <SkipForward className="w-4 h-4" strokeWidth={2} />
                    </button>
                  ) : null}
                  {showHeroTransport && onRepeatCycle ? (
                    <button
                      type="button"
                      onClick={onRepeatCycle}
                      className={`home-hero-transport-btn touch-manipulation relative${repeatMode !== 'none' ? ' home-hero-transport-btn--active' : ''}`}
                      aria-label={t('player.repeat')}
                    >
                      <Repeat className="w-4 h-4" strokeWidth={2} />
                      {repeatMode === 'one' ? (
                        <span className="home-hero-repeat-one">1</span>
                      ) : null}
                    </button>
                  ) : null}
                  {!showHeroTransport ? (
                    <button
                      type="button"
                      onClick={onRestart}
                      className="home-console-restart touch-manipulation"
                      aria-label={t('home.restart')}
                    >
                      <RotateCcw strokeWidth={2} className="w-4 h-4" />
                    </button>
                  ) : null}
                  {showHeroTransport && moreMenu ? (
                    <span className="home-hero-more-wrap">
                      <PlayerBarMoreMenu
                        open={moreMenuOpen}
                        onOpenChange={setMoreMenuOpen}
                        displayMode={heroDisplay}
                        {...moreMenu}
                      />
                    </span>
                  ) : null}
                </div>
              </div>

              {!tidalNowPlaying ? (
                <HomeProgressSlider
                  duration={duration}
                  durationSeconds={durationSeconds}
                  currentTimeSeconds={currentTimeSeconds}
                  progress={progress}
                  onSeek={onSeek}
                  onScrubStart={onScrubStart}
                  onScrubEnd={onScrubEnd}
                  ariaLabel={t('home.progress')}
                />
              ) : null}
            </>
          )}
        </div>
      )}
      {showVinylSettings || vinylSettingsOpen ? (
        <MobileHomeVinylSettingsSheet
          open={vinylSettingsOpen}
          onClose={() => setVinylSettingsOpen(false)}
        />
      ) : null}
    </div>
  );
}
