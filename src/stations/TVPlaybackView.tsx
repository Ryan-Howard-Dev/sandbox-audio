import React, { useEffect, useRef, useState } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Cast,
  ListOrdered,
  Loader2,
} from 'lucide-react';
import type { AudioFsmState, MediaEnvelope } from '../sandboxLayer1';
import { proxiedArtworkUrl } from '../displaySanitize';
import { applyHeroDisplayFromSettingsEvent, loadHeroDisplayMode, resolveHeroShowShades } from '../heroDisplaySettings';
import { seedGradientUniverseStyle } from '../seedGradient';
import { useTrackUniverseStyle } from '../hooks/useTrackUniverseStyle';
import { useVinylVisualStyle } from '../vinylVisualSettings';
import VinylHero from '../components/VinylHero';
import { formatTime } from './theme';

export interface TVPlaybackViewProps {
  title: string;
  artist: string;
  album?: string;
  albumArt: string;
  state: AudioFsmState;
  isPlaying: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  shuffleOn: boolean;
  repeatMode: 'none' | 'one' | 'all';
  queueCount: number;
  castActive: boolean;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onShuffleToggle: () => void;
  onRepeatCycle: () => void;
  onSeek: (seconds: number) => void;
  onOpenQueue: () => void;
  onOpenCast: () => void;
  onBack: () => void;
  /** Current track — genre-based vinyl visuals when Follow genre is on. */
  envelope?: MediaEnvelope | null;
}

