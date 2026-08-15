/**
 * Search runtime for the shell — runSearch, explore/browse search, dropdown debounce and
 * outside-click effects, snapshot/popstate/back history, and the dropdown activate/submit/
 * history helpers. Extracted from sandboxLayer3 with no JSX.
 *
 * Search *state* (searchInput, searchHits, searchDropdownOpen, refs, etc.) stays declared in the
 * shell: it is set up early alongside unrelated nav/UI state, and non-search consumers throughout
 * the file (rendering, playback, download flows) read and write those setters directly. This
 * module only holds the behavior, called at the original positions from SandboxShell:
 *
 *   1. useShellSearchRunner       — where `runSearch` used to be declared. E2E handler
 *      registration stays in the shell (it wires many non-search handlers too); it just reads
 *      `runSearch` from this hook's return.
 *   2. useShellExploreSearch      — where `runExploreSearch` / `handleBrowsePick` used to be.
 *   3. useShellSearchDropdownEffects — where the searchActiveIndex-reset, catalog/unified
 *      debounce, and outside-click effects used to be. Call this between the same neighboring
 *      effects as before.
 *   4. useShellSearchHistoryNav   — where `clearSearchView` used to start (folds in
 *      `restoreSearchSnapshot`, which used to sit a few lines earlier — it is a plain callback
 *      with no effect-ordering concerns, so moving it into this hook is safe). Popstate here
 *      must stay between the search-snapshot logic and `handleShellBack`, which is declared right
 *      after this call in the shell — do not pull popstate across handleShellBack.
 *   5. useShellSearchDrillNav     — where `handleSelectArtist` used to start (also covers
 *      `handleOpenArtistByName`, `handleOpenAlbumByName`, `handleSelectAlbum`).
 *   6. useShellSearchNavigate     — where `navigateSearchQuery` / `handleSelectSuggestion` used
 *      to be.
 *   7. useShellSearchDropdownActions — where `handleSelectTrack` used to start (also covers
 *      `handleSelectPlaylist`, `handleActivateRecentSearch`, `searchDropdownItems`,
 *      `activateSearchDropdownItem`, `submitSearch`, `handleRemoveRecentSearch`,
 *      `handleClearSearchHistory`, `handleClearSearchInput`).
 *
 * None of these declare hooks conditionally, so call order across renders is always consistent;
 * what matters is that the *effect*-bearing pieces (dropdown effects, popstate) keep the same
 * relative order versus the other effects still declared inline in the shell.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import {
  engineSearch,
  engineExploreSearch,
  type ResolvedSearchHit,
} from '../sandboxLayer2';
import {
  resolveCatalogArtistByName,
  buildCatalogArtistStub,
  catalogDisplayArtistName,
  catalogEntityArtistName,
  findCatalogArtistByName,
  isLikelyArtistNameQuery,
  isLikelyTrackTitleQuery,
  needsWebTrackSupplement,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogTrack,
  type CatalogSearchResult,
} from '../searchCatalog';
import {
  matchSearchHistory,
  recordSearchQuery,
  recordSearchArtist,
  recordSearchAlbum,
  recordSearchTrack,
  removeSearchHistoryEntry,
  clearSearchHistory,
  historyEntryToArtist,
  historyEntryToAlbum,
  historyEntryToTrack,
  type SearchHistoryEntry,
} from '../searchHistory';
import {
  buildSearchDropdownItems,
  type SearchDropdownItem,
} from '../searchDropdownModel';
import {
  EMPTY_UNIFIED,
  instantLocalLockerSearch,
  runUnifiedSearch,
  applyWebSupplementToUnified,
  type UnifiedPlaylistResult,
  type UnifiedSearchResult,
  type UnifiedSearchSection,
} from '../unifiedSearch';
import { fetchWebCatalogTracks, WEB_LEAK_SEARCH_MAX_WAIT_MS } from '../webCatalogSearch';
import { searchYouTubeTracks } from '../youtubeSearch';
import { exploreDisplayQuery, type ExploreGroup } from '../exploreCatalog';
import { isNewMusicQuery, newMusicSearchLabel } from '../newMusicQuery';
import { searchPodcastsUnified } from '../podcastCatalog';
import type { PodcastSearchHit } from '../podcastSearch';
import type { PodcastCatalogEpisodeHit } from '../podcastCatalog';
import {
  requestShellScrollRestore,
  saveShellScroll,
  SEARCH_RESULTS_SCROLL_KEY,
  searchArtistScrollKey,
} from '../scrollRestore';
import { logE2e } from '../e2eDevAction';
import type { StationId } from './shellNav';
import type { LockerSectionId } from '../stations/CollectionView';

const EMPTY_CATALOG: CatalogSearchResult = {
  suggestions: [],
  artists: [],
  albums: [],
  tracks: [],
};

type Setter<T> = Dispatch<SetStateAction<T>>;

/** ---- 1. runSearch ------------------------------------------------------------------------ */

