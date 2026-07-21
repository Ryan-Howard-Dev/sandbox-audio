import React, { useCallback } from 'react';
import { Clock } from 'lucide-react';
import CatalogArtThumb from './CatalogArtThumb';
import type { SearchHistoryEntry } from '../searchHistory';
import { patchSearchHistoryArtwork } from '../searchHistory';
import { findArtistImage } from '../artistImage';

export interface SearchHistoryThumbProps {
  entry: SearchHistoryEntry;
}

/** Artwork for a recent search row — round for artists, square for albums/tracks. */
export default function SearchHistoryThumb({ entry }: SearchHistoryThumbProps) {
  const [artistArt, setArtistArt] = React.useState<string | undefined>();

  React.useEffect(() => {
    setArtistArt(undefined);
    if (entry.kind === 'artist' && entry.artworkUrl) return;
    if (entry.kind !== 'query' && entry.kind !== 'artist') return;

    const name = entry.kind === 'artist' ? entry.name : entry.query;
    let cancelled = false;
    void findArtistImage(name).then((url) => {
      if (!cancelled && url) setArtistArt(url);
    });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  const persistArt = useCallback(
    (url: string) => {
      patchSearchHistoryArtwork(entry, url);
    },
    [entry],
  );

  if (entry.kind === 'album') {
    return (
      <CatalogArtThumb
        url={entry.artworkUrl}
        title={entry.title}
        fallback={{ album: entry.title, artist: entry.artist }}
        onResolvedUrl={persistArt}
      />
    );
  }

  if (entry.kind === 'track') {
    return (
      <CatalogArtThumb
        url={entry.artworkUrl}
        title={entry.title}
        fallback={{ album: entry.title, artist: entry.artist }}
        onResolvedUrl={persistArt}
      />
    );
  }

  if (entry.kind === 'artist') {
    return (
      <CatalogArtThumb
        url={entry.artworkUrl ?? artistArt}
        title={entry.name}
        round
        onResolvedUrl={persistArt}
      />
    );
  }

  if (artistArt) {
    return <CatalogArtThumb url={artistArt} title={entry.query} round />;
  }

  return (
    <span className="search-history-query-icon" aria-hidden>
      <Clock className="w-3.5 h-3.5 text-[var(--text-dim)]" />
    </span>
  );
}
