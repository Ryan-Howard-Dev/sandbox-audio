/**
 * Mobile nav action helpers — Settings entry points, the Locker-home shortcut, the mobile tab bar
 * / hamburger menu routers, and the Locker/Discover music-segment switcher (bar included).
 * Extracted from sandboxLayer3 with no JSX besides the segment bar it already owned.
 *
 * Call this hook at the original position, right after useShellNavConstruction and after
 * closeMobileSearch/openMobileSearch/showAppToast are declared — it only reads callbacks that
 * already exist by then. openSettings is consumed later by usePlayEnvironment/ShellChrome, so it
 * must keep being called before those sites (same render, no behaviour change).
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import MusicSegmentBar, { type MusicSegmentId } from '../components/MusicSegmentBar';
import type { StationId, MobileTabId } from './shellNav';
import type { LockerSectionId } from '../stations/CollectionView';
import type { SettingsTab } from '../stations/SettingsView';
import type { DiscoverTabId } from '../stations/DiscoverStationView';

export type UseShellMobileNavActionsArgs = {
  station: StationId;
  lockerSection: LockerSectionId;
  showMobileShell: boolean;
  podcastsEnabled: boolean;
  audiobooksEnabled: boolean;
  t: (key: string, opts?: Record<string, unknown>) => string;
  showAppToast: (msg: string, durationMs?: number) => void;
  closeMobileSearch: () => void;
  openMobileSearch: () => void;
  shellMainRef: MutableRefObject<HTMLElement | null>;
  mobileSearchCommitGuardUntilRef: MutableRefObject<number>;
  settingsReturnStationRef: MutableRefObject<StationId>;
  setSettingsInitialTab: Dispatch<SetStateAction<SettingsTab | undefined>>;
  setMobileNowPlayingOpen: Dispatch<SetStateAction<boolean>>;
  setStation: Dispatch<SetStateAction<StationId>>;
  setNavOpen: Dispatch<SetStateAction<boolean>>;
  setLockerSection: Dispatch<SetStateAction<LockerSectionId>>;
  setLockerHomeResetKey: Dispatch<SetStateAction<number>>;
  setMobileMenuOpen: Dispatch<SetStateAction<boolean>>;
  setDiscoverDrillFromTab: Dispatch<SetStateAction<DiscoverTabId | null>>;
  setDiscoverTab: Dispatch<SetStateAction<DiscoverTabId>>;
  /** Opens the download queue with no station filter. */
  openDownloads: () => void;
};

