import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Disc,
  Filter,
  Loader2,
  Play,
  Search,
  User,
  X,
} from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  activeFilterCount,
  facetOptions,
  hitToEnvelope,
  LOCKER_SEARCH_FACETS,
  processLockerSearchHits,
  releaseGroupFacetOptions,
  searchLockerLocalFallback,
  type LockerSearchAlbumResult,
  type LockerSearchArtistResult,
  type LockerSearchCollectionResult,
} from '../lockerSearch';
import {
  tier34SearchLocker,
  type LockerSearchFilters,
  type LockerSearchMode,
  type Tier34SearchHit,
} from '../tier34/client';
import { seedGradient } from '../seedGradient';
import { useImeFriendlyInput } from '../useImeFriendlyInput';
import { imeSearchInputProps } from '../imeInputProps';

const SEARCH_DEBOUNCE_MS = 250;

export interface LockerSearchViewProps {
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onSelectArtist?: (artistName: string) => void;
  onOpenCollection?: (collectionKey: string, editionKey?: string) => void;
  onClose?: () => void;
}

const MODES: Array<{ id: LockerSearchMode; label: string }> = [
  { id: 'tracks', label: 'Tracks' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'collections', label: 'Collections' },
];

const EMPTY_FILTERS: LockerSearchFilters = {};

