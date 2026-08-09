/**
 * Nav construction for the shell — mobile bottom-tab items, the desktop/TV side-nav item list,
 * the mobile "more" menu, active-tab/menu resolution, and the download-progress badges overlaid
 * on all of those. Pure derivations (useMemo) plus the download-queue-revision subscription that
 * feeds the badge counts; no JSX. Extracted from sandboxLayer3.
 *
 * Call this hook at the original position, right after mobilePinTabIds used to be declared
 * (after navPinTabs/podcastsEnabled/etc. state and before the mobile-search-overlay callbacks
 * that follow). downloadQueueRevision now lives entirely inside this hook — nothing outside this
 * cluster read or wrote it.
 */

import { useMemo, useState } from 'react';
import { Activity, ArrowDownCircle, BookAudio, Menu, Podcast, Radio, Search, Server, Settings, Sliders, User } from 'lucide-react';
import type { MobileNavMoreItem } from '../components/MobileNavMoreSheet';
import { countDownloadSheetBadge } from '../components/DownloadActivitySheet';
import { getDownloadJobs } from '../downloadQueue';
import { mobilePinTabIdsFromNavPins } from '../mobile/buildMobileTabItems';
import { resolveMobileTabActiveId } from '../mobile/mobileTabActiveLogic';
import { useShellDownloadQueueBadge } from './useShellDownloads';
import {
  BASE_NAV,
  NAV_PIN_META,
  type MobileTabId,
  type NavItemId,
  type StationId,
} from './shellNav';
import type { NavPinTabId } from '../navPinTabs';
import type { DiscoverTabId } from '../stations/DiscoverStationView';

export type UseShellNavConstructionArgs = {
  navPinTabs: NavPinTabId[];
  t: (key: string, opts?: Record<string, unknown>) => string;
  discoverStationEnabled: boolean;
  sonicLockerEnabled: boolean;
  podcastsEnabled: boolean;
  audiobooksEnabled: boolean;
  libraryStationEnabled: boolean;
  proAudio: boolean;
  profileDisplayName: string | undefined;
  station: StationId;
  discoverTab: DiscoverTabId;
  mobileSearchOpen: boolean;
  discoverReleaseBadge: number;
  podcastEpisodeBadge: number;
};