export type ShellSearchRunnerArgs = {
  station: StationId;
  podcastsEnabled: boolean;
  finishMobileSearchNavigation: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  setSearchHistoryTick: Setter<number>;
  setSearchInput: Setter<string>;
  setSearchQuery: Setter<string>;
  setSearchLoading: Setter<boolean>;
  setSearchHits: Setter<ResolvedSearchHit[]>;
  setSearchResults: Setter<MediaEnvelope[]>;
  setSearchFromCache: Setter<boolean>;
  setWebSupplementLoading: Setter<boolean>;
  setWebSupplementError: Setter<string | null>;
  webSupplementTracksRef: MutableRefObject<CatalogTrack[]>;
  setPodcastSearchHits: Setter<PodcastSearchHit[]>;
  setPodcastCatalogHits: Setter<PodcastCatalogEpisodeHit[]>;
  setSelectedArtist: Setter<CatalogArtist | null>;
  setAlbumDrillQuery: Setter<string | null>;
  setAlbumDrillAlbum: Setter<CatalogAlbum | null>;
  setAlbumDrillTracks: Setter<CatalogTrack[]>;
  albumHistoryPushedRef: MutableRefObject<boolean>;
  searchSnapshotRef: MutableRefObject<{
    query: string;
    hits: ResolvedSearchHit[];
    results: MediaEnvelope[];
    fromCache: boolean;
    input: string;
  } | null>;
  setAppToast: Setter<string | null>;
  setSearchDropdownOpen: Setter<boolean>;
  setSearchSection: Setter<UnifiedSearchSection>;
  searchReturnStationRef: MutableRefObject<StationId>;
  searchHistoryPushedRef: MutableRefObject<boolean>;
  setStation: Setter<StationId>;
  setNavOpen: Setter<boolean>;
  searchRunGenerationRef: MutableRefObject<number>;
  unifiedSearchResultRef: MutableRefObject<UnifiedSearchResult>;
  setUnifiedSearchResult: Setter<UnifiedSearchResult>;
  setSearchCatalog: Setter<CatalogSearchResult>;
  setUnifiedSearchLoading: Setter<boolean>;
};

