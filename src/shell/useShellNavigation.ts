/**
 * Navigation and back-stack behavior for the shell — hardware/TV back handling, feature-flag
 * station guards, and the Discover shortcut. Extracted from sandboxLayer3 with no JSX.
 *
 * Call sites must match the old positions:
 *
 *   1. useShellTvBackHandler       — where the TV Escape/Back keydown effect used to be. Closes
 *      the queue/cast overlays and the TV nav drawer first, then falls tvScreen back to 'home';
 *      that priority order is what the effect enforced before, so it stays in the same shape.
 *   2. useShellStationSettingsSync — where the settings-change listener (storage +
 *      'sandbox-settings-change') and the audiobooksReturnStationRef-tracking effect used to be,
 *      in that order. This MUST run before useShellStationGuards below — it is what keeps
 *      proAudio/podcastsEnabled/audiobooksEnabled/etc in sync with settings changes the guards
 *      react to. The mounted-flag effect that used to sit between them (setPodcastsMounted /
 *      setAudiobooksMounted) stays inline in the shell — it is a render/keep-alive concern, not
 *      navigation, and leaving it in place preserves the settings-sync-before-guards ordering
 *      without pulling unrelated state through this module.
 *   3. useShellStationGuards       — where the feature-flag station-disable effect used to be
 *      (redirects off `dj` / `podcasts` / `audiobooks` / `discover` / `library` /
 *      `sonic-locker` once a flag turns a station off underneath the user).
 *   4. useShellBackNavigation      — where `handleShellBack` (plus its ref and the
 *      useAndroidBackNavigation call right after it) used to be declared. Everything ahead of
 *      the station-root fallback is an overlay/drill-down being dismissed in the exact priority
 *      order the shell relied on; reordering these branches changes what a hardware back press
 *      does.
 *   5. useShellGoToDiscover        — where `goToDiscover` used to be declared.
 *
 * Search chrome (openMobileSearch, closeMobileSearch, the mobile tab/menu/segment nav
 * callbacks) stays in the shell. They read and write searchReturnStationRef /
 * settingsReturnStationRef and the mobile-search-commit-guard timer closely enough with the
 * search runtime that pulling them out here would just re-couple this module back to
 * useShellSearch; only the two ref *values* they share with back-navigation (StationId refs)
 * cross the boundary, as plain arguments.
 */

import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import { useAndroidBackNavigation } from '../hooks/useAndroidBackNavigation';
import { closeSandboxOverlay } from '../hooks/useDismissableOverlay';
import { isNowPlayingSheetDomOpen } from '../homeHeroPlayerLogic';
import { resolveDiscoverHardwareBack } from '../mobile/discoverAndroidBack';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { CatalogArtist } from '../searchCatalog';
import {
  readAudiobooksEnabled,
  readCollectionStationEnabled,
  readDiscoverStationEnabled,
  readPodcastsEnabled,
  readProAudio,
  readSonicLockerStationEnabled,
  type StationId,
} from './shellNav';
import type { DiscoverTabId } from '../stations/DiscoverStationView';

type Setter<T> = Dispatch<SetStateAction<T>>;
type TvScreen = 'home' | 'playback';

/** ---- 1. TV Escape/Back keydown handler --------------------------------------------------- */

export type ShellTvBackHandlerArgs = {
  isTV: boolean;
  tvQueueOpen: boolean;
  setTvQueueOpen: Setter<boolean>;
  castPickerOpen: boolean;
  setCastPickerOpen: Setter<boolean>;
  navOpen: boolean;
  setNavOpen: Setter<boolean>;
  station: StationId;
  tvScreen: TvScreen;
  setTvScreen: Setter<TvScreen>;
};

export function useShellTvBackHandler({
  isTV,
  tvQueueOpen,
  setTvQueueOpen,
  castPickerOpen,
  setCastPickerOpen,
  navOpen,
  setNavOpen,
  station,
  tvScreen,
  setTvScreen,
}: ShellTvBackHandlerArgs) {
  useEffect(() => {
    if (!isTV) return;
    const onTvBack = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' && e.key !== 'Back' && e.keyCode !== 4) return;
      if (tvQueueOpen) {
        e.preventDefault();
        e.stopPropagation();
        setTvQueueOpen(false);
        return;
      }
      if (castPickerOpen) {
        e.preventDefault();
        e.stopPropagation();
        setCastPickerOpen(false);
        return;
      }
      if (navOpen) {
        e.preventDefault();
        e.stopPropagation();
        setNavOpen(false);
        return;
      }
      if (station === 'home' && tvScreen === 'playback') {
        e.preventDefault();
        e.stopPropagation();
        setTvScreen('home');
      }
    };
    window.addEventListener('keydown', onTvBack, true);
    return () => window.removeEventListener('keydown', onTvBack, true);
  }, [isTV, tvQueueOpen, castPickerOpen, navOpen, station, tvScreen]);
}

