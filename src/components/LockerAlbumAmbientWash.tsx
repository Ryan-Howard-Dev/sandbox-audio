import React, { useEffect, useState } from 'react';
import { probeArtworkUrl } from './locker/LockerAlbumBannerArt';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';

export interface LockerAlbumAmbientWashProps {
  coverArt?: string;
  albumName: string;
  style?: React.CSSProperties;
  isMonochrome?: boolean;
}

/** Fixed full-viewport album art wash — portaled to shell-root for header bleed. */
export default function LockerAlbumAmbientWash({
  coverArt,
  albumName,
  style,
  isMonochrome = false,
}: LockerAlbumAmbientWashProps) {
  const [validatedSrc, setValidatedSrc] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const raw = coverArt?.trim();
    const proxied = raw ? (proxiedArtworkUrl(raw) ?? raw) : undefined;
    setValidatedSrc(undefined);
    if (!proxied) return;

    void probeArtworkUrl(proxied).then((ok) => {
      if (!cancelled && ok) setValidatedSrc(proxied);
    });

    return () => {
      cancelled = true;
    };
  }, [coverArt]);

  const hasArt = Boolean(validatedSrc);

  return (
    <div
      className={`locker-album-ambient-wash${hasArt ? ' locker-album-ambient-wash--has-art' : ''}${
        hasArt && isMonochrome ? ' locker-album-ambient-wash--monochrome' : ''
      }`}
      style={style}
      aria-hidden
    >
      {hasArt ? (
        <div className="locker-album-ambient-wash__art">
          <img src={validatedSrc} alt="" />
        </div>
      ) : (
        <div
          className="locker-album-ambient-wash__seed"
          style={{ background: seedGradient(albumName) }}
        />
      )}
      <div className="locker-album-ambient-wash__scrim" />
    </div>
  );
}