export default function TVPlaybackView({
  title,
  artist,
  album,
  albumArt,
  state,
  isPlaying,
  currentTimeSeconds,
  durationSeconds,
  shuffleOn,
  repeatMode,
  queueCount,
  castActive,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  onShuffleToggle,
  onRepeatCycle,
  onSeek,
  onOpenQueue,
  onOpenCast,
  onBack: _onBack,
  envelope = null,
}: TVPlaybackViewProps) {
  void _onBack;
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const duration = durationSeconds > 0 ? durationSeconds : 1;
  const progress = Math.min(100, (currentTimeSeconds / duration) * 100);
  const isBusy = state === 'Resolving' || state === 'Connecting';
  const art = proxiedArtworkUrl(albumArt) ?? albumArt;
  const hasArt = Boolean(art?.trim());
  const gradientSeed = title?.trim() || album?.trim() || artist?.trim() || 'Sandbox';

  const [heroDisplay, setHeroDisplay] = useState(loadHeroDisplayMode);
  const showShades = resolveHeroShowShades(heroDisplay, hasArt);
  const pausedSpin =
    !isPlaying && (state === 'Ready' || state === 'Connecting') && Boolean(title?.trim());
  const hasTrack = Boolean(title?.trim());
  const { cssVars: vinylCssVars, vinylClass } = useVinylVisualStyle(envelope);
  const { universeStyle, isArtDriven, isMonochrome } = useTrackUniverseStyle(
    hasArt ? art : undefined,
    gradientSeed,
  );
  const trackStyle = hasTrack
    ? { ...universeStyle, ...vinylCssVars }
    : seedGradientUniverseStyle(gradientSeed);
  const artUniverseClass =
    hasTrack && isArtDriven
      ? ` home-vinyl-universe--art-driven${isMonochrome ? ' home-vinyl-universe--art-monochrome' : ''}`
      : '';

  useEffect(() => {
    const sync = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplay);
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  useEffect(() => {
    playBtnRef.current?.focus();
  }, []);

  const btnClass =
    'tv-playback-btn flex items-center justify-center w-16 h-16 rounded-2xl border-2 border-transparent bg-[#111420] text-text-primary outline-none transition-all duration-200 focus:border-[#C2410C] focus:ring-4 focus:ring-[#C2410C]/35 focus:scale-110 disabled:opacity-40';

  return (
    <div
      className={`tv-playback flex flex-col flex-1 min-h-0 items-center justify-center px-12 py-10 gap-10 ${
        isPlaying ? 'tv-playback--hypnotic tv-playback--playing' : ''
      }`}
      style={isPlaying ? trackStyle : undefined}
    >
      <div className="tv-playback-hero flex flex-col lg:flex-row items-center gap-12 w-full max-w-6xl">
        <div
          className={`vinyl-universe--tv home-vinyl-universe shrink-0${
            isPlaying ? ' vinyl-universe--active home-vinyl-universe--active' : ''
          }${showShades ? ' vinyl-universe--shades home-vinyl-universe--shades' : ''}${
            vinylClass ? ` ${vinylClass}` : ''
          }${artUniverseClass}`}
          style={trackStyle}
          aria-hidden={false}
        >
          <VinylHero
            title={gradientSeed}
            artworkUrl={art}
            playing={isPlaying}
            pausedSpin={pausedSpin}
            showShades={showShades}
            size="tv"
            discClassName={vinylClass}
            discStyle={trackStyle}
          />
        </div>

        <div className="flex flex-col items-center lg:items-start text-center lg:text-left min-w-0 flex-1 gap-4 relative z-10">
          <p className="font-mono text-xs uppercase tracking-[0.35em] text-[#C2410C]">Now Playing</p>
          <h1 className="font-display text-4xl lg:text-5xl font-black text-text-heading leading-tight truncate max-w-full">
            {title || 'No Track'}
          </h1>
          <p className="text-2xl text-[#9aa3bc] truncate max-w-full">{artist || '—'}</p>
          {album ? (
            <p className="text-lg text-[#6e758c] truncate max-w-full">{album}</p>
          ) : null}

          <div className="w-full max-w-xl mt-4 space-y-2">
            <input
              type="range"
              min={0}
              max={100}
              step={0.5}
              value={progress}
              onChange={(e) => {
                const pct = parseFloat(e.target.value) / 100;
                onSeek(pct * duration);
              }}
              className="tv-playback-scrub w-full h-2 accent-[#C2410C] cursor-pointer"
              aria-label="Seek"
            />
            <div className="flex justify-between font-mono text-sm text-[#6e758c]">
              <span>{formatTime(currentTimeSeconds)}</span>
              <span>{formatTime(durationSeconds)}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="tv-playback-controls flex flex-wrap items-center justify-center gap-4 relative z-10">
        <button
          type="button"
          onClick={onShuffleToggle}
          className={`${btnClass} ${shuffleOn ? 'text-[#C2410C] border-[#C2410C]/40' : ''}`}
          aria-label="Shuffle"
        >
          <Shuffle className="w-7 h-7" strokeWidth={2} />
        </button>
        <button type="button" onClick={onSkipBack} className={btnClass} aria-label="Previous">
          <SkipBack className="w-8 h-8" strokeWidth={2} />
        </button>
        <button
          ref={playBtnRef}
          type="button"
          onClick={onTogglePlay}
          disabled={state === 'Idle'}
          className={`${btnClass} w-20 h-20 bg-[#C2410C] text-text-on-accent focus:ring-[#C2410C]/50`}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isBusy ? (
            <Loader2 className="w-9 h-9 animate-spin" strokeWidth={2} />
          ) : isPlaying ? (
            <Pause className="w-9 h-9" strokeWidth={2} />
          ) : (
            <Play className="w-9 h-9 ml-1" strokeWidth={2} />
          )}
        </button>
        <button type="button" onClick={onSkipForward} className={btnClass} aria-label="Next">
          <SkipForward className="w-8 h-8" strokeWidth={2} />
        </button>
        <button
          type="button"
          onClick={onRepeatCycle}
          className={`${btnClass} relative ${repeatMode !== 'none' ? 'text-[#C2410C] border-[#C2410C]/40' : ''}`}
          aria-label="Repeat"
        >
          <Repeat className="w-7 h-7" strokeWidth={2} />
          {repeatMode === 'one' ? (
            <span className="absolute top-1 right-2 text-xs font-bold text-[#C2410C]">1</span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onOpenQueue}
          className={`${btnClass} relative`}
          aria-label="Queue"
        >
          <ListOrdered className="w-7 h-7" strokeWidth={2} />
          {queueCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[1.25rem] h-5 px-1 rounded-full bg-[#C2410C] text-[10px] font-bold flex items-center justify-center">
              {queueCount > 99 ? '99+' : queueCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={onOpenCast}
          className={`${btnClass} ${castActive ? 'text-[#C2410C] border-[#C2410C]/40' : ''}`}
          aria-label="Cast"
        >
          <Cast className="w-7 h-7" strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
