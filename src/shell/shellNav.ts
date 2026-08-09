/**
 * Shell navigation vocabulary — station ids, tab ids, and the metadata each nav surface renders.
 *
 * First extraction out of sandboxLayer3, which is ~10k lines and named in the risk register as a
 * god object (R-011). These are the pieces with no dependency on component state at all, so they
 * move without touching behaviour. The station id union in particular is referenced throughout the
 * shell and belongs somewhere a reader can find it.
 */

import type React from 'react';
import { BookAudio, Compass, Home, Music as MusicIcon, Podcast, Radio, Search, Settings } from 'lucide-react';
import type { NavPinTabId } from '../navPinTabs';
import { prefsGetItem } from '../prefsStorage';
import { loadAudiobooksEnabled } from '../audiobooksSettings';
import { loadCollectionStationEnabled } from '../collectionStationSettings';
import { loadDiscoverStationEnabled } from '../discoverStationSettings';
import { loadLibraryStationEnabled } from '../libraryStationSettings';
import { loadPodcastsEnabled } from '../podcastSettings';
import { loadSonicLockerStationEnabled } from '../sonicLockerStationSettings';

export type StationId =
  | 'home'
  | 'discover'
  /*
   * The records you own that the locker cannot see. Reached from More alongside Downloads and
   * Insights, because it is a tool rather than a way of browsing music, and because the Music
   * segment bar was already five wide on a phone.
   */
  | 'collection'
  | 'library'
  | 'sonic-locker'
  | 'search'
  | 'locker'
  | 'podcasts'
  | 'audiobooks'
  | 'insights'
  | 'settings'
  | 'dj';

export type MobileTabId = StationId | 'mobile-search' | 'mobile-menu';
export type NavItemId = StationId | 'profile';

export const NAV_PIN_META: Record<
  NavPinTabId,
  { labelKey: string; shortLabelKey?: string; icon: React.ElementType }
> = {
  home: { labelKey: 'nav.home', icon: Home },
  /*
   * Music is a note, not a HardDrive — the drive glyph described where the files live, not what
   * the tab is for. Audiobooks is BookAudio (book + waveform) rather than BookOpen, which read as
   * "reading" and reinforced the wrong idea the "Books" label already gave. Both are solid-stroke
   * shapes that stay legible on the light presets as well as the dark ones.
   */
  locker: { labelKey: 'nav.music', icon: MusicIcon },
  discover: { labelKey: 'nav.discover', shortLabelKey: 'nav.discoverShort', icon: Compass },
  search: { labelKey: 'nav.search', icon: Search },
  podcasts: { labelKey: 'nav.podcasts', shortLabelKey: 'nav.podcastsShort', icon: Podcast },
  audiobooks: { labelKey: 'nav.audiobooks', shortLabelKey: 'nav.audiobooksShort', icon: BookAudio },
  settings: { labelKey: 'nav.settings', shortLabelKey: 'nav.settingsShort', icon: Settings },
};

export const BASE_NAV: Array<{ id: StationId; labelKey: string; icon: React.ElementType }> = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'locker', labelKey: 'nav.locker', icon: MusicIcon },
  { id: 'discover', labelKey: 'nav.discover', icon: Compass },
  { id: 'sonic-locker', labelKey: 'nav.sonicLocker', icon: Radio },
];

/*
 * Read at call time rather than captured, because these are user settings that change while the
 * shell is mounted and the nav has to reflect the change without a remount.
 */
export function readProAudio(): boolean {
  return prefsGetItem('isProAudioEnabled') === 'true';
}

export function readLibraryStationEnabled(): boolean {
  return loadLibraryStationEnabled();
}

export function readPodcastsEnabled(): boolean {
  return loadPodcastsEnabled();
}

export function readAudiobooksEnabled(): boolean {
  return loadAudiobooksEnabled();
}

export function readDiscoverStationEnabled(): boolean {
  return loadDiscoverStationEnabled();
}

export function readCollectionStationEnabled(): boolean {
  return loadCollectionStationEnabled();
}

export function readSonicLockerStationEnabled(): boolean {
  return loadSonicLockerStationEnabled();
}
