import React, { useEffect, useMemo, useState } from 'react';
import type { RepeatMode } from '../queuePersistence';
import HomeHeroPlayer, { type HomeHeroMoreMenuConfig } from '../components/HomeHeroPlayer';
import HomeIdleDiscovery, {
  type HomeIdleListeningPreview,
  type HomeIdleRecentItem,
} from '../components/HomeIdleDiscovery';
import type { AudioFsmState, MediaEnvelope } from '../sandboxLayer1';
import StemSlidersPanel, { type StemSlidersPanelProps } from '../components/StemSlidersPanel';
import { proxiedArtworkUrl } from '../displaySanitize';
import {
  applyHeroDisplayFromSettingsEvent,
  loadHeroDisplayMode,
  resolveHeroShowShades,
} from '../heroDisplaySettings';
import { getGenreBucketForTrack } from '../vinylGenreThemes';
import { useTrackUniverseStyle } from '../hooks/useTrackUniverseStyle';
import { useVinylVisualStyle } from '../vinylVisualSettings';

export interface HomeViewProps {
  title: string;
  artist: string;
  album?: string;
  albumArt: string;
  state: AudioFsmState;
  isPlaying: boolean;
  hasLoadedTrack: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  onTogglePlay: () => void;
  onPlayFeatured: () => void;
  onRestart: () => void;
  onSeek: (seconds: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  compact?: boolean;
  onGoToArtist?: (artist: string) => void;
  onGoToAlbum?: (artist: string, album: string) => void;
  envelope?: MediaEnvelope | null;
  /** Mobile: tap vinyl/meta to open full now playing. */
  onOpenNowPlaying?: () => void;
  /** Mobile: collapse inline expanded hero. */
  onCloseNowPlaying?: () => void;
  /** Mobile shell: inline expanded hero (same page, no overlay). */
  expanded?: boolean;
  showMobileShell?: boolean;
  onSkipBack?: () => void;
  onSkipForward?: () => void;
  moreMenu?: HomeHeroMoreMenuConfig;
  shuffleOn?: boolean;
  onShuffleToggle?: () => void;
  repeatMode?: RepeatMode;
  onRepeatCycle?: () => void;
  fidelityLabel?: string;
  resolveElapsedSeconds?: number;
  onCancelResolve?: () => void;
  idleDiscovery?: {
    recentItems: HomeIdleRecentItem[];
    queueCount: number;
    listening: HomeIdleListeningPreview;
    onOpenInsights: () => void;
    onOpenPlaylistsPrompt?: () => void;
    onPlayRecent?: (id: string) => void;
    onResumeQueue?: () => void;
  };
  /** Desktop home: server-cached stem mix sliders (Phase E). */
  stemSliders?: StemSlidersPanelProps;
}

export default function HomeView({
  title,
  artist,
  album,
  albumArt,
  state,
  isPlaying,
  hasLoadedTrack,
  currentTimeSeconds,
  durationSeconds,
  onTogglePlay,
  onPlayFeatured,
  onRestart,
  onSeek,
  onScrubStart,
  onScrubEnd,
  compact = false,
  onGoToArtist,
  onGoToAlbum,
  envelope = null,
  onOpenNowPlaying,
  onCloseNowPlaying,
  expanded = false,
  showMobileShell = false,
  onSkipBack,
  onSkipForward,
  moreMenu,
  shuffleOn,
  onShuffleToggle,
  repeatMode,
  onRepeatCycle,
  fidelityLabel,
  resolveElapsedSeconds = 0,
  onCancelResolve,
  idleDiscovery,
  stemSliders,
}: HomeViewProps) {
  const trueIdle =
    !hasLoadedTrack &&
    !isPlaying &&
    state !== 'Ready' &&
    state !== 'Connecting' &&
    state !== 'Resolving';
  const displayArt = proxiedArtworkUrl(albumArt) ?? albumArt;
  const hasArt = Boolean(displayArt?.trim());
  const [heroDisplay, setHeroDisplay] = useState(loadHeroDisplayMode);
  const showShades = resolveHeroShowShades(heroDisplay, hasArt, { idleHome: trueIdle });
  const gradientSeed = title?.trim() || album?.trim() || 'Sandbox';
  const { cssVars: vinylCssVars, vinylClass } = useVinylVisualStyle(envelope);
  const { universeStyle, isArtDriven, isMonochrome } = useTrackUniverseStyle(
    hasArt ? displayArt : undefined,
    gradientSeed,
  );
  const genreBucket = useMemo(
    () => (trueIdle ? null : getGenreBucketForTrack(envelope)),
    [trueIdle, envelope?.envelopeId, envelope?.title, envelope?.artist],
  );

  useEffect(() => {
    const sync = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplay);
    };
    const syncFromStorage = () => setHeroDisplay(loadHeroDisplayMode());
    window.addEventListener('sandbox-settings-change', sync);
    window.addEventListener('storage', syncFromStorage);
    return () => {
      window.removeEventListener('sandbox-settings-change', sync);
      window.removeEventListener('storage', syncFromStorage);
    };
  }, []);

  const trackGlowStyle = !trueIdle
    ? { ...universeStyle, ...vinylCssVars }
    : undefined;
  const artUniverseClass =
    !trueIdle && isArtDriven
      ? ` home-vinyl-universe--art-driven${isMonochrome ? ' home-vinyl-universe--art-monochrome' : ''}`
      : '';

  return (
    <div
      className={`home-view home-view--stack flex flex-col flex-1 min-h-0 w-full items-center justify-center ${
        trueIdle ? 'home-view--idle' : 'home-view--active home-view--track-glow home-view--hypnotic-lite'
      } ${showShades ? 'home-view--shades' : ''} ${compact ? 'home-view--compact' : ''}${
        expanded ? ' home-view--expanded' : ''
      }${genreBucket ? ` home-genre-${genreBucket}` : ''}${vinylClass ? ` ${vinylClass}` : ''}${artUniverseClass}`}
      style={trackGlowStyle}
      data-genre-bucket={genreBucket ?? undefined}
    >
      <HomeHeroPlayer
        title={title}
        artist={artist}
        album={album}
        albumArt={albumArt}
        state={state}
        isPlaying={isPlaying}
        hasLoadedTrack={hasLoadedTrack}
        trueIdle={trueIdle}
        currentTimeSeconds={currentTimeSeconds}
        durationSeconds={durationSeconds}
        onTogglePlay={onTogglePlay}
        onPlayFeatured={onPlayFeatured}
        onRestart={onRestart}
        onSeek={onSeek}
        onScrubStart={onScrubStart}
        onScrubEnd={onScrubEnd}
        compact={compact}
        expanded={expanded}
        onGoToArtist={onGoToArtist}
        onGoToAlbum={onGoToAlbum}
        envelope={envelope}
        onExpand={onOpenNowPlaying}
        onCollapse={onCloseNowPlaying}
        showMobileShell={showMobileShell}
        heroDisplayMode={heroDisplay}
        onHeroDisplayModeChange={setHeroDisplay}
        onSkipBack={onSkipBack}
        onSkipForward={onSkipForward}
        moreMenu={moreMenu}
        shuffleOn={shuffleOn}
        onShuffleToggle={onShuffleToggle}
        repeatMode={repeatMode}
        onRepeatCycle={onRepeatCycle}
        fidelityLabel={fidelityLabel}
        resolveElapsedSeconds={resolveElapsedSeconds}
        onCancelResolve={onCancelResolve}
      />
      {!trueIdle && stemSliders && !showMobileShell ? (
        <div className="w-full max-w-2xl px-4 mt-4 shrink-0">
          <StemSlidersPanel {...stemSliders} />
        </div>
      ) : null}
      {trueIdle && idleDiscovery ? (
        <HomeIdleDiscovery
          recentItems={idleDiscovery.recentItems}
          queueCount={idleDiscovery.queueCount}
          listening={idleDiscovery.listening}
          onOpenInsights={idleDiscovery.onOpenInsights}
          onOpenPlaylistsPrompt={idleDiscovery.onOpenPlaylistsPrompt}
          onPlayRecent={idleDiscovery.onPlayRecent}
          onResumeQueue={idleDiscovery.onResumeQueue}
        />
      ) : null}
    </div>
  );
}