export function useShellSearchRunner({
  station,
  podcastsEnabled,
  finishMobileSearchNavigation,
  t,
  setSearchHistoryTick,
  setSearchInput,
  setSearchQuery,
  setSearchLoading,
  setSearchHits,
  setSearchResults,
  setSearchFromCache,
  setWebSupplementLoading,
  setWebSupplementError,
  webSupplementTracksRef,
  setPodcastSearchHits,
  setPodcastCatalogHits,
  setSelectedArtist,
  setAlbumDrillQuery,
  setAlbumDrillAlbum,
  setAlbumDrillTracks,
  albumHistoryPushedRef,
  searchSnapshotRef,
  setAppToast,
  setSearchDropdownOpen,
  setSearchSection,
  searchReturnStationRef,
  searchHistoryPushedRef,
  setStation,
  setNavOpen,
  searchRunGenerationRef,
  unifiedSearchResultRef,
  setUnifiedSearchResult,
  setSearchCatalog,
  setUnifiedSearchLoading,
}: ShellSearchRunnerArgs) {
  const runSearch = useCallback(
    async (
      q: string,
      options?: { preserveArtist?: boolean; albumHint?: CatalogAlbum; albumDrill?: boolean },
    ) => {
      const trimmed = q.trim();
      if (!trimmed) return 0;
      recordSearchQuery(trimmed);
      setSearchHistoryTick((n) => n + 1);
      setSearchInput(trimmed);
      setSearchQuery(trimmed);
      setSearchLoading(true);
      setSearchHits([]);
      setSearchResults([]);
      setSearchFromCache(false);
      setWebSupplementLoading(false);
      setWebSupplementError(null);
      webSupplementTracksRef.current = [];
      setPodcastSearchHits([]);
      setPodcastCatalogHits([]);
      /*
       * Opening an album is not a search, even though it reuses this function.
       *
       * The album view renders result.albumTracks and nothing else, so the podcast lookup, the
       * YouTube supplement and the web-catalog supplement below cannot contribute anything to it.
       * They were still all firing, and on a phone they compete for the same network the album
       * tracks are arriving on, which is why an album took so long to appear.
       */
      const drillingIntoAlbum = options?.albumDrill === true;
      if (podcastsEnabled && trimmed.length >= 2 && !drillingIntoAlbum) {
        void searchPodcastsUnified(trimmed).then(({ localHits, catalogHits }) => {
          setPodcastSearchHits(localHits);
          setPodcastCatalogHits(catalogHits);
        });
      }
      if (!options?.preserveArtist) {
        setSelectedArtist(null);
        if (!options?.albumDrill) {
          setAlbumDrillQuery(null);
          setAlbumDrillAlbum(null);
          setAlbumDrillTracks([]);
        }
        albumHistoryPushedRef.current = false;
        searchSnapshotRef.current = null;
      }
      if (options?.albumDrill) {
        setAlbumDrillQuery(trimmed);
        setAlbumDrillAlbum(options.albumHint ?? null);
        setAppToast(null);
      }
      setSearchDropdownOpen(false);
      setSearchSection(isLikelyTrackTitleQuery(trimmed) ? 'tracks' : 'all');
      if (station !== 'search') {
        searchReturnStationRef.current = station;
      }
      if (!options?.preserveArtist && !searchHistoryPushedRef.current) {
        window.history.pushState({ sandboxSearch: true }, '');
        searchHistoryPushedRef.current = true;
      }
      setStation('search');
      finishMobileSearchNavigation();
      setNavOpen(false);
      const runGen = ++searchRunGenerationRef.current;
      const supplementQuery = !drillingIntoAlbum && needsWebTrackSupplement(trimmed);
      const loadingGuardMs = supplementQuery
        ? WEB_LEAK_SEARCH_MAX_WAIT_MS
        : drillingIntoAlbum
          ? 12_000
          : 45_000;
      const loadingGuard = window.setTimeout(() => {
        if (searchRunGenerationRef.current !== runGen) return;
        setSearchLoading(false);
        setUnifiedSearchLoading(false);
        setWebSupplementLoading(false);
        if (supplementQuery) {
          setWebSupplementError((prev) => prev ?? t('searchResults.onlineSearchTimedOut'));
        }
      }, loadingGuardMs);
      setUnifiedSearchLoading(true);

      const applyWebTracks = (tracks: CatalogTrack[]) => {
        if (tracks.length === 0) return;
        // Merge (dedupe by id) rather than replace, so parallel supplements — web-catalog and
        // YouTube — accumulate instead of clobbering each other.
        const byId = new Map<string, CatalogTrack>(
          webSupplementTracksRef.current.map((tk) => [tk.id, tk] as [string, CatalogTrack]),
        );
        for (const tk of tracks) if (!byId.has(tk.id)) byId.set(tk.id, tk);
        const merged: CatalogTrack[] = [...byId.values()];
        webSupplementTracksRef.current = merged;
        setWebSupplementError(null);
        setUnifiedSearchResult((prev) => {
          const next = applyWebSupplementToUnified(prev, merged, trimmed);
          setSearchCatalog(next.catalog);
          return next;
        });
      };

      // YouTube supplement — finds mixtapes, singles, demos, bootlegs and DJ sets the iTunes
      // catalog doesn't carry. Keyless via on-device yt-dlp; returns [] (no-op) off Android.
      // Deferred slightly so the primary catalog results and any immediate play tap get network
      // priority first (the resolve for a tapped track must not be starved by discovery calls).
      window.setTimeout(() => {
        if (searchRunGenerationRef.current !== runGen) return;
        if (drillingIntoAlbum) return;
        void searchYouTubeTracks(trimmed, 12)
          .then((ytTracks) => {
            if (searchRunGenerationRef.current !== runGen) return;
            if (ytTracks.length > 0) applyWebTracks(ytTracks);
          })
          .catch(() => {});
      }, 900);
      // NOTE: The Internet Archive supplement was removed from auto-search — resolving each
      // item's audio file meant 8+ archive.org requests per search, which flooded the network
      // and starved playback resolution (a tapped song would sit stuck on "loading"). The
      // searchArchiveOrgTracks helper remains for a future explicit "search Archive.org" action.

      const finalizeUnifiedWithWeb = (unified: UnifiedSearchResult) => {
        const web = webSupplementTracksRef.current;
        if (web.length === 0) return unified;
        return applyWebSupplementToUnified(unified, web, trimmed);
      };

      if (supplementQuery) {
        setWebSupplementLoading(true);
        void fetchWebCatalogTracks(trimmed, {
          maxWaitMs: WEB_LEAK_SEARCH_MAX_WAIT_MS,
          onPartial: (tracks) => {
            if (searchRunGenerationRef.current !== runGen) return;
            applyWebTracks(tracks);
          },
        })
          .then((tracks) => {
            if (searchRunGenerationRef.current !== runGen) return;
            if (tracks.length > 0) {
              applyWebTracks(tracks);
              return;
            }
            const hasWeb = unifiedSearchResultRef.current.tracks.some((t) =>
              t.id.startsWith('youtube-'),
            );
            if (!hasWeb) setWebSupplementError(t('searchResults.onlineSearchTimedOut'));
          })
          .catch(() => {
            if (searchRunGenerationRef.current !== runGen) return;
            setWebSupplementError(t('searchResults.onlineSearchTimedOut'));
          })
          .finally(() => {
            if (searchRunGenerationRef.current === runGen) {
              setWebSupplementLoading(false);
            }
          });
      }

      void runUnifiedSearch(trimmed, {
        limit: 60,
        onArtistImagesUpdated: (unified) => {
          if (searchRunGenerationRef.current !== runGen) return;
          const merged = finalizeUnifiedWithWeb(unified);
          setUnifiedSearchResult(merged);
          setSearchCatalog(merged.catalog);
        },
      })
        .then((unified) => {
          if (searchRunGenerationRef.current !== runGen) return;
          const merged = finalizeUnifiedWithWeb(unified);
          setUnifiedSearchResult(merged);
          setSearchCatalog(merged.catalog);
        })
        .finally(() => {
          if (searchRunGenerationRef.current === runGen) {
            setUnifiedSearchLoading(false);
            window.clearTimeout(loadingGuard);
          }
        });

      void engineSearch(
        trimmed,
        (partial) => {
          if (searchRunGenerationRef.current !== runGen) return;
          setSearchHits(partial);
          setSearchResults(partial.map((h) => h.primaryEnvelope));
        },
        options?.albumHint,
        { catalogOnly: !needsWebTrackSupplement(trimmed) },
      )
        .then((result) => {
          if (searchRunGenerationRef.current !== runGen) return;
          setSearchHits(result.hits);
          setSearchResults(result.envelopes);
          setSearchFromCache(result.fromCache);
          const albumCtx = result.albumContext ?? options?.albumHint ?? null;
          const trackYear = result.albumTracks?.find((t) => t.releaseYear?.trim())?.releaseYear?.trim();
          const fetchedCount = result.albumTracks?.length ?? 0;
          const metaCount = Math.max(
            albumCtx?.trackCount ?? 0,
            options?.albumHint?.trackCount ?? 0,
          );
          const albumWithTracks =
            albumCtx && fetchedCount > 0
              ? {
                  ...albumCtx,
                  trackCount: Math.max(metaCount, fetchedCount) || fetchedCount,
                }
              : albumCtx;
          setAlbumDrillAlbum(
            albumWithTracks && trackYear && !albumWithTracks.releaseYear
              ? { ...albumWithTracks, releaseYear: trackYear }
              : albumWithTracks,
          );
          setAlbumDrillTracks(result.albumTracks ?? []);
        })
        .catch(() => {
          if (searchRunGenerationRef.current !== runGen) return;
          setSearchResults([]);
          setSearchHits([]);
          setAlbumDrillAlbum(null);
          setAlbumDrillTracks([]);
        })
        .finally(() => {
          if (searchRunGenerationRef.current === runGen) {
            setSearchLoading(false);
            window.clearTimeout(loadingGuard);
          }
        });
      return;
    },
    [station, podcastsEnabled, finishMobileSearchNavigation, t],
  );

  return { runSearch };
}

/** ---- 2. runExploreSearch + handleBrowsePick ---------------------------------------------- */