export function useShellNavConstruction({
  navPinTabs,
  t,
  discoverStationEnabled,
  sonicLockerEnabled,
  podcastsEnabled,
  audiobooksEnabled,
  libraryStationEnabled,
  proAudio,
  profileDisplayName,
  station,
  discoverTab,
  mobileSearchOpen,
  discoverReleaseBadge,
  podcastEpisodeBadge,
}: UseShellNavConstructionArgs) {
  const [downloadQueueRevision, setDownloadQueueRevision] = useState(0);
  useShellDownloadQueueBadge({ setDownloadQueueRevision });

  /*
   * Everything wanting attention, across every station, for the Downloads entry in More.
   * Recomputed on each queue revision — that state exists precisely to drive these counts.
   */
  const downloadAttentionBadge = useMemo(() => {
    const jobs = getDownloadJobs();
    return (
      countDownloadSheetBadge(jobs, 'music') +
      countDownloadSheetBadge(jobs, 'podcast') +
      countDownloadSheetBadge(jobs, 'audiobook')
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [downloadQueueRevision]);

  const mobilePinTabIds = useMemo(
    () => new Set(mobilePinTabIdsFromNavPins(navPinTabs)),
    [navPinTabs],
  );

  const mobileTabItems = useMemo(() => {
    const pinIds = mobilePinTabIdsFromNavPins(navPinTabs);
    const items: Array<{
      id: MobileTabId;
      label: string;
      shortLabel?: string;
      icon: React.ElementType;
    }> = pinIds.map((tabId) => {
      const pin = tabId === 'mobile-search' ? 'search' : tabId;
      const meta = NAV_PIN_META[pin as NavPinTabId];
      return {
        id: tabId as MobileTabId,
        label: t(meta.labelKey),
        shortLabel: meta.shortLabelKey ? t(meta.shortLabelKey) : undefined,
        icon: meta.icon,
      };
    });
    items.push({ id: 'mobile-menu', label: t('nav.menu'), icon: Menu });
    return items;
  }, [navPinTabs, t]);

  const navItems = useMemo(() => {
    const items: Array<{ id: NavItemId; label: string; icon: React.ElementType }> = BASE_NAV.filter(
      (n) =>
        (n.id !== 'discover' || discoverStationEnabled) &&
        (n.id !== 'sonic-locker' || sonicLockerEnabled),
    ).map((n) => ({
      id: n.id,
      label:
        n.id === 'locker' && navPinTabs.includes('locker') ? t('nav.music') : t(n.labelKey),
      icon: n.icon,
    }));
    items.push({ id: 'search', label: t('nav.search'), icon: Search });
    if (podcastsEnabled) {
      items.push({ id: 'podcasts', label: t('nav.podcasts'), icon: Podcast });
    }
    if (audiobooksEnabled) {
      items.push({ id: 'audiobooks', label: t('nav.audiobooks'), icon: BookAudio });
    }
    if (libraryStationEnabled) {
      items.push({ id: 'library', label: t('nav.serverLibrary'), icon: Server });
    }
    if (proAudio) {
      items.push({ id: 'dj', label: t('nav.djConsole'), icon: Sliders });
    }
    items.push({ id: 'settings', label: t('nav.settings'), icon: Settings });
    items.push({
      id: 'profile',
      label: t('shell.profile', { name: profileDisplayName ?? 'Operator' }),
      icon: User,
    });
    return items;
  }, [proAudio, podcastsEnabled, audiobooksEnabled, libraryStationEnabled, discoverStationEnabled, sonicLockerEnabled, navPinTabs, profileDisplayName, t]);

  const mobileMenuItems = useMemo((): MobileNavMoreItem[] => {
    // Discover now lives inside the Music tab's segment bar (Library / Genres /
    // Playlists / Discover), so it is no longer a separate menu destination.
    const items: MobileNavMoreItem[] = [];
    if (sonicLockerEnabled) {
      items.push({
        id: 'sonic-locker',
        label: t('nav.sonicLocker'),
        subtitle: t('nav.browseSonicLockerHint'),
        icon: Radio,
        tone: 'accent',
      });
    }
    items.push(
      /*
       * Downloads belongs here, not buried in Music.
       *
       * It is not a music feature — podcasts, audiobooks and documents all queue through the same
       * runner, and the foreground notification that reports "13 of 52 tracks" is app-wide. Living
       * under one station meant there was no place to look at the queue from the other three, and
       * no obvious place to look at it from anywhere.
       *
       * The badge is the count wanting attention (queued or failed), so a stalled download is
       * visible from the nav bar rather than only from the pull-down shade.
       */
      {
        id: 'downloads',
        label: t('nav.downloads'),
        subtitle: t('nav.browseDownloadsHint'),
        icon: ArrowDownCircle,
        tone: 'accent',
        badge: downloadAttentionBadge > 0 ? downloadAttentionBadge : undefined,
      },
      {
        id: 'insights',
        label: t('nav.insights'),
        subtitle: t('nav.browseInsightsHint'),
        icon: Activity,
        tone: 'accent-bright',
      },
      {
        id: 'settings',
        label: t('nav.settings'),
        subtitle: t('nav.browseSettingsHint'),
        icon: Settings,
        tone: 'accent-deep',
      },
    );
    return items;
  }, [
    audiobooksEnabled,
    discoverReleaseBadge,
    discoverStationEnabled,
    downloadAttentionBadge,
    sonicLockerEnabled,
    t,
  ]);

  const mobileMenuActiveId = useMemo(() => {
    if (station === 'sonic-locker') return 'sonic-locker';
    if (station === 'audiobooks') return 'audiobooks';
    if (station === 'insights') return 'insights';
    if (station === 'settings') return 'settings';
    return undefined;
  }, [station]);

  const mobileTabActiveId = useMemo((): MobileTabId => {
    // Discover is a segment of the Music tab, so it keeps the Music (locker) pin lit.
    if (station === 'discover') return 'locker';
    return resolveMobileTabActiveId({
      station,
      discoverTab,
      mobileSearchOpen,
      pinnedTabIds: mobilePinTabIds,
      navPinTabs,
    }) as MobileTabId;
  }, [mobilePinTabIds, mobileSearchOpen, navPinTabs, station, discoverTab]);

  const mobileNavBadges = useMemo((): Partial<Record<MobileTabId, number>> | undefined => {
    const badges: Partial<Record<MobileTabId, number>> = {};
    const downloadErrors = countDownloadSheetBadge(getDownloadJobs(), 'music');
    if (downloadErrors > 0) {
      badges.locker = downloadErrors;
    }
    if (discoverStationEnabled && discoverReleaseBadge > 0) {
      badges['mobile-menu'] = discoverReleaseBadge;
    }
    if (podcastsEnabled && podcastEpisodeBadge > 0 && mobilePinTabIds.has('podcasts')) {
      badges.podcasts = podcastEpisodeBadge;
    }
    return Object.keys(badges).length > 0 ? badges : undefined;
  }, [
    discoverStationEnabled,
    discoverReleaseBadge,
    podcastEpisodeBadge,
    podcastsEnabled,
    mobilePinTabIds,
    downloadQueueRevision,
  ]);

  const mobileDownloadBadge = countDownloadSheetBadge(getDownloadJobs(), 'music');
  const podcastDownloadBadge = countDownloadSheetBadge(getDownloadJobs(), 'podcast');
  const audiobookDownloadBadge = countDownloadSheetBadge(getDownloadJobs(), 'audiobook');

  return {
    mobileTabItems,
    navItems,
    mobileMenuItems,
    mobileMenuActiveId,
    mobileTabActiveId,
    mobileNavBadges,
    mobileDownloadBadge,
    podcastDownloadBadge,
    audiobookDownloadBadge,
  };
}
