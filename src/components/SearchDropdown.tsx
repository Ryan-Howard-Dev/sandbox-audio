import React, { useEffect, useRef } from 'react';
import { ListMusic, Loader2, Play, Search, X } from 'lucide-react';
import CatalogArtThumb from './CatalogArtThumb';
import type { ExploreGroup } from '../exploreCatalog';
import type {
  CatalogAlbum,
  CatalogArtist,
  CatalogSearchResult,
  CatalogTrack,
} from '../searchCatalog';
import type { UnifiedPlaylistResult } from '../unifiedSearch';
import type { QuickBrowseFilter } from '../exploreBrowseData';
import { resolveArtistRowArtwork } from '../artistImage';
import { resolveAlbumRowArtwork } from '../albumCover';
import { displayTrackTitle } from '../displaySanitize';
import { seedGradient } from '../seedGradient';
import SearchBrowsePanel from './SearchBrowsePanel';
import SearchHistoryThumb from './SearchHistoryThumb';
import { RecentSearchRowBody } from './recentSearchRow';
import type { SearchHistoryEntry } from '../searchHistory';
import { historyEntryKey } from '../searchHistory';
import { isAndroid } from '../platformEnv';

export interface SearchDropdownProps {
  query: string;
  open: boolean;
  loading: boolean;
  catalog: CatalogSearchResult;
  playlists?: UnifiedPlaylistResult[];
  podcastsEnabled?: boolean;
  activeIndex?: number;
  connectivityHint?: string | null;
  dropdownRef?: React.Ref<HTMLDivElement>;
  onSelectSuggestion: (suggestion: string) => void;
  onSelectArtist: (artist: CatalogArtist) => void;
  onSelectAlbum: (album: CatalogAlbum) => void;
  onSelectTrack: (track: CatalogTrack) => void;
  onSelectPlaylist?: (playlist: UnifiedPlaylistResult) => void;
  onViewAllResults: () => void;
  onBrowsePick: (label: string, group: ExploreGroup) => void;
  onQuickFilter: (filter: QuickBrowseFilter) => void;
  recentSearches?: SearchHistoryEntry[];
  onSelectRecent?: (entry: SearchHistoryEntry) => void;
  onRemoveRecent?: (entry: SearchHistoryEntry) => void;
  onClearHistory?: () => void;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  const q = query.trim();
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <span className="search-dropdown-highlight">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

function ExplicitBadge() {
  return (
    <span className="font-mono text-[8px] px-1 py-0.5 rounded border border-[var(--border)] text-[var(--text-dim)] uppercase shrink-0">
      E
    </span>
  );
}

function LocalBadge() {
  return (
    <span className="search-dropdown-locker-badge">Offline</span>
  );
}

function isLocalId(id: string): boolean {
  return id.startsWith('local-');
}

function rowClass(active: boolean): string {
  return `search-dropdown-row touch-manipulation${active ? ' search-dropdown-row--active' : ''}`;
}

const TAP_SLOP_PX = 10;

/** Distinguish tap from scroll — do not preventDefault on pointerdown (blocks Android scroll). */
function bindScrollSafeTap(onActivate: () => void) {
  const starts = new WeakMap<HTMLElement, { x: number; y: number; pointerId: number }>();
  return {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      starts.set(e.currentTarget, {
        x: e.clientX,
        y: e.clientY,
        pointerId: e.pointerId,
      });
    },
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => {
      const start = starts.get(e.currentTarget);
      starts.delete(e.currentTarget);
      if (!start || start.pointerId !== e.pointerId) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy <= TAP_SLOP_PX * TAP_SLOP_PX) {
        onActivate();
      }
    },
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => {
      starts.delete(e.currentTarget);
    },
  };
}

/** Mobile WebView: activate on confirmed tap (not scroll). */
function bindDropdownRow(
  index: number,
  onActivate: () => void,
  rowRefs: React.MutableRefObject<Map<number, HTMLButtonElement>>,
  activeIndex: number,
) {
  const tap = bindScrollSafeTap(onActivate);
  return {
    ref: (el: HTMLButtonElement | null) => {
      if (el) rowRefs.current.set(index, el);
      else rowRefs.current.delete(index);
    },
    className: rowClass(activeIndex === index),
    ...tap,
  };
}