export type ShellExploreSearchArgs = {
  station: StationId;
  finishMobileSearchNavigation: () => void;
  setSearchInput: Setter<string>;
  setSearchQuery: Setter<string>;
  setSearchLoading: Setter<boolean>;
  setSearchHits: Setter<ResolvedSearchHit[]>;
  setSearchResults: Setter<MediaEnvelope[]>;
  setSearchFromCache: Setter<boolean>;
  setPodcastSearchHits: Setter<PodcastSearchHit[]>;
  setSelectedArtist: Setter<CatalogArtist | null>;
  setAlbumDrillAlbum: Setter<CatalogAlbum | null>;
  setAlbumDrillTracks: Setter<CatalogTrack[]>;
  setSearchDropdownOpen: Setter<boolean>;
  searchReturnStationRef: MutableRefObject<StationId>;
  searchHistoryPushedRef: MutableRefObject<boolean>;
  setStation: Setter<StationId>;
  setNavOpen: Setter<boolean>;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
};

export function useShellExploreSearch({
  station,
  finishMobileSearchNavigation,
  setSearchInput,
  setSearchQuery,
  setSearchLoading,
  setSearchHits,
  setSearchResults,
  setSearchFromCache,
  setPodcastSearchHits,
  setSelectedArtist,
  setAlbumDrillAlbum,
  setAlbumDrillTracks,
  setSearchDropdownOpen,
  searchReturnStationRef,
  searchHistoryPushedRef,
  setStation,
  setNavOpen,
  searchInputRef,
}: ShellExploreSearchArgs) {
  const runExploreSearch = useCallback(
    async (label: string, group: ExploreGroup = 'quick') => {
      const displayQuery = exploreDisplayQuery(group, label);
      setSearchInput(displayQuery);
      setSearchQuery(displayQuery);
      setSearchLoading(true);
      setSearchHits([]);
      setSearchResults([]);
      setSearchFromCache(false);
      setPodcastSearchHits([]);
      setSelectedArtist(null);
      setAlbumDrillAlbum(null);
      setAlbumDrillTracks([]);
      setSearchDropdownOpen(false);
      if (station !== 'search') {
        searchReturnStationRef.current = station;
      }
      if (!searchHistoryPushedRef.current) {
        window.history.pushState({ sandboxSearch: true }, '');
        searchHistoryPushedRef.current = true;
      }
      setStation('search');
      finishMobileSearchNavigation();
      setNavOpen(false);
      try {
        const result = await engineExploreSearch(group, label);
        setSearchHits(result.hits);
        setSearchResults(result.envelopes);
        setSearchFromCache(result.fromCache);
      } catch {
        setSearchResults([]);
        setSearchHits([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [station, finishMobileSearchNavigation],
  );

  const handleBrowsePick = useCallback(
    (label: string, group: ExploreGroup) => {
      setSearchDropdownOpen(false);
      searchInputRef.current?.blur();
      void runExploreSearch(label, group);
    },
    [runExploreSearch],
  );

  return { runExploreSearch, handleBrowsePick };
}

/** ---- 3. Dropdown debounce + outside-click effects ---------------------------------------- */

export type ShellSearchDropdownEffectsArgs = {
  searchInput: string;
  searchDropdownOpen: boolean;
  setSearchActiveIndex: Setter<number>;
  setCatalogLoading: Setter<boolean>;
  setSearchCatalog: Setter<CatalogSearchResult>;
  setUnifiedSearchResult: Setter<UnifiedSearchResult>;
  setSearchDropdownOpen: Setter<boolean>;
  catalogRequestRef: MutableRefObject<number>;
  searchFormRef: MutableRefObject<HTMLFormElement | null>;
  searchDropdownRef: MutableRefObject<HTMLDivElement | null>;
};

export function useShellSearchDropdownEffects({
  searchInput,
  searchDropdownOpen,
  setSearchActiveIndex,
  setCatalogLoading,
  setSearchCatalog,
  setUnifiedSearchResult,
  setSearchDropdownOpen,
  catalogRequestRef,
  searchFormRef,
  searchDropdownRef,
}: ShellSearchDropdownEffectsArgs) {
  useEffect(() => {
    setSearchActiveIndex(-1);
  }, [searchInput]);

  useEffect(() => {
    const q = searchInput.trim();
    if (!searchDropdownOpen) {
      setCatalogLoading(false);
      return;
    }

    if (q.length < 1) {
      setSearchCatalog(EMPTY_CATALOG);
      setUnifiedSearchResult(EMPTY_UNIFIED);
      setCatalogLoading(false);
      return;
    }

    const instantFrame = window.requestAnimationFrame(() => {
      const instant = instantLocalLockerSearch(q, 16);
      setSearchCatalog(instant);
      setUnifiedSearchResult((prev) => ({
        ...prev,
        catalog: instant,
        tracks: instant.tracks,
        albums: instant.albums,
        artists: instant.artists,
      }));
    });

    if (q.length < 2) {
      setCatalogLoading(false);
      return () => window.cancelAnimationFrame(instantFrame);
    }

    const requestId = ++catalogRequestRef.current;
    setCatalogLoading(true);

    const timer = window.setTimeout(() => {
      void runUnifiedSearch(q, {
        limit: 24,
        onArtistImagesUpdated: (unified) => {
          if (catalogRequestRef.current !== requestId) return;
          setUnifiedSearchResult(unified);
          setSearchCatalog(unified.catalog);
        },
      })
        .then((unified) => {
          if (catalogRequestRef.current !== requestId) return;
          setUnifiedSearchResult(unified);
          setSearchCatalog(unified.catalog);
        })
        .finally(() => {
          if (catalogRequestRef.current === requestId) setCatalogLoading(false);
        });
    }, 280);

    return () => {
      window.cancelAnimationFrame(instantFrame);
      window.clearTimeout(timer);
    };
  }, [searchInput, searchDropdownOpen]);

  useEffect(() => {
    if (!searchDropdownOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (searchFormRef.current?.contains(target)) return;
      if (searchDropdownRef.current?.contains(target)) return;
      setSearchDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [searchDropdownOpen]);
}

/** ---- 4. Snapshot restore, clear, popstate, and back handlers ----------------------------- */

export type ShellSearchHistoryNavArgs = {
  searchSnapshotRef: MutableRefObject<{
    query: string;
    hits: ResolvedSearchHit[];
    results: MediaEnvelope[];
    fromCache: boolean;
    input: string;
  } | null>;
  setSearchInput: Setter<string>;
  setSearchQuery: Setter<string>;
  setSearchHits: Setter<ResolvedSearchHit[]>;
  setSearchResults: Setter<MediaEnvelope[]>;
  setSearchFromCache: Setter<boolean>;
  setSearchLoading: Setter<boolean>;
  setAlbumDrillQuery: Setter<string | null>;
  setAlbumDrillAlbum: Setter<CatalogAlbum | null>;
  setAlbumDrillTracks: Setter<CatalogTrack[]>;
  albumHistoryPushedRef: MutableRefObject<boolean>;
  searchReturnStationRef: MutableRefObject<StationId>;
  setStation: Setter<StationId>;
  albumDrillQuery: string | null;
  selectedArtist: CatalogArtist | null;
  setSelectedArtist: Setter<CatalogArtist | null>;
  searchQuery: string;
  artistHistoryPushedRef: MutableRefObject<boolean>;
  searchHistoryPushedRef: MutableRefObject<boolean>;
  searchScrollParentRef: MutableRefObject<string>;
};

export function useShellSearchHistoryNav({
  searchSnapshotRef,
  setSearchInput,
  setSearchQuery,
  setSearchHits,
  setSearchResults,
  setSearchFromCache,
  setSearchLoading,
  setAlbumDrillQuery,
  setAlbumDrillAlbum,
  setAlbumDrillTracks,
  albumHistoryPushedRef,
  searchReturnStationRef,
  setStation,
  albumDrillQuery,
  selectedArtist,
  setSelectedArtist,
  searchQuery,
  artistHistoryPushedRef,
  searchHistoryPushedRef,
  searchScrollParentRef,
}: ShellSearchHistoryNavArgs) {
  const restoreSearchSnapshot = useCallback(() => {
    const snapshot = searchSnapshotRef.current;
    if (!snapshot) return;
    setSearchInput(snapshot.input);
    setSearchQuery(snapshot.query);
    setSearchHits(snapshot.hits);
    setSearchResults(snapshot.results);
    setSearchFromCache(snapshot.fromCache);
    setSearchLoading(false);
    requestShellScrollRestore(SEARCH_RESULTS_SCROLL_KEY);
  }, []);

  const clearSearchView = useCallback((returnStation?: StationId) => {
    setSearchQuery('');
    setSearchHits([]);
    setSearchResults([]);
    setSearchInput('');
    setSearchLoading(false);
    setAlbumDrillQuery(null);
    setAlbumDrillAlbum(null);
    setAlbumDrillTracks([]);
    albumHistoryPushedRef.current = false;
    searchSnapshotRef.current = null;
    setStation(returnStation ?? searchReturnStationRef.current ?? 'home');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const state = window.history.state as Record<string, unknown> | null;

      if (albumDrillQuery) {
        if (state?.sandboxAlbum) {
          return;
        }
        albumHistoryPushedRef.current = false;
        setAlbumDrillQuery(null);
        setAlbumDrillAlbum(null);
        setAlbumDrillTracks([]);
        setSearchQuery('');
        setSearchHits([]);
        setSearchResults([]);
        setSearchInput('');
        setSearchLoading(false);
        requestShellScrollRestore(searchScrollParentRef.current);
        return;
      }
      if (selectedArtist) {
        if (state?.sandboxArtist) {
          return;
        }
        artistHistoryPushedRef.current = false;
        setSelectedArtist(null);
        if (searchSnapshotRef.current) {
          restoreSearchSnapshot();
        } else {
          clearSearchView(searchReturnStationRef.current);
        }
        return;
      }
      if (searchHistoryPushedRef.current || searchQuery) {
        if (state?.sandboxSearch) {
          return;
        }
        searchHistoryPushedRef.current = false;
        clearSearchView();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [albumDrillQuery, selectedArtist, searchQuery, clearSearchView, restoreSearchSnapshot]);

  const handleAlbumBack = useCallback(() => {
    if (albumHistoryPushedRef.current) {
      albumHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setAlbumDrillQuery(null);
    setAlbumDrillAlbum(null);
    setAlbumDrillTracks([]);
    setSearchQuery('');
    setSearchHits([]);
    setSearchResults([]);
    setSearchInput('');
    setSearchLoading(false);
    requestShellScrollRestore(searchScrollParentRef.current);
  }, []);

  const handleSearchBack = useCallback(() => {
    const returnTo = searchReturnStationRef.current || 'home';
    if (searchHistoryPushedRef.current) {
      searchHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    clearSearchView(returnTo);
  }, [clearSearchView]);

  const handleArtistBack = useCallback(() => {
    if (artistHistoryPushedRef.current) {
      artistHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setSelectedArtist(null);
    if (searchSnapshotRef.current) {
      restoreSearchSnapshot();
    } else {
      requestShellScrollRestore(SEARCH_RESULTS_SCROLL_KEY);
      clearSearchView(searchReturnStationRef.current);
    }
  }, [restoreSearchSnapshot, clearSearchView]);

  return { clearSearchView, handleAlbumBack, handleSearchBack, handleArtistBack };
}

/** ---- 5. Artist / album drill-in helpers --------------------------------------------------- */

export type ShellSearchDrillNavArgs = {
  station: StationId;
  finishMobileSearchNavigation: () => void;
  setSearchHistoryTick: Setter<number>;
  searchRunGenerationRef: MutableRefObject<number>;
  catalogRequestRef: MutableRefObject<number>;
  setSearchDropdownOpen: Setter<boolean>;
  setSelectedArtist: Setter<CatalogArtist | null>;
  setStation: Setter<StationId>;
  setCatalogLoading: Setter<boolean>;
  setSearchCatalog: Setter<CatalogSearchResult>;
  setUnifiedSearchResult: Setter<UnifiedSearchResult>;
  setSearchLoading: Setter<boolean>;
  setUnifiedSearchLoading: Setter<boolean>;
  setWebSupplementLoading: Setter<boolean>;
  setWebSupplementError: Setter<string | null>;
  webSupplementTracksRef: MutableRefObject<CatalogTrack[]>;
  searchQuery: string;
  searchHits: ResolvedSearchHit[];
  searchResults: MediaEnvelope[];
  searchFromCache: boolean;
  searchInput: string;
  searchReturnStationRef: MutableRefObject<StationId>;
  searchSnapshotRef: MutableRefObject<{
    query: string;
    hits: ResolvedSearchHit[];
    results: MediaEnvelope[];
    fromCache: boolean;
    input: string;
  } | null>;
  setAlbumDrillQuery: Setter<string | null>;
  setAlbumDrillAlbum: Setter<CatalogAlbum | null>;
  setAlbumDrillTracks: Setter<CatalogTrack[]>;
  albumHistoryPushedRef: MutableRefObject<boolean>;
  setNavOpen: Setter<boolean>;
  artistHistoryPushedRef: MutableRefObject<boolean>;
  artistOpenGenerationRef: MutableRefObject<number>;
  setQueueDrawerOpen: Setter<boolean>;
  setTvQueueOpen: Setter<boolean>;
  setMobileNowPlayingOpen: Setter<boolean>;
  audioEnvelopeArtworkUrl: string | undefined;
  runSearch: (
    q: string,
    options?: { preserveArtist?: boolean; albumHint?: CatalogAlbum; albumDrill?: boolean },
  ) => Promise<number | void>;
  setAppToast: Setter<string | null>;
  selectedArtist: CatalogArtist | null;
  searchScrollParentRef: MutableRefObject<string>;
};

export function useShellSearchDrillNav({
  station,
  finishMobileSearchNavigation,
  setSearchHistoryTick,
  searchRunGenerationRef,
  catalogRequestRef,
  setSearchDropdownOpen,
  setSelectedArtist,
  setStation,
  setCatalogLoading,
  setSearchCatalog,
  setUnifiedSearchResult,
  setSearchLoading,
  setUnifiedSearchLoading,
  setWebSupplementLoading,
  setWebSupplementError,
  webSupplementTracksRef,
  searchQuery,
  searchHits,
  searchResults,
  searchFromCache,
  searchInput,
  searchReturnStationRef,
  searchSnapshotRef,
  setAlbumDrillQuery,
  setAlbumDrillAlbum,
  setAlbumDrillTracks,
  albumHistoryPushedRef,
  setNavOpen,
  artistHistoryPushedRef,
  artistOpenGenerationRef,
  setQueueDrawerOpen,
  setTvQueueOpen,
  setMobileNowPlayingOpen,
  audioEnvelopeArtworkUrl,
  runSearch,
  setAppToast,
  selectedArtist,
  searchScrollParentRef,
}: ShellSearchDrillNavArgs) {
  const handleSelectArtist = useCallback((
    artist: CatalogArtist,
    options?: { returnStation?: StationId; skipStationTransition?: boolean },
  ) => {
    const name = artist?.name?.trim();
    const id = artist?.id?.trim();
    if (!name || !id) {
      console.warn('[search] handleSelectArtist skipped — missing artist name or id', artist);
      return;
    }
    const t0 = performance.now();
    logE2e('artist-select', true, `artist=${name} ts=${Date.now()}`);
    recordSearchArtist(artist);
    setSearchHistoryTick((n) => n + 1);
    searchRunGenerationRef.current += 1;
    catalogRequestRef.current += 1;
    setSearchDropdownOpen(false);
    if (!options?.skipStationTransition) {
      finishMobileSearchNavigation();
    }
    setSelectedArtist({
      // The artist the catalog matched, opened as they are. Reducing the name here is what put
      // "Tyler" on the page while holding Tyler, The Creator's id: the search picked the right
      // artist and this cut his name on the way to the station.
      ...artist,
      name: catalogEntityArtistName(artist.name),
    });
    if (!options?.skipStationTransition) {
      setStation('search');
    }
    setCatalogLoading(false);
    setSearchCatalog(EMPTY_CATALOG);
    setUnifiedSearchResult(EMPTY_UNIFIED);
    setSearchLoading(false);
    setUnifiedSearchLoading(false);
    setWebSupplementLoading(false);
    setWebSupplementError(null);
    webSupplementTracksRef.current = [];
    if (options?.returnStation) {
      searchReturnStationRef.current = options.returnStation;
      searchSnapshotRef.current = null;
    } else if (searchQuery && searchHits.length > 0) {
      saveShellScroll(SEARCH_RESULTS_SCROLL_KEY);
      searchSnapshotRef.current = {
        query: searchQuery,
        hits: searchHits,
        results: searchResults,
        fromCache: searchFromCache,
        input: searchInput,
      };
    }
    setAlbumDrillQuery(null);
    setAlbumDrillAlbum(null);
    setAlbumDrillTracks([]);
    albumHistoryPushedRef.current = false;
    setNavOpen(false);
    window.history.pushState({ sandboxArtist: artist.id }, '');
    artistHistoryPushedRef.current = true;
    logE2e(
      'search-nav',
      true,
      `artist=${artist.name} id=${artist.id} ms=${Math.round(performance.now() - t0)}`,
    );
  }, [searchQuery, searchHits, searchResults, searchFromCache, searchInput, finishMobileSearchNavigation]);

  const handleOpenArtistByName = useCallback(
    async (artistName: string) => {
      const trimmed = artistName?.trim();
      if (!trimmed || /^local upload$/i.test(trimmed)) return;
      // Resolving an artist by name hits the network (fetchSearchCatalog); tapping a second
      // artist row before the first resolve lands used to let whichever lookup finished LAST
      // win and navigate, even if it was the stale/earlier tap — showing the wrong artist page.
      const generation = ++artistOpenGenerationRef.current;
      setQueueDrawerOpen(false);
      setTvQueueOpen(false);
      setMobileNowPlayingOpen(false);
      try {
        const artist = await resolveCatalogArtistByName(trimmed);
        if (artistOpenGenerationRef.current !== generation) return;
        if (!artist?.name?.trim() || !artist?.id?.trim()) {
          handleSelectArtist(buildCatalogArtistStub(trimmed), { returnStation: station });
          return;
        }
        handleSelectArtist(artist, { returnStation: station });
      } catch (err) {
        if (artistOpenGenerationRef.current !== generation) return;
        console.warn('[search] handleOpenArtistByName failed', trimmed, err);
        handleSelectArtist(buildCatalogArtistStub(trimmed), { returnStation: station });
      }
    },
    [station, handleSelectArtist],
  );

  const handleOpenAlbumByName = useCallback(
    (artistName: string, albumTitle: string) => {
      const artist = artistName.trim();
      const album = albumTitle.trim();
      if (!artist || !album || /^local upload$/i.test(artist)) return;
      setQueueDrawerOpen(false);
      setTvQueueOpen(false);
      setMobileNowPlayingOpen(false);
      setSearchDropdownOpen(false);
      setSelectedArtist(null);
      const hint: CatalogAlbum = {
        kind: 'album',
        id: `album-${artist}-${album}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: album,
        artist,
        artworkUrl: audioEnvelopeArtworkUrl,
      };
      setStation('search');
      setNavOpen(false);
      void runSearch(`${artist} ${album}`, { albumHint: hint, albumDrill: true });
    },
    [audioEnvelopeArtworkUrl, runSearch],
  );

  const handleSelectAlbum = useCallback(
    (album: CatalogAlbum) => {
      recordSearchAlbum(album);
      setSearchHistoryTick((n) => n + 1);
      setSearchDropdownOpen(false);
      setAppToast(null);
      if (selectedArtist) {
        const parentKey = searchArtistScrollKey(selectedArtist.id);
        saveShellScroll(parentKey);
        searchScrollParentRef.current = parentKey;
        if (!albumHistoryPushedRef.current) {
          window.history.pushState({ sandboxAlbum: album.id }, '');
          albumHistoryPushedRef.current = true;
        }
        void runSearch(`${album.artist} ${album.title}`, {
          preserveArtist: true,
          albumDrill: true,
          albumHint: album,
        });
        return;
      }
      if (searchQuery) {
        saveShellScroll(SEARCH_RESULTS_SCROLL_KEY);
        searchScrollParentRef.current = SEARCH_RESULTS_SCROLL_KEY;
      }
      void runSearch(`${album.artist} ${album.title}`, {
        albumHint: album,
        albumDrill: true,
      });
    },
    [runSearch, selectedArtist, searchQuery],
  );

  return { handleSelectArtist, handleOpenArtistByName, handleOpenAlbumByName, handleSelectAlbum };
}

/** ---- 6. navigateSearchQuery + handleSelectSuggestion -------------------------------------- */

export type ShellSearchNavigateArgs = {
  setSearchInput: Setter<string>;
  transitionToSearchStation: () => void;
  runExploreSearch: (label: string, group?: ExploreGroup) => Promise<void>;
  handleSelectArtist: (
    artist: CatalogArtist,
    options?: { returnStation?: StationId; skipStationTransition?: boolean },
  ) => void;
  runSearch: (
    q: string,
    options?: { preserveArtist?: boolean; albumHint?: CatalogAlbum; albumDrill?: boolean },
  ) => Promise<number | void>;
  searchCatalogArtists: CatalogArtist[];
  unifiedSearchArtists: CatalogArtist[];
};

export function useShellSearchNavigate({
  setSearchInput,
  transitionToSearchStation,
  runExploreSearch,
  handleSelectArtist,
  runSearch,
  searchCatalogArtists,
  unifiedSearchArtists,
}: ShellSearchNavigateArgs) {
  const navigateSearchQuery = useCallback(
    (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;
      logE2e('search-nav', true, `query=${trimmed}`);
      setSearchInput(trimmed);
      transitionToSearchStation();

      if (isNewMusicQuery(trimmed)) {
        void runExploreSearch(newMusicSearchLabel(), 'quick');
        return;
      }

      if (isLikelyArtistNameQuery(trimmed)) {
        void resolveCatalogArtistByName(trimmed).then((artist) => {
          handleSelectArtist(artist, { skipStationTransition: true });
        });
        return;
      }

      const cachedArtist = findCatalogArtistByName(
        trimmed,
        searchCatalogArtists,
        unifiedSearchArtists,
      );
      if (cachedArtist) {
        handleSelectArtist(cachedArtist, { skipStationTransition: true });
        return;
      }

      const lockerArtist = findCatalogArtistByName(
        trimmed,
        instantLocalLockerSearch(trimmed, 8).artists,
      );
      if (lockerArtist) {
        handleSelectArtist(lockerArtist, { skipStationTransition: true });
        return;
      }

      void runSearch(trimmed);
    },
    [
      transitionToSearchStation,
      handleSelectArtist,
      runExploreSearch,
      runSearch,
      searchCatalogArtists,
      unifiedSearchArtists,
    ],
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: string) => navigateSearchQuery(suggestion),
    [navigateSearchQuery],
  );

  return { navigateSearchQuery, handleSelectSuggestion };
}

/** ---- 7. Dropdown item selection, submit, and history-list actions ------------------------- */

export type ShellSearchDropdownActionsArgs = {
  setSearchHistoryTick: Setter<number>;
  finishMobileSearchNavigation: () => void;
  showMobileShell: boolean;
  handleMobileTrackTitleTap: (env: MediaEnvelope, candidates?: CandidateSource[]) => Promise<void>;
  handlePlayEnvelope: (
    env: MediaEnvelope,
    candidates?: CandidateSource[],
    options?: { autoPlay?: boolean; seedSearchQueue?: boolean },
  ) => Promise<boolean>;
  setFocusPlaylistId: Setter<string | null>;
  setLockerSection: Setter<LockerSectionId>;
  setStation: Setter<StationId>;
  setNavOpen: Setter<boolean>;
  handleSelectSuggestion: (suggestion: string) => void;
  handleSelectArtist: (
    artist: CatalogArtist,
    options?: { returnStation?: StationId; skipStationTransition?: boolean },
  ) => void;
  handleSelectAlbum: (album: CatalogAlbum) => void;
  navigateSearchQuery: (rawQuery: string) => void;
  searchInput: string;
  recentSearchMatches: SearchHistoryEntry[];
  searchCatalog: CatalogSearchResult;
  unifiedPlaylists: UnifiedPlaylistResult[];
  searchActiveIndex: number;
  setSearchInput: Setter<string>;
  setSearchCatalog: Setter<CatalogSearchResult>;
  setUnifiedSearchResult: Setter<UnifiedSearchResult>;
  setSearchActiveIndex: Setter<number>;
  searchInputRef: MutableRefObject<HTMLInputElement | null>;
};

export function useShellSearchDropdownActions({
  setSearchHistoryTick,
  finishMobileSearchNavigation,
  showMobileShell,
  handleMobileTrackTitleTap,
  handlePlayEnvelope,
  setFocusPlaylistId,
  setLockerSection,
  setStation,
  setNavOpen,
  handleSelectSuggestion,
  handleSelectArtist,
  handleSelectAlbum,
  navigateSearchQuery,
  searchInput,
  recentSearchMatches,
  searchCatalog,
  unifiedPlaylists,
  searchActiveIndex,
  setSearchInput,
  setSearchCatalog,
  setUnifiedSearchResult,
  setSearchActiveIndex,
  searchInputRef,
}: ShellSearchDropdownActionsArgs) {
  const handleSelectTrack = useCallback(
    (track: CatalogTrack) => {
      recordSearchTrack(track);
      setSearchHistoryTick((n) => n + 1);
      finishMobileSearchNavigation();
      if (!track.envelope) return;
      if (showMobileShell) void handleMobileTrackTitleTap(track.envelope);
      else void handlePlayEnvelope(track.envelope, undefined, { seedSearchQueue: true });
    },
    [handlePlayEnvelope, handleMobileTrackTitleTap, showMobileShell, finishMobileSearchNavigation],
  );

  const handleSelectPlaylist = useCallback(
    (playlist: UnifiedPlaylistResult) => {
      finishMobileSearchNavigation();
      setFocusPlaylistId(playlist.id);
      setLockerSection('playlists');
      setStation('locker');
      setNavOpen(false);
    },
    [finishMobileSearchNavigation],
  );

  const handleActivateRecentSearch = useCallback(
    (entry: SearchHistoryEntry) => {
      switch (entry.kind) {
        case 'query':
          handleSelectSuggestion(entry.query);
          break;
        case 'artist':
          handleSelectArtist(historyEntryToArtist(entry));
          break;
        case 'album':
          handleSelectAlbum(historyEntryToAlbum(entry));
          break;
        case 'track':
          handleSelectTrack(historyEntryToTrack(entry));
          break;
        default:
          break;
      }
    },
    [handleSelectSuggestion, handleSelectArtist, handleSelectAlbum, handleSelectTrack],
  );

  const searchDropdownItems = useMemo(
    () =>
      buildSearchDropdownItems({
        query: searchInput,
        recentSearches: recentSearchMatches,
        catalog: searchCatalog,
        playlists: unifiedPlaylists,
        includeViewAll: searchInput.trim().length >= 2,
      }),
    [searchInput, recentSearchMatches, searchCatalog, unifiedPlaylists],
  );

  const activateSearchDropdownItem = useCallback(
    (item: SearchDropdownItem) => {
      switch (item.kind) {
        case 'recent':
          handleActivateRecentSearch(item.entry);
          break;
        case 'suggestion':
          handleSelectSuggestion(item.query);
          break;
        case 'artist':
          handleSelectArtist(item.artist);
          break;
        case 'album':
          handleSelectAlbum(item.album);
          break;
        case 'track':
          handleSelectTrack(item.track);
          break;
        case 'playlist':
          handleSelectPlaylist(item.playlist);
          break;
        case 'view-all':
          navigateSearchQuery(searchInput.trim());
          break;
        default:
          break;
      }
    },
    [
      handleActivateRecentSearch,
      handleSelectSuggestion,
      handleSelectArtist,
      handleSelectAlbum,
      handleSelectTrack,
      handleSelectPlaylist,
      navigateSearchQuery,
      searchInput,
    ],
  );

  const submitSearch = useCallback(() => {
    const q = (searchInputRef.current?.value ?? searchInput).trim();
    if (!q) return;
    if (searchActiveIndex >= 0 && searchDropdownItems[searchActiveIndex]) {
      activateSearchDropdownItem(searchDropdownItems[searchActiveIndex]!);
      return;
    }
    navigateSearchQuery(q);
  }, [
    searchInput,
    searchActiveIndex,
    searchDropdownItems,
    activateSearchDropdownItem,
    navigateSearchQuery,
  ]);

  const handleRemoveRecentSearch = useCallback((entry: SearchHistoryEntry) => {
    removeSearchHistoryEntry(entry);
    setSearchHistoryTick((n) => n + 1);
  }, []);

  const handleClearSearchHistory = useCallback(() => {
    clearSearchHistory();
    setSearchHistoryTick((n) => n + 1);
  }, []);

  const handleClearSearchInput = useCallback(() => {
    setSearchInput('');
    setSearchCatalog(EMPTY_CATALOG);
    setUnifiedSearchResult(EMPTY_UNIFIED);
    setSearchActiveIndex(-1);
    searchInputRef.current?.focus();
  }, []);

  return {
    handleSelectTrack,
    handleSelectPlaylist,
    handleActivateRecentSearch,
    searchDropdownItems,
    activateSearchDropdownItem,
    submitSearch,
    handleRemoveRecentSearch,
    handleClearSearchHistory,
    handleClearSearchInput,
  };
}