/** ---- 2. Settings-change listener + audiobooks return-station tracking -------------------- */

export type ShellStationSettingsSyncArgs = {
  station: StationId;
  setProAudio: Setter<boolean>;
  setPodcastsEnabled: Setter<boolean>;
  setAudiobooksEnabled: Setter<boolean>;
  setDiscoverStationEnabled: Setter<boolean>;
  setCollectionStationEnabled: Setter<boolean>;
  setSonicLockerEnabled: Setter<boolean>;
  audiobooksReturnStationRef: MutableRefObject<StationId>;
};

export function useShellStationSettingsSync({
  station,
  setProAudio,
  setPodcastsEnabled,
  setAudiobooksEnabled,
  setDiscoverStationEnabled,
  setCollectionStationEnabled,
  setSonicLockerEnabled,
  audiobooksReturnStationRef,
}: ShellStationSettingsSyncArgs) {
  useEffect(() => {
    const sync = () => {
      setProAudio(readProAudio());
      setPodcastsEnabled(readPodcastsEnabled());
      setAudiobooksEnabled(readAudiobooksEnabled());
      setDiscoverStationEnabled(readDiscoverStationEnabled());
      setCollectionStationEnabled(readCollectionStationEnabled());
      setSonicLockerEnabled(readSonicLockerStationEnabled());
    };
    window.addEventListener('storage', sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  const prevStationForAudiobooksRef = useRef<StationId>(station);

  useEffect(() => {
    const prev = prevStationForAudiobooksRef.current;
    if (station === 'audiobooks' && prev !== 'audiobooks') {
      audiobooksReturnStationRef.current = prev;
    }
    prevStationForAudiobooksRef.current = station;
  }, [station]);
}

/** ---- 3. Feature-flag station-disable guards ---------------------------------------------- */

export type ShellStationGuardsArgs = {
  station: StationId;
  proAudio: boolean;
  podcastsEnabled: boolean;
  audiobooksEnabled: boolean;
  discoverStationEnabled: boolean;
  libraryStationEnabled: boolean;
  sonicLockerEnabled: boolean;
  settingsReturnStationRef: MutableRefObject<StationId>;
  setStation: Setter<StationId>;
};

export function useShellStationGuards({
  station,
  proAudio,
  podcastsEnabled,
  audiobooksEnabled,
  discoverStationEnabled,
  libraryStationEnabled,
  sonicLockerEnabled,
  settingsReturnStationRef,
  setStation,
}: ShellStationGuardsArgs) {
  useEffect(() => {
    if (station === 'dj' && !proAudio) {
      setStation('settings');
    }
    if (station === 'podcasts' && !podcastsEnabled) {
      setStation(settingsReturnStationRef.current);
    }
    if (station === 'audiobooks' && !audiobooksEnabled) {
      setStation(settingsReturnStationRef.current);
    }
    if (station === 'discover' && !discoverStationEnabled) {
      setStation('home');
    }
    if (station === 'library' && !libraryStationEnabled) {
      setStation('home');
    }
    if (station === 'sonic-locker' && !sonicLockerEnabled) {
      setStation('home');
    }
  }, [
    station,
    proAudio,
    podcastsEnabled,
    audiobooksEnabled,
    discoverStationEnabled,
    libraryStationEnabled,
    sonicLockerEnabled,
  ]);
}

/** ---- 4. handleShellBack + Android hardware back wiring ----------------------------------- */

export type ShellBackNavigationArgs = {
  playerAddToPlaylistOpen: boolean;
  setPlayerAddToPlaylistOpen: Setter<boolean>;
  mixRadioSaveOpen: boolean;
  setMixRadioSaveOpen: Setter<boolean>;
  lyricsDrawerOpen: boolean;
  setLyricsDrawerOpen: Setter<boolean>;
  mobileNowPlayingOpenRef: MutableRefObject<boolean>;
  setMobileNowPlayingOpen: Setter<boolean>;
  podcastChaptersOpenRef: MutableRefObject<boolean>;
  setPodcastChaptersOpen: Setter<boolean>;
  sleepTimerPanelOpen: boolean;
  setSleepTimerPanelOpen: Setter<boolean>;
  castPickerOpen: boolean;
  setCastPickerOpen: Setter<boolean>;
  queueDrawerOpen: boolean;
  setQueueDrawerOpen: Setter<boolean>;
  navOpen: boolean;
  setNavOpen: Setter<boolean>;
  mobileSearchOpen: boolean;
  closeMobileSearch: () => void;
  mobileMenuOpen: boolean;
  setMobileMenuOpen: Setter<boolean>;
  videoFeedOpen: boolean;
  setVideoFeedOpen: Setter<boolean>;
  searchDropdownOpen: boolean;
  setSearchDropdownOpen: Setter<boolean>;
  settingsDrillBackRef: MutableRefObject<(() => boolean) | null>;
  playlistsDrillBackRef: MutableRefObject<(() => boolean) | null>;
  exploreDrillBackRef: MutableRefObject<(() => boolean) | null>;
  mfyDrillBackRef: MutableRefObject<(() => boolean) | null>;
  stationRef: MutableRefObject<StationId>;
  discoverTabRef: MutableRefObject<DiscoverTabId>;
  discoverDrillFromTabRef: MutableRefObject<DiscoverTabId | null>;
  setDiscoverTab: Setter<DiscoverTabId>;
  setDiscoverDrillFromTab: Setter<DiscoverTabId | null>;
  station: StationId;
  albumDrillQuery: string | null;
  selectedArtist: CatalogArtist | null;
  handleAlbumBack: () => void;
  handleArtistBack: () => void;
  searchQuery: string;
  searchInput: string;
  setSearchQuery: Setter<string>;
  setSearchInput: Setter<string>;
  setSearchHits: Setter<ResolvedSearchHit[]>;
  setSearchResults: Setter<MediaEnvelope[]>;
  setSearchLoading: Setter<boolean>;
  lockerDrillBackRef: MutableRefObject<(() => boolean) | null>;
  podcastsDrillBackRef: MutableRefObject<(() => boolean) | null>;
  audiobooksDrillBackRef: MutableRefObject<(() => boolean) | null>;
  audiobooksReturnStationRef: MutableRefObject<StationId>;
  settingsReturnStationRef: MutableRefObject<StationId>;
  setStation: Setter<StationId>;
};

export function useShellBackNavigation({
  playerAddToPlaylistOpen,
  setPlayerAddToPlaylistOpen,
  mixRadioSaveOpen,
  setMixRadioSaveOpen,
  lyricsDrawerOpen,
  setLyricsDrawerOpen,
  mobileNowPlayingOpenRef,
  setMobileNowPlayingOpen,
  podcastChaptersOpenRef,
  setPodcastChaptersOpen,
  sleepTimerPanelOpen,
  setSleepTimerPanelOpen,
  castPickerOpen,
  setCastPickerOpen,
  queueDrawerOpen,
  setQueueDrawerOpen,
  navOpen,
  setNavOpen,
  mobileSearchOpen,
  closeMobileSearch,
  mobileMenuOpen,
  setMobileMenuOpen,
  videoFeedOpen,
  setVideoFeedOpen,
  searchDropdownOpen,
  setSearchDropdownOpen,
  settingsDrillBackRef,
  playlistsDrillBackRef,
  exploreDrillBackRef,
  mfyDrillBackRef,
  stationRef,
  discoverTabRef,
  discoverDrillFromTabRef,
  setDiscoverTab,
  setDiscoverDrillFromTab,
  station,
  albumDrillQuery,
  selectedArtist,
  handleAlbumBack,
  handleArtistBack,
  searchQuery,
  searchInput,
  setSearchQuery,
  setSearchInput,
  setSearchHits,
  setSearchResults,
  setSearchLoading,
  lockerDrillBackRef,
  podcastsDrillBackRef,
  audiobooksDrillBackRef,
  audiobooksReturnStationRef,
  settingsReturnStationRef,
  setStation,
}: ShellBackNavigationArgs) {
  const handleShellBack = useCallback((): boolean => {
    if (playerAddToPlaylistOpen) {
      closeSandboxOverlay(() => setPlayerAddToPlaylistOpen(false));
      return true;
    }
    if (mixRadioSaveOpen) {
      closeSandboxOverlay(() => setMixRadioSaveOpen(false));
      return true;
    }
    if (lyricsDrawerOpen) {
      closeSandboxOverlay(() => setLyricsDrawerOpen(false));
      return true;
    }
    if (mobileNowPlayingOpenRef.current || isNowPlayingSheetDomOpen()) {
      setMobileNowPlayingOpen(false);
      return true;
    }
    if (podcastChaptersOpenRef.current) {
      setPodcastChaptersOpen(false);
      return true;
    }
    if (sleepTimerPanelOpen) {
      closeSandboxOverlay(() => setSleepTimerPanelOpen(false));
      return true;
    }
    if (castPickerOpen) {
      closeSandboxOverlay(() => setCastPickerOpen(false));
      return true;
    }
    if (queueDrawerOpen) {
      closeSandboxOverlay(() => setQueueDrawerOpen(false));
      return true;
    }
    if (navOpen) {
      closeSandboxOverlay(() => setNavOpen(false));
      return true;
    }
    if (mobileSearchOpen) {
      closeMobileSearch();
      return true;
    }
    if (mobileMenuOpen) {
      closeSandboxOverlay(() => setMobileMenuOpen(false));
      return true;
    }
    if (videoFeedOpen) {
      setVideoFeedOpen(false);
      return true;
    }
    if (searchDropdownOpen) {
      setSearchDropdownOpen(false);
      return true;
    }
    if (settingsDrillBackRef.current?.()) {
      return true;
    }
    if (playlistsDrillBackRef.current?.()) {
      return true;
    }
    if (exploreDrillBackRef.current?.()) {
      return true;
    }
    // Ahead of the tab-level resolver: the expanded mix page is a drill-down *inside* the Feed
    // tab, so letting the resolver run first would leave it open and switch tabs underneath it.
    if (mfyDrillBackRef.current?.()) {
      return true;
    }
    const discoverBack = resolveDiscoverHardwareBack({
      station: stationRef.current,
      discoverTab: discoverTabRef.current,
      discoverDrillFromTab: discoverDrillFromTabRef.current,
    });
    if (discoverBack.handled) {
      setDiscoverTab(discoverBack.nextTab);
      if (discoverBack.clearDrill) {
        setDiscoverDrillFromTab(null);
      }
      return true;
    }
    if (station === 'search') {
      if (albumDrillQuery) {
        handleAlbumBack();
        return true;
      }
      if (selectedArtist) {
        handleArtistBack();
        return true;
      }
      if (searchQuery.trim() || searchInput.trim()) {
        setSearchQuery('');
        setSearchInput('');
        setSearchHits([]);
        setSearchResults([]);
        setSearchLoading(false);
        return true;
      }
    }
    if (station === 'locker') {
      if (lockerDrillBackRef.current?.()) {
        return true;
      }
    }
    if (station === 'podcasts') {
      if (podcastsDrillBackRef.current?.()) {
        return true;
      }
    }
    if (station === 'audiobooks') {
      if (audiobooksDrillBackRef.current?.()) {
        return true;
      }
      setStation(audiobooksReturnStationRef.current);
      return true;
    }
    if (station === 'settings') {
      if (settingsDrillBackRef.current?.()) {
        return true;
      }
      setStation(settingsReturnStationRef.current);
      return true;
    }
    // Root of any non-home station: hardware back returns Home instead of
    // minimizing the app. Only Home itself falls through to minimize.
    if (stationRef.current !== 'home') {
      setStation('home');
      return true;
    }
    return false;
  }, [
    playerAddToPlaylistOpen,
    mixRadioSaveOpen,
    sleepTimerPanelOpen,
    castPickerOpen,
    queueDrawerOpen,
    lyricsDrawerOpen,
    navOpen,
    mobileSearchOpen,
    closeMobileSearch,
    searchDropdownOpen,
    station,
    albumDrillQuery,
    selectedArtist,
    handleAlbumBack,
    handleArtistBack,
    searchQuery,
    searchInput,
    mobileMenuOpen,
    videoFeedOpen,
  ]);

  const handleShellBackRef = useRef(handleShellBack);
  handleShellBackRef.current = handleShellBack;

  useAndroidBackNavigation(handleShellBack);

  return { handleShellBack, handleShellBackRef };
}

/** ---- 5. goToDiscover ---------------------------------------------------------------------- */

export type ShellGoToDiscoverArgs = {
  setDiscoverTab: Setter<DiscoverTabId>;
  setStation: Setter<StationId>;
  setNavOpen: Setter<boolean>;
};

export function useShellGoToDiscover({
  setDiscoverTab,
  setStation,
  setNavOpen,
}: ShellGoToDiscoverArgs) {
  const goToDiscover = useCallback((tab: DiscoverTabId = 'feed') => {
    setDiscoverTab(tab);
    setStation('discover');
    setNavOpen(false);
  }, []);

  return { goToDiscover };
}
