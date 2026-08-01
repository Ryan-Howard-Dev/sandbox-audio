import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Play, Shuffle, ChevronLeft } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import {
  resolveLockerArtworkUrl,
  resolveLockerEntryGroupArt,
  type LockerEntry,
} from '../../lockerStorage';
import type { AlbumCollection } from '../../collectionIntelligence';
import {
  buildLockerGenreShelves,
  collectionCoverUrl,
  collectionTrackList,
  genreShelfTracks,
  lockerGenreSourceCollections,
  type LockerGenreCover,
  type LockerGenreShelf,
} from '../../lockerGenreShelf';
import { lockerEntryToEnvelope } from '../../smartPlaylistEngine';
import { enrichLockerGenres, genreEnrichmentPending } from '../../genreEnrichment';
import { sortLockerTracks } from '../../lockerTrackOrder';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { preferStableLockerCoverUrl } from '../../albumArtCache';
import { seedGradient } from '../../seedGradient';
import { useTranslation } from '../../i18n';

export interface LockerGenreViewProps {
  collections: AlbumCollection[];
  entries: LockerEntry[];
  libraryQuery?: string;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  /** Android hardware back / re-tap: pop genre detail back to the grid. */
  drillBackRef?: React.MutableRefObject<(() => boolean) | null>;
}

function playEnvelopes(tracks: LockerEntry[]): MediaEnvelope[] {
  return sortLockerTracks(tracks).map(lockerEntryToEnvelope);
}

/**
 * Locker cover image that heals itself. `blob:` object URLs stored on a track die
 * when the app process restarts, so on load failure (or up-front for a blob: URL)
 * we re-resolve durable art from the vault by track id.
 */
function LockerCoverImg({
  url,
  trackId,
  seed,
  className,
}: {
  url?: string;
  trackId?: string;
  seed: string;
  className: string;
}) {
  const [src, setSrc] = useState(url);
  const [failed, setFailed] = useState(false);

  const healedRef = React.useRef(false);
  const heldSrcRef = React.useRef(url);
  useEffect(() => {
    // Hold a live blob against a different per-row remint for the same cell. After a
    // hard fail, heldSrcRef is cleared so the next candidate can replace it.
    const next = preferStableLockerCoverUrl(heldSrcRef.current, url) ?? url;
    heldSrcRef.current = next;
    setSrc(next);
    setFailed(false);
    healedRef.current = false;
  }, [url]);

  const heal = useCallback(() => {
    // Only re-resolve once, and only after the image actually fails to load — a
    // valid (same-process) blob: URL must not be discarded pre-emptively.
    if (healedRef.current) {
      heldSrcRef.current = undefined;
      setFailed(true);
      return;
    }
    healedRef.current = true;
    if (!trackId) {
      heldSrcRef.current = undefined;
      setFailed(true);
      return;
    }
    void resolveLockerArtworkUrl(trackId)
      .then((fresh) => {
        const next = fresh?.trim();
        // Only swap in a genuinely different URL. Re-setting the same dead blob:
        // string would not re-render, so onError never fires again and the tile is
        // stuck showing the browser's broken-image icon — fall to the gradient.
        if (next && next !== src) {
          heldSrcRef.current = next;
          setSrc(next);
        } else {
          heldSrcRef.current = undefined;
          setFailed(true);
        }
      })
      .catch(() => {
        heldSrcRef.current = undefined;
        setFailed(true);
      });
  }, [trackId, src]);

  if (!src || failed) {
    return <div className={className} style={{ background: seedGradient(seed) }} aria-hidden />;
  }
  return (
    <img
      src={proxiedArtworkUrl(src) ?? src}
      alt=""
      loading="lazy"
      className={className}
      onError={heal}
    />
  );
}

/** 2×2 cover mosaic with gradient fallback, used for both genre tiles and albums. */
function CoverMosaic({ covers, seed }: { covers: LockerGenreCover[]; seed: string }) {
  if (covers.length === 0) {
    return (
      <div
        className="locker-genre-mosaic locker-genre-mosaic--empty"
        style={{ background: seedGradient(seed) }}
        aria-hidden
      />
    );
  }
  // One cover fills the tile; 4+ covers tile as a grid.
  const tiles = covers.length >= 4 ? covers.slice(0, 4) : [covers[0]!];
  return (
    <div
      className={`locker-genre-mosaic locker-genre-mosaic--${tiles.length >= 4 ? 'quad' : 'single'}`}
      aria-hidden
    >
      {tiles.map((cover, i) => (
        <React.Fragment key={`${cover.trackId}-${i}`}>
          <LockerCoverImg
            url={cover.url}
            trackId={cover.trackId}
            seed={`${seed}-${i}`}
            className="locker-genre-mosaic-cell"
          />
        </React.Fragment>
      ))}
    </div>
  );
}

