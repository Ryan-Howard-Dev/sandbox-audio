import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';
import type { CanonicalArtist } from '../../collectionIntelligence';
import { findArtistImage, getCachedArtistImage, pickLockerArtistCoverArt } from '../../artistImage';
import { canonicalArtworkSrc, proxiedArtworkUrl, sanitizeCoverArtUrl } from '../../displaySanitize';
import { seedGradient } from '../../seedGradient';
import { useMobileShell } from '../../hooks/useMobileShell';
import type { LockerEntry } from '../../lockerStorage';

export interface LockerArtistGridProps {
  artists: CanonicalArtist[];
  /** Locker tracks — used for album-art fallback when profile photos are missing. */
  vaultEntries?: LockerEntry[];
  onSelectArtist: (name: string, artworkUrl?: string) => void;
  emptyLabel: string;
}

function artistInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function LockerArtistAvatar({
  name,
  modern,
  lockerFallback,
  onArtwork,
}: {
  name: string;
  modern?: boolean;
  lockerFallback?: string;
  onArtwork?: (url: string) => void;
}) {
  const [url, setUrl] = useState<string | undefined>(() => {
    const cached = getCachedArtistImage(name);
    if (typeof cached === 'string') return cached;
    return lockerFallback;
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const cached = getCachedArtistImage(name);
    const warm = typeof cached === 'string' ? cached : lockerFallback;
    setUrl(warm);
    setFailed(false);
    if (warm) onArtwork?.(warm);
    let cancelled = false;
    void findArtistImage(name).then((found) => {
      if (!cancelled && found) {
        setUrl(found);
        onArtwork?.(found);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [name, lockerFallback, onArtwork]);

  const src = proxiedArtworkUrl(sanitizeCoverArtUrl(url));
  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="locker-artist-avatar-img"
        onError={() => {
          const fallback = proxiedArtworkUrl(sanitizeCoverArtUrl(lockerFallback));
          if (fallback && canonicalArtworkSrc(fallback) !== canonicalArtworkSrc(src)) {
            setUrl(lockerFallback);
            setFailed(false);
            onArtwork?.(lockerFallback!);
            return;
          }
          setFailed(true);
        }}
      />
    );
  }

  return (
    <span
      className={`locker-artist-avatar${modern ? ' locker-artist-avatar--modern' : ''}`}
      aria-hidden
      style={{ background: seedGradient(name) }}
    >
      {modern ? (
        <span className="locker-artist-avatar-initials">{artistInitials(name)}</span>
      ) : null}
    </span>
  );
}

/** Artist browse grid — profile photos with download counts. */
export default function LockerArtistGrid({
  artists,
  vaultEntries = [],
  onSelectArtist,
  emptyLabel,
}: LockerArtistGridProps) {
  const isMobileShell = useMobileShell();
  const artworkByName = useRef<Map<string, string>>(new Map());

  if (artists.length === 0) {
    return (
      <div className="collection-placeholder locker-artist-empty">
        <p className="font-display text-lg font-bold text-[var(--text)]">{emptyLabel}</p>
      </div>
    );
  }

  const sorted = artists;

  return (
    <ul className={`locker-artist-grid${isMobileShell ? ' locker-artist-grid--modern' : ''}`}>
      {sorted.map((artist) => (
        <li key={artist.id}>
          <button
            type="button"
            className="locker-artist-card touch-manipulation"
            onClick={() =>
              onSelectArtist(
                artist.displayName,
                artworkByName.current.get(artist.displayName),
              )
            }
          >
            <LockerArtistAvatar
              name={artist.displayName}
              modern={isMobileShell}
              lockerFallback={pickLockerArtistCoverArt(artist.displayName, vaultEntries)}
              onArtwork={(url) => artworkByName.current.set(artist.displayName, url)}
            />
            <span className="locker-artist-body min-w-0">
              <span className="locker-artist-name truncate">{artist.displayName}</span>
              {!isMobileShell ? (
                <span className="locker-artist-meta">
                  {artist.albumCount} album{artist.albumCount === 1 ? '' : 's'} · {artist.trackCount}{' '}
                  track{artist.trackCount === 1 ? '' : 's'}
                </span>
              ) : null}
            </span>
            {isMobileShell ? (
              <MoreVertical className="locker-artist-menu-icon" aria-hidden />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
