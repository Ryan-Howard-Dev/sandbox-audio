/**
 * Maps shell station state to the highlighted mobile bottom-nav tab.
 */

export type DiscoverTabId = 'feed' | 'explore' | 'playlists';

export type MobileTabActiveId =
  | 'home'
  | 'locker'
  | 'discover'
  | 'podcasts'
  | 'audiobooks'
  | 'sonic-locker'
  | 'insights'
  | 'settings'
  | 'dj'
  | 'library'
  | 'mobile-search'
  | 'mobile-menu';

/**
 * Stations reached from More, which therefore light the More tab rather than a pinned one.
 *
 * Every addition to StationId that lands in the More sheet has to be listed here too, and nothing
 * enforces it: the union widens, every branch still compiles, and the bug is a lit tab that
 * disagrees with the screen you are looking at. That has now happened five times in one sitting —
 * FORMAT_SPLIT, the settings search index, the shelf segment, and twice here.
 */
const MOBILE_MENU_STATIONS = new Set([
  'sonic-locker',
  'audiobooks',
  'collection',
  'health',
  'files',
  'insights',
  'settings',
]);

export type ResolveMobileTabActiveIdInput = {
  station: string;
  discoverTab?: DiscoverTabId;
  mobileSearchOpen: boolean;
  pinnedTabIds: ReadonlySet<string>;
  navPinTabs: readonly string[];
};

export function resolveMobileTabActiveId(input: ResolveMobileTabActiveIdInput): MobileTabActiveId {
  const { station, discoverTab, mobileSearchOpen, pinnedTabIds, navPinTabs } = input;

  if (mobileSearchOpen || station === 'search') {
    return pinnedTabIds.has('mobile-search') ? 'mobile-search' : 'mobile-menu';
  }

  if (station === 'discover') {
    if (discoverTab === 'playlists') return 'mobile-menu';
    if (pinnedTabIds.has('discover')) return 'discover';
    return 'mobile-menu';
  }

  if (station === 'podcasts' && pinnedTabIds.has('podcasts')) return 'podcasts';
  if (station === 'audiobooks' && pinnedTabIds.has('audiobooks')) return 'audiobooks';

  if (MOBILE_MENU_STATIONS.has(station)) return 'mobile-menu';
  if (pinnedTabIds.has(station)) return station as MobileTabActiveId;
  return navPinTabs[0] === 'search' ? 'mobile-search' : (navPinTabs[0] as MobileTabActiveId);
}
