import React, { useEffect, useMemo, useRef, useState } from 'react';
import { proxiedArtworkUrl, canonicalArtworkSrc } from '../displaySanitize';
import { stabilizePlaybackArtSrc } from '../playerBarTrackMeta';
import { seedGradient, handleArtImgError } from '../seedGradient';
import { useTranslation } from '../i18n';

export type VinylHeroSize = 'home' | 'tv' | 'compact';

export interface VinylHeroProps {
  title: string;
  artworkUrl?: string;
  playing: boolean;
  /** Spin animation paused at current angle (loaded track, not playing). */
  pausedSpin?: boolean;
  /** true = vinyl-shades (gradient disc); false = album art on label / full disc. */
  showShades: boolean;
  size?: VinylHeroSize;
  className?: string;
  /** Psychedelic vinyl classes + addon personality — applied on the disc element. */
  discClassName?: string;
  /** CSS vars from vinyl visual settings — applied on the disc element. */
  discStyle?: React.CSSProperties;
  /** Stabilization scope — album group for locker playback, else envelope id. */
  stabilizeScope?: string;
}

export default function VinylHero({
  title,
  artworkUrl,
  playing,
  pausedSpin = false,
  showShades,
  size = 'home',
  className = '',
  discClassName = '',
  discStyle,
  stabilizeScope,
}: VinylHeroProps) {
  const { t } = useTranslation();
  const hasArt = Boolean(artworkUrl?.trim());
  const showCoverArt = hasArt && !showShades;
  const gradientSeed = title?.trim() || 'Sandbox';

  const [artLoaded, setArtLoaded] = useState(false);
  const [artSrc, setArtSrc] = useState<string | undefined>(
    () => proxiedArtworkUrl(artworkUrl) ?? artworkUrl,
  );
  const artImgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const next = proxiedArtworkUrl(artworkUrl) ?? artworkUrl;
    const scope = stabilizeScope?.trim() || title;
    setArtSrc((prev) => {
      const stable = stabilizePlaybackArtSrc(prev, next, scope);
      if (stable !== prev) setArtLoaded(false);
      return stable;
    });
  }, [artworkUrl, stabilizeScope, title]);

  useEffect(() => {
    const img = artImgRef.current;
    if (img?.complete && img.naturalWidth > 0) {
      setArtLoaded(true);
    }
  }, [artSrc]);

  const vinylSpinClass = useMemo(() => {
    if (playing) return 'vinyl-spin';
    if (pausedSpin) return 'vinyl-spin-paused';
    return '';
  }, [playing, pausedSpin]);

  const wrapClass =
    size === 'compact'
      ? 'home-vinyl-wrap home-vinyl-wrap--compact'
      : size === 'tv'
        ? 'vinyl-hero-wrap vinyl-hero-wrap--tv'
        : 'home-vinyl-wrap';

  const discClass =
    size === 'tv'
      ? 'vinyl-hero-disc home-vinyl-disc vinyl-disc vinyl-disc--tv'
      : 'home-vinyl-disc vinyl-disc';

  return (
    <div className={`${wrapClass} shrink-0 ${className}`.trim()}>
      <div
        className={`${discClass} ${showCoverArt ? 'has-art' : 'has-gradient'}${
          playing ? ' is-playing' : ''
        }${discClassName ? ` ${discClassName}` : ''}`}
        style={discStyle}
        role="img"
        aria-label={showCoverArt ? t('home.albumArt', { title }) : t('home.vinylPlayer')}
      >
        <div className={`vinyl-disc-inner ${vinylSpinClass}`}>
          <div className="vinyl-disc-art-layer">
            {showCoverArt ? (
              <>
                <div
                  className="vinyl-disc-art-placeholder"
                  style={{ background: seedGradient(gradientSeed) }}
                  aria-hidden
                />
                <img
                  ref={artImgRef}
                  src={artSrc}
                  alt=""
                  className={`vinyl-disc-cover${artLoaded ? ' is-loaded' : ''}`}
                  onLoad={() => setArtLoaded(true)}
                  onError={(e) => {
                    const raw = artworkUrl?.trim();
                    const canon = canonicalArtworkSrc(raw);
                    if (canon) {
                      const canonDisplay = proxiedArtworkUrl(canon) ?? canon;
                      if (artSrc !== canonDisplay) {
                        setArtSrc(canonDisplay);
                        return;
                      }
                    }
                    if (
                      raw &&
                      artSrc !== raw &&
                      (raw.startsWith('http') || raw.startsWith('blob:') || raw.startsWith('//'))
                    ) {
                      setArtSrc(raw);
                      return;
                    }
                    handleArtImgError(e, gradientSeed);
                    setArtLoaded(false);
                  }}
                />
              </>
            ) : (
              <div
                className="vinyl-disc-art-placeholder"
                style={{ background: seedGradient(gradientSeed) }}
                aria-hidden
              />
            )}
          </div>
          <div className="vinyl-disc-grooves" aria-hidden />
          <div className="vinyl-disc-grooves vinyl-disc-grooves-fine" aria-hidden />
          <div className="vinyl-disc-sheen" aria-hidden />
          <div className={`vinyl-disc-label${showCoverArt ? ' vinyl-disc-label--art' : ''}`}>
            {showShades ? (
              <div
                className="vinyl-disc-art vinyl-disc-art-empty"
                style={{ background: seedGradient(gradientSeed) }}
              />
            ) : null}
          </div>
        </div>
        <div className="vinyl-disc-rim" aria-hidden />
        <div className="vinyl-disc-ring vinyl-disc-ring-inner" aria-hidden />
        <div className="vinyl-disc-ring vinyl-disc-ring-mid" aria-hidden />
        <div className="vinyl-disc-spindle" aria-hidden>
          <span className="vinyl-disc-spindle-hole" />
        </div>
        <div className="vinyl-disc-vignette" aria-hidden />
      </div>
    </div>
  );
}