function GenreTile({
  shelf,
  covers,
  label,
  labels,
  onOpen,
  onPlay,
}: {
  shelf: LockerGenreShelf;
  covers: LockerGenreCover[];
  label: string;
  labels: { albums: (n: number) => string; tracks: (n: number) => string };
  onOpen: () => void;
  onPlay: () => void;
}) {
  return (
    <div className={`locker-genre-tile locker-genre-tile--${shelf.bucket}`}>
      <button
        type="button"
        className="locker-genre-tile-open touch-manipulation"
        onClick={onOpen}
      >
        <CoverMosaic covers={covers} seed={shelf.label} />
        <div className="locker-genre-tile-meta">
          <span className="locker-genre-tile-name">{label}</span>
          <span className="locker-genre-tile-count">
            {labels.albums(shelf.albumCount)} · {labels.tracks(shelf.trackCount)}
          </span>
        </div>
      </button>
      <button
        type="button"
        className="locker-genre-tile-play touch-manipulation"
        onClick={onPlay}
        aria-label={`Play ${label}`}
      >
        <Play size={18} fill="currentColor" />
      </button>
    </div>
  );
}

export default function LockerGenreView({
  collections,
  entries,
  libraryQuery = '',
  onPlayAlbum,
  drillBackRef,
}: LockerGenreViewProps) {
  const { t } = useTranslation();
  const [activeGenreKey, setActiveGenreKey] = useState<string | null>(null);

  const shelves = useMemo(() => {
    const source = lockerGenreSourceCollections(collections, entries);
    // No "Other" bucket by design — enrichment (album → artist → song → sibling
    // album) is expected to give every album a real genre. Anything unresolved
    // is retried on the next open rather than parked in a catch-all shelf.
    return buildLockerGenreShelves(source);
  }, [collections, entries]);

  const entryById = useMemo(() => {
    const map = new Map<string, LockerEntry>();
    for (const e of entries) map.set(e.id, e);
    return map;
  }, [entries]);

  // Resolve a cover to the album-cache-aware URL (same resolver as now-playing),
  // which recovers durable art for albums whose stored URL is a dead blob:.
  const resolveCoverUrl = useCallback(
    (cover: LockerGenreCover): string => {
      const entry = entryById.get(cover.trackId);
      if (!entry) return cover.url;
      return resolveLockerEntryGroupArt(entry, entries) ?? cover.url;
    },
    [entryById, entries],
  );

  const coversFor = useCallback(
    (covers: LockerGenreCover[]): LockerGenreCover[] =>
      covers.map((c) => ({ ...c, url: resolveCoverUrl(c) })),
    [resolveCoverUrl],
  );

  // Backfill real genres from iTunes for tracks stamped "Downloaded" / blank.
  // Cached per album, so this only hits the network for genres it hasn't
  // resolved yet; the vault refresh re-renders these shelves when it finishes.
  useEffect(() => {
    if (!genreEnrichmentPending(entries)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      void enrichLockerGenres(entries).catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [entries]);

  const filteredShelves = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    if (!q) return shelves;
    return shelves.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.topArtists.some((a) => a.toLowerCase().includes(q)),
    );
  }, [shelves, libraryQuery]);

  // Stable cover list per shelf across parent re-renders (same vault art → same url strings).
  // Also hold a still-live blob: when coversFor/pick flips to a different per-row remint.
  const prevMosaicRef = React.useRef(new Map<string, LockerGenreCover[]>());
  const mosaicCoversByShelfKey = useMemo(() => {
    const liveUrls = new Set<string>();
    for (const e of entries) {
      const art = e.albumArt?.trim();
      if (art?.startsWith('blob:')) liveUrls.add(art);
    }
    const map = new Map<string, LockerGenreCover[]>();
    for (const shelf of filteredShelves) {
      const resolved = coversFor(shelf.covers);
      const prevCovers = prevMosaicRef.current.get(shelf.key);
      map.set(
        shelf.key,
        resolved.map((cover) => {
          const prevUrl = prevCovers?.find((p) => p.trackId === cover.trackId)?.url;
          return {
            ...cover,
            url: preferStableLockerCoverUrl(prevUrl, cover.url, liveUrls) ?? cover.url,
          };
        }),
      );
    }
    prevMosaicRef.current = map;
    return map;
  }, [filteredShelves, coversFor, entries]);

  const activeShelf = useMemo(
    () => shelves.find((s) => s.key === activeGenreKey) ?? null,
    [shelves, activeGenreKey],
  );

  // Genre no longer exists after a re-scan → fall back to the grid.
  useEffect(() => {
    if (activeGenreKey && !activeShelf) setActiveGenreKey(null);
  }, [activeGenreKey, activeShelf]);

  // Hardware back pops the detail before leaving the locker.
  useEffect(() => {
    if (!drillBackRef) return;
    drillBackRef.current = () => {
      if (activeGenreKey) {
        setActiveGenreKey(null);
        return true;
      }
      return false;
    };
    return () => {
      if (drillBackRef) drillBackRef.current = null;
    };
  }, [drillBackRef, activeGenreKey]);

  const albumsLabel = (n: number) => t('locker.genre.albumsCount', { count: n });
  const tracksLabel = (n: number) => t('locker.genre.tracksCount', { count: n });
  // Untagged music groups under "Unknown" internally; show it as "Other".
  const shelfLabel = (shelf: LockerGenreShelf) =>
    shelf.label === 'Unknown' ? t('locker.genre.otherLabel') : shelf.label;

  const playShelf = (shelf: LockerGenreShelf, shuffle: boolean) => {
    if (!onPlayAlbum) return;
    const envs = genreShelfTracks(shelf).map(lockerEntryToEnvelope);
    if (envs.length > 0) onPlayAlbum(envs, shuffle);
  };

  const playCollection = (collection: AlbumCollection, shuffle = false) => {
    if (!onPlayAlbum) return;
    const envs = playEnvelopes(collectionTrackList(collection));
    if (envs.length > 0) onPlayAlbum(envs, shuffle);
  };

  if (activeShelf) {
    return (
      <div className="locker-genre-detail">
        <div className="locker-genre-detail-head">
          <button
            type="button"
            className="locker-genre-back touch-manipulation"
            onClick={() => setActiveGenreKey(null)}
          >
            <ChevronLeft size={18} />
            {t('locker.genre.backToGenres')}
          </button>
          <h2 className="locker-genre-detail-title">{shelfLabel(activeShelf)}</h2>
          <p className="locker-genre-detail-stats">
            {albumsLabel(activeShelf.albumCount)} · {tracksLabel(activeShelf.trackCount)}
          </p>
          <div className="locker-genre-detail-actions">
            <button
              type="button"
              className="locker-genre-action locker-genre-action--primary touch-manipulation"
              onClick={() => playShelf(activeShelf, false)}
            >
              <Play size={16} fill="currentColor" /> {t('locker.genre.playAll')}
            </button>
            <button
              type="button"
              className="locker-genre-action touch-manipulation"
              onClick={() => playShelf(activeShelf, true)}
            >
              <Shuffle size={16} /> {t('locker.genre.shuffle')}
            </button>
          </div>
        </div>
        <div className="locker-genre-album-grid">
          {activeShelf.collections.map((collection) => {
            const coverTrackId = collectionTrackList(collection)[0]?.id;
            const coverTrack = coverTrackId ? entryById.get(coverTrackId) : undefined;
            const cover = coverTrack
              ? resolveLockerEntryGroupArt(coverTrack, entries) ?? collectionCoverUrl(collection)
              : collectionCoverUrl(collection);
            return (
              <button
                key={collection.key}
                type="button"
                className="locker-genre-album-card touch-manipulation"
                onClick={() => playCollection(collection)}
              >
                <div className="locker-genre-album-cover">
                  <LockerCoverImg
                    url={cover}
                    trackId={coverTrackId}
                    seed={collection.displayName}
                    className="locker-genre-album-cover-img"
                  />
                  <span className="locker-genre-album-play" aria-hidden>
                    <Play size={16} fill="currentColor" />
                  </span>
                </div>
                <span className="locker-genre-album-name">{collection.displayName}</span>
                <span className="locker-genre-album-artist">{collection.artist}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  if (filteredShelves.length === 0) {
    return (
      <div className="locker-genre-empty">
        <p>{t('locker.genre.empty')}</p>
      </div>
    );
  }

  return (
    <div className="locker-genre-grid">
      {filteredShelves.map((shelf) => (
        <React.Fragment key={shelf.key}>
          <GenreTile
            shelf={shelf}
            covers={mosaicCoversByShelfKey.get(shelf.key) ?? coversFor(shelf.covers)}
            label={shelfLabel(shelf)}
            labels={{ albums: albumsLabel, tracks: tracksLabel }}
            onOpen={() => setActiveGenreKey(shelf.key)}
            onPlay={() => playShelf(shelf, true)}
          />
        </React.Fragment>
      ))}
    </div>
  );
}
