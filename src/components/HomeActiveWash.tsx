import React, { useMemo } from 'react';
import { seedGradient } from '../seedGradient';
import { useCoverArtGlow } from '../hooks/useCoverArtGlow';

export interface HomeActiveWashProps {
  albumArt: string;
  showShades: boolean;
  gradientSeed: string;
  genreBucket?: string | null;
  style?: React.CSSProperties;
}

/**
 * Full-viewport album ambient wash at shell-root (mobile / when music universe is off).
 * Sits behind shell chrome; scrim keeps search/header readable.
 */
export default function HomeActiveWash({
  albumArt,
  showShades,
  gradientSeed,
  genreBucket,
  style,
}: HomeActiveWashProps) {
  const hasArt = Boolean(albumArt?.trim()) && !showShades;
  const { style: coverGlowStyle, isMonochrome } = useCoverArtGlow(
    hasArt ? albumArt : undefined,
    gradientSeed,
  );
  const mergedStyle = useMemo(
    () => (hasArt ? { ...style, ...coverGlowStyle } : style),
    [hasArt, style, coverGlowStyle],
  );

  return (
    <div
      className={`home-active-wash${
        !hasArt && genreBucket ? ` home-genre-${genreBucket}` : ''
      }${hasArt && isMonochrome ? ' home-active-wash--monochrome' : ''}`}
      style={mergedStyle}
      aria-hidden
    >
      {hasArt ? (
        <div className="home-active-wash__art">
          <img src={albumArt} alt="" />
        </div>
      ) : (
        <div
          className="home-active-wash__seed"
          style={{ background: seedGradient(gradientSeed) }}
        />
      )}
      <div className="home-active-wash__scrim" />
    </div>
  );
}
