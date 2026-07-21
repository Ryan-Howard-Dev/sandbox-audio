import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Loader2 } from 'lucide-react';
import type { AudioFsmState } from '../sandboxLayer1';
import type { SyncStatePayload } from '../tier34/connectProtocol';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';

export interface CarModeViewProps {
  title: string;
  artist: string;
  albumArt: string;
  state: AudioFsmState;
  isPlaying: boolean;
  volume: number;
  isMuted: boolean;
  connectRemote: boolean;
  remoteMirror?: SyncStatePayload | null;
  onTogglePlay: () => void;
  onSkipBack: () => void;
  onSkipForward: () => void;
  onSetVolume: (level: number) => void;
  onToggleMute: () => void;
  onExit: () => void;
}

const EXIT_CONFIRM_MS = 2500;

export default function CarModeView({
  title,
  artist,
  albumArt,
  state,
  isPlaying,
  volume,
  isMuted,
  connectRemote,
  remoteMirror,
  onTogglePlay,
  onSkipBack,
  onSkipForward,
  onSetVolume,
  onToggleMute,
  onExit,
}: CarModeViewProps) {
  const playBtnRef = useRef<HTMLButtonElement>(null);
  const exitTapRef = useRef(0);
  const [exitArmed, setExitArmed] = useState(false);

  const track = connectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex] ?? null
    : null;
  const displayTitle = connectRemote && track ? track.title : title;
  const displayArtist = connectRemote && track ? track.artist : artist;
  const displayVolume = connectRemote && remoteMirror ? remoteMirror.volume : volume;
  const showMuted = connectRemote ? displayVolume === 0 : isMuted || volume === 0;
  const displayPlaying = connectRemote && remoteMirror ? remoteMirror.isPlaying : isPlaying;
  const isBusy = !connectRemote && (state === 'Resolving' || state === 'Connecting');
  const hasTrack = connectRemote
    ? Boolean(remoteMirror?.currentTrackId)
    : state !== 'Idle';

  const art = connectRemote && track
    ? proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl ?? ''
    : proxiedArtworkUrl(albumArt) ?? albumArt;
  const gradient = seedGradient(displayTitle || displayArtist || 'Car');

  useEffect(() => {
    playBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 4) {
        e.preventDefault();
        onExit();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onExit]);

  useEffect(() => {
    if (!exitArmed) return;
    const t = window.setTimeout(() => setExitArmed(false), EXIT_CONFIRM_MS);
    return () => window.clearTimeout(t);
  }, [exitArmed]);

  const handleExitTap = useCallback(() => {
    const now = Date.now();
    if (exitArmed || now - exitTapRef.current < EXIT_CONFIRM_MS) {
      exitTapRef.current = 0;
      setExitArmed(false);
      onExit();
      return;
    }
    exitTapRef.current = now;
    setExitArmed(true);
  }, [exitArmed, onExit]);

  const volumePercent = Math.round(displayVolume * 100);

  return (
    <div className="car-mode flex flex-col flex-1 min-h-0 w-full" role="application" aria-label="Car mode">
      <header className="car-mode-header">
        <p className="car-mode-kicker">Car Mode</p>
        {connectRemote ? (
          <p className="car-mode-remote-badge">Sandbox Connect</p>
        ) : null}
      </header>

      <div className="car-mode-body">
        <div
          className="car-mode-art"
          style={{
            background: art
              ? `url(${art}) center/cover no-repeat, ${gradient}`
              : gradient,
          }}
          role="img"
          aria-label={displayTitle ? `${displayTitle} album art` : 'Album art'}
        />

        <div className="car-mode-meta">
          <h1 className="car-mode-title">{displayTitle || 'No Track'}</h1>
          <p className="car-mode-artist">{displayArtist || '—'}</p>
        </div>
      </div>

      <div className="car-mode-controls" aria-label="Playback controls">
        <button
          type="button"
          onClick={onSkipBack}
          className="car-mode-btn car-mode-btn--secondary"
          aria-label="Previous track"
        >
          <SkipBack className="car-mode-icon" strokeWidth={2.25} />
        </button>
        <button
          ref={playBtnRef}
          type="button"
          onClick={onTogglePlay}
          disabled={!hasTrack}
          className="car-mode-btn car-mode-btn--primary"
          aria-label={displayPlaying ? 'Pause' : 'Play'}
        >
          {isBusy ? (
            <Loader2 className="car-mode-icon car-mode-icon--spin" strokeWidth={2.25} />
          ) : displayPlaying ? (
            <Pause className="car-mode-icon" strokeWidth={2.25} />
          ) : (
            <Play className="car-mode-icon car-mode-icon--play" strokeWidth={2.25} />
          )}
        </button>
        <button
          type="button"
          onClick={onSkipForward}
          className="car-mode-btn car-mode-btn--secondary"
          aria-label="Next track"
        >
          <SkipForward className="car-mode-icon" strokeWidth={2.25} />
        </button>
      </div>

      <div className="car-mode-volume" aria-label="Volume">
        <button
          type="button"
          onClick={onToggleMute}
          className="car-mode-btn car-mode-btn--secondary car-mode-btn--volume"
          aria-label={showMuted ? 'Unmute' : 'Mute'}
        >
          {showMuted ? (
            <VolumeX className="car-mode-icon car-mode-icon--sm" strokeWidth={2.25} />
          ) : (
            <Volume2 className="car-mode-icon car-mode-icon--sm" strokeWidth={2.25} />
          )}
        </button>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volumePercent}
          onChange={(e) => onSetVolume(parseInt(e.target.value, 10) / 100)}
          className="car-mode-volume-slider touch-manipulation"
          aria-label="Volume"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={volumePercent}
          aria-valuetext={`${volumePercent} percent`}
        />
      </div>

      <footer className="car-mode-footer">
        <button
          type="button"
          onClick={handleExitTap}
          className={`car-mode-exit touch-manipulation ${exitArmed ? 'car-mode-exit--armed' : ''}`}
          aria-label="Exit car mode"
        >
          {exitArmed ? 'Tap again to exit Car Mode' : 'Exit Car Mode'}
        </button>
      </footer>
    </div>
  );
}
