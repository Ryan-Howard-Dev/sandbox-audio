import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { LockerVm } from './LocalView';
import LocalView from './LocalView';
import PlaylistsView from './PlaylistsView';
import LockerGenreView from '../components/locker/LockerGenreView';
import {
  buildLockerGenreShelves,
  lockerGenreSourceCollections,
} from '../lockerGenreShelf';
import { repairLockerVault, useLockerVault } from '../LockerVaultContext';
import { useTranslation } from '../i18n';
import {
  editionToAlbumGroup,
  filterCollectionsForLockerTab,
  isLockerVideoEntry,
  type LockerTabId,
} from '../collectionIntelligence';
import { useCollectionIntelligence } from '../hooks/useCollectionIntelligence';
import { useMobileShell } from '../hooks/useMobileShell';
import { useLockerSyncProgress } from '../hooks/useLockerSyncProgress';
import { loadPlaylists, subscribePlaylists } from '../playlistStorage';
import LockerBrowseFilterPills from '../components/locker/LockerBrowseFilterPills';
import LockerHeaderSearch from '../components/locker/LockerHeaderSearch';
import LockerArtistsMobileHeader, {
  type ArtistListSort,
  type LockerArtistsMobileMenuItem,
} from '../components/locker/LockerArtistsMobileHeader';
import LockerPinnedRow from '../components/locker/LockerPinnedRow';
import LockerSyncProgressBar from '../components/locker/LockerSyncProgressBar';
import NotificationBellButton from '../components/NotificationBellButton';
import type { LockerBrowseFilterId } from '../components/locker/lockerBrowseFilters';
import { loadLockerSyncSettings, type LockerSyncSettings } from '../lockerSync';
import { loadLockerPins, unpinLockerAlbum, type LockerPin } from '../lockerPins';
import { loadLockerViewPrefs, saveLockerViewPrefs } from '../lockerViewPrefs';
import { isNativeMobileShellClient } from '../hooks/mobileShellLayout';
import { isAirGapEnabled, subscribeAirGap } from '../airGapMode';

export type LockerSectionId = LockerTabId;

/** @deprecated use LockerSectionId */
export type CollectionSectionId = LockerSectionId;

const ALL_TABS: LockerTabId[] = [
  'artists',
  'albums',
  'singles',
  'genres',
  'videos',
  'playlists',
];

export interface CollectionViewProps {
  section: LockerSectionId;
  onSectionChange: (id: LockerSectionId) => void;
  /** Replaces the internal section tab bar with the shared Music segment bar. */
  sectionBar?: React.ReactNode;
  /** Increment to pop locker UI back to the artists hub root (re-tap locker tab). */
  homeResetKey?: number;
  /** Android hardware back — pop locker drill-down before leaving the station. */
  lockerDrillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  vm: LockerVm;
  activeEnvelopeId: string | null;
  meshResults: MediaEnvelope[];
  lockerTracks: MediaEnvelope[];
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayNext?: (tracks: MediaEnvelope[]) => void;
  onPrepareForTravel?: (tracks: MediaEnvelope[]) => void;
  onAddToQueue?: (tracks: MediaEnvelope[]) => void;
  onRunSearch?: (query: string) => void;
  onGoToPlaylists?: () => void;
  onDownloadImportedPlaylist?: (playlist: import('../playlistStorage').StoredPlaylist) => void | Promise<void>;
  initialOpenPlaylistId?: string | null;
  onOpenPlaylistHandled?: () => void;
  onSelectArtist?: (artistName: string) => void;
  onGoToAlbum?: (artistName: string, albumTitle: string) => void;
  onOpenListening?: () => void;
  onSendToDj?: (deck: 'A' | 'B', trackId: string) => void;
  onAnalyzeStems?: (trackId: string) => void;
  /** Unseen followed-artist release count (mobile bell). */
  releaseNotifCount?: number;
  onOpenReleaseFeed?: () => void;
}

