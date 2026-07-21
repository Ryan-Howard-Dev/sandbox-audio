import React from 'react';
import { Disc3, User } from 'lucide-react';
import { catalogThumbArtworkUrl } from '../catalogDirect';
import { findAlbumCover } from '../albumCover';
import { proxiedArtworkUrl, sanitizeCoverArtUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';

export interface CatalogArtThumbProps {
  url?: string;
  title: string;
  round?: boolean;
  /** Use search-results-thumb sizing (same 2.5rem footprint, square corners unless round). */
  className?: string;
  /** When url is missing or fails to load, look up cover by album + artist. */
  fallback?: { album: string; artist: string };
  onResolvedUrl?: (url: string) => void;
}

export default function CatalogArtThumb({
  url,
  title,
  round = false,
  className = '',
  fallback,
  onResolvedUrl,
}: CatalogArtThumbProps) {
  const safeUrl = sanitizeCoverArtUrl(url);
  const [failed, setFailed] = React.useState(false);
  const [resolved, setResolved] = React.useState<string | undefined>();
  const effectiveUrl = safeUrl?.trim() || resolved;
  const thumbUrl = catalogThumbArtworkUrl(effectiveUrl) ?? effectiveUrl;
  const [src, setSrc] = React.useState<string | undefined>(() => proxiedArtworkUrl(thumbUrl));

  React.useEffect(() => {
    setFailed(false);
    setResolved(undefined);
    const next = catalogThumbArtworkUrl(safeUrl) ?? safeUrl;
    setSrc(proxiedArtworkUrl(next));
  }, [url, safeUrl]);

  React.useEffect(() => {
    if (safeUrl?.trim() || !fallback) return;
    let cancelled = false;
    void findAlbumCover(fallback.album, fallback.artist).then((cover) => {
      if (cancelled || !cover?.url) return;
      const safeCover = sanitizeCoverArtUrl(cover.url);
      if (!safeCover) return;
      const thumb = catalogThumbArtworkUrl(safeCover) ?? safeCover;
      setResolved(safeCover);
      setSrc(proxiedArtworkUrl(thumb));
      onResolvedUrl?.(safeCover);
    });
    return () => {
      cancelled = true;
    };
  }, [safeUrl, fallback?.album, fallback?.artist, onResolvedUrl]);

  React.useEffect(() => {
    if (!resolved) return;
    const thumb = catalogThumbArtworkUrl(resolved) ?? resolved;
    setSrc(proxiedArtworkUrl(thumb));
    setFailed(false);
  }, [resolved]);

  const shapeClass = round ? 'catalog-art-thumb--round' : '';

  const tryFallbackLookup = React.useCallback(() => {
    if (!fallback || resolved) {
      setFailed(true);
      return;
    }
    void findAlbumCover(fallback.album, fallback.artist).then((cover) => {
      const safeCover = sanitizeCoverArtUrl(cover?.url);
      if (safeCover) {
        const thumb = catalogThumbArtworkUrl(safeCover) ?? safeCover;
        setResolved(safeCover);
        setSrc(proxiedArtworkUrl(thumb));
        setFailed(false);
        onResolvedUrl?.(safeCover);
        return;
      }
      setFailed(true);
    });
  }, [fallback, onResolvedUrl, resolved]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className={`catalog-art-thumb ${shapeClass} ${className}`.trim()}
        onError={() => {
          const raw = thumbUrl?.trim() || effectiveUrl?.trim();
          const smaller = raw ? catalogThumbArtworkUrl(raw) : undefined;
          if (smaller && src !== smaller) {
            setSrc(proxiedArtworkUrl(smaller) ?? smaller);
            return;
          }
          if (raw && src !== raw && (raw.startsWith('http') || raw.startsWith('//'))) {
            setSrc(proxiedArtworkUrl(raw) ?? raw);
            return;
          }
          if (fallback && !resolved) {
            tryFallbackLookup();
            return;
          }
          setFailed(true);
        }}
      />
    );
  }

  return (
    <div
      className={`catalog-art-thumb catalog-art-thumb--placeholder ${shapeClass} ${className}`.trim()}
      style={{ background: seedGradient(title) }}
      aria-hidden
    >
      {round ? (
        <User className="catalog-art-thumb-icon" />
      ) : (
        <Disc3 className="catalog-art-thumb-icon" />
      )}
    </div>
  );
}