function bindPointerAction(onActivate: () => void) {
  return bindScrollSafeTap(onActivate);
}

export default function SearchDropdown({
  query,
  open,
  loading,
  catalog,
  playlists = [],
  podcastsEnabled = false,
  activeIndex = -1,
  connectivityHint = null,
  dropdownRef,
  onSelectSuggestion,
  onSelectArtist,
  onSelectAlbum,
  onSelectTrack,
  onSelectPlaylist,
  onViewAllResults,
  onBrowsePick,
  onQuickFilter,
  recentSearches = [],
  onSelectRecent,
  onRemoveRecent,
  onClearHistory,
}: SearchDropdownProps) {
  const rowRefs = useRef<Map<number, HTMLButtonElement>>(new Map());
  let rowIndex = 0;

  useEffect(() => {
    // Android MainActivity already resizes the WebView for IME — skip visualViewport keyboard math.
    if (isAndroid()) return;

    const vv = window.visualViewport;
    if (!vv) return;

    const handler = () => {
      const keyboardHeight = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty('--keyboard-height', `${keyboardHeight}px`);
    };

    handler();
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
      document.documentElement.style.setProperty('--keyboard-height', '0px');
    };
  }, []);

  useEffect(() => {
    if (activeIndex < 0) return;
    rowRefs.current.get(activeIndex)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  if (!open) return null;

  const trimmedQuery = query.trim();
  const showBrowse = trimmedQuery.length < 2;
  const catalogSuggestionSet = new Set(catalog.suggestions.map((s) => s.toLowerCase()));
  const visibleRecentSearches = recentSearches.filter((entry) => {
    if (entry.kind !== 'query') return true;
    return !catalogSuggestionSet.has(entry.query.toLowerCase());
  });

  const activateRecent = (entry: SearchHistoryEntry) => {
    if (onSelectRecent) {
      onSelectRecent(entry);
      return;
    }
    if (entry.kind === 'query') onSelectSuggestion(entry.query);
  };

  const renderRecentRow = (entry: SearchHistoryEntry, idx?: number) => {
    const key = historyEntryKey(entry);
    const row =
      idx === undefined ? (
        <button
          type="button"
          className={rowClass(false)}
          {...bindPointerAction(() => activateRecent(entry))}
        >
          <SearchHistoryThumb entry={entry} />
          <RecentSearchRowBody entry={entry} query={trimmedQuery} highlight={highlightMatch} />
        </button>
      ) : (
        <button type="button" {...rowProps(idx, () => activateRecent(entry))}>
          <SearchHistoryThumb entry={entry} />
          <RecentSearchRowBody entry={entry} query={trimmedQuery} highlight={highlightMatch} />
        </button>
      );

    return (
      <li key={key} className="search-dropdown-recent-row">
        {row}
        {onRemoveRecent ? (
          <button
            type="button"
            className="search-dropdown-remove-recent touch-manipulation"
            aria-label={`Remove ${entry.kind === 'query' ? entry.query : entry.kind === 'artist' ? entry.name : entry.title} from recent searches`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onRemoveRecent(entry)}
          >
            <X className="w-3 h-3" />
          </button>
        ) : null}
      </li>
    );
  };

  const hasResults =
    visibleRecentSearches.length > 0 ||
    catalog.suggestions.length > 0 ||
    catalog.artists.length > 0 ||
    catalog.albums.length > 0 ||
    catalog.tracks.length > 0 ||
    playlists.length > 0;

  const rowProps = (index: number, onActivate: () => void) =>
    bindDropdownRow(index, onActivate, rowRefs, activeIndex);

  const nextIndex = () => rowIndex++;

  return (
    <div
      ref={dropdownRef}
      className={`search-dropdown absolute top-[calc(100%+0.35rem)] left-0 right-0 z-[110] rounded-xl overflow-hidden search-dropdown--enter${showBrowse ? ' search-dropdown--browse' : ''}`}
      role={showBrowse ? 'dialog' : 'listbox'}
      aria-label={showBrowse ? 'Browse music' : 'Search suggestions and results'}
    >
      {connectivityHint ? (
        <p className="search-dropdown-connectivity-hint">{connectivityHint}</p>
      ) : null}

      <div className="search-dropdown-scroll overflow-y-auto music-scrollbar">
        {showBrowse ? (
          <>
            <p className="search-dropdown-empty-lead">What do you want to play?</p>
            {visibleRecentSearches.length > 0 ? (
              <section className="border-b border-[var(--border)]">
                <div className="search-dropdown-section-head">
                  <p className="search-dropdown-section-title">Recent searches</p>
                  {onClearHistory ? (
                    <button
                      type="button"
                      className="search-dropdown-clear-history touch-manipulation"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={onClearHistory}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <ul>
                  {visibleRecentSearches.map((entry) => renderRecentRow(entry))}
                </ul>
              </section>
            ) : null}
            <SearchBrowsePanel
              onPickCategory={onBrowsePick}
              onQuickFilter={onQuickFilter}
              podcastsEnabled={podcastsEnabled}
            />
          </>
        ) : null}

        {!showBrowse && loading && !hasResults && (
          <div className="flex items-center gap-2 px-4 py-6 font-mono text-[10px] uppercase text-accent">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Searching…
          </div>
        )}

        {!showBrowse && visibleRecentSearches.length > 0 && (
          <section className="border-b border-[var(--border)]">
            <p className="search-dropdown-section-title px-4 pt-3 pb-1">Recent searches</p>
            <ul>
              {visibleRecentSearches.map((entry) => {
                const idx = nextIndex();
                return renderRecentRow(entry, idx);
              })}
            </ul>
          </section>
        )}

        {!showBrowse && catalog.suggestions.length > 0 && (
          <section className="border-b border-[var(--border)]">
            <p className="search-dropdown-section-title px-4 pt-3 pb-1">Try searching for</p>
            <ul>
              {catalog.suggestions.map((suggestion) => {
                const idx = nextIndex();
                return (
                  <li key={suggestion}>
                    <button type="button" {...rowProps(idx, () => onSelectSuggestion(suggestion))}>
                      <Search className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="font-mono text-xs text-[var(--text)] truncate">
                        {highlightMatch(suggestion, query)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!showBrowse && playlists.length > 0 && (
          <section className="border-b border-[var(--border)]">
            <p className="search-dropdown-section-title px-4 pt-3 pb-1">Playlists</p>
            <ul>
              {playlists.map((playlist) => {
                const idx = nextIndex();
                return (
                  <li key={playlist.id}>
                    <button type="button" {...rowProps(idx, () => onSelectPlaylist?.(playlist))}>
                      <div
                        className="w-10 h-10 shrink-0 flex items-center justify-center border border-[var(--border)] rounded-md"
                        style={{ background: seedGradient(playlist.name) }}
                      >
                        <ListMusic className="w-4 h-4 text-text-primary/80" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold text-[var(--text)] truncate uppercase">
                          {highlightMatch(playlist.name, query)}
                        </p>
                        <p className="font-mono text-[9px] uppercase text-[var(--text-dim)]">
                          Playlist · {playlist.trackCount} tracks
                          {playlist.isSmart ? ' · Smart' : ''}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!showBrowse &&
        (catalog.artists.length > 0 || catalog.albums.length > 0 || catalog.tracks.length > 0) ? (
          <section>
            <p className="search-dropdown-section-title px-4 pt-3 pb-1">Top results</p>

            {catalog.tracks.slice(0, 1).map((track) => {
              const idx = nextIndex();
              return (
                <button
                  key={`top-${track.id}`}
                  type="button"
                  {...rowProps(idx, () => onSelectTrack(track))}
                  className={`${rowClass(activeIndex === idx)} search-dropdown-top-hit`}
                >
                  <CatalogArtThumb url={track.artworkUrl} title={track.title} fallback={{ album: track.album ?? track.title, artist: track.artist }} />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-sm font-bold text-[var(--text)] truncate uppercase">
                      {highlightMatch(displayTrackTitle(track.title), query)}
                    </p>
                    <p className="font-mono text-[10px] uppercase text-[var(--text-dim)] truncate">
                      {track.artist}
                      {track.album ? ` · ${track.album}` : ''}
                    </p>
                  </div>
                  <span className="search-dropdown-play-chip" aria-hidden>
                    <Play className="w-3.5 h-3.5" />
                    Play
                  </span>
                  {isLocalId(track.id) ? <LocalBadge /> : null}
                </button>
              );
            })}

            {catalog.artists.map((artist) => {
              const idx = nextIndex();
              return (
                <button
                  key={artist.id}
                  type="button"
                  {...rowProps(idx, () => onSelectArtist(artist))}
                >
                  <CatalogArtThumb
                    url={resolveArtistRowArtwork(artist, catalog.albums, catalog.tracks)}
                    title={artist.name}
                    round
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono text-xs font-bold text-[var(--text)] truncate uppercase">
                        {highlightMatch(artist.name, query)}
                      </p>
                      {isLocalId(artist.id) ? <LocalBadge /> : null}
                    </div>
                    <p className="font-mono text-[9px] uppercase text-[var(--text-dim)]">Artist</p>
                  </div>
                </button>
              );
            })}

            {catalog.albums.map((album) => {
              const idx = nextIndex();
              return (
                <button
                  key={album.id}
                  type="button"
                  {...rowProps(idx, () => onSelectAlbum(album))}
                >
                  <CatalogArtThumb
                    url={resolveAlbumRowArtwork(album, catalog.tracks)}
                    title={album.title}
                    fallback={{ album: album.title, artist: album.artist }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono text-xs font-bold text-[var(--text)] truncate uppercase">
                        {highlightMatch(album.title, query)}
                      </p>
                      {album.explicit && <ExplicitBadge />}
                      {isLocalId(album.id) ? <LocalBadge /> : null}
                    </div>
                    <p className="font-mono text-[9px] uppercase text-[var(--text-dim)] truncate">
                      Album · {album.artist}
                      {album.releaseYear ? ` · ${album.releaseYear}` : ''}
                    </p>
                  </div>
                </button>
              );
            })}

            {catalog.tracks.slice(1).map((track) => {
              const idx = nextIndex();
              return (
                <button
                  key={track.id}
                  type="button"
                  {...rowProps(idx, () => onSelectTrack(track))}
                >
                  <CatalogArtThumb url={track.artworkUrl} title={track.title} fallback={{ album: track.album ?? track.title, artist: track.artist }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <p className="font-mono text-xs font-bold text-[var(--text)] truncate uppercase">
                        {highlightMatch(displayTrackTitle(track.title), query)}
                      </p>
                      {track.explicit && <ExplicitBadge />}
                      {isLocalId(track.id) ? <LocalBadge /> : null}
                    </div>
                    <p className="font-mono text-[9px] uppercase text-[var(--text-dim)] truncate">
                      Track · {track.artist}
                    </p>
                  </div>
                  <Play className="w-3.5 h-3.5 text-accent shrink-0 opacity-70" aria-hidden />
                </button>
              );
            })}
          </section>
        ) : null}

        {!showBrowse && !loading && !hasResults && (
          <div className="px-4 py-6">
            <p className="font-mono text-[10px] uppercase text-center text-[var(--text-dim)]">
              No matches for &ldquo;{query}&rdquo;
            </p>
          </div>
        )}
      </div>

      {!showBrowse && hasResults ? (
        (() => {
          const idx = nextIndex();
          return (
            <button
              type="button"
              {...rowProps(idx, onViewAllResults)}
              className={`${rowClass(activeIndex === idx)} search-dropdown-view-all`}
            >
              View all results for &ldquo;{query}&rdquo;
            </button>
          );
        })()
      ) : null}
    </div>
  );
}