function LockerTab({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`locker-station-tab touch-manipulation ${active ? 'locker-station-tab-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  );
}

export default function CollectionView({
  section,
  onSectionChange,
  sectionBar,
  homeResetKey = 0,
  lockerDrillBackRef,
  vm,
  activeEnvelopeId,
  meshResults,
  lockerTracks,
  onPlay,
  onPlayAlbum,
  onPlayNext,
  onPrepareForTravel,
  onAddToQueue,
  onGoToPlaylists,
  onSelectArtist,
  onGoToAlbum,
  onRunSearch,
  onDownloadImportedPlaylist,
  initialOpenPlaylistId,
  onOpenPlaylistHandled,
  onOpenListening,
  onSendToDj,
  onAnalyzeStems,
  releaseNotifCount = 0,
  onOpenReleaseFeed,
}: CollectionViewProps) {
  const { t } = useTranslation();
  const isMobileShell = useMobileShell();
  const syncProgress = useLockerSyncProgress();
  const { entries: vaultEntries } = useLockerVault();
  const { collections, preferredEdition, graph } = useCollectionIntelligence(vaultEntries);
  const [playlistCount, setPlaylistCount] = useState(() => loadPlaylists().length);
  const [browseFilter, setBrowseFilter] = useState<LockerBrowseFilterId>(() => {
    const prefs = loadLockerViewPrefs();
    if (isNativeMobileShellClient() && prefs.browseFilter === 'downloaded') {
      return 'all';
    }
    return prefs.browseFilter;
  });
  const [libraryQuery, setLibraryQuery] = useState('');
  const [lockerSync, setLockerSync] = useState<LockerSyncSettings>(() => loadLockerSyncSettings());
  const [pins, setPins] = useState<LockerPin[]>(() => loadLockerPins());
  const [openCollectionKey, setOpenCollectionKey] = useState<string | null>(null);
  const [artistHubActive, setArtistHubActive] = useState(false);
  const [artistsSearchOpen, setArtistsSearchOpen] = useState(false);
  const [artistsSortMenuOpen, setArtistsSortMenuOpen] = useState(false);
  const [artistsMenuOpen, setArtistsMenuOpen] = useState(false);
  const [artistListSort, setArtistListSort] = useState<ArtistListSort>('name');
  const hubPanelRef = React.useRef<HTMLDivElement>(null);
  const localDrillBackRef = React.useRef<(() => boolean) | null>(null);
  const lockerPlaylistsDrillBackRef = React.useRef<(() => boolean) | null>(null);
  const lockerGenreDrillBackRef = React.useRef<(() => boolean) | null>(null);
  const localUploadRef = React.useRef<(() => void) | null>(null);
  const localRepairRef = React.useRef<(() => void) | null>(null);
  const localUpdateArtworkRef = React.useRef<(() => void) | null>(null);
  const [airGap, setAirGap] = useState(isAirGapEnabled);

  const artistProfileOpen = section === 'artists' && artistHubActive;
  const showMobileArtistsChrome =
    isMobileShell && section === 'artists' && !artistProfileOpen;
  /**
   * On the mobile Music pillar the segment bar is the only header chrome. The "Locker" title,
   * stats line and sync bar used to render on Genres/Playlists but not Library, which moved the
   * segment tabs down 71px between segments — the tabs appeared to change size and the page
   * jumped. Suppress the title block for every mobile segment so the bar never moves.
   */
  const showLockerTitleBlock = !isMobileShell;

  useEffect(() => {
    if (!homeResetKey) return;
    setArtistHubActive(false);
    setOpenCollectionKey(null);
    setLibraryQuery('');
    setArtistsSearchOpen(false);
    setArtistsSortMenuOpen(false);
    setArtistsMenuOpen(false);
    hubPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [homeResetKey]);

  const tabs = useMemo(
    () =>
      isMobileShell
        ? (['artists', 'genres', 'playlists'] as LockerTabId[])
        : ALL_TABS,
    [isMobileShell],
  );

  useEffect(() => {
    if (!isMobileShell) return;
    if (section === 'albums' || section === 'singles' || section === 'videos') {
      onSectionChange('artists');
    }
  }, [isMobileShell, section, onSectionChange]);

  useEffect(() => subscribePlaylists(() => setPlaylistCount(loadPlaylists().length)), []);

  useEffect(() => subscribeAirGap(setAirGap), []);

  const artistsHeaderMenuItems = useMemo((): LockerArtistsMobileMenuItem[] => {
    const items: LockerArtistsMobileMenuItem[] = [
      {
        id: 'upload',
        label: t('locker.headerMenu.uploadMusic'),
        onClick: () => localUploadRef.current?.(),
      },
    ];
    if (!airGap) {
      items.push(
        {
          id: 'fix-song-info',
          label: t('locker.headerMenu.fixSongInfo'),
          onClick: () => localRepairRef.current?.(),
        },
        {
          id: 'update-artwork',
          label: t('locker.headerMenu.updateArtwork'),
          onClick: () => localUpdateArtworkRef.current?.(),
        },
      );
    }
    return items;
  }, [airGap, t]);

  useEffect(() => {
    const syncSettings = () => setLockerSync(loadLockerSyncSettings());
    const syncPins = () => setPins(loadLockerPins());
    window.addEventListener('sandbox-settings-change', syncSettings);
    window.addEventListener('sandbox-locker-pins-change', syncPins);
    return () => {
      window.removeEventListener('sandbox-settings-change', syncSettings);
      window.removeEventListener('sandbox-locker-pins-change', syncPins);
    };
  }, []);

  useEffect(() => {
    if (isMobileShell && section === 'videos') {
      onSectionChange('artists');
    }
  }, [isMobileShell, section, onSectionChange]);

  const handleBrowseFilterChange = useCallback((id: LockerBrowseFilterId) => {
    setBrowseFilter(id);
    saveLockerViewPrefs({ browseFilter: id });
  }, []);

  const statsLine = useMemo(() => {
    if (section === 'playlists') {
      return t('locker.playlistsStats', { count: playlistCount });
    }

    if (section === 'artists') {
      const artistCount = graph.artists.length;
      const trackCount = vaultEntries.filter((e) => !isLockerVideoEntry(e)).length;
      return t('locker.artistsStats', { artists: artistCount, tracks: trackCount });
    }

    if (section === 'genres') {
      const source = lockerGenreSourceCollections(collections, vaultEntries);
      const shelves = buildLockerGenreShelves(source);
      const tracks = shelves.reduce((sum, sh) => sum + sh.trackCount, 0);
      return t('locker.genre.stats', { genres: shelves.length, tracks });
    }

    const videos = vaultEntries.filter(isLockerVideoEntry);
    let visibleCount = vaultEntries.length;
    if (section === 'videos') {
      visibleCount = videos.length;
    } else {
      visibleCount = vaultEntries.filter((e) => !isLockerVideoEntry(e)).length;
    }
    const displayCollections = filterCollectionsForLockerTab(collections, section, vaultEntries);
    const collectionsPart =
      section === 'videos'
        ? `${videos.length} videos`
        : `${displayCollections.length} collections`;
    return `${visibleCount} tracks · ${collectionsPart}`;
  }, [vaultEntries, collections, section, playlistCount, graph.artists.length, t]);

  const pinArtForKey = useCallback(
    (key: string) => {
      const collection = collections.find((c) => c.key === key);
      if (!collection) return undefined;
      const edition = preferredEdition(collection);
      const album = editionToAlbumGroup(collection, edition);
      for (const track of album.tracks) {
        if (track.albumArt) return track.albumArt;
      }
      return undefined;
    },
    [collections, preferredEdition],
  );

  const handleOpenPin = useCallback((pin: LockerPin) => {
    setOpenCollectionKey(pin.key);
  }, []);

  React.useEffect(() => {
    if (section !== 'artists') setArtistHubActive(false);
  }, [section]);

  React.useEffect(() => {
    void repairLockerVault();
  }, []);

  useEffect(() => {
    if (!lockerDrillBackRef) return;
    lockerDrillBackRef.current = () => {
      if (artistsMenuOpen) {
        setArtistsMenuOpen(false);
        return true;
      }
      if (artistsSortMenuOpen) {
        setArtistsSortMenuOpen(false);
        return true;
      }
      if (artistsSearchOpen) {
        setArtistsSearchOpen(false);
        return true;
      }
      if (section === 'playlists' && lockerPlaylistsDrillBackRef.current?.()) {
        return true;
      }
      if (section === 'genres' && lockerGenreDrillBackRef.current?.()) {
        return true;
      }
      if (localDrillBackRef.current?.()) {
        return true;
      }
      if (libraryQuery.trim()) {
        setLibraryQuery('');
        return true;
      }
      if (section !== 'artists') {
        onSectionChange('artists');
        return true;
      }
      return false;
    };
    return () => {
      lockerDrillBackRef.current = null;
    };
  }, [
    section,
    libraryQuery,
    lockerDrillBackRef,
    onSectionChange,
    artistsSearchOpen,
    artistsSortMenuOpen,
    artistsMenuOpen,
  ]);

  return (
    <div
      className={`locker-page${artistProfileOpen ? ' locker-page--artist-profile' : ''}`}
      data-locker-vault="2"
    >
      {!(artistProfileOpen && isMobileShell) ? (
      <header
        className={`locker-station-header${
          artistProfileOpen ? ' locker-station-header--profile' : ''
        }${!showLockerTitleBlock ? ' locker-station-header--artists-mobile' : ''}`}
      >
        {/* Segment bar first: it must sit at the header's top edge in every segment. */}
        {sectionBar ?? null}
        {showLockerTitleBlock ? (
        <div className="flex items-start justify-between gap-3">
          <h1 className="font-display text-[1.75rem] font-bold tracking-tight leading-none text-[var(--text)]">
            {t('nav.locker')}
          </h1>
          {onOpenReleaseFeed ? (
            <NotificationBellButton
              count={releaseNotifCount}
              onClick={onOpenReleaseFeed}
              ariaLabel={t('locker.releaseNotifBellAria', { count: releaseNotifCount })}
            />
          ) : null}
        </div>
        ) : null}
        {showLockerTitleBlock ? (
        <p className="locker-header-subtitle">
          {statsLine}
          {lockerSync.enabled && lockerSync.provider !== 'none' ? (
            <span className="locker-sync-status-badge">
              {lockerSync.lastSyncedAt
                ? t('locker.syncStatus.synced')
                : t('locker.syncStatus.enabled')}
            </span>
          ) : null}
        </p>
        ) : null}
        {showLockerTitleBlock ? <LockerSyncProgressBar progress={syncProgress} /> : null}
        {sectionBar ? null : (
          <nav className="locker-station-tabs" aria-label={t('locker.tabsAria')}>
            {tabs.map((tab) => (
              <React.Fragment key={tab}>
                <LockerTab
                  active={section === tab}
                  label={t(`locker.tabs.${tab}`)}
                  onClick={() => onSectionChange(tab)}
                />
              </React.Fragment>
            ))}
          </nav>
        )}
        {showMobileArtistsChrome ? (
          <LockerArtistsMobileHeader
            searchOpen={artistsSearchOpen}
            onSearchToggle={() => {
              setArtistsSearchOpen((open) => !open);
              setArtistsSortMenuOpen(false);
              setArtistsMenuOpen(false);
            }}
            libraryQuery={libraryQuery}
            onLibraryQueryChange={setLibraryQuery}
            sortMenuOpen={artistsSortMenuOpen}
            onSortMenuToggle={() => {
              setArtistsSortMenuOpen((open) => !open);
              setArtistsMenuOpen(false);
            }}
            artistSort={artistListSort}
            onArtistSortChange={setArtistListSort}
            menuOpen={artistsMenuOpen}
            onMenuToggle={() => {
              setArtistsMenuOpen((open) => !open);
              setArtistsSortMenuOpen(false);
            }}
            menuItems={artistsHeaderMenuItems}
          />
        ) : section === 'genres' ? (
          <LockerHeaderSearch
            value={libraryQuery}
            onChange={setLibraryQuery}
            placeholder={t('locker.genre.searchPlaceholder')}
            ariaLabel={t('locker.genre.searchPlaceholder')}
          />
        ) : section !== 'playlists' && section !== 'artists' ? (
          <>
            <LockerHeaderSearch
              value={libraryQuery}
              onChange={setLibraryQuery}
              placeholder={t('locker.searchPlaceholder')}
              ariaLabel={t('locker.searchPlaceholder')}
            />
            <LockerBrowseFilterPills
              active={browseFilter}
              onChange={handleBrowseFilterChange}
              labelFor={(id) => t(`locker.browseFilters.${id}`)}
              hiddenFilters={
                section === 'videos'
                  ? ['artists']
                  : isNativeMobileShellClient()
                    ? ['downloaded']
                    : []
              }
              ariaLabel={t('locker.browseFiltersAria')}
            />
          </>
        ) : section === 'artists' && !artistProfileOpen && !showMobileArtistsChrome ? (
          <LockerHeaderSearch
            value={libraryQuery}
            onChange={setLibraryQuery}
            placeholder={t('locker.searchArtistsPlaceholder')}
            ariaLabel={t('locker.searchArtistsPlaceholder')}
          />
        ) : null}
      </header>
      ) : null}

      <div className="locker-hub-panel" ref={hubPanelRef}>
        {section !== 'playlists' && section !== 'genres' && pins.length > 0 && !artistProfileOpen ? (
          <LockerPinnedRow
            pins={pins}
            title={t('locker.pinsTitle')}
            onOpen={handleOpenPin}
            onUnpin={unpinLockerAlbum}
            artForKey={pinArtForKey}
          />
        ) : null}

        {section === 'playlists' ? (
          <PlaylistsView
            embedded
            mobile={isMobileShell}
            playlistsDrillBackRef={lockerPlaylistsDrillBackRef}
            meshResults={meshResults}
            lockerTracks={lockerTracks}
            activeEnvelopeId={activeEnvelopeId}
            onPlay={onPlay}
            onPlayAlbum={onPlayAlbum}
            onPlayNext={onPlayNext}
            onPrepareForTravel={onPrepareForTravel}
            onRunSearch={onRunSearch}
            onGoToLocker={(section) => onSectionChange(section ?? 'artists')}
            onGoToSearch={onGoToPlaylists}
            onDownloadImportedPlaylist={onDownloadImportedPlaylist}
            initialOpenPlaylistId={initialOpenPlaylistId}
            onOpenPlaylistHandled={onOpenPlaylistHandled}
          />
        ) : section === 'genres' ? (
          <LockerGenreView
            collections={collections}
            entries={vaultEntries}
            libraryQuery={libraryQuery}
            onPlayAlbum={onPlayAlbum}
            drillBackRef={lockerGenreDrillBackRef}
          />
        ) : (
          <LocalView
            vm={vm}
            activeEnvelopeId={activeEnvelopeId}
            onPlay={onPlay}
            onPlayAlbum={onPlayAlbum}
            onAddToQueue={onAddToQueue}
            onGoToPlaylists={onGoToPlaylists}
            onSelectArtist={onSelectArtist}
            onGoToAlbum={onGoToAlbum}
            embedded
            lockerTab={section}
            browseFilter={browseFilter}
            onBrowseFilterChange={handleBrowseFilterChange}
            libraryQuery={libraryQuery}
            openCollectionKey={openCollectionKey}
            onOpenCollectionKeyHandled={() => setOpenCollectionKey(null)}
            onOpenListening={onOpenListening}
            onSendToDj={onSendToDj}
            onAnalyzeStems={onAnalyzeStems}
            onArtistHubActiveChange={setArtistHubActive}
            homeResetKey={homeResetKey}
            drillBackRef={localDrillBackRef}
            uploadActionRef={localUploadRef}
            repairActionRef={localRepairRef}
            updateArtworkActionRef={localUpdateArtworkRef}
            artistListSort={artistListSort}
          />
        )}
      </div>
    </div>
  );
}