export function useShellMobileNavActions({
  station,
  lockerSection,
  showMobileShell,
  podcastsEnabled,
  audiobooksEnabled,
  t,
  showAppToast,
  closeMobileSearch,
  openMobileSearch,
  shellMainRef,
  mobileSearchCommitGuardUntilRef,
  settingsReturnStationRef,
  setSettingsInitialTab,
  setMobileNowPlayingOpen,
  setStation,
  setNavOpen,
  setLockerSection,
  setLockerHomeResetKey,
  setMobileMenuOpen,
  setDiscoverDrillFromTab,
  setDiscoverTab,
  openDownloads,
}: UseShellMobileNavActionsArgs) {
  const openSettings = useCallback((tab?: SettingsTab) => {
    if (station !== 'settings') {
      settingsReturnStationRef.current = station;
    }
    setSettingsInitialTab(tab);
    setMobileNowPlayingOpen(false);
    setStation('settings');
    setNavOpen(false);
  }, [station]);

  const openSettingsAddons = useCallback(() => {
    openSettings('addons');
  }, [openSettings]);

  const goToLockerHome = useCallback(() => {
    closeMobileSearch();
    setMobileNowPlayingOpen(false);
    setNavOpen(false);
    setLockerSection('artists');
    if (station === 'locker') {
      setLockerHomeResetKey((key) => key + 1);
    }
    setStation('locker');
  }, [station, closeMobileSearch]);

  const handleMobileTabNavigate = useCallback((id: MobileTabId) => {
    if (Date.now() < mobileSearchCommitGuardUntilRef.current) return;
    if (id === 'mobile-menu') {
      setMobileMenuOpen(true);
      return;
    }
    if (id === 'mobile-search') {
      openMobileSearch();
      return;
    }
    if (id === 'podcasts' && !podcastsEnabled) {
      closeMobileSearch();
      setMobileNowPlayingOpen(false);
      setNavOpen(false);
      showAppToast(t('nav.podcastsEnablePrompt'));
      openSettingsAddons();
      return;
    }
    if (id === 'audiobooks' && !audiobooksEnabled) {
      closeMobileSearch();
      setMobileNowPlayingOpen(false);
      setNavOpen(false);
      showAppToast(t('nav.audiobooksEnablePrompt'));
      openSettingsAddons();
      return;
    }
    if (id === 'home') {
      closeMobileSearch();
      setMobileNowPlayingOpen(false);
      setStation('home');
      setNavOpen(false);
      return;
    }
    if (id === 'locker') {
      goToLockerHome();
      return;
    }
    closeMobileSearch();
    setMobileNowPlayingOpen(false);
    if (id === 'settings' && station !== 'settings') {
      settingsReturnStationRef.current = station;
    }
    setStation(id);
    setNavOpen(false);
  }, [station, podcastsEnabled, audiobooksEnabled, openMobileSearch, closeMobileSearch, goToLockerHome, showAppToast, t, openSettingsAddons]);

  const handleMobileMenuSelect = useCallback(
    (id: string) => {
      closeMobileSearch();
      setMobileNowPlayingOpen(false);
      if (id === 'discover-feed') {
        setDiscoverDrillFromTab(null);
        setDiscoverTab('feed');
        setStation('discover');
        setNavOpen(false);
        return;
      }
      if (id === 'discover-explore') {
        setDiscoverDrillFromTab(null);
        setDiscoverTab('explore');
        setStation('discover');
        setNavOpen(false);
        return;
      }
      if (id === 'discover-playlists') {
        setDiscoverDrillFromTab('feed');
        setDiscoverTab('playlists');
        setStation('discover');
        setNavOpen(false);
        return;
      }
      if (id === 'settings') {
        openSettings();
        return;
      }
      if (id === 'collection') {
        setNavOpen(false);
        setStation('collection');
        return;
      }
      if (id === 'health') {
        setNavOpen(false);
        setStation('health');
        return;
      }
      if (id === 'downloads') {
        /*
         * Opened without a station filter, because the queue is not a station's. One runner feeds
         * music, podcasts, audiobooks and documents alike, and the thing being asked here is
         * "what is downloading", not "what is downloading in Music".
         */
        setNavOpen(false);
        openDownloads();
        return;
      }
      handleMobileTabNavigate(id as MobileTabId);
    },
    [closeMobileSearch, openSettings, openDownloads, setNavOpen, handleMobileTabNavigate],
  );

  // Music tab = Locker + Discover behind one segment switcher.
  const musicSegment: MusicSegmentId =
    station === 'discover'
      ? 'discover'
      : lockerSection === 'genres'
        ? 'genres'
        : lockerSection === 'playlists'
          ? 'playlists'
          : 'library';

  const handleMusicSegment = useCallback(
    (segment: MusicSegmentId) => {
      closeMobileSearch();
      setMobileNowPlayingOpen(false);
      // Segments have very different content heights, so without this the scroll position
      // carried over and the page appeared to expand/jump when switching. Always land at
      // the top so every segment opens the same way.
      shellMainRef.current?.scrollTo({ top: 0 });
      if (segment === 'discover') {
        setDiscoverDrillFromTab(null);
        setDiscoverTab('feed');
        setStation('discover');
        return;
      }
      setDiscoverDrillFromTab(null);
      setLockerSection(
        segment === 'genres' ? 'genres' : segment === 'playlists' ? 'playlists' : 'artists',
      );
      setStation('locker');
    },
    [closeMobileSearch],
  );

  const musicSegmentBar = showMobileShell ? (
    <MusicSegmentBar active={musicSegment} onSelect={handleMusicSegment} />
  ) : undefined;

  return {
    openSettings,
    openSettingsAddons,
    goToLockerHome,
    handleMobileTabNavigate,
    handleMobileMenuSelect,
    musicSegment,
    handleMusicSegment,
    musicSegmentBar,
  };
}