export default function LockerSearchView({
  onPlay,
  onPlayAlbum,
  onSelectArtist,
  onOpenCollection,
  onClose,
}: LockerSearchViewProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const lockerSearchField = useImeFriendlyInput(query, setQuery, inputRef);
  const [mode, setMode] = useState<LockerSearchMode>('tracks');
  const [filters, setFilters] = useState<LockerSearchFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [usingLocalFallback, setUsingLocalFallback] = useState(false);
  const [hits, setHits] = useState<Tier34SearchHit[]>([]);
  const [facetDistribution, setFacetDistribution] = useState<
    Record<string, Record<string, number>> | undefined
  >();
  const [estimatedTotal, setEstimatedTotal] = useState<number | undefined>();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const runSearch = useCallback(async (q: string, activeFilters: LockerSearchFilters) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setFacetDistribution(undefined);
      setEstimatedTotal(undefined);
      setUsingLocalFallback(false);
      setLoading(false);
      return;
    }

    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const result = await tier34SearchLocker(trimmed, {
        limit: 60,
        filters: activeFilters,
        facets: [...LOCKER_SEARCH_FACETS],
      });
      if (reqId !== requestIdRef.current) return;

      if (result.ok && result.hits.length > 0) {
        setHits(result.hits);
        setFacetDistribution(result.facetDistribution);
        setEstimatedTotal(result.estimatedTotalHits);
        setUsingLocalFallback(false);
        return;
      }

      const localHits = await searchLockerLocalFallback(trimmed, {
        limit: 60,
        filters: activeFilters,
      });
      if (reqId !== requestIdRef.current) return;
      setHits(localHits);
      setFacetDistribution(undefined);
      setEstimatedTotal(localHits.length > 0 ? localHits.length : undefined);
      setUsingLocalFallback(!result.ok || result.hits.length === 0);
    } catch {
      if (reqId !== requestIdRef.current) return;
      const localHits = await searchLockerLocalFallback(trimmed, {
        limit: 60,
        filters: activeFilters,
      });
      if (reqId !== requestIdRef.current) return;
      setHits(localHits);
      setFacetDistribution(undefined);
      setEstimatedTotal(localHits.length > 0 ? localHits.length : undefined);
      setUsingLocalFallback(true);
    } finally {
      if (reqId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void runSearch(query, filters);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, filters, runSearch]);

  const processed = useMemo(() => processLockerSearchHits(hits), [hits]);

  const filterCount = activeFilterCount(filters);

  const artistOptions = facetOptions(facetDistribution, 'artist');
  const genreOptions = facetOptions(facetDistribution, 'genre');
  const yearOptions = facetOptions(facetDistribution, 'year');
  const sourceOptions = facetOptions(facetDistribution, 'source');
  const releaseGroupOptions = releaseGroupFacetOptions(facetDistribution);

  const clearFilters = () => setFilters(EMPTY_FILTERS);

  const playHits = (rows: Tier34SearchHit[]) => {
    const envs = rows.map(hitToEnvelope);
    if (envs.length === 0) return;
    if (onPlayAlbum) onPlayAlbum(envs, false);
    else onPlay(envs[0]!);
  };

  const renderTrackRow = (hit: Tier34SearchHit, index: number) => (
    <li key={hit.id} className="locker-search-row group">
      <span className="locker-search-row-index">{index + 1}</span>
      <button
        type="button"
        className="locker-search-row-main touch-manipulation"
        onClick={() => onPlay(hitToEnvelope(hit))}
      >
        <span className="locker-search-row-title">{hit.title}</span>
        <span className="locker-search-row-meta">
          {hit.artist}
          {hit.album ? ` · ${hit.album}` : ''}
          {hit.year ? ` · ${hit.year}` : ''}
        </span>
      </button>
      <span className="locker-search-row-badges">
        {hit.lossless ? <span className="locker-search-badge">LOSSLESS</span> : null}
        {hit.source ? <span className="locker-search-badge locker-search-badge--dim">{hit.source}</span> : null}
      </span>
      <button
        type="button"
        className="locker-search-play touch-manipulation"
        aria-label={`Play ${hit.title}`}
        onClick={() => onPlay(hitToEnvelope(hit))}
      >
        <Play className="w-4 h-4 ml-0.5" />
      </button>
    </li>
  );

  const renderAlbumCard = (album: LockerSearchAlbumResult) => (
    <article
      key={album.key}
      className="locker-search-album-card touch-manipulation"
      role="button"
      tabIndex={0}
      onClick={() => playHits(album.hits)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          playHits(album.hits);
        }
      }}
    >
      <div
        className="locker-search-album-art"
        style={{ background: seedGradient(album.title) }}
      >
        <Disc className="w-8 h-8 text-[var(--text-dim)]" />
        {album.editionCount > 1 ? (
          <span className="locker-search-edition-badge">{album.editionCount} ed.</span>
        ) : null}
      </div>
      <div className="locker-search-album-meta">
        <p className="locker-search-album-title">{album.title}</p>
        <p className="locker-search-album-artist">{album.artist}</p>
        <p className="locker-search-album-sub">
          {album.trackCount} tracks
          {album.year ? ` · ${album.year}` : ''}
          {album.genre ? ` · ${album.genre}` : ''}
        </p>
      </div>
    </article>
  );

  const renderArtistRow = (artist: LockerSearchArtistResult, index: number) => (
    <li key={artist.key} className="locker-search-row group">
      <span className="locker-search-row-index">{index + 1}</span>
      <button
        type="button"
        className="locker-search-row-main touch-manipulation"
        onClick={() => onSelectArtist?.(artist.name)}
      >
        <span className="locker-search-row-title flex items-center gap-2">
          <User className="w-3.5 h-3.5 text-accent shrink-0" />
          {artist.name}
        </span>
        <span className="locker-search-row-meta">
          {artist.trackCount} tracks · {artist.albumCount} albums
        </span>
      </button>
      <button
        type="button"
        className="locker-search-filter-chip touch-manipulation"
        onClick={() => setFilters((f) => ({ ...f, artist: artist.name }))}
      >
        Filter
      </button>
    </li>
  );

  const renderCollectionCard = (collection: LockerSearchCollectionResult) => (
    <article
      key={collection.collectionKey}
      className="locker-search-collection-card touch-manipulation"
      role="button"
      tabIndex={0}
      onClick={() => {
        if (onOpenCollection) {
          onOpenCollection(collection.collectionKey, collection.albums[0]?.key);
          return;
        }
        playHits(collection.tracks);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (onOpenCollection) onOpenCollection(collection.collectionKey);
          else playHits(collection.tracks);
        }
      }}
    >
      <div
        className="locker-search-collection-cover"
        style={{ background: seedGradient(collection.title) }}
      >
        <Disc className="w-10 h-10 text-[var(--text-dim)]" />
      </div>
      <div className="locker-search-collection-body">
        <p className="locker-search-collection-title">{collection.title}</p>
        <p className="locker-search-collection-artist">{collection.artist}</p>
        <p className="locker-search-collection-sub font-mono">
          {collection.trackCount} tracks
          {collection.editionCount > 1 ? ` · ${collection.editionCount} editions` : ''}
          {collection.releaseGroupId ? ' · release group' : ''}
        </p>
        {collection.editionCount > 1 ? (
          <div className="locker-search-editions">
            {collection.albums.map((edition) => (
              <button
                key={edition.key}
                type="button"
                className="locker-search-edition-pill touch-manipulation"
                onClick={(e) => {
                  e.stopPropagation();
                  playHits(edition.hits);
                }}
              >
                {edition.title}
                <span className="locker-search-edition-pill-meta">
                  {edition.trackCount}
                  {edition.year ? ` · ${edition.year}` : ''}
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );

  const resultCount =
    mode === 'tracks'
      ? processed.tracks.length
      : mode === 'albums'
        ? processed.albums.length
        : mode === 'artists'
          ? processed.artists.length
          : processed.collections.length;

  return (
    <section className="locker-search font-mono" aria-label="Locker search">
      <div className="locker-search-bar">
        <Search className="w-4 h-4 text-accent shrink-0" aria-hidden />
        <input
          ref={lockerSearchField.setInputRef}
          type="text"
          {...imeSearchInputProps}
          value={lockerSearchField.value}
          onChange={lockerSearchField.onChange}
          onInput={lockerSearchField.onInput}
          onCompositionStart={lockerSearchField.onCompositionStart}
          onCompositionEnd={lockerSearchField.onCompositionEnd}
          placeholder="Search artist, album, track, genre, year, label…"
          className="locker-search-input focus-accent"
          aria-label="Search locker"
          enterKeyHint="search"
        />
        {query ? (
          <button
            type="button"
            className="locker-search-clear touch-manipulation"
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        ) : null}
        <button
          type="button"
          className={`locker-search-filter-toggle touch-manipulation ${filtersOpen ? 'locker-search-filter-toggle--active' : ''}`}
          onClick={() => setFiltersOpen((o) => !o)}
          aria-expanded={filtersOpen}
        >
          <Filter className="w-4 h-4" />
          {filterCount > 0 ? <span className="locker-search-filter-count">{filterCount}</span> : null}
        </button>
        {onClose ? (
          <button type="button" className="locker-search-close touch-manipulation" onClick={onClose}>
            Close
          </button>
        ) : null}
      </div>

      <nav className="locker-search-modes" aria-label="Search mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`locker-search-mode touch-manipulation ${mode === m.id ? 'locker-search-mode--active' : ''}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>

      {filtersOpen ? (
        <div className="locker-search-filters">
          <label className="locker-search-filter-field">
            Artist
            <select
              value={filters.artist ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, artist: e.target.value || undefined }))
              }
              className="focus-accent"
            >
              <option value="">Any</option>
              {artistOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="locker-search-filter-field">
            Genre
            <select
              value={filters.genre ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, genre: e.target.value || undefined }))
              }
              className="focus-accent"
            >
              <option value="">Any</option>
              {genreOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="locker-search-filter-field">
            Year
            <select
              value={filters.year ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, year: e.target.value || undefined }))
              }
              className="focus-accent"
            >
              <option value="">Any</option>
              {yearOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="locker-search-filter-field">
            Source
            <select
              value={filters.source ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, source: e.target.value || undefined }))
              }
              className="focus-accent"
            >
              <option value="">Any</option>
              {sourceOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="locker-search-filter-field">
            Release group
            <select
              value={filters.releaseGroupId ?? ''}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  releaseGroupId: e.target.value || undefined,
                }))
              }
              className="focus-accent"
            >
              <option value="">Any</option>
              {releaseGroupOptions.map((rg) => (
                <option key={rg.id} value={rg.id}>
                  {rg.id.slice(0, 8)}… ({rg.count})
                </option>
              ))}
            </select>
          </label>
          <label className="locker-search-filter-field locker-search-filter-field--checkbox">
            <input
              type="checkbox"
              checked={filters.lossless === true}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  lossless: e.target.checked ? true : undefined,
                }))
              }
            />
            Lossless only
          </label>
          {filterCount > 0 ? (
            <button
              type="button"
              className="locker-search-clear-filters touch-manipulation"
              onClick={clearFilters}
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="locker-search-status">
        {loading ? (
          <span className="flex items-center gap-2 text-[var(--text-dim)]">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
            Searching…
          </span>
        ) : query.trim().length < 2 ? (
          <span className="text-[var(--text-dim)]">Type at least 2 characters</span>
        ) : (
          <span className="text-[var(--text-dim)]">
            {resultCount} {mode}
            {estimatedTotal && estimatedTotal > hits.length && !usingLocalFallback
              ? ` · ~${estimatedTotal} indexed`
              : ''}
            {usingLocalFallback ? ' · on-device fallback' : ''}
          </span>
        )}
      </div>

      {query.trim().length >= 2 && !loading && resultCount === 0 ? (
        <p className="locker-search-empty">
          No locker matches for “{query.trim()}”.
          {usingLocalFallback
            ? ' Meilisearch and on-device scan found nothing — browse Collection or import tracks.'
            : ''}
        </p>
      ) : null}

      {mode === 'tracks' && processed.tracks.length > 0 ? (
        <ul className="locker-search-list">{processed.tracks.map(renderTrackRow)}</ul>
      ) : null}

      {mode === 'albums' && processed.albums.length > 0 ? (
        <div className="locker-search-album-grid">
          {processed.albums.map(renderAlbumCard)}
        </div>
      ) : null}

      {mode === 'artists' && processed.artists.length > 0 ? (
        <ul className="locker-search-list">{processed.artists.map(renderArtistRow)}</ul>
      ) : null}

      {mode === 'collections' && processed.collections.length > 0 ? (
        <div className="locker-search-collection-list">
          {processed.collections.map(renderCollectionCard)}
        </div>
      ) : null}
    </section>
  );
}
