import React from 'react';

export interface MusicUniverseBackdropProps {
  /** Loaded track on home — backdrop visible (may be paused). */
  active: boolean;
  /** Vinyl spinning — subtle ambient pulse only (no spin-sync beams). */
  playing: boolean;
  /** Vinyl-shades mode — richer color throw from the disc. */
  showShades?: boolean;
  /** TV leanback — lighter CSS variant (fewer layers). */
  variant?: 'default' | 'tv';
  /** Psychedelic vinyl visual classes from settings (opt-in). */
  psycheClass?: string;
  style?: React.CSSProperties;
}

/**
 * Full-viewport ambient wash behind shell chrome — void + edge tints only.
 * Colors driven by CSS vars from seedGradientUniverseStyle.
 */
export default function MusicUniverseBackdrop({
  active,
  playing,
  showShades = false,
  variant = 'default',
  psycheClass = '',
  style,
}: MusicUniverseBackdropProps) {
  if (!active) return null;

  return (
    <div
      className={`music-universe-backdrop${
        playing ? ' music-universe-backdrop--playing' : ' music-universe-backdrop--paused'
      }${showShades ? ' music-universe-backdrop--shades' : ''}${
        variant === 'tv' ? ' music-universe-backdrop--tv' : ''
      }${psycheClass ? ` ${psycheClass}` : ''}`}
      style={style}
      aria-hidden
    >
      <div className="music-universe-backdrop__void" />
      <div className="music-universe-backdrop__ambient" />
      <div className="music-universe-backdrop__throw" />
      <div className="music-universe-backdrop__rings" />
      <div className="music-universe-backdrop__hue" />
    </div>
  );
}
