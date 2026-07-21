import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import LockerAlbumAmbientWash from '../components/LockerAlbumAmbientWash';
import {
  ArrowLeft,
  Loader2,
  Upload,
  FolderOpen,
  Check,
  Disc,
  Play,
  Search,
  Shuffle,
  Wrench,
} from 'lucide-react';
import type { AudioFsmState, MediaEnvelope } from '../sandboxLayer1';
import { useLockerVault } from '../LockerVaultContext';
import {
  dedupeLockerEntriesForDisplay,
  backfillEmbeddedAlbumCovers,
  backfillLockerTrackNumbers,
  backfillUrlAlbumCoversToBlobs,
  albumPrimaryArtist,
  albumGroupNeedsCredits,
  albumGroupHasPersistedCover,
  artistLineContainsLeakWatermark,
  clearAlbumCoverForGroup,
  formatAlbumDisplayName,
  getLockerEntriesSnapshot,
  inferAlbumFromFiles,
  isPersistentAlbumArt,
  isUsableArtistName,
  lockerAlbumArtistNeedsIdentification,
  lockerAlbumGroupKey,
  normalizeLockerAlbumArtistKey,
  parseAlbumFolderName,
  persistAlbumCoverBlobForGroup,
  persistAlbumCoverForGroup,
  persistOrphanTrackCover,
  persistOrphanTrackCoverBlob,
  refreshLockerEntryAlbumArt,
  resolveAlbumBannerArtist,
  resolveAlbumReleaseYear,
  resolveAlbumSearchArtist,
  resolveLockerEntryGroupArt,
  resolveLockerTrackArtistLine,
  repairAlbumGroupDurations,
  removeAlbumFromLocker,
  removeLockerEntry,
  saveLockerFile,
  LockerCapacityExceededError,
  tracksForAlbumGroup,
  updateAlbumGroupMetadata,
  updateLockerEntryMetadata,
  lockerEntryMatchesArtistFilter,
  formatLockerAlbumFeaturingLine,
  type LockerEntry,
} from '../lockerStorage';
import { LOCKER_USER_DELETE_CONFIRMED } from '../lockerDeleteGuard';
import { enrichAlbumMetadata, formatCreditLine, isClassicalGenre, artistCreditsFromLockerCreditsJson, fetchCatalogSupplementalArtistCredits } from '../albumCredits';
import { isAirGapEnabled } from '../airGapMode';
import {
  canonicalArtworkSrc,
  displayLockerTrackTitle,
  proxiedArtworkUrl,
} from '../displaySanitize';
import AlbumArtistCreditsSection from '../components/AlbumArtistCreditsSection';
import {
  collectAlbumGuestArtists,
  collectLockerAlbumArtistCredits,
  mergeAlbumArtistCreditLists,
} from '../searchCatalog';
import { identifyAndRepairAlbumGroup } from '../metadataRepair';
import {
  fixLockerTrackFromOnlineLibrary,
} from '../deviceImportMetadata';
import {
  LOCKER_STUB_REPAIR_EVENT,
  runLibraryMetadataAutoRepair,
  type LockerStubRepairEventDetail,
} from '../libraryMetadataAutoRepair';
import { formatAlbumDuration, formatTime } from './theme';
import { seedGradient } from '../seedGradient';
import { useCoverArtGlow } from '../hooks/useCoverArtGlow';
import { extractEmbeddedCover, extractEmbeddedCoverFromAny } from '../embeddedCover';
import { findAlbumCoverForLockerGroup } from '../albumCover';
import {
  forgetKnownGoodAlbumArt,
  pickLockerAlbumCover,
  rememberKnownGoodAlbumArt,
  resolveLockerAlbumArtSrc,
  resolveLockerTrackThumbArt,
  transferKnownGoodAlbumArt,
} from '../albumArtCache';
import ModalOverlay from './ModalOverlay';
import type { LockerMenuAction } from '../components/LockerMoreMenu';
import AddToPlaylistPicker from '../components/AddToPlaylistPicker';
import EditLockerInfoModal, {
  type EditLockerInfoValues,
} from '../components/EditLockerInfoModal';
import AlbumCreditsModal from '../components/AlbumCreditsModal';
import TrackRowSources from '../components/TrackRowSources';
import LoadInDjMenu from '../components/LoadInDjMenu';
import AnalyzeStemsButton from '../components/AnalyzeStemsButton';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  loadLockerSyncSettings,
  loadSyncAlbumFlags,
  saveSyncAlbumFlag,
  type LockerSyncSettings,
} from '../lockerSync';
import { groupTracksByEnvelope } from '../groupTracksByEnvelope';
import { sortLockerTracks } from '../lockerTrackOrder';
import {
  buildOrphanSingleCollections,
  editionToAlbumGroup,
  filterCollectionsForLockerTab,
  formatStorageSaved,
  isLockerVideoEntry,
  isLockerSingleCollection,
  isOrphanLockerTrack,
  lockerCollectionRoleForArtist,
  type CollectionAlbumGroup,
  type LockerTabId,
} from '../collectionIntelligence';
import { useCollectionIntelligence } from '../hooks/useCollectionIntelligence';
import LockerSearchView from './LockerSearchView';
import { scheduleLockerSearchReindex } from '../lockerSearchSync';
import MetadataRepairPanel from '../components/MetadataRepairPanel';
import { useTranslation } from '../i18n';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { useMobileShell } from '../hooks/useMobileShell';
import {
  flushPendingShellScrollRestore,
  LOCKER_LIBRARY_SCROLL_KEY,
  LOCKER_SEARCH_SCROLL_KEY,
  lockerArtistScrollKey,
  requestShellScrollRestore,
  saveShellScroll,
} from '../scrollRestore';
import LockerRowActions from '../components/locker/LockerRowActions';
import LockerArtistGrid from '../components/locker/LockerArtistGrid';
import LockerArtistHub from '../components/locker/LockerArtistHub';
import {
  LockerAlbumBannerArtistAvatar,
  LockerAlbumBannerCover,
  lockerAlbumBannerEntryId,
} from '../components/locker/LockerAlbumBannerArt';
import MobileTrackActionSheet from '../mobile/MobileTrackActionSheet';
import {
  filterCollectionsByBrowseFilter,
  filterTracksByBrowseFilter,
  isLockerAlbumSynced,
  collectionDownloadStatus,
  type LockerBrowseFilterId,
} from '../components/locker/lockerBrowseFilters';
import {
  filterCollectionsByLibraryQuery,
  filterTracksByLibraryQuery,
  sortCollectionsForLocker,
} from '../lockerLibrarySearch';
import {
  isLockerPinned,
  toggleLockerPin,
} from '../lockerPins';
import {
  loadLockerViewPrefs,
  saveLockerViewPrefs,
  type LockerLayoutMode,
  type LockerSortBy,
} from '../lockerViewPrefs';
import { searchLockerMirror } from '../lockerMirror';
import { LayoutGrid, List, Pin } from 'lucide-react';
import {
  getMostPlayed,
  storedHitToEnvelope,
  subscribePlayHistory,
} from '../playHistory';
import { formatMinutesHuman, getListeningStats } from '../listeningAnalytics';
import { repairLockerAlbumGrouping, backfillMissingAlbumCovers, backfillLockerAlbumArt } from '../lockerAlbumBackfill';
import { reconcileActiveDownloadJobsWithLocker } from '../downloadJobReconcile';
import { autoResumePausedDownloadJobs } from '../acquisitionPipeline';
import {
  getInProgressDownloadTrackIds,
  subscribeDownloadQueue,
} from '../downloadQueue';
import {
  isLockerAlbumCompletionPending,
  queueLockerAlbumMissingTracks,
  shouldAutoQueueLockerAlbumMissingTracks,
  shouldOfferLockerAlbumCompletion,
  summarizeLockerAlbumMissingTracks,
} from '../lockerAlbumCompletion';
import {
  audiobookRejectToastKey,
  isAudiobookBlockedFile,
  isMusicUpload,
  isRawAudioUpload,
  MUSIC_UPLOAD_ACCEPT,
  partitionMusicUploads,
} from '../lockerUploadFilter';
import DeviceMusicScanPanel from '../components/DeviceMusicScanPanel';
import { isDeviceMusicScanAvailable } from '../deviceMusicScan';

type AlbumGroup = CollectionAlbumGroup;

export interface LockerVm {
  url: string;
  title: string;
  state: AudioFsmState;
}

export interface LocalViewProps {
  vm: LockerVm;
  activeEnvelopeId: string | null;
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onAddToQueue?: (tracks: MediaEnvelope[]) => void;
  onGoToPlaylists?: () => void;
  /** Open catalog artist page (bio + discography). */
  onSelectArtist?: (artistName: string) => void;
  /** Open catalog album page (search drill-down). */
  onGoToAlbum?: (artistName: string, albumTitle: string) => void;
  /** Inside Collection hub — hide duplicate page chrome. */
  embedded?: boolean;
  /** @deprecated use lockerTab */
  forcedViewMode?: 'albums' | 'tracks';
  /** Active locker tab — albums, singles, or videos. */
  lockerTab?: LockerTabId;
  /** Open listening stats station. */
  onOpenListening?: () => void;
  /** Send track to DJ deck (Pro Audio, desktop). */
  onSendToDj?: (deck: 'A' | 'B', trackId: string) => void;
  /** Queue server Demucs analyze (mobile). */
  onAnalyzeStems?: (trackId: string) => void;
  /** Browse filter pills from Collection hub (all / artists / downloaded / synced). */
  browseFilter?: LockerBrowseFilterId;
  /** Controlled in-locker search (mobile hub). */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  onBrowseFilterChange?: (id: LockerBrowseFilterId) => void;
  /** In-header query — filters grid in place. */
  libraryQuery?: string;
  openCollectionKey?: string | null;
  onOpenCollectionKeyHandled?: () => void;
  /** Parent hides library chrome when locker artist profile is open. */
  onArtistHubActiveChange?: (active: boolean) => void;
  /** Increment to clear artist/album drill-down (re-tap locker tab). */
  homeResetKey?: number;
  /** Android hardware back — pop in-locker overlays and drill-down. */
  drillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  /** Parent overflow menu → open upload modal. */
  uploadActionRef?: React.MutableRefObject<(() => void) | null>;
  /** Parent overflow menu → open library metadata repair panel. */
  repairActionRef?: React.MutableRefObject<(() => void) | null>;
  /** Parent overflow menu → fetch missing album artwork library-wide. */
  updateArtworkActionRef?: React.MutableRefObject<(() => void) | null>;
  /** Mobile artists list sort (Collection hub). */
  artistListSort?: 'name' | 'tracks';
}

function isNowPlaying(vm: LockerVm, entry: LockerEntry): boolean {
  if (!vm.url && !vm.title) return false;
  if (vm.url && entry.url && vm.url === entry.url) return true;
  if (vm.title && entry.title && vm.title.toLowerCase() === entry.title.toLowerCase()) {
    return true;
  }
  return false;
}

function entryToEnvelope(entry: LockerEntry): MediaEnvelope {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName,
    url: '',
    durationSeconds: entry.durationSeconds,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: entry.id,
    artworkUrl: resolveLockerEntryGroupArt(entry),
  };
}

type UploadKind = 'track' | 'album';

function pickAlbumCover(tracks: LockerEntry[]): string | undefined {
  return pickLockerAlbumCover(tracks);
}

function groupHasDurableCoverArt(tracks: LockerEntry[]): boolean {
  return tracks.some((t) => isPersistentAlbumArt(t.albumArt));
}

function verifyImageLoads(src: string): Promise<boolean> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

function snapTracksForAlbum(
  snap: LockerEntry[],
  albumName: string,
  artist: string,
): LockerEntry[] {
  return tracksForAlbumGroup(snap, albumName, artist);
}

function snapTracksForAlbumGroup(snap: LockerEntry[], album: AlbumGroup): LockerEntry[] {
  if (album.key.startsWith('orphan:')) {
    const entryId = album.key.slice('orphan:'.length);
    const entry = snap.find((e) => e.id === entryId);
    return entry ? [entry] : album.tracks;
  }
  return snapTracksForAlbum(snap, album.name, album.artist);
}

const COVER_ACCEPT = 'image/jpeg,image/png,.jpg,.jpeg,.png';

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif)$/i;

const GENRE_OPTIONS = [
  'Hip-Hop/Rap',
  'R&B/Soul',
  'Electronic',
  'Rock',
  'Pop',
  'Jazz',
  'Classical',
  'Ambient',
  'Metal',
  'Other',
] as const;

function isImageUpload(file: File): boolean {
  return file.type.startsWith('image/') || IMAGE_EXT_RE.test(file.name);
}

/** Prefer cover.jpg / folder.jpg / front.jpg, then any embedded image. */
function pickCoverImage(files: File[]): File | undefined {
  const images = files.filter(isImageUpload);
  if (images.length === 0) return undefined;
  const named = (n: string) => images.find((f) => f.name.toLowerCase() === n);
  return (
    named('cover.jpg') ||
    named('folder.jpg') ||
    named('front.jpg') ||
    images.find((f) => /^(cover|folder|front)\./i.test(f.name)) ||
    images[0]
  );
}

/** Parse a track filename like "04 - Track Name.flac" into title (+ optional artist). */
function parseTrackFilename(filename: string): { title: string; artist?: string } {
  const base = filename.replace(/\.[^/.]+$/, '');
  const withoutNumber = base.replace(/^\s*\d+\s*[-._)]?\s*/, '').trim() || base.trim();
  const dash = withoutNumber.split(/\s+[-–—]\s+/);
  if (dash.length >= 2 && dash[0].trim()) {
    return { artist: dash[0].trim(), title: dash.slice(1).join(' - ').trim() };
  }
  return { title: withoutNumber };
}

async function copyShareText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
}

function sortLockerList(list: LockerEntry[], sortBy: LockerSortBy): LockerEntry[] {
  const copy = [...list];
  if (sortBy === 'priority') return copy;
  if (sortBy === 'artist') {
    return copy.sort((a, b) =>
      (a.artist ?? '').localeCompare(b.artist ?? '', undefined, { sensitivity: 'base' }),
    );
  }
  if (sortBy === 'added') {
    return copy.sort((a, b) => b.addedAt - a.addedAt);
  }
  return copy.sort((a, b) =>
    (a.title ?? '').localeCompare(b.title ?? '', undefined, { numeric: true }),
  );
}

function formatReleaseDate(releaseYear?: string): string {
  if (!releaseYear?.trim()) return '';
  const raw = releaseYear.trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const d = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return d
        .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        .toUpperCase();
    }
  }
  if (/^\d{4}$/.test(raw)) return raw;
  return raw.toUpperCase();
}

export default function LocalView({
  vm,
  activeEnvelopeId,
  onPlay,
  onPlayAlbum,
  onAddToQueue,
  onGoToPlaylists,
  onSelectArtist,
  onGoToAlbum,
  embedded = false,
  forcedViewMode,
  lockerTab = 'albums',
  onOpenListening,
  onSendToDj,
  onAnalyzeStems,
  browseFilter = 'all',
  searchOpen: searchOpenProp,
  onSearchOpenChange,
  onBrowseFilterChange,
  libraryQuery = '',
  openCollectionKey,
  onOpenCollectionKeyHandled,
  onArtistHubActiveChange,
  homeResetKey = 0,
  drillBackRef,
  uploadActionRef,
  repairActionRef,
  updateArtworkActionRef,
  artistListSort = 'name',
}: LocalViewProps) {
  const initialPrefs = loadLockerViewPrefs();
  const { t } = useTranslation();
  const { entries: vaultEntries, ready: hydrated, refresh } = useLockerVault();
  const {
    collections,
    graph,
    stats: collectionStats,
    preferredEdition,
    setPreferredEdition,
  } = useCollectionIntelligence(vaultEntries);
  const [viewMode, setViewMode] = useState<'albums' | 'tracks'>(initialPrefs.viewMode);
  const [layoutMode, setLayoutMode] = useState<LockerLayoutMode>(initialPrefs.layoutMode);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadKind, setUploadKind] = useState<UploadKind>('album');
  const [uploading, setUploading] = useState(false);
  const [sortBy, setSortBy] = useState<LockerSortBy>(initialPrefs.sortBy);
  const [mirrorMatchIds, setMirrorMatchIds] = useState<Set<string> | null>(null);
  const [downloadQueueRevision, setDownloadQueueRevision] = useState(0);
  const [formTitle, setFormTitle] = useState('');
  const [formArtist, setFormArtist] = useState('');
  const [formAlbum, setFormAlbum] = useState('');
  const [formYear, setFormYear] = useState('');
  const [formGenre, setFormGenre] = useState('');
  const [albumFiles, setAlbumFiles] = useState<File[]>([]);
  const [albumFolderName, setAlbumFolderName] = useState('');
  const [albumAudioCount, setAlbumAudioCount] = useState(0);
  const [trackFile, setTrackFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverPreviewUrlRef = useRef<string | null>(null);
  const [importProgress, setImportProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [deviceScanManualOpen, setDeviceScanManualOpen] = useState(false);
  const trackFileRef = useRef<HTMLInputElement>(null);
  const albumFilesRef = useRef<HTMLInputElement>(null);
  const albumFolderRef = useRef<HTMLInputElement>(null);
  const coverFileRef = useRef<HTMLInputElement>(null);
  const pendingCoverAlbum = useRef<AlbumGroup | null>(null);
  const brokenAlbumArt = useRef<Map<string, string>>(new Map());
  const artRecoveryAttempted = useRef(new Map<string, string>());
  const onlineCoverAttempted = useRef<Set<string>>(new Set());
  const [brokenArtRevision, setBrokenArtRevision] = useState(0);
  const [albumCoverPreview, setAlbumCoverPreview] = useState<Record<string, string>>({});
  const [selectedCollectionKey, setSelectedCollectionKey] = useState<string | null>(null);
  const collectionBackScrollKeyRef = useRef(LOCKER_LIBRARY_SCROLL_KEY);
  const [activeEditionKey, setActiveEditionKey] = useState<string | null>(null);
  const [expandedGridKey, setExpandedGridKey] = useState<string | null>(null);
  const [statsOpen, setStatsOpen] = useState(false);
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [artistFilter, setArtistFilter] = useState<string | null>(null);
  const [artistHeroArtwork, setArtistHeroArtwork] = useState<string | undefined>();
  const [playlistTracks, setPlaylistTracks] = useState<MediaEnvelope[] | null>(null);
  const [editTarget, setEditTarget] = useState<
    | { mode: 'track'; entry: LockerEntry }
    | { mode: 'album'; album: AlbumGroup; focusField?: 'albumArtist' }
    | null
  >(null);
  const [creditsTarget, setCreditsTarget] = useState<AlbumGroup | null>(null);
  const [toast, setToast] = useState('');
  const [syncAlbumFlags, setSyncAlbumFlags] = useState(() => loadSyncAlbumFlags());
  const [lockerSyncSettings, setLockerSyncSettings] = useState<LockerSyncSettings>(() =>
    loadLockerSyncSettings(),
  );
  const [searchOpenInternal, setSearchOpenInternal] = useState(false);
  const searchOpen = searchOpenProp ?? searchOpenInternal;
  const setSearchOpen = onSearchOpenChange ?? setSearchOpenInternal;
  const [repairOpen, setRepairOpen] = useState(false);
  const [libraryInsightsTick, setLibraryInsightsTick] = useState(0);
  const [actionSheet, setActionSheet] = useState<{
    title: string;
    subtitle?: string;
    actions: LockerMenuAction[];
    ariaLabel: string;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<
    | { kind: 'track'; entry: LockerEntry }
    | { kind: 'album'; album: AlbumGroup }
    | null
  >(null);
  const [confirmDeleteBusy, setConfirmDeleteBusy] = useState(false);
  const [completeMissingBusy, setCompleteMissingBusy] = useState(false);
  const autoCompleteAttemptedRef = useRef(new Set<string>());

  const isMobileShell = useMobileShell();

  useEffect(() => {
    if (!embedded || !isMobileShell) return;
    if (lockerTab === 'albums' && viewMode !== 'albums') {
      setViewMode('albums');
      saveLockerViewPrefs({ viewMode: 'albums' });
    }
    if (lockerTab === 'artists' && artistFilter && viewMode !== 'albums') {
      setViewMode('albums');
      saveLockerViewPrefs({ viewMode: 'albums' });
    }
  }, [embedded, isMobileShell, lockerTab, viewMode, artistFilter]);

  useEffect(() => subscribePlayHistory(() => setLibraryInsightsTick((n) => n + 1)), []);
  useEffect(() => subscribeDownloadQueue(() => setDownloadQueueRevision((n) => n + 1)), []);

  const pendingDownloadTrackIds = useMemo(
    () => getInProgressDownloadTrackIds(),
    [downloadQueueRevision],
  );

  const libraryInsights = useMemo(() => {
    void libraryInsightsTick;
    const entries = getLockerEntriesSnapshot() ?? [];
    const recentEntry = entries.length
      ? [...entries].sort((a, b) => b.addedAt - a.addedAt)[0]
      : null;
    const topHit = getMostPlayed(1)[0] ?? null;
    const stats = getListeningStats('month');
    return {
      recentEntry,
      topHit,
      minutesLabel: formatMinutesHuman(stats.minutesListened),
      topArtist: stats.topArtists[0]?.label,
      sessionCount: stats.sessionCount,
    };
  }, [vaultEntries, libraryInsightsTick]);

  useEffect(() => {
    const sync = () => {
      setLockerSyncSettings(loadLockerSyncSettings());
      setSyncAlbumFlags(loadSyncAlbumFlags());
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  const isMobile = useMemo(
    () => isMobileShell || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0),
    [isMobileShell],
  );
  const isNarrowMenu = useNarrowViewport(767);

  const openActionSheet = useCallback(
    (payload: {
      title: string;
      subtitle?: string;
      actions: LockerMenuAction[];
      ariaLabel: string;
    }) => {
      if (isMobileShell || isNarrowMenu) {
        setActionSheet(payload);
        return;
      }
    },
    [isMobileShell, isNarrowMenu],
  );

  const coverBackfillRan = useRef(false);
  const creditsBackfillAttempted = useRef(new Set<string>());
  const catalogIdentifyAttempted = useRef(new Set<string>());
  const [catalogIdentifiedArtists, setCatalogIdentifiedArtists] = useState<
    Record<string, string>
  >({});
  const [embeddedCoverDone, setEmbeddedCoverDone] = useState(false);
  useEffect(() => {
    if (!hydrated || coverBackfillRan.current) return;
    coverBackfillRan.current = true;
    void repairLockerAlbumGrouping()
      .then((metaChanged) =>
        reconcileActiveDownloadJobsWithLocker().then((reconciled) => metaChanged || reconciled > 0),
      )
      .then(async (metaChanged) => {
        const embedded = await backfillEmbeddedAlbumCovers();
        const trackNums = await backfillLockerTrackNumbers();
        const urlBlobs = await backfillUrlAlbumCoversToBlobs();
        return embedded || trackNums || urlBlobs || metaChanged;
      })
      .then((changed) => (changed ? refresh() : undefined))
      .then(() => autoResumePausedDownloadJobs())
      .catch(() => undefined)
      .finally(() => setEmbeddedCoverDone(true));
  }, [hydrated, refresh]);

  useEffect(() => {
    if (!artistFilter || !embeddedCoverDone) return;
    let cancelled = false;
    void backfillMissingAlbumCovers().then((fixed) => {
      if (fixed > 0 && !cancelled) void refresh();
    });
    return () => {
      cancelled = true;
    };
  }, [artistFilter, embeddedCoverDone, refresh]);

  useEffect(() => {
    if (!libraryQuery || libraryQuery.trim().length < 2) {
      setMirrorMatchIds(null);
      return;
    }
    let cancelled = false;
    void searchLockerMirror(libraryQuery).then((hits) => {
      if (cancelled) return;
      setMirrorMatchIds(hits.length > 0 ? new Set(hits.map((h) => h.id)) : null);
    });
    return () => {
      cancelled = true;
    };
  }, [libraryQuery]);

  useEffect(() => {
    if (!openCollectionKey) return;
    setSelectedCollectionKey(openCollectionKey);
    setActiveEditionKey(null);
    setViewMode('albums');
    onOpenCollectionKeyHandled?.();
  }, [openCollectionKey, onOpenCollectionKeyHandled]);

  useEffect(() => {
    if (embedded) return;
    if (forcedViewMode) setViewMode(forcedViewMode);
  }, [embedded, forcedViewMode]);

  useEffect(() => {
    const readArtistFilter = () => {
      const v = sessionStorage.getItem('sandbox-collection-artist-filter');
      if (v) {
        setArtistFilter(v);
        sessionStorage.removeItem('sandbox-collection-artist-filter');
      }
    };
    readArtistFilter();
    window.addEventListener('sandbox-collection-filter', readArtistFilter);
    return () => window.removeEventListener('sandbox-collection-filter', readArtistFilter);
  }, []);

  const albumArtSrc = useCallback(
    (album: AlbumGroup) =>
      resolveLockerAlbumArtSrc(
        album.key,
        pickAlbumCover(album.tracks),
        albumCoverPreview[album.key],
        brokenAlbumArt.current.get(album.key),
      ),
    [albumCoverPreview, brokenArtRevision],
  );

  const trackArtSrc = useCallback(
    (entry: LockerEntry) => {
      const groupKey = lockerAlbumGroupKey(entry);
      if (!groupKey) return pickLockerAlbumCover([entry]);
      const siblings = vaultEntries.filter((row) => lockerAlbumGroupKey(row) === groupKey);
      return resolveLockerTrackThumbArt(
        entry,
        groupKey,
        siblings.length > 0 ? siblings : [entry],
        albumCoverPreview[groupKey],
        brokenAlbumArt.current.get(groupKey),
      );
    },
    [albumCoverPreview, brokenArtRevision, vaultEntries],
  );

  const recoverAlbumArt = useCallback((album: AlbumGroup, failedSrc: string) => {
    const snap = getLockerEntriesSnapshot() ?? [];
    const tracks = snapTracksForAlbumGroup(snap, album);
    const entryId = album.key.startsWith('orphan:')
      ? album.key.slice('orphan:'.length)
      : tracks[0]?.id;
    if (!entryId || !failedSrc.startsWith('blob:')) return false;
    if (artRecoveryAttempted.current.get(entryId) === failedSrc) return true;

    artRecoveryAttempted.current.set(entryId, failedSrc);
    void refreshLockerEntryAlbumArt(entryId).then((fresh) => {
      if (fresh && fresh !== failedSrc) {
        artRecoveryAttempted.current.delete(entryId);
        brokenAlbumArt.current.delete(album.key);
        rememberKnownGoodAlbumArt(album.key, fresh);
        setBrokenArtRevision((n) => n + 1);
        return;
      }
      if (!fresh) {
        brokenAlbumArt.current.set(album.key, failedSrc);
        setBrokenArtRevision((n) => n + 1);
      }
    });
    return true;
  }, []);

  const handleAlbumArtError = useCallback(
    (album: AlbumGroup, failedSrc?: string) => {
      const snap = getLockerEntriesSnapshot() ?? [];
      const tracks = snapTracksForAlbumGroup(snap, album);
      const currentSrc = albumCoverPreview[album.key] ?? pickAlbumCover(tracks);
      const failedCanon = canonicalArtworkSrc(failedSrc);
      const currentCanon = canonicalArtworkSrc(currentSrc);
      // Stale error after cache refresh — a newer blob URL may already be live.
      if (failedCanon && currentCanon && failedCanon !== currentCanon) return;
      // Online preview still valid — vault src may be stale/revoked during refresh.
      if (albumCoverPreview[album.key]) return;
      // Transient gap while persist/refresh is in flight — do not permanently hide.
      if (!currentSrc) return;
      const src = failedCanon ?? currentCanon ?? failedSrc ?? currentSrc;
      if (src.startsWith('blob:') && recoverAlbumArt(album, src)) return;
      if (brokenAlbumArt.current.get(album.key) === src) return;
      brokenAlbumArt.current.set(album.key, src);
      setBrokenArtRevision((n) => n + 1);
      onlineCoverAttempted.current.delete(album.key);
      void backfillLockerAlbumArt(album.name, album.artist).then((ok) => {
        if (!ok) return;
        brokenAlbumArt.current.delete(album.key);
        setBrokenArtRevision((n) => n + 1);
        void refresh();
      });
    },
    [albumCoverPreview, recoverAlbumArt],
  );

  const openCoverArtPicker = (album: AlbumGroup) => {
    pendingCoverAlbum.current = album;
    setOpenMenuKey(null);
    window.requestAnimationFrame(() => {
      const input = coverFileRef.current;
      if (!input) {
        setToast('Could not open file picker');
        return;
      }
      try {
        if (typeof input.showPicker === 'function') {
          void input.showPicker();
        } else {
          input.click();
        }
      } catch {
        input.click();
      }
    });
  };

  const isPlaceholderArtist = (a?: string) =>
    !a || !a.trim() || /^local upload$/i.test(a.trim()) || !isUsableArtistName(a);

  const refreshAlbumCover = async (
    album: AlbumGroup,
    hint?: { albumName?: string; artist?: string; albumArtist?: string },
  ) => {
    setOpenMenuKey(null);
    onlineCoverAttempted.current.add(album.key);

    const searchAlbum =
      hint?.albumName?.trim() || album.displayName || album.name;
    // Prefer a real artist the user typed (album artist, then artist) over the
    // "Local Upload" placeholder or a word guessed from the folder name.
    const searchArtist =
      [hint?.albumArtist, hint?.artist].find((a) => !isPlaceholderArtist(a))?.trim() ||
      resolveAlbumSearchArtist(album.name, album.artist, album.tracks);

    setToast(`Searching for ${searchAlbum} cover…`);
    try {
      const found = await findAlbumCoverForLockerGroup(
        searchAlbum,
        searchArtist,
        album.tracks,
      );
      if (found?.url) {
        brokenAlbumArt.current.delete(album.key);
        setBrokenArtRevision((n) => n + 1);
        setAlbumCoverPreview((prev) => ({ ...prev, [album.key]: found.url }));
        const coverExtra = { releaseYear: found.year || undefined };
        const persisted = album.key.startsWith('orphan:')
          ? await persistOrphanTrackCover(album.key.slice('orphan:'.length), found.url, coverExtra)
          : await persistAlbumCoverForGroup(album.name, album.artist, found.url, coverExtra);
        if (!persisted) {
          console.warn('[locker] cover not persisted for', album.name);
          setToast('Cover found but could not save — check console');
          return;
        }
        await refresh();
        brokenAlbumArt.current.delete(album.key);
        setBrokenArtRevision((n) => n + 1);
        const snap = getLockerEntriesSnapshot() ?? [];
        const tracks = snapTracksForAlbumGroup(snap, album);
        let vaultArt = pickAlbumCover(tracks);
        if (vaultArt?.startsWith('blob:') && !(await verifyImageLoads(vaultArt))) {
          const entryId = album.key.startsWith('orphan:')
            ? album.key.slice('orphan:'.length)
            : tracks[0]?.id;
          if (entryId) {
            vaultArt = (await refreshLockerEntryAlbumArt(entryId)) ?? vaultArt;
          }
        }
        const vaultConfirmed =
          vaultArt !== undefined && (await verifyImageLoads(vaultArt));
        if (vaultConfirmed) {
          rememberKnownGoodAlbumArt(album.key, vaultArt!);
          setAlbumCoverPreview((prev) => {
            const next = { ...prev };
            delete next[album.key];
            return next;
          });
          setToast('Cover art updated');
        } else {
          console.warn('[locker] cover persisted but image verify failed for', album.name);
          setToast('Cover saved — reload if it does not appear');
        }
      } else {
        if (pickAlbumCover(album.tracks)) {
          const current = pickAlbumCover(album.tracks);
          if (current) brokenAlbumArt.current.set(album.key, current);
          setBrokenArtRevision((n) => n + 1);
          forgetKnownGoodAlbumArt(album.key);
          await clearAlbumCoverForGroup(album.name, album.artist);
          setAlbumCoverPreview((prev) => {
            const next = { ...prev };
            delete next[album.key];
            return next;
          });
          await refresh();
        }
        setToast('No cover found online for this album');
      }
    } catch {
      setToast('Could not fetch cover art');
    }
  };

  const handleCoverArtFile = async (file: File | undefined) => {
    const album = pendingCoverAlbum.current;
    if (!file) {
      pendingCoverAlbum.current = null;
      return;
    }
    if (!album) {
      setToast('Select an album first');
      return;
    }
    pendingCoverAlbum.current = null;

    const okType =
      file.type === 'image/jpeg' ||
      file.type === 'image/png' ||
      /\.(jpe?g|png)$/i.test(file.name);
    if (!okType) {
      setToast('Choose a JPG or PNG image');
      return;
    }

    const preview = URL.createObjectURL(file);
    setAlbumCoverPreview((prev) => ({ ...prev, [album.key]: preview }));
    setToast('Saving cover art…');
    try {
      if (album.key.startsWith('orphan:')) {
        await persistOrphanTrackCoverBlob(album.key.slice('orphan:'.length), file);
      } else {
        await persistAlbumCoverBlobForGroup(album.name, album.artist, file);
      }
      brokenAlbumArt.current.delete(album.key);
      setBrokenArtRevision((n) => n + 1);
      setAlbumCoverPreview((prev) => {
        const next = { ...prev };
        delete next[album.key];
        return next;
      });
      const snap = getLockerEntriesSnapshot() ?? [];
      const tracks = snapTracksForAlbumGroup(snap, album);
      const vaultArt = pickAlbumCover(tracks);
      if (vaultArt) rememberKnownGoodAlbumArt(album.key, vaultArt);
      URL.revokeObjectURL(preview);
      setEditTarget((t) => (t?.mode === 'album' && t.album.key === album.key ? null : t));
      setToast('Cover art saved');
    } catch {
      URL.revokeObjectURL(preview);
      setAlbumCoverPreview((prev) => {
        const next = { ...prev };
        delete next[album.key];
        return next;
      });
      setToast('Could not save cover art');
    }
  };

  const setCoverFromFile = useCallback((file: File | undefined) => {
    if (coverPreviewUrlRef.current) {
      URL.revokeObjectURL(coverPreviewUrlRef.current);
      coverPreviewUrlRef.current = null;
    }
    if (file) {
      const url = URL.createObjectURL(file);
      coverPreviewUrlRef.current = url;
      setCoverPreview(url);
    } else {
      setCoverPreview(null);
    }
  }, []);

  const resetUploadForm = useCallback(() => {
    setFormTitle('');
    setFormArtist('');
    setFormAlbum('');
    setFormYear('');
    setFormGenre('');
    setAlbumFiles([]);
    setAlbumFolderName('');
    setAlbumAudioCount(0);
    setTrackFile(null);
    setImportProgress(null);
    setDeviceScanManualOpen(false);
    setCoverFromFile(undefined);
  }, [setCoverFromFile]);

  const closeUpload = useCallback(() => {
    setUploadOpen(false);
    resetUploadForm();
  }, [resetUploadForm]);

  useEffect(
    () => () => {
      if (coverPreviewUrlRef.current) URL.revokeObjectURL(coverPreviewUrlRef.current);
    },
    [],
  );

  const notifyAudiobookRejected = useCallback(
    (audiobooks: File[], musicCount: number) => {
      if (audiobooks.length === 0) return;
      const first = audiobooks[0];
      const reason = isAudiobookBlockedFile(first, {
        audioFileCount: musicCount + audiobooks.length,
      }).reason;
      const base = t(audiobookRejectToastKey(reason));
      setToast(
        audiobooks.length > 1
          ? `${base} ${t('locker.uploadAudiobookSkippedCount', { count: audiobooks.length })}`
          : base,
      );
    },
    [t],
  );

  /** Step 1 — read an album folder / multi-file selection and prefill fields. */
  const prepareAlbumSelection = (files: FileList | null) => {
    if (!files?.length) return;
    const arr = [...files];
    const { music: audio, audiobooks } = partitionMusicUploads(arr);
    notifyAudiobookRejected(audiobooks, audio.length);
    const inferred = inferAlbumFromFiles(arr);
    const folderName = inferred.fromFolder ? inferred.albumName : '';

    setAlbumFiles(arr);
    setAlbumAudioCount(audio.length);
    setAlbumFolderName(folderName);

    if (folderName) {
      const parsed = parseAlbumFolderName(folderName);
      setFormAlbum(parsed.album || folderName);
      if (parsed.artist) setFormArtist(parsed.artist);
      if (parsed.year) setFormYear(parsed.year);
    }

    const imageCover = pickCoverImage(arr);
    setCoverFromFile(imageCover);
    if (!imageCover && audio.length > 0) {
      void extractEmbeddedCoverFromAny(audio).then((embedded) => {
        if (embedded) setCoverFromFile(embedded);
      });
    }
  };

  /** Step 1 — read a single track and prefill title/artist from the filename. */
  const prepareTrackSelection = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!isRawAudioUpload(file)) return;
    const block = isAudiobookBlockedFile(file, { audioFileCount: 1 });
    if (block.blocked || !isMusicUpload(file, { audioFileCount: 1 })) {
      setToast(t(audiobookRejectToastKey(block.reason)));
      return;
    }
    setTrackFile(file);
    const parsed = parseTrackFilename(file.name);
    setFormTitle(parsed.title);
    if (parsed.artist) setFormArtist(parsed.artist);
  };

  /** Step 2 — write the prepared selection to the locker with live progress. */
  const runImport = async () => {
    if (uploading) return;

    if (uploadKind === 'album') {
      const { music: audio, audiobooks } = partitionMusicUploads(albumFiles);
      if (audio.length === 0) {
        notifyAudiobookRejected(audiobooks, 0);
        return;
      }
      audio.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

      const rawAlbum = formAlbum.trim() || albumFolderName || 'Uploaded Album';
      const parsed = parseAlbumFolderName(rawAlbum);
      const artist = formArtist.trim() || parsed.artist || 'Local Upload';
      const albumName = albumFolderName.trim() || rawAlbum;
      const genre = formGenre.trim();
      const year = formYear.trim() || parsed.year || '';

      setUploading(true);
      setImportProgress({ current: 0, total: audio.length });
      try {
        const savedIds: string[] = [];
        for (let i = 0; i < audio.length; i++) {
          const saved = await saveLockerFile(audio[i], undefined, artist, albumName);
          savedIds.push(saved.id);
          setImportProgress({ current: i + 1, total: audio.length });
        }

        const cover =
          pickCoverImage(albumFiles) ?? (await extractEmbeddedCoverFromAny(audio));
        if (cover) {
          try {
            await persistAlbumCoverBlobForGroup(albumName, artist, cover);
          } catch {
            /* cover is best-effort */
          }
        }
        if (year) {
          try {
            await updateAlbumGroupMetadata(albumName, artist, { releaseYear: year });
          } catch {
            /* best-effort */
          }
        }
        if (genre) {
          for (const id of savedIds) {
            try {
              await updateLockerEntryMetadata(id, { genre });
            } catch {
              /* best-effort */
            }
          }
        }

        await refresh();
        scheduleLockerSearchReindex();
        setViewMode('albums');
        closeUpload();
      } catch (err) {
        if (err instanceof LockerCapacityExceededError) {
          setToast(err.message);
        } else {
          throw err;
        }
      } finally {
        setUploading(false);
        setImportProgress(null);
      }
    } else {
      if (!trackFile) return;
      const block = isAudiobookBlockedFile(trackFile, { audioFileCount: 1 });
      if (block.blocked || !isMusicUpload(trackFile, { audioFileCount: 1 })) {
        setToast(t(audiobookRejectToastKey(block.reason)));
        return;
      }
      const artist = formArtist.trim() || 'Local Upload';
      const title = formTitle.trim() || parseTrackFilename(trackFile.name).title;
      const genre = formGenre.trim();

      setUploading(true);
      setImportProgress({ current: 0, total: 1 });
      try {
        const saved = await saveLockerFile(trackFile, title, artist);
        const cover = await extractEmbeddedCover(trackFile);
        if (genre || cover) {
          try {
            await updateLockerEntryMetadata(saved.id, {
              ...(genre ? { genre } : {}),
              ...(cover ? { albumArtBlob: cover } : {}),
            });
          } catch {
            /* best-effort */
          }
        }
        setImportProgress({ current: 1, total: 1 });
        await refresh();
        scheduleLockerSearchReindex();
        closeUpload();
      } catch (err) {
        if (err instanceof LockerCapacityExceededError) {
          setToast(err.message);
        } else {
          throw err;
        }
      } finally {
        setUploading(false);
        setImportProgress(null);
      }
    }
  };

  const importCount = uploadKind === 'album' ? albumAudioCount : trackFile ? 1 : 0;
  const canImport = importCount > 0 && !uploading;
  const showDeviceMusicScan = isDeviceMusicScanAvailable();
  const showManualUploadPickers = !showDeviceMusicScan || deviceScanManualOpen;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const selectArtistFilter = useCallback(
    (name: string, artworkUrl?: string, options?: { saveScroll?: boolean }) => {
      if (options?.saveScroll !== false) {
        saveShellScroll(LOCKER_LIBRARY_SCROLL_KEY);
        collectionBackScrollKeyRef.current = LOCKER_LIBRARY_SCROLL_KEY;
      }
      onBrowseFilterChange?.('all');
      setArtistHeroArtwork(artworkUrl);
      setArtistFilter(name);
      setViewMode('albums');
      setSelectedCollectionKey(null);
      setActiveEditionKey(null);
      setExpandedGridKey(null);
    },
    [onBrowseFilterChange],
  );

  const clearArtistFilter = useCallback(() => {
    requestShellScrollRestore(LOCKER_LIBRARY_SCROLL_KEY);
    setArtistFilter(null);
    setArtistHeroArtwork(undefined);
  }, []);

  const openCollectionDetail = useCallback(
    (collectionKey: string, editionKey?: string | null, parentScrollKey?: string) => {
      const parentKey =
        parentScrollKey ??
        (artistFilter
          ? lockerArtistScrollKey(artistFilter)
          : searchOpen
            ? LOCKER_SEARCH_SCROLL_KEY
            : LOCKER_LIBRARY_SCROLL_KEY);
      saveShellScroll(parentKey);
      collectionBackScrollKeyRef.current = parentKey;
      setSelectedCollectionKey(collectionKey);
      setActiveEditionKey(editionKey ?? null);
    },
    [artistFilter, searchOpen],
  );

  const closeCollectionDetail = useCallback(() => {
    const parentKey = collectionBackScrollKeyRef.current;
    if (parentKey === LOCKER_SEARCH_SCROLL_KEY) {
      setSearchOpen(true);
    }
    requestShellScrollRestore(parentKey);
    setSelectedCollectionKey(null);
    setActiveEditionKey(null);
    setExpandedGridKey(null);
  }, [setSearchOpen]);

  const openLockerSearch = useCallback(() => {
    saveShellScroll(LOCKER_LIBRARY_SCROLL_KEY);
    setSearchOpen(true);
  }, [setSearchOpen]);

  const closeLockerSearch = useCallback(() => {
    setSearchOpen(false);
    requestShellScrollRestore(LOCKER_LIBRARY_SCROLL_KEY);
  }, [setSearchOpen]);

  useLayoutEffect(() => {
    flushPendingShellScrollRestore();
  }, [selectedCollectionKey, artistFilter, searchOpen]);

  useEffect(() => {
    if (!homeResetKey) return;
    onBrowseFilterChange?.('all');
    clearArtistFilter();
    setSelectedCollectionKey(null);
    setActiveEditionKey(null);
    setExpandedGridKey(null);
    setViewMode('albums');
  }, [homeResetKey, clearArtistFilter, onBrowseFilterChange]);

  useEffect(() => {
    if (!uploadActionRef) return;
    uploadActionRef.current = () => setUploadOpen(true);
    return () => {
      uploadActionRef.current = null;
    };
  }, [uploadActionRef]);

  const runLibraryFixSongInfo = useCallback(async () => {
    if (isAirGapEnabled()) {
      setToast(t('locker.deviceScanMetadataAirGap'));
      return;
    }
    setToast(t('locker.menu.fixingLibraryTags'));
    try {
      const result = await runLibraryMetadataAutoRepair();
      await refresh();
      scheduleLockerSearchReindex();
      const totalFixed =
        result.knownStubFixed +
        result.catalogStubFixed +
        result.junkCleared +
        result.unsafeUndone +
        result.enriched;
      setToast(
        totalFixed > 0
          ? t('locker.menu.fixLibraryTagsDone', { count: totalFixed })
          : t('locker.menu.fixSongInfoNone'),
      );
    } catch {
      setToast(t('locker.menu.fixSongInfoFailed'));
    }
  }, [refresh, setToast, t]);

  useEffect(() => {
    const onStubRepair = (event: Event) => {
      const detail = (event as CustomEvent<LockerStubRepairEventDetail>).detail;
      if (!detail) return;
      if (detail.phase === 'start') {
        setToast(t('locker.menu.fixingLibraryTags'));
      } else if (detail.phase === 'done' && detail.result) {
        const total =
          detail.result.knownStubFixed +
          detail.result.catalogStubFixed +
          detail.result.enriched;
        if (total > 0) {
          void refresh().then(() => scheduleLockerSearchReindex());
          setToast(t('locker.menu.fixLibraryTagsDone', { count: total }));
        }
      }
    };
    window.addEventListener(LOCKER_STUB_REPAIR_EVENT, onStubRepair);
    return () => window.removeEventListener(LOCKER_STUB_REPAIR_EVENT, onStubRepair);
  }, [refresh, setToast, t]);

  useEffect(() => {
    if (!repairActionRef) return;
    repairActionRef.current = () => {
      void runLibraryFixSongInfo();
    };
    return () => {
      repairActionRef.current = null;
    };
  }, [repairActionRef, runLibraryFixSongInfo]);

  const updateLibraryArtwork = useCallback(async () => {
    if (isAirGapEnabled()) {
      setToast(t('locker.deviceScanMetadataAirGap'));
      return;
    }
    setToast(t('locker.menu.searchingCover'));
    try {
      const fixed = await backfillMissingAlbumCovers();
      if (fixed > 0) {
        await refresh();
        scheduleLockerSearchReindex();
      }
      setToast(
        fixed > 0
          ? t('locker.headerMenu.artworkUpdated', { count: fixed })
          : t('locker.headerMenu.artworkNone'),
      );
    } catch {
      setToast(t('locker.menu.fixSongInfoFailed'));
    }
  }, [refresh, setToast, t]);

  useEffect(() => {
    if (!updateArtworkActionRef) return;
    updateArtworkActionRef.current = () => {
      void updateLibraryArtwork();
    };
    return () => {
      updateArtworkActionRef.current = null;
    };
  }, [updateArtworkActionRef, updateLibraryArtwork]);

  useEffect(() => {
    if (!drillBackRef) return;
    drillBackRef.current = () => {
      if (confirmDelete) {
        setConfirmDelete(null);
        return true;
      }
      if (editTarget) {
        setEditTarget(null);
        return true;
      }
      if (creditsTarget) {
        setCreditsTarget(null);
        return true;
      }
      if (actionSheet) {
        setActionSheet(null);
        return true;
      }
      if (uploadOpen) {
        setUploadOpen(false);
        resetUploadForm();
        return true;
      }
      if (repairOpen) {
        setRepairOpen(false);
        return true;
      }
      if (statsOpen) {
        setStatsOpen(false);
        return true;
      }
      if (searchOpen) {
        closeLockerSearch();
        return true;
      }
      if (playlistTracks) {
        setPlaylistTracks(null);
        return true;
      }
      if (openMenuKey) {
        setOpenMenuKey(null);
        return true;
      }
      if (selectedCollectionKey) {
        closeCollectionDetail();
        return true;
      }
      if (expandedGridKey) {
        setExpandedGridKey(null);
        return true;
      }
      if (artistFilter) {
        clearArtistFilter();
        return true;
      }
      if (viewMode === 'tracks') {
        setViewMode('albums');
        saveLockerViewPrefs({ viewMode: 'albums' });
        return true;
      }
      return false;
    };
    return () => {
      drillBackRef.current = null;
    };
  }, [
    drillBackRef,
    confirmDelete,
    editTarget,
    creditsTarget,
    actionSheet,
    uploadOpen,
    resetUploadForm,
    repairOpen,
    statsOpen,
    searchOpen,
    setSearchOpen,
    closeLockerSearch,
    playlistTracks,
    openMenuKey,
    closeCollectionDetail,
    selectedCollectionKey,
    expandedGridKey,
    artistFilter,
    clearArtistFilter,
    viewMode,
  ]);

  const lockerArtistMatches = useCallback(
    (entry: LockerEntry, filter: string) => lockerEntryMatchesArtistFilter(entry, filter),
    [],
  );

  const sorted = useMemo(
    () => sortLockerList(vaultEntries, sortBy),
    [vaultEntries, sortBy],
  );

  const visibleTracks = useMemo(() => {
    let base = dedupeLockerEntriesForDisplay(sorted);
    if (lockerTab === 'videos') {
      base = sorted.filter(isLockerVideoEntry);
    } else {
      base = sorted.filter((e) => !isLockerVideoEntry(e));
    }
    if (lockerTab === 'albums') {
      base = base.filter((e) => !isOrphanLockerTrack(e));
    } else if (lockerTab === 'singles') {
      base = base.filter((e) => isOrphanLockerTrack(e));
    }
    if (artistFilter) {
      base = base.filter((e) => lockerArtistMatches(e, artistFilter));
    }
    return filterTracksByBrowseFilter(base, browseFilter, collections, syncAlbumFlags);
  }, [sorted, artistFilter, lockerTab, browseFilter, collections, syncAlbumFlags, lockerArtistMatches]);

  const queryFilteredTracks = useMemo(() => {
    let tracks = filterTracksByLibraryQuery(visibleTracks, libraryQuery);
    if (mirrorMatchIds && libraryQuery.trim().length >= 2) {
      tracks = tracks.filter((t) => mirrorMatchIds.has(t.id));
    }
    return tracks;
  }, [visibleTracks, libraryQuery, mirrorMatchIds]);

  const displayCollections = useMemo(
    () => filterCollectionsForLockerTab(collections, lockerTab, vaultEntries),
    [collections, lockerTab, vaultEntries],
  );

  const filteredCollections = useMemo(() => {
    let cols = filterCollectionsByBrowseFilter(
      displayCollections,
      browseFilter,
      syncAlbumFlags,
      preferredEdition,
      pendingDownloadTrackIds,
    );
    cols = filterCollectionsByLibraryQuery(cols, libraryQuery, preferredEdition);
    if (mirrorMatchIds && libraryQuery.trim().length >= 2) {
      cols = cols.filter((collection) => {
        const edition = preferredEdition(collection);
        const group = editionToAlbumGroup(collection, edition);
        return group.tracks.some((t) => mirrorMatchIds.has(t.id));
      });
    }
    const sortKey =
      sortBy === 'priority' ? 'title' : sortBy === 'added' || sortBy === 'artist' ? sortBy : 'title';
    return sortCollectionsForLocker(cols, sortKey, preferredEdition);
  }, [
    displayCollections,
    browseFilter,
    syncAlbumFlags,
    preferredEdition,
    libraryQuery,
    mirrorMatchIds,
    sortBy,
    pendingDownloadTrackIds,
  ]);

  const artistFilteredCollections = useMemo(() => {
    if (!artistFilter) return filteredCollections;
    return filteredCollections.filter((collection) => {
      const tracks = collection.editions.flatMap((edition) => edition.tracks);
      if (lockerCollectionRoleForArtist(collection, artistFilter)) return true;
      return tracks.some((track) => lockerEntryMatchesArtistFilter(track, artistFilter));
    });
  }, [filteredCollections, artistFilter]);

  /**
   * Artist hub ignores browseFilter (e.g. Downloaded) so finished album jobs still
   * appear under the artist even when offlineReady stamps briefly lag native cache.
   */
  const artistHubBaseCollections = useMemo(() => {
    if (!artistFilter) return [];
    return displayCollections.filter((collection) => {
      if (lockerCollectionRoleForArtist(collection, artistFilter)) return true;
      const tracks = collection.editions.flatMap((edition) => edition.tracks);
      return tracks.some((track) => lockerEntryMatchesArtistFilter(track, artistFilter));
    });
  }, [displayCollections, artistFilter]);

  const artistHubTracks = useMemo(() => {
    if (!artistFilter) return [];
    let base = dedupeLockerEntriesForDisplay(sorted).filter((e) => !isLockerVideoEntry(e));
    base = base.filter((e) => lockerArtistMatches(e, artistFilter));
    let tracks = filterTracksByLibraryQuery(base, libraryQuery);
    if (mirrorMatchIds && libraryQuery.trim().length >= 2) {
      tracks = tracks.filter((t) => mirrorMatchIds.has(t.id));
    }
    return tracks;
  }, [
    artistFilter,
    sorted,
    lockerArtistMatches,
    libraryQuery,
    mirrorMatchIds,
  ]);

  const videoEntries = useMemo(
    () => vaultEntries.filter(isLockerVideoEntry),
    [vaultEntries],
  );

  const allEditionGroups = useMemo(
    () =>
      collections.flatMap((collection) =>
        collection.editions.map((edition) => editionToAlbumGroup(collection, edition)),
      ),
    [collections],
  );

  const coverCandidates = useMemo(() => {
    const videoIds = new Set(vaultEntries.filter(isLockerVideoEntry).map((e) => e.id));
    const orphanSingles = buildOrphanSingleCollections(vaultEntries, videoIds);
    const byKey = new Map<string, AlbumGroup>();
    for (const collection of [...collections, ...orphanSingles]) {
      const edition = preferredEdition(collection);
      const group = editionToAlbumGroup(collection, edition);
      byKey.set(group.key, group);
    }
    return [...byKey.values()];
  }, [collections, preferredEdition, vaultEntries]);

  useEffect(() => {
    let changed = false;
    for (const album of coverCandidates) {
      const art = pickAlbumCover(album.tracks);
      if (art) rememberKnownGoodAlbumArt(album.key, art);
      const failedSrc = brokenAlbumArt.current.get(album.key);
      if (failedSrc && art && failedSrc !== art) {
        brokenAlbumArt.current.delete(album.key);
        changed = true;
      }
    }
    if (changed) setBrokenArtRevision((n) => n + 1);
  }, [coverCandidates]);

  const selectedCollection = useMemo(
    () => collections.find((c) => c.key === selectedCollectionKey) ?? null,
    [collections, selectedCollectionKey],
  );

  const selectedAlbum = useMemo(() => {
    if (!selectedCollection) return null;
    const edition =
      selectedCollection.editions.find((e) => e.key === activeEditionKey) ??
      preferredEdition(selectedCollection);
    return editionToAlbumGroup(selectedCollection, edition);
  }, [selectedCollection, activeEditionKey, preferredEdition]);

  const displayAlbumCollections = artistFilter ? artistFilteredCollections : filteredCollections;

  const filteredArtists = useMemo(() => {
    const q = libraryQuery.trim().toLowerCase();
    let list = q
      ? graph.artists.filter((a) => a.displayName.toLowerCase().includes(q))
      : graph.artists;
    if (artistListSort === 'tracks') {
      return [...list].sort(
        (a, b) =>
          b.trackCount - a.trackCount ||
          a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
      );
    }
    return [...list].sort((a, b) =>
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
    );
  }, [graph.artists, libraryQuery, artistListSort]);

  const gridCollectionSections = useMemo(() => {
    if (!artistFilter) {
      return [{ id: 'all', label: undefined as string | undefined, collections: displayAlbumCollections }];
    }
    const albums = displayAlbumCollections.filter((c) => !isLockerSingleCollection(c));
    const singles = displayAlbumCollections.filter((c) => isLockerSingleCollection(c));
    const sections: { id: string; label?: string; collections: typeof displayAlbumCollections }[] =
      [];
    if (albums.length > 0) {
      sections.push({
        id: 'albums',
        label: t('locker.artistHubAlbumsSection'),
        collections: albums,
      });
    }
    if (singles.length > 0) {
      sections.push({
        id: 'singles',
        label: t('locker.artistHubSinglesSection'),
        collections: singles,
      });
    }
    return sections.length > 0
      ? sections
      : [{ id: 'empty', label: undefined, collections: [] as typeof displayAlbumCollections }];
  }, [artistFilter, displayAlbumCollections, t]);

  const artistHubAlbumCollections = useMemo(
    () =>
      artistHubBaseCollections.filter(
        (c) =>
          !isLockerSingleCollection(c) &&
          lockerCollectionRoleForArtist(c, artistFilter ?? '') === 'primary',
      ),
    [artistHubBaseCollections, artistFilter],
  );

  const artistHubAppearsOnCollections = useMemo(
    () =>
      artistHubBaseCollections.filter(
        (c) =>
          !isLockerSingleCollection(c) &&
          lockerCollectionRoleForArtist(c, artistFilter ?? '') === 'guest',
      ),
    [artistHubBaseCollections, artistFilter],
  );

  const artistHubSingleCollections = useMemo(() => {
    if (!artistFilter) return [];
    const fromGroups = artistHubBaseCollections.filter(
      (c) =>
        isLockerSingleCollection(c) &&
        lockerCollectionRoleForArtist(c, artistFilter) === 'primary',
    );
    const videoIds = new Set(vaultEntries.filter(isLockerVideoEntry).map((e) => e.id));
    const orphans = buildOrphanSingleCollections(vaultEntries, videoIds).filter(
      (c) => lockerCollectionRoleForArtist(c, artistFilter) === 'primary',
    );
    const seen = new Set(fromGroups.map((c) => c.key));
    const merged = [...fromGroups];
    for (const orphan of orphans) {
      if (seen.has(orphan.key)) continue;
      seen.add(orphan.key);
      merged.push(orphan);
    }
    return merged;
  }, [artistHubBaseCollections, artistFilter, vaultEntries]);

  const showArtistBrowse =
    lockerTab === 'artists' && !artistFilter && !selectedAlbum && viewMode === 'albums';

  const showBrowseFilterArtists =
    browseFilter === 'artists' &&
    lockerTab !== 'artists' &&
    !artistFilter &&
    !selectedAlbum &&
    viewMode === 'albums';

  const showArtistHub =
    lockerTab === 'artists' && Boolean(artistFilter) && !selectedAlbum;

  useEffect(() => {
    onArtistHubActiveChange?.(showArtistHub);
  }, [showArtistHub, onArtistHubActiveChange]);

  useEffect(() => {
    return () => onArtistHubActiveChange?.(false);
  }, [onArtistHubActiveChange]);

  const showAlbumGrid =
    lockerTab !== 'videos' &&
    viewMode === 'albums' &&
    !selectedAlbum &&
    !showArtistHub &&
    (lockerTab === 'artists' ? Boolean(artistFilter) : browseFilter !== 'artists');

  const showLibraryInsights =
    lockerTab === 'albums' && viewMode === 'albums' && !selectedAlbum && !artistFilter;

  const showAlbumsEmpty =
    lockerTab !== 'videos' &&
    viewMode === 'albums' &&
    !selectedAlbum &&
    browseFilter !== 'artists' &&
    displayAlbumCollections.length === 0;
  const showVideosEmpty = lockerTab === 'videos' && videoEntries.length === 0;
  const showGeneralEmpty =
    hydrated && sorted.length === 0 && !showAlbumsEmpty && !showVideosEmpty;

  useEffect(() => {
    if (!embeddedCoverDone) return;
    let cancelled = false;
    void (async () => {
      let changed = false;
      for (const album of coverCandidates) {
        if (cancelled) return;
        if (onlineCoverAttempted.current.has(album.key)) continue;
        if (albumCoverPreview[album.key]) continue;

        const broken = brokenAlbumArt.current.has(album.key);
        if (!broken && groupHasDurableCoverArt(album.tracks)) continue;
        if (!broken && (await albumGroupHasPersistedCover(album.tracks))) continue;

        onlineCoverAttempted.current.add(album.key);
        try {
          const ok = await backfillLockerAlbumArt(album.name, album.artist);
          if (ok) {
            brokenAlbumArt.current.delete(album.key);
            changed = true;
          }
        } catch {
          /* online lookup is best-effort */
        }
      }
      if (changed && !cancelled) void refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [embeddedCoverDone, coverCandidates, albumCoverPreview, brokenArtRevision, refresh]);

  const creditsAlbum = useMemo(() => {
    if (!creditsTarget) return null;
    return allEditionGroups.find((a) => a.key === creditsTarget.key) ?? creditsTarget;
  }, [allEditionGroups, creditsTarget]);

  const selectedAlbumEntryId = useMemo(
    () => (selectedAlbum ? lockerAlbumBannerEntryId(selectedAlbum) : undefined),
    [selectedAlbum],
  );

  const selectedCoverArt = useMemo(
    () => (selectedAlbum ? albumArtSrc(selectedAlbum) : undefined),
    [selectedAlbum, albumArtSrc],
  );

  const { style: selectedAlbumGlowStyle, isMonochrome: selectedAlbumMonochrome } =
    useCoverArtGlow(selectedCoverArt, selectedAlbum?.displayName ?? '');
  const selectedAlbumBannerStyle = selectedAlbum
    ? (selectedAlbumGlowStyle as React.CSSProperties)
    : undefined;

  const showAlbumAmbientWash =
    lockerTab !== 'videos' && viewMode === 'albums' && Boolean(selectedAlbum);

  useEffect(() => {
    const root = document.querySelector('.shell-root');
    if (!root) return;
    if (showAlbumAmbientWash) {
      root.classList.add('shell-root--locker-album-wash');
    } else {
      root.classList.remove('shell-root--locker-album-wash');
    }
    return () => root.classList.remove('shell-root--locker-album-wash');
  }, [showAlbumAmbientWash]);

  const lockerAlbumWashPortal =
    showAlbumAmbientWash && selectedAlbum
      ? createPortal(
          <LockerAlbumAmbientWash
            coverArt={selectedCoverArt}
            albumName={selectedAlbum.displayName}
            style={selectedAlbumBannerStyle}
            isMonochrome={selectedAlbumMonochrome}
          />,
          document.querySelector('.shell-root') ?? document.body,
        )
      : null;

  const selectedAlbumGroupedTracks = useMemo(
    () => (selectedAlbum ? groupTracksByEnvelope(selectedAlbum.tracks) : []),
    [selectedAlbum],
  );

  const groupedVisibleTracks = useMemo(
    () => groupTracksByEnvelope(queryFilteredTracks),
    [queryFilteredTracks],
  );

  const selectedAlbumMissing = useMemo(
    () =>
      selectedAlbum
        ? summarizeLockerAlbumMissingTracks(selectedAlbum.tracks)
        : { missingCount: 0, playableCount: 0, missingTitles: [] },
    [selectedAlbum],
  );

  const offerAlbumCompletion = useMemo(
    () =>
      selectedAlbum
        ? shouldOfferLockerAlbumCompletion(
            selectedAlbum.name,
            selectedAlbum.artist,
            selectedAlbum.tracks,
          )
        : false,
    [selectedAlbum],
  );

  const runCompleteMissingTracks = useCallback(async () => {
    if (!selectedAlbum || completeMissingBusy || !offerAlbumCompletion) return;
    if (isAirGapEnabled()) {
      setToast(t('travel.offlineBlocked'));
      return;
    }
    setCompleteMissingBusy(true);
    try {
      const jobId = await queueLockerAlbumMissingTracks(
        selectedAlbum.name,
        selectedAlbum.artist,
        selectedAlbum.tracks,
      );
      if (jobId) {
        setToast(
          t('locker.completeMissingQueued', {
            count: selectedAlbumMissing.missingCount,
          }),
        );
      } else {
        setToast(t('locker.completeMissingUnavailable'));
      }
    } finally {
      setCompleteMissingBusy(false);
    }
  }, [
    selectedAlbum,
    completeMissingBusy,
    offerAlbumCompletion,
    selectedAlbumMissing.missingCount,
    t,
  ]);

  // Tidal-like: auto-queue hollow/missing tracks when user already started a full album download.
  useEffect(() => {
    if (!selectedAlbum || !hydrated || isAirGapEnabled()) return;
    if (!shouldAutoQueueLockerAlbumMissingTracks(
      selectedAlbum.name,
      selectedAlbum.artist,
      selectedAlbum.tracks,
    )) {
      return;
    }
    if (autoCompleteAttemptedRef.current.has(selectedAlbum.key)) return;
    if (isLockerAlbumCompletionPending(selectedAlbum.name, selectedAlbum.artist)) {
      autoCompleteAttemptedRef.current.add(selectedAlbum.key);
      return;
    }
    autoCompleteAttemptedRef.current.add(selectedAlbum.key);
    void queueLockerAlbumMissingTracks(
      selectedAlbum.name,
      selectedAlbum.artist,
      selectedAlbum.tracks,
    ).then((jobId) => {
      if (jobId) {
        setToast(
          t('locker.completeMissingQueued', {
            count: selectedAlbumMissing.missingCount,
          }),
        );
      }
    });
  }, [
    selectedAlbum?.key,
    selectedAlbum?.name,
    selectedAlbum?.artist,
    selectedAlbum?.tracks,
    hydrated,
    selectedAlbumMissing.missingCount,
    t,
  ]);

  const selectedAlbumMeta = useMemo(() => {
    if (!selectedAlbum) return null;
    const groups = groupTracksByEnvelope(selectedAlbum.tracks);
    const totalSeconds = groups.reduce(
      (sum, g) => sum + (g.primary.durationSeconds || 0),
      0,
    );
    const releaseYear = resolveAlbumReleaseYear(selectedAlbum.name, selectedAlbum.tracks);
    const identifiedArtist = catalogIdentifiedArtists[selectedAlbum.key];
    const artistName = resolveAlbumBannerArtist(
      selectedAlbum.name,
      selectedAlbum.artist,
      selectedAlbum.tracks,
      identifiedArtist,
    );
    return {
      totalSeconds,
      releaseDate: formatReleaseDate(releaseYear),
      artistName,
      trackCount: groups.length,
    };
  }, [selectedAlbum, catalogIdentifiedArtists]);

  const [lockerSupplementCredits, setLockerSupplementCredits] = useState<string[]>([]);

  const selectedAlbumArtistCredits = useMemo(() => {
    if (!selectedAlbum) return [];
    const albumArtist =
      resolveAlbumBannerArtist(
        selectedAlbum.name,
        selectedAlbum.artist,
        selectedAlbum.tracks,
        catalogIdentifiedArtists[selectedAlbum.key],
      ) || selectedAlbum.artist;
    const fromJson = artistCreditsFromLockerCreditsJson(selectedAlbum.tracks);
    const supplemental =
      fromJson.length > 0 ? fromJson : lockerSupplementCredits;
    return collectLockerAlbumArtistCredits(
      albumArtist,
      selectedAlbum.tracks,
      (track) => resolveLockerTrackArtistLine(track, albumArtist, selectedAlbum.name),
      supplemental,
    );
  }, [selectedAlbum, catalogIdentifiedArtists, lockerSupplementCredits]);

  const selectedAlbumGuestArtists = useMemo(() => {
    if (!selectedAlbum) return [];
    const albumArtist =
      resolveAlbumBannerArtist(
        selectedAlbum.name,
        selectedAlbum.artist,
        selectedAlbum.tracks,
        catalogIdentifiedArtists[selectedAlbum.key],
      ) || selectedAlbum.artist;
    return collectAlbumGuestArtists(
      albumArtist,
      selectedAlbum.tracks.map((track) => ({
        title: track.title,
        artist: resolveLockerTrackArtistLine(track, albumArtist, selectedAlbum.name),
        trackPerformers: track.trackPerformers,
        trackSoloists: track.trackSoloists,
      })),
    );
  }, [selectedAlbum, catalogIdentifiedArtists]);

  useEffect(() => {
    if (!selectedAlbum) {
      setLockerSupplementCredits([]);
      return;
    }
    if (isAirGapEnabled()) {
      setLockerSupplementCredits([]);
      return;
    }
    const albumArtist =
      resolveAlbumBannerArtist(
        selectedAlbum.name,
        selectedAlbum.artist,
        selectedAlbum.tracks,
        catalogIdentifiedArtists[selectedAlbum.key],
      ) || selectedAlbum.artist;
    const mapped = selectedAlbum.tracks.map((track) => ({
      title: track.title,
      artist: resolveLockerTrackArtistLine(track, albumArtist, selectedAlbum.name),
      trackPerformers: track.trackPerformers,
      trackSoloists: track.trackSoloists,
    }));
    const guests = collectAlbumGuestArtists(albumArtist, mapped);
    if (guests.length > 0 || artistCreditsFromLockerCreditsJson(selectedAlbum.tracks).length > 0) {
      setLockerSupplementCredits([]);
      return;
    }
    let cancelled = false;
    void fetchCatalogSupplementalArtistCredits(
      selectedAlbum.name,
      albumArtist,
      selectedAlbum.tracks,
    )
      .then((names) => {
        if (!cancelled) setLockerSupplementCredits(names);
      })
      .catch(() => {
        if (!cancelled) setLockerSupplementCredits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedAlbum, catalogIdentifiedArtists]);

  const selectedAlbumFeaturingLine = useMemo(() => {
    if (!selectedAlbumMeta?.artistName) return '';
    return formatLockerAlbumFeaturingLine(
      selectedAlbumMeta.artistName,
      selectedAlbumGuestArtists,
    );
  }, [selectedAlbumMeta?.artistName, selectedAlbumGuestArtists]);

  const handleLockerAlbumArtistNav = useCallback(
    (name: string) => {
      if (embedded) {
        selectArtistFilter(name, undefined, { saveScroll: false });
        setSelectedCollectionKey(null);
        setActiveEditionKey(null);
      } else {
        onSelectArtist?.(name);
      }
    },
    [embedded, onSelectArtist, selectArtistFilter],
  );

  useEffect(() => {
    if (!hydrated || !selectedAlbum) return;
    if (!selectedAlbum.tracks.some((t) => !t.durationSeconds)) return;
    void repairAlbumGroupDurations(selectedAlbum.name, selectedAlbum.artist).then(() =>
      refresh(),
    );
  }, [hydrated, selectedAlbum?.key]);

  useEffect(() => {
    if (!hydrated || !selectedAlbum || !embeddedCoverDone) return;
    if (creditsBackfillAttempted.current.has(selectedAlbum.key)) return;
    if (!albumGroupNeedsCredits(selectedAlbum.tracks)) return;
    creditsBackfillAttempted.current.add(selectedAlbum.key);
    void enrichAlbumMetadata(selectedAlbum.name, selectedAlbum.artist)
      .then((result) => (result ? refresh() : undefined))
      .catch(() => undefined);
  }, [hydrated, embeddedCoverDone, selectedAlbum?.key, refresh]);

  useEffect(() => {
    if (!hydrated || !selectedAlbum) return;
    if (catalogIdentifyAttempted.current.has(selectedAlbum.key)) return;
    const hasLeakTags = selectedAlbum.tracks.some(
      (t) =>
        artistLineContainsLeakWatermark(t.artist ?? '') ||
        artistLineContainsLeakWatermark(t.trackPerformers ?? '') ||
        (t.albumArtist?.trim() && !isUsableArtistName(t.albumArtist)),
    );
    const needsArtistFix =
      lockerAlbumArtistNeedsIdentification(selectedAlbum.tracks) || hasLeakTags;
    const needsTrackArtists = selectedAlbum.tracks.some(
      (t) => !isUsableArtistName(t.artist?.trim()),
    );
    if (!needsArtistFix && !needsTrackArtists && !hasLeakTags) return;
    catalogIdentifyAttempted.current.add(selectedAlbum.key);
    void identifyAndRepairAlbumGroup(
      selectedAlbum.name,
      selectedAlbum.artist,
      selectedAlbum.tracks,
    )
      .then((outcome) => {
        if (outcome.artist) {
          setCatalogIdentifiedArtists((prev) => ({
            ...prev,
            [selectedAlbum.key]: outcome.artist!,
          }));
        }
        if (outcome.updated) {
          void refresh().then(() => {
            const artist = outcome.artist ?? '';
            if (outcome.matchType === 'official_album' && artist) {
              setToast(t('locker.menu.identifyOfficialMatch', { artist }));
            } else if (artist) {
              setToast(t('locker.menu.identifyPartialMatch', { artist }));
            } else {
              setToast('Album metadata updated from catalog');
            }
          });
        } else if (outcome.artist) {
          setToast(t('locker.menu.identifyAlreadyCorrect', { artist: outcome.artist }));
        } else if (hasLeakTags || needsArtistFix) {
          setToast(t('locker.menu.identifyManual'));
        }
      })
      .catch(() => {
        setToast('Catalog identification failed — check network');
      });
  }, [hydrated, selectedAlbum?.key, refresh, t]);

  useEffect(() => {
    if (!hydrated || !selectedAlbum || !embeddedCoverDone) return;
    if (onlineCoverAttempted.current.has(selectedAlbum.key)) return;
    let cancelled = false;
    void (async () => {
      if (await albumGroupHasPersistedCover(selectedAlbum.tracks)) return;
      if (cancelled) return;
      onlineCoverAttempted.current.add(selectedAlbum.key);
      const ok = await backfillLockerAlbumArt(selectedAlbum.name, selectedAlbum.artist);
      if (ok && !cancelled) {
        brokenAlbumArt.current.delete(selectedAlbum.key);
        void refresh();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [hydrated, embeddedCoverDone, selectedAlbum?.key, selectedAlbum?.tracks, refresh]);

  const promptDeleteTrack = (entry: LockerEntry) => {
    setConfirmDelete({ kind: 'track', entry });
  };

  const promptDeleteAlbum = (album: AlbumGroup) => {
    setConfirmDelete({ kind: 'album', album });
  };

  const runConfirmedDelete = async () => {
    if (!confirmDelete || confirmDeleteBusy) return;
    setConfirmDeleteBusy(true);
    try {
      if (confirmDelete.kind === 'track') {
        await removeLockerEntry(confirmDelete.entry.id, {
          userConfirmed: LOCKER_USER_DELETE_CONFIRMED,
        });
        setOpenMenuKey(null);
        await refresh();
        scheduleLockerSearchReindex();
        setToast(t('locker.confirm.trackRemoved'));
      } else {
        const album = confirmDelete.album;
        await removeAlbumFromLocker(album.name, album.artist, {
          userConfirmed: LOCKER_USER_DELETE_CONFIRMED,
        });
        setOpenMenuKey(null);
        if (selectedAlbum?.key === album.key) {
          setSelectedCollectionKey(null);
          setActiveEditionKey(null);
        }
        await refresh();
        scheduleLockerSearchReindex();
        setToast(t('locker.confirm.albumRemoved'));
      }
    } finally {
      setConfirmDeleteBusy(false);
      setConfirmDelete(null);
    }
  };

  const albumEnvelopes = (album: AlbumGroup) =>
    groupTracksByEnvelope(sortLockerTracks(album.tracks)).map((g) =>
      entryToEnvelope(g.primary),
    );

  const playAlbum = (album: AlbumGroup, shuffle?: boolean) => {
    const envs = albumEnvelopes(album);
    if (envs.length === 0) return;
    if (onPlayAlbum) onPlayAlbum(envs, shuffle);
    else onPlay(envs[0]);
  };

  const playAlbumAt = (album: AlbumGroup, index: number) => {
    // Never hard-block hollow rows here — handlePlayEnvelope re-queues acquisition
    // (e.g. Nee Nah / Née Nah missing blob) instead of a dead-end toast.
    const envs = albumEnvelopes(album).slice(index);
    if (envs.length === 0) return;
    if (onPlayAlbum) onPlayAlbum(envs, false);
    else onPlay(envs[0]);
  };

  const openCreditsForAlbum = (album: AlbumGroup) => {
    setOpenMenuKey(null);
    setCreditsTarget(album);
  };

  const openCreditsForTrack = (entry: LockerEntry) => {
    const album = allEditionGroups.find(
      (a) =>
        a.name === entry.albumName &&
        (a.artist ?? 'Local Upload').trim().toLowerCase() ===
          (entry.artist ?? 'Local Upload').trim().toLowerCase(),
    );
    if (album) {
      openCreditsForAlbum(album);
      return;
    }
    setOpenMenuKey(null);
    setCreditsTarget({
      key: `track-only:${entry.id}`,
      name: entry.albumName ?? entry.title,
      displayName: formatAlbumDisplayName(entry.albumName ?? entry.title),
      artist: entry.artist,
      tracks: [entry],
    });
  };

  const openArtistHubCredits = () => {
    const withCredits = artistHubTracks.find(
      (t) =>
        t.creditsJson?.trim() ||
        t.producers?.trim() ||
        t.performers?.trim() ||
        t.composer?.trim(),
    );
    if (withCredits) {
      openCreditsForTrack(withCredits);
      return;
    }
    const firstAlbum = artistHubAlbumCollections[0] ?? artistHubSingleCollections[0];
    if (!firstAlbum) return;
    const edition = preferredEdition(firstAlbum);
    openCreditsForAlbum(editionToAlbumGroup(firstAlbum, edition));
  };

  const trackClassicalSubtitle = (track: LockerEntry, genre: string): string | null => {
    const classical = isClassicalGenre(genre);
    const composer = formatCreditLine(track.composer);
    const soloists = formatCreditLine(track.trackSoloists);
    if (!classical && !composer && !soloists) return null;
    const parts: string[] = [];
    if (composer) parts.push(`Composer: ${composer}`);
    if (classical && soloists) parts.push(`Soloist: ${soloists}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  };

  const toggleAlbumSync = (album: AlbumGroup) => {
    const synced = Boolean(syncAlbumFlags[album.key]);
    const next = saveSyncAlbumFlag(album.key, !synced);
    setSyncAlbumFlags(next);
    setToast(
      synced ? 'Album removed from cross-device sync' : 'Album included in cross-device sync',
    );
  };

  const identifyAlbumFromCatalog = async (
    album: AlbumGroup,
  ): Promise<'updated' | 'already' | 'manual'> => {
    catalogIdentifyAttempted.current.delete(album.key);
    const needsFix = lockerAlbumArtistNeedsIdentification(album.tracks);
    setToast(t('locker.menu.identifying'));
    try {
      const outcome = await identifyAndRepairAlbumGroup(
        album.name,
        album.artist,
        album.tracks,
        { allowNetwork: true },
      );
      if (outcome.artist) {
        setCatalogIdentifiedArtists((prev) => ({ ...prev, [album.key]: outcome.artist! }));
      }
      await refresh();
      const snap = getLockerEntriesSnapshot() ?? [];
      const tracks = tracksForAlbumGroup(snap, album.name, album.artist);
      const artistName = resolveAlbumBannerArtist(
        album.name,
        album.artist,
        tracks,
        outcome.artist,
      );
      if (outcome.updated && artistName) {
        if (outcome.matchType === 'official_album') {
          setToast(t('locker.menu.identifyOfficialMatch', { artist: artistName }));
        } else {
          setToast(t('locker.menu.identifyPartialMatch', { artist: artistName }));
        }
        return 'updated';
      }
      if (!needsFix && artistName) {
        setToast(t('locker.menu.identifyAlreadyCorrect', { artist: artistName }));
        return 'already';
      }
      setToast(t('locker.menu.identifyManual'));
      return 'manual';
    } catch {
      setToast(t('locker.menu.identifyManual'));
      return 'manual';
    }
  };

  const refreshEditTargetAlbum = (album: AlbumGroup) => {
    const snap = getLockerEntriesSnapshot() ?? [];
    const trackIds = new Set(album.tracks.map((t) => t.id));
    const tracks =
      trackIds.size > 0
        ? snap.filter((e) => trackIds.has(e.id))
        : tracksForAlbumGroup(snap, album.name, album.artist);
    const artist =
      resolveAlbumBannerArtist(album.name, album.artist, tracks) || album.artist;
    setEditTarget({ mode: 'album', album: { ...album, tracks, artist } });
  };

  const fixTrackFromOnlineLibrary = async (entry: LockerEntry) => {
    setOpenMenuKey(null);
    setToast(t('locker.menu.fixingSongInfo'));
    try {
      const ok = await fixLockerTrackFromOnlineLibrary(entry);
      await refresh();
      scheduleLockerSearchReindex();
      setToast(
        ok ? t('locker.menu.fixSongInfoDone') : t('locker.menu.fixSongInfoNone'),
      );
    } catch {
      setToast(t('locker.menu.fixSongInfoFailed'));
    }
  };

  const fixArtistSongInfo = async (tracks: LockerEntry[]) => {
    setOpenMenuKey(null);
    if (tracks.length === 0) {
      setToast(t('locker.menu.fixSongInfoNone'));
      return;
    }
    if (isAirGapEnabled()) {
      setToast(t('locker.deviceScanMetadataAirGap'));
      return;
    }
    setToast(t('locker.menu.fixingArtistSongInfo'));
    try {
      const result = await runLibraryMetadataAutoRepair(tracks.map((track) => track.id));
      await refresh();
      scheduleLockerSearchReindex();
      const totalFixed =
        result.knownStubFixed +
        result.catalogStubFixed +
        result.junkCleared +
        result.unsafeUndone +
        result.enriched;
      setToast(
        totalFixed > 0
          ? t('locker.menu.fixArtistSongInfoDone', { count: totalFixed })
          : t('locker.menu.fixSongInfoNone'),
      );
    } catch {
      setToast(t('locker.menu.fixSongInfoFailed'));
    }
  };

  const buildArtistMenu = (tracks: LockerEntry[]): LockerMenuAction[] => [
    {
      id: 'fix-song-info',
      label: t('locker.menu.fixSongInfo'),
      onClick: () => void fixArtistSongInfo(tracks),
    },
  ];

  const buildAlbumMenu = (album: AlbumGroup, collectionKey?: string): LockerMenuAction[] => {
    const envs = albumEnvelopes(album);
    const pinKey = collectionKey ?? album.key;
    const pinned = isLockerPinned(pinKey);
    const synced = Boolean(syncAlbumFlags[album.key]);
    const showSyncOption =
      lockerSyncSettings.enabled && lockerSyncSettings.provider !== 'none';
    const orphanEntry =
      album.tracks.length === 1 && isOrphanLockerTrack(album.tracks[0])
        ? album.tracks[0]
        : null;

    const matchCatalogAction: LockerMenuAction = {
      id: 'match-catalog',
      label: t('locker.menu.fixAllSongInfoAlbum'),
      onClick: () => {
        void identifyAlbumFromCatalog(album).then((result) => {
          if (result === 'manual') {
            setEditTarget({ mode: 'album', album, focusField: 'albumArtist' });
          }
        });
      },
    };

    const updateArtworkAction: LockerMenuAction = {
      id: 'update-artwork',
      label: t('locker.menu.updateArtwork'),
      onClick: () => void refreshAlbumCover(album),
    };

    const playActions: LockerMenuAction[] = [
      {
        id: 'play',
        section: isNarrowMenu ? undefined : t('locker.menu.sectionPlay'),
        label: t('locker.menu.playAlbum'),
        onClick: () => onPlayAlbum?.(envs, false) ?? onPlay(envs[0]),
      },
      {
        id: 'shuffle',
        section: isNarrowMenu ? undefined : t('locker.menu.sectionPlay'),
        label: t('locker.menu.shuffleAlbum'),
        onClick: () => onPlayAlbum?.(envs, true) ?? onPlay(envs[0]),
      },
    ];

    if (isNarrowMenu) {
      const actions: LockerMenuAction[] = [
        ...playActions,
        ...buildCatalogNavActions(album.artist, album.displayName),
        matchCatalogAction,
        updateArtworkAction,
        {
          id: 'change-cover',
          label: t('locker.menu.changeCover'),
          onClick: () => openCoverArtPicker(album),
        },
        {
          id: 'edit-details',
          label: t('locker.menu.editDetails'),
          onClick: () => setEditTarget({ mode: 'album', album }),
        },
        {
          id: 'queue',
          label: t('locker.menu.addToQueue'),
          onClick: () => {
            onAddToQueue?.(envs);
            setToast(t('locker.menu.addedToQueue'));
          },
        },
        {
          id: 'playlist',
          label: t('locker.menu.addToPlaylist'),
          onClick: () => setPlaylistTracks(envs),
        },
        {
          id: 'credits',
          label: t('locker.menu.viewCredits'),
          onClick: () => openCreditsForAlbum(album),
        },
        {
          id: 'pin',
          label: pinned ? t('locker.menu.unpin') : t('locker.menu.pin'),
          onClick: () => {
            const ok = toggleLockerPin({
              key: pinKey,
              title: album.displayName,
              artist: album.artist,
              kind: 'album',
            });
            if (!ok && !isLockerPinned(pinKey)) setToast(t('locker.pinsFull'));
          },
        },
      ];
      if (showSyncOption) {
        actions.push({
          id: 'sync',
          label: synced ? t('locker.menu.syncAlbumActive') : t('locker.menu.syncAlbum'),
          onClick: () => toggleAlbumSync(album),
        });
      }
      actions.push(
        {
          id: 'share',
          label: t('locker.menu.share'),
          onClick: () => {
            void copyShareText(
              `${album.displayName} — ${album.artist}\n${album.tracks.length} tracks in Sandbox Locker`,
            );
            setToast(t('locker.menu.linkCopied'));
          },
        },
        {
          id: 'delete',
          label: orphanEntry ? t('locker.menu.deleteTrack') : t('locker.menu.deleteAlbum'),
          divider: true,
          danger: true,
          deferSheetClose: true,
          onClick: () =>
            orphanEntry ? promptDeleteTrack(orphanEntry) : promptDeleteAlbum(album),
        },
      );
      return actions;
    }

    const actions: LockerMenuAction[] = [
      ...playActions,
      matchCatalogAction,
      updateArtworkAction,
      {
        id: 'queue',
        section: t('locker.menu.sectionLibrary'),
        label: t('locker.menu.addToQueue'),
        onClick: () => {
          onAddToQueue?.(envs);
          setToast(t('locker.menu.addedToQueue'));
        },
      },
      {
        id: 'playlist',
        section: t('locker.menu.sectionLibrary'),
        label: t('locker.menu.addToPlaylist'),
        onClick: () => setPlaylistTracks(envs),
      },
      {
        id: 'credits',
        section: t('locker.menu.sectionLibrary'),
        label: t('locker.menu.viewCredits'),
        onClick: () => openCreditsForAlbum(album),
      },
      {
        id: 'pin',
        section: t('locker.menu.sectionLibrary'),
        label: pinned ? t('locker.menu.unpin') : t('locker.menu.pin'),
        onClick: () => {
          const ok = toggleLockerPin({
            key: pinKey,
            title: album.displayName,
            artist: album.artist,
            kind: 'album',
          });
          if (!ok && !isLockerPinned(pinKey)) setToast(t('locker.pinsFull'));
        },
      },
      ...buildCatalogNavActions(
        album.artist,
        album.displayName,
        t('locker.menu.sectionLibrary'),
      ),
      {
        id: 'edit',
        section: t('locker.menu.sectionEdit'),
        label: t('locker.menu.editAlbum'),
        onClick: () => setEditTarget({ mode: 'album', album }),
      },
      {
        id: 'share',
        label: t('locker.menu.share'),
        onClick: () => {
          void copyShareText(
            `${album.displayName} — ${album.artist}\n${album.tracks.length} tracks in Sandbox Locker`,
          );
          setToast(t('locker.menu.linkCopied'));
        },
      },
      {
        id: 'delete',
        section: t('locker.menu.sectionDanger'),
        label: orphanEntry ? t('locker.menu.deleteTrack') : t('locker.menu.deleteAlbum'),
        divider: true,
        danger: true,
        deferSheetClose: true,
        onClick: () =>
          orphanEntry ? promptDeleteTrack(orphanEntry) : promptDeleteAlbum(album),
      },
    ];
    if (showSyncOption) {
      actions.splice(5, 0, {
        id: 'sync',
        section: t('locker.menu.sectionLibrary'),
        label: synced ? t('locker.menu.syncAlbumActive') : t('locker.menu.syncAlbum'),
        onClick: () => toggleAlbumSync(album),
      });
    }
    return actions;
  };

  const buildTrackMenu = (entry: LockerEntry): LockerMenuAction[] => {
    const env = entryToEnvelope(entry);
    const stemActions: LockerMenuAction[] = onAnalyzeStems
      ? [
          {
            id: 'analyze-stems',
            section: isNarrowMenu ? undefined : t('stems.title'),
            label: t('stems.analyze'),
            onClick: () => onAnalyzeStems(entry.id),
          },
        ]
      : [];
    const djActions: LockerMenuAction[] = onSendToDj
      ? [
          {
            id: 'send-dj-a',
            section: isNarrowMenu ? undefined : t('locker.menu.sectionDj'),
            label: t('locker.menu.loadInDjDeckA'),
            onClick: () => onSendToDj('A', entry.id),
          },
          {
            id: 'send-dj-b',
            section: isNarrowMenu ? undefined : t('locker.menu.sectionDj'),
            label: t('locker.menu.loadInDjDeckB'),
            onClick: () => onSendToDj('B', entry.id),
          },
        ]
      : [];
    const fixInfoSection = isNarrowMenu ? undefined : t('locker.menu.sectionFixInfo');
    const fixSongInfoAction: LockerMenuAction = {
      id: 'fix-song-info',
      section: fixInfoSection,
      label: t('locker.menu.fixSongInfo'),
      onClick: () => void fixTrackFromOnlineLibrary(entry),
    };
    const librarySection = isNarrowMenu ? undefined : t('locker.menu.sectionLibrary');
    const deleteAction: LockerMenuAction = {
      id: 'delete',
      section: isNarrowMenu ? undefined : t('locker.menu.sectionDanger'),
      label: t('locker.menu.deleteTrack'),
      divider: true,
      danger: true,
      deferSheetClose: true,
      onClick: () => promptDeleteTrack(entry),
    };
    const playAction: LockerMenuAction = {
      id: 'play',
      section: isNarrowMenu ? undefined : t('locker.menu.sectionPlay'),
      label: t('locker.menu.playTrack'),
      onClick: () => onPlay(env),
    };
    const tailActions: LockerMenuAction[] = [
      {
        id: 'edit',
        section: isNarrowMenu ? undefined : t('locker.menu.sectionEdit'),
        label: t('locker.menu.editTrack'),
        onClick: () => setEditTarget({ mode: 'track', entry }),
      },
      {
        id: 'credits',
        section: librarySection,
        label: t('locker.menu.viewCredits'),
        onClick: () => openCreditsForTrack(entry),
      },
      {
        id: 'share',
        section: isNarrowMenu ? undefined : t('locker.menu.sectionShare'),
        label: t('locker.menu.share'),
        onClick: () => {
          void copyShareText(`${entry.title} — ${entry.artist}`);
          setToast(t('locker.menu.trackLinkCopied'));
        },
      },
    ];
    const midActions: LockerMenuAction[] = [
      ...buildCatalogNavActions(entry.artist, entry.albumName, librarySection),
      {
        id: 'queue',
        section: librarySection,
        label: t('locker.menu.addToQueue'),
        onClick: () => {
          onAddToQueue?.([env]);
          setToast(t('locker.menu.trackAddedToQueue'));
        },
      },
      {
        id: 'playlist',
        section: librarySection,
        label: t('locker.menu.addToPlaylist'),
        onClick: () => setPlaylistTracks([env]),
      },
    ];
    const mobileSheet = isMobileShell || isNarrowMenu;
    if (mobileSheet) {
      return [
        playAction,
        fixSongInfoAction,
        ...stemActions,
        ...djActions,
        ...midActions,
        ...tailActions,
        deleteAction,
      ];
    }
    return [
      playAction,
      fixSongInfoAction,
      ...stemActions,
      ...djActions,
      ...midActions,
      ...tailActions,
      deleteAction,
    ];
  };

  const albumLongPressRef = useRef<Map<string, number>>(new Map());

  const bindAlbumLongPress = (
    album: AlbumGroup,
    collectionTitle: string,
    collectionArtist: string,
    collectionKey: string,
  ) => ({
    onTouchStart: () => {
      if (!isMobileShell && !isNarrowMenu) return;
      const existing = albumLongPressRef.current.get(album.key);
      if (existing) window.clearTimeout(existing);
      const timer = window.setTimeout(() => {
        openActionSheet({
          title: collectionTitle,
          subtitle: collectionArtist,
          actions: buildAlbumMenu(album, collectionKey),
          ariaLabel: `Options for ${collectionTitle}`,
        });
      }, 480);
      albumLongPressRef.current.set(album.key, timer);
    },
    onTouchEnd: () => {
      const timer = albumLongPressRef.current.get(album.key);
      if (timer) window.clearTimeout(timer);
      albumLongPressRef.current.delete(album.key);
    },
    onTouchMove: () => {
      const timer = albumLongPressRef.current.get(album.key);
      if (timer) window.clearTimeout(timer);
      albumLongPressRef.current.delete(album.key);
    },
  });

  const saveEditInfo = async (values: EditLockerInfoValues) => {
    if (!editTarget) return;
    if (editTarget.mode === 'track') {
      await updateLockerEntryMetadata(
        editTarget.entry.id,
        {
          title: values.title,
          artist: values.artist,
          albumName: values.albumName,
          composer: values.composer,
          genre: values.genre,
        },
        { userEdit: true },
      );
    } else {
      const { album } = editTarget;
      const nextGenre = values.genre?.trim();
      const oldKey = album.key;
      await updateAlbumGroupMetadata(
        album.name,
        album.artist,
        {
          albumName: values.albumName,
          artist: values.artist,
          albumArtist: values.albumArtist,
          composer: values.composer,
          releaseYear: values.releaseYear,
          discCount: values.discCount,
          ...(nextGenre ? { genre: nextGenre } : {}),
        },
        { userEdit: true },
      );
      const newName = (values.albumName?.trim() || album.name).trim();
      const newArtist = (values.artist?.trim() || album.artist).trim() || 'Local Upload';
      const newKey = `${newName}::${newArtist}`;
      if (newKey !== oldKey) {
        brokenAlbumArt.current.delete(oldKey);
        brokenAlbumArt.current.delete(newKey);
        transferKnownGoodAlbumArt(oldKey, newKey);
        onlineCoverAttempted.current.delete(oldKey);
        onlineCoverAttempted.current.delete(newKey);
      }
    }
    await refresh();
    scheduleLockerSearchReindex();
    setToast('Saved');
  };

  const openSearchCollection = (collectionKey: string, editionKey?: string) => {
    saveShellScroll(LOCKER_SEARCH_SCROLL_KEY);
    collectionBackScrollKeyRef.current = LOCKER_SEARCH_SCROLL_KEY;
    setSearchOpen(false);
    setViewMode('albums');

    let resolvedCollectionKey = collectionKey;
    if (collectionKey.startsWith('album:') && editionKey) {
      const match = collections.find((c) =>
        c.editions.some((e) => e.key === editionKey),
      );
      if (match) resolvedCollectionKey = match.key;
    } else if (!collections.some((c) => c.key === collectionKey) && editionKey) {
      const match = collections.find((c) =>
        c.editions.some((e) => e.key === editionKey),
      );
      if (match) resolvedCollectionKey = match.key;
    }

    setSelectedCollectionKey(resolvedCollectionKey);
    setActiveEditionKey(editionKey ?? null);
  };

  const catalogArtistNavigable = (name: string | undefined) => {
    const trimmed = (name ?? '').trim();
    return Boolean(trimmed && !/^local upload$/i.test(trimmed));
  };

  const goToCatalogArtist = useCallback(
    (name: string) => {
      if (!catalogArtistNavigable(name) || !onSelectArtist) return;
      onSelectArtist(name.trim());
    },
    [onSelectArtist],
  );

  const goToCatalogAlbum = useCallback(
    (artist: string, albumTitle: string) => {
      if (!catalogArtistNavigable(artist) || !onGoToAlbum) return;
      const album = albumTitle.trim();
      if (!album) return;
      onGoToAlbum(artist.trim(), album);
    },
    [onGoToAlbum],
  );

  const buildCatalogNavActions = (
    artist: string,
    albumTitle?: string,
    section?: string,
  ): LockerMenuAction[] => {
    const nav: LockerMenuAction[] = [];
    if (onSelectArtist && catalogArtistNavigable(artist)) {
      nav.push({
        id: 'artist',
        section,
        label: t('locker.menu.goToArtist'),
        onClick: () => goToCatalogArtist(artist),
      });
    }
    if (onGoToAlbum && albumTitle?.trim() && catalogArtistNavigable(artist)) {
      nav.push({
        id: 'album',
        section,
        label: t('locker.menu.goToAlbum'),
        onClick: () => goToCatalogAlbum(artist, albumTitle),
      });
    }
    return nav;
  };

  const formatArtistLine = (artist: string | undefined, year?: string, albumTitle?: string) => {
    const a = (artist ?? '').trim();
    const showYear = year && !albumTitle?.includes(year);
    if (!a || /^local upload$/i.test(a)) {
      return showYear ? String(year) : '';
    }
    return showYear ? `${a} · ${year}` : a;
  };

  return (
    <div
      className={`${embedded ? 'locker-embedded' : 'locker-page'}${
        showArtistHub ? ' locker-embedded--artist-profile' : ''
      }${showAlbumAmbientWash ? ' locker-album-detail-open' : ''}`}
    >
      {lockerAlbumWashPortal}
      <input
        ref={coverFileRef}
        type="file"
        accept={COVER_ACCEPT}
        className="locker-cover-file-input"
        aria-label="Upload album cover art"
        onChange={(e) => {
          const file = e.target.files?.[0];
          void handleCoverArtFile(file);
          e.target.value = '';
        }}
      />
      {!embedded && (
        <header>
          <div className="locker-toolbar">
            <div>
              <h1 className="font-display text-[1.75rem] font-bold tracking-tight leading-none text-[var(--text)]">
                Locker
              </h1>
              <p className="locker-header-subtitle">
                {visibleTracks.length} tracks · {collectionStats.albumCollectionCount} collections
                {collectionStats.duplicateAlbumGroups > 0
                  ? ` · ${collectionStats.duplicateAlbumGroups} multi-edition`
                  : ''}
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {!isMobileShell ? (
                <button
                  type="button"
                  onClick={() => (searchOpen ? closeLockerSearch() : openLockerSearch())}
                  className={`h-9 px-4 rounded border text-sm font-semibold touch-manipulation flex items-center gap-2 ${
                    searchOpen
                      ? 'border-[var(--orange)] text-accent bg-accent-soft'
                      : 'border-[var(--border)] text-[var(--text-mid)] hover:border-[var(--orange)] hover:text-accent'
                  }`}
                  aria-expanded={searchOpen}
                >
                  <Search className="w-4 h-4" />
                  Search
                </button>
              ) : null}
              <label className="locker-sort">
                Sort
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'title' | 'priority')}
                  className="focus-accent"
                >
                  <option value="title">Title</option>
                  <option value="priority">Priority</option>
                </select>
              </label>
              <button
                type="button"
                onClick={() => setRepairOpen(true)}
                className="h-9 px-4 rounded border text-sm font-semibold touch-manipulation flex items-center gap-2 border-[var(--border)] text-[var(--text-mid)] hover:border-[var(--orange)] hover:text-accent"
                title="Repair library metadata"
              >
                <Wrench className="w-4 h-4" />
                Repair
              </button>
              <button
                type="button"
                onClick={() => setUploadOpen(true)}
                className="h-9 px-5 rounded btn-accent text-sm font-semibold touch-manipulation"
              >
                Upload
              </button>
            </div>
          </div>

          <nav className="locker-tabs" aria-label="Library view">
            {(['albums', 'tracks'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => {
                  setViewMode(m);
                  setSelectedCollectionKey(null);
                  setActiveEditionKey(null);
                }}
                className={`locker-tab touch-manipulation ${viewMode === m ? 'locker-tab-active' : ''}`}
              >
                {m === 'albums' ? 'Albums' : 'Songs'}
              </button>
            ))}
          </nav>
        </header>
      )}

      {embedded && !showArtistHub && !(showArtistBrowse && isMobileShell) && (
        <div className="locker-embedded-bar locker-embedded-bar--controls">
          <span className="locker-embedded-bar-spacer" aria-hidden />
          <div className="locker-embedded-controls">
            {(!isMobileShell || lockerTab === 'singles') ? (
            <nav className="locker-tabs locker-tabs--compact" aria-label={t('locker.viewModeAria')}>
              {(['albums', 'tracks'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setViewMode(m);
                    saveLockerViewPrefs({ viewMode: m });
                    setSelectedCollectionKey(null);
                    setActiveEditionKey(null);
                  }}
                  className={`locker-tab touch-manipulation ${viewMode === m ? 'locker-tab-active' : ''}`}
                >
                  {m === 'albums' ? t('locker.viewAlbums') : t('locker.viewTracks')}
                </button>
              ))}
            </nav>
            ) : null}
            <label className="locker-sort">
              {t('locker.sortLabel')}
              <select
                value={sortBy}
                onChange={(e) => {
                  const next = e.target.value as LockerSortBy;
                  setSortBy(next);
                  saveLockerViewPrefs({ sortBy: next });
                }}
                className="focus-accent"
              >
                <option value="title">{t('locker.sortTitle')}</option>
                <option value="artist">{t('locker.sortArtist')}</option>
                <option value="added">{t('locker.sortAdded')}</option>
                <option value="priority">{t('locker.sortPriority')}</option>
              </select>
            </label>
            <div className="locker-layout-toggle" role="group" aria-label={t('locker.layoutAria')}>
              <button
                type="button"
                className={`locker-layout-btn touch-manipulation${layoutMode === 'grid' ? ' locker-layout-btn--active' : ''}`}
                onClick={() => {
                  setLayoutMode('grid');
                  saveLockerViewPrefs({ layoutMode: 'grid' });
                }}
                aria-pressed={layoutMode === 'grid'}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
              <button
                type="button"
                className={`locker-layout-btn touch-manipulation${layoutMode === 'list' ? ' locker-layout-btn--active' : ''}`}
                onClick={() => {
                  setLayoutMode('list');
                  saveLockerViewPrefs({ layoutMode: 'list' });
                }}
                aria-pressed={layoutMode === 'list'}
              >
                <List className="w-4 h-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => setUploadOpen(true)}
              className="h-8 px-4 rounded btn-accent text-xs font-semibold touch-manipulation"
            >
              {t('locker.upload')}
            </button>
          </div>
        </div>
      )}

      {searchOpen ? (
        <LockerSearchView
          onPlay={onPlay}
          onPlayAlbum={onPlayAlbum}
          onSelectArtist={(name) => {
            setSearchOpen(false);
            selectArtistFilter(name, undefined, { saveScroll: false });
          }}
          onOpenCollection={openSearchCollection}
          onClose={closeLockerSearch}
        />
      ) : null}

      {!embedded && (
        <div className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]/60 overflow-hidden font-mono text-xs">
          <button
            type="button"
            className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-[var(--bg-hover)] touch-manipulation"
            onClick={() => setStatsOpen((o) => !o)}
            aria-expanded={statsOpen}
          >
            <span className="text-[var(--text-mid)] uppercase tracking-wide">
              Collection intelligence
            </span>
            <span className="text-accent tabular-nums">
              {collectionStats.storageSavedLabel} saved
            </span>
          </button>
          {statsOpen ? (
            <div className="px-3 pb-3 pt-1 grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1 text-[var(--text-dim)] border-t border-[var(--border)]">
              <span>Release groups: {collectionStats.releaseGroupCount}</span>
              <span>Editions: {collectionStats.editionCount}</span>
              <span>Collections: {collectionStats.albumCollectionCount}</span>
              <span>Duplicate albums: {collectionStats.duplicateAlbumGroups}</span>
              <span>Duplicate tracks: {collectionStats.duplicateTrackCopies}</span>
              <span>Hash dupes: {collectionStats.hashDuplicateGroups}</span>
              <span className="col-span-2 sm:col-span-3 text-accent">
                Storage saved (est.): {formatStorageSaved(collectionStats.storageSavedBytes)}
              </span>
            </div>
          ) : null}
        </div>
      )}

      {toast && (
        <p className="mb-3 text-sm text-accent px-3 py-2 rounded-md bg-accent-soft border border-accent/20">
          {toast}
        </p>
      )}

      {showArtistHub ? (
        <LockerArtistHub
          artistName={artistFilter!}
          tracks={artistHubTracks}
          albumCollections={artistHubAlbumCollections}
          appearsOnCollections={artistHubAppearsOnCollections}
          singleCollections={artistHubSingleCollections}
          initialArtworkUrl={artistHeroArtwork}
          activeEnvelopeId={activeEnvelopeId ?? undefined}
          onBack={clearArtistFilter}
          onPlayAll={
            onPlayAlbum && artistHubTracks.length > 0
              ? () => onPlayAlbum(artistHubTracks.map((e) => entryToEnvelope(e)), false)
              : undefined
          }
          onShuffle={
            onPlayAlbum && artistHubTracks.length > 0
              ? () => onPlayAlbum(artistHubTracks.map((e) => entryToEnvelope(e)), true)
              : undefined
          }
          onPlayTrack={(env) => onPlay(env)}
          onPlayTracks={(envs, shuffle) => {
            if (onPlayAlbum) onPlayAlbum(envs, shuffle);
            else if (envs[0]) onPlay(envs[0]);
          }}
          onOpenCollection={(collection) => {
            openCollectionDetail(collection.key);
          }}
          onPlayCollection={(album) => playAlbum(album, false)}
          albumArtSrc={albumArtSrc}
          trackArtSrc={trackArtSrc}
          onAlbumArtError={handleAlbumArtError}
          formatArtistLine={formatArtistLine}
          preferredEdition={preferredEdition}
          onOpenCredits={openArtistHubCredits}
          openMenuKey={openMenuKey}
          onOpenMenuKeyChange={setOpenMenuKey}
          buildTrackMenu={buildTrackMenu}
          overflowMenu={
            artistHubTracks.length > 0 ? (
              <LockerRowActions
                menuKey={`artist-hub:${artistFilter}`}
                openMenuKey={openMenuKey}
                onOpenMenuKeyChange={setOpenMenuKey}
                actions={buildArtistMenu(artistHubTracks)}
                ariaLabel={t('locker.artistHubMenuAria')}
                sheetTitle={artistFilter!}
                alwaysVisible
                portaled
                panelClassName="locker-artist-menu-panel"
              />
            ) : undefined
          }
        />
      ) : null}

      {showGeneralEmpty ? (
        <div className="py-16 text-center border border-dashed border-[var(--border)] rounded-xl">
          <p className="text-[var(--text-mid)]">Nothing here yet. Tap Upload to add music.</p>
        </div>
      ) : null}

      {lockerTab !== 'videos' && viewMode === 'albums' && selectedAlbum && selectedAlbumMeta && (
        <div
          className={`locker-album-detail mb-6${
            selectedCoverArt ? ' locker-album-detail--has-art' : ''
          }`}
          style={selectedAlbumBannerStyle}
        >
          <button
            type="button"
            onClick={closeCollectionDetail}
            className="locker-album-back touch-manipulation"
          >
            <ArrowLeft className="w-4 h-4" />
            {artistFilter ? artistFilter : 'All albums'}
          </button>
          <section
            className={`locker-album-banner${selectedCoverArt ? ' locker-album-banner--has-art' : ''}`}
            aria-label={`${selectedAlbum.displayName} album`}
          >
            <div className="locker-album-banner-menu">
              <LockerRowActions
                menuKey={`album-detail:${selectedAlbum.key}`}
                openMenuKey={openMenuKey}
                onOpenMenuKeyChange={setOpenMenuKey}
                actions={buildAlbumMenu(selectedAlbum, selectedCollection?.key)}
                ariaLabel="Album options"
                sheetTitle={selectedAlbum.displayName}
                sheetSubtitle={selectedAlbumMeta?.artistName ?? selectedAlbum.artist}
                alwaysVisible
                portaled
                panelClassName="locker-album-menu-panel"
                maxHeightCapPx={isNarrowMenu ? 700 : 448}
              />
            </div>
            <div className="locker-album-banner-content">
              <div className="locker-album-banner-cover">
                <LockerAlbumBannerCover
                  album={selectedAlbum}
                  artSrc={selectedCoverArt}
                  entryId={selectedAlbumEntryId}
                  onArtError={(failedSrc) => handleAlbumArtError(selectedAlbum, failedSrc)}
                />
              </div>
              <div className="locker-album-banner-info">
                <h2 className="locker-album-banner-title">{selectedAlbum.displayName}</h2>
                {selectedAlbumMeta.artistName ? (
                  !/^local upload$/i.test(selectedAlbumMeta.artistName.trim()) ? (
                    <button
                      type="button"
                      className="locker-album-banner-artist locker-album-banner-artist--clickable touch-manipulation"
                      onClick={() => {
                        if (embedded) {
                          selectArtistFilter(selectedAlbumMeta.artistName, undefined, {
                            saveScroll: false,
                          });
                          setSelectedCollectionKey(null);
                          setActiveEditionKey(null);
                        } else {
                          onSelectArtist?.(selectedAlbumMeta.artistName);
                        }
                      }}
                      aria-label={`View artist ${selectedAlbumMeta.artistName}`}
                    >
                      <span className="locker-album-banner-artist-avatar">
                        <LockerAlbumBannerArtistAvatar
                          artistName={selectedAlbumMeta.artistName}
                          vaultEntries={vaultEntries}
                          lockerFallback={selectedCoverArt}
                        />
                      </span>
                      <span>
                        {selectedAlbumArtistCredits.length > 0
                          ? selectedAlbumMeta.artistName
                          : selectedAlbumFeaturingLine || selectedAlbumMeta.artistName}
                      </span>
                    </button>
                  ) : (
                    <p className="locker-album-banner-artist">
                      <span className="locker-album-banner-artist-avatar">
                        <LockerAlbumBannerArtistAvatar
                          artistName={selectedAlbumMeta.artistName}
                          vaultEntries={vaultEntries}
                          lockerFallback={selectedCoverArt}
                        />
                      </span>
                      <span>
                        {selectedAlbumArtistCredits.length > 0
                          ? selectedAlbumMeta.artistName
                          : selectedAlbumFeaturingLine || selectedAlbumMeta.artistName}
                      </span>
                    </p>
                  )
                ) : null}
                <p className="locker-album-banner-stats">
                  {selectedAlbumMeta.trackCount}{' '}
                  {selectedAlbumMeta.trackCount === 1 ? 'TRACK' : 'TRACKS'}
                  {selectedAlbumMeta.totalSeconds > 0
                    ? ` (${formatAlbumDuration(selectedAlbumMeta.totalSeconds)})`
                    : ''}
                </p>
                {selectedAlbumMeta.releaseDate ? (
                  <p className="locker-album-banner-release">{selectedAlbumMeta.releaseDate}</p>
                ) : null}
                {selectedCollection && selectedCollection.editionCount > 1 ? (
                  <div className="locker-edition-picker" role="group" aria-label="Album edition">
                    {selectedCollection.editions.map((edition) => {
                      const active =
                        (activeEditionKey ?? preferredEdition(selectedCollection).key) ===
                        edition.key;
                      return (
                        <button
                          key={edition.key}
                          type="button"
                          className={`locker-edition-pill touch-manipulation ${active ? 'locker-edition-pill--active' : ''}`}
                          onClick={() => {
                            setActiveEditionKey(edition.key);
                            setPreferredEdition(selectedCollection.key, edition.key);
                          }}
                          title={`${edition.label} · ${edition.trackCount} tracks · ${edition.year ?? 'unknown year'} · ${edition.source ?? 'local'}`}
                        >
                          <span className="locker-edition-pill-label">{edition.label}</span>
                          {edition.year ? (
                            <span className="locker-edition-pill-meta">{edition.year}</span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <div className="locker-album-banner-actions">
                  <button
                    type="button"
                    className="artist-btn artist-btn-primary touch-manipulation"
                    onClick={() => playAlbum(selectedAlbum, false)}
                  >
                    <Play className="w-4 h-4 fill-current" />
                    {t('locker.play')}
                  </button>
                  <button
                    type="button"
                    className="artist-btn artist-btn-primary touch-manipulation"
                    onClick={() => playAlbum(selectedAlbum, true)}
                  >
                    <Shuffle className="w-4 h-4" />
                    {t('locker.shuffle')}
                  </button>
                  {offerAlbumCompletion ? (
                    <button
                      type="button"
                      className="artist-btn touch-manipulation border border-amber-500/50 text-amber-200/90"
                      disabled={completeMissingBusy || isLockerAlbumCompletionPending(selectedAlbum.name, selectedAlbum.artist)}
                      onClick={() => void runCompleteMissingTracks()}
                    >
                      {completeMissingBusy ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : null}
                      {t('locker.completeMissing', {
                        count: selectedAlbumMissing.missingCount,
                      })}
                    </button>
                  ) : null}
                  {lockerSyncSettings.enabled && lockerSyncSettings.provider !== 'none' ? (
                    <button
                      type="button"
                      className={`artist-btn touch-manipulation${
                        syncAlbumFlags[selectedAlbum.key]
                          ? ' artist-btn-primary'
                          : ' border border-[var(--border)]'
                      }`}
                      onClick={() => toggleAlbumSync(selectedAlbum)}
                    >
                      {syncAlbumFlags[selectedAlbum.key]
                        ? t('locker.menu.syncAlbumActive')
                        : t('locker.menu.syncAlbum')}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
          {selectedAlbumArtistCredits.length > 0 ? (
            <AlbumArtistCreditsSection
              artistCredits={selectedAlbumArtistCredits}
              guestArtists={selectedAlbumGuestArtists}
              onGoToArtist={handleLockerAlbumArtistNav}
              className="locker-album-artist-credits"
            />
          ) : null}
          <div className="locker-album-tracklist">
            <div className="locker-album-track-table-head" aria-hidden>
              <span className="locker-album-track-index">#</span>
              <span>Title</span>
              <span>Time</span>
              <span className="locker-album-track-col-actions" />
            </div>
            <ul className="locker-album-track-table-body">
              {selectedAlbumGroupedTracks.map((group, index) => {
                const track = group.primary;
                const playing =
                  isNowPlaying(vm, track) ||
                  group.entries.some((e) => isNowPlaying(vm, e));
                const albumGenre =
                  selectedAlbum.tracks.find((t) => t.genre?.trim())?.genre ?? '';
                const creditLine = trackClassicalSubtitle(track, albumGenre);
                const dupCount = group.entries.length;
                const groupHasPlayable = group.entries.some((e) => e.offlineReady === true);
                const bannerArtist =
                  selectedAlbumMeta?.artistName ||
                  catalogIdentifiedArtists[selectedAlbum.key] ||
                  '';
                const trackArtistLine = resolveLockerTrackArtistLine(
                  track,
                  bannerArtist,
                  selectedAlbum.name,
                );
                return (
                  <li
                    key={group.key}
                    className={`locker-album-track-row group ${playing ? 'is-active' : ''}`}
                  >
                    <span className="locker-album-track-index">{index + 1}</span>
                    <button
                      type="button"
                      onClick={() => playAlbumAt(selectedAlbum, index)}
                      className="locker-album-track-main touch-manipulation min-w-0 text-left"
                    >
                      <span className="locker-album-track-titleline">
                        <span
                          className={`track-list-title truncate ${playing ? 'is-active' : ''}`}
                        >
                          {displayLockerTrackTitle(track.title)}
                        </span>
                        {!groupHasPlayable && track.offlineReady === false ? (
                          <span
                            className="local-offline-badge shrink-0"
                            title="Audio missing on device — Settings → Recover blobs"
                          >
                            Missing
                          </span>
                        ) : null}
                      </span>
                      {trackArtistLine ? (
                        <span className="locker-album-track-subartist">
                          {trackArtistLine}
                        </span>
                      ) : null}
                      {creditLine ? (
                        <span className="block truncate text-[11px] text-[var(--text-dim)] mt-0.5">
                          {creditLine}
                        </span>
                      ) : null}
                      {dupCount > 1 ? (
                        <span className="block truncate text-[10px] text-accent/80 mt-0.5 font-mono uppercase">
                          {dupCount} copies merged
                        </span>
                      ) : null}
                    </button>
                    <span className="locker-album-track-duration">
                      {formatTime(track.durationSeconds || 0)}
                    </span>
                    <span
                      className={`locker-album-track-actions ${
                        isMobile ? 'locker-album-track-actions--visible' : ''
                      }`}
                    >
                      <TrackRowSources
                        envelopeId={track.id}
                        title={track.title}
                        baseEnvelope={entryToEnvelope(track)}
                        onPlay={(env) => onPlay(env)}
                        open={openMenuKey === `sources:${track.id}`}
                        onOpenChange={(o) =>
                          setOpenMenuKey(o ? `sources:${track.id}` : null)
                        }
                        alwaysVisible={isMobile}
                      />
                      {onAnalyzeStems ? (
                        <AnalyzeStemsButton
                          trackId={track.id}
                          title={track.title}
                          onAnalyze={onAnalyzeStems}
                          alwaysVisible={isMobile}
                        />
                      ) : null}
                      {onSendToDj ? (
                        <LoadInDjMenu
                          trackId={track.id}
                          title={track.title}
                          onLoad={onSendToDj}
                          open={openMenuKey === `dj:${track.id}`}
                          onOpenChange={(o) =>
                            setOpenMenuKey(o ? `dj:${track.id}` : null)
                          }
                          alwaysVisible={isMobile}
                        />
                      ) : null}
                      <button
                        type="button"
                        className="search-results-action search-results-action--play touch-manipulation"
                        aria-label={`Play ${track.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          playAlbumAt(selectedAlbum, index);
                        }}
                      >
                        <Play className="w-4 h-4 ml-0.5" />
                      </button>
                      <LockerRowActions
                        menuKey={`track:${track.id}`}
                        openMenuKey={openMenuKey}
                        onOpenMenuKeyChange={setOpenMenuKey}
                        actions={buildTrackMenu(track)}
                        ariaLabel={`Options for ${displayLockerTrackTitle(track.title)}`}
                        sheetTitle={displayLockerTrackTitle(track.title)}
                        sheetSubtitle={trackArtistLine || track.artist}
                        portaled
                        alwaysVisible={isMobile}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {lockerTab === 'videos' && !selectedAlbum && (
        <div className="locker-album-grid">
          {videoEntries.length === 0 ? (
            <div className="collection-placeholder col-span-full">
              <p className="font-display text-lg font-bold text-[var(--text)]">No videos yet</p>
              <p className="text-sm text-[var(--text-mid)] mt-2 max-w-md">
                Upload video files to your locker and they will appear here.
              </p>
            </div>
          ) : (
            videoEntries.map((entry) => {
              const active =
                activeEnvelopeId === entry.id || isNowPlaying(vm, entry);
              const art = entry.albumArt;
              return (
                <article
                  key={entry.id}
                  className="locker-album-card group relative cursor-pointer touch-manipulation"
                  onClick={() => onPlay(entryToEnvelope(entry))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onPlay(entryToEnvelope(entry));
                    }
                  }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="locker-album-art">
                    {art ? (
                      <img src={art} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="locker-album-art-placeholder"
                        style={{ background: seedGradient(entry.title) }}
                      />
                    )}
                    <span className="locker-edition-badge font-mono">Video</span>
                  </div>
                  <div className="locker-album-meta">
                    <p className="locker-album-title">{entry.title}</p>
                    <p className="locker-album-artist">{entry.artist || '\u00A0'}</p>
                    <p className="locker-album-sub font-mono">
                      {formatTime(entry.durationSeconds || 0)}
                      {active ? ' · playing' : ''}
                    </p>
                  </div>
                  <div
                    className={`absolute top-1.5 right-1.5 z-20 transition-opacity ${
                      isMobile
                        ? 'opacity-100'
                        : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    role="presentation"
                  >
                    <LockerRowActions
                      menuKey={`track:${entry.id}`}
                      openMenuKey={openMenuKey}
                      onOpenMenuKeyChange={setOpenMenuKey}
                      actions={buildTrackMenu(entry)}
                      ariaLabel={`Options for ${entry.title}`}
                      sheetTitle={entry.title}
                      sheetSubtitle={entry.artist}
                      align="right"
                      portaled
                      alwaysVisible={isMobile}
                    />
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {showLibraryInsights ? (
        <section
          className="locker-library-insights"
          aria-label={`${t('home.recentlyAdded')}, ${t('home.mostPlayed')}, ${t('home.yourListening')}`}
        >
          <button
            type="button"
            className="locker-library-insight-row touch-manipulation"
            onClick={() => {
              if (libraryInsights.recentEntry) {
                onPlay(entryToEnvelope(libraryInsights.recentEntry));
              }
            }}
          >
            <span className="locker-library-insight-label">{t('home.recentlyAdded')}</span>
            {libraryInsights.recentEntry ? (
              <>
                <span className="locker-library-insight-title">{libraryInsights.recentEntry.title}</span>
                <span className="locker-library-insight-meta">
                  {libraryInsights.recentEntry.artist || t('home.uploadTracks')}
                </span>
              </>
            ) : (
              <span className="locker-library-insight-meta">{t('home.uploadTracks')}</span>
            )}
          </button>

          <button
            type="button"
            className="locker-library-insight-row touch-manipulation"
            disabled={!libraryInsights.topHit}
            onClick={() => {
              if (libraryInsights.topHit) {
                onPlay(storedHitToEnvelope(libraryInsights.topHit));
              }
            }}
          >
            <span className="locker-library-insight-label">{t('home.mostPlayed')}</span>
            {libraryInsights.topHit ? (
              <>
                <span className="locker-library-insight-title">{libraryInsights.topHit.title}</span>
                <span className="locker-library-insight-meta">
                  {libraryInsights.topHit.artist}
                  {libraryInsights.topHit.playCount > 0
                    ? ` · ${libraryInsights.topHit.playCount} play${libraryInsights.topHit.playCount === 1 ? '' : 's'}`
                    : ''}
                </span>
              </>
            ) : (
              <span className="locker-library-insight-meta">{t('home.playHistory')}</span>
            )}
          </button>

          <button
            type="button"
            className="locker-library-insight-row touch-manipulation"
            onClick={() => onOpenListening?.()}
          >
            <span className="locker-library-insight-label">{t('home.yourListening')}</span>
            {libraryInsights.sessionCount > 0 ? (
              <>
                <span className="locker-library-insight-title">
                  {t('home.minutesThisMonth', { minutes: libraryInsights.minutesLabel })}
                </span>
                <span className="locker-library-insight-meta">
                  {libraryInsights.topArtist
                    ? t('home.topArtist', { artist: libraryInsights.topArtist })
                    : libraryInsights.sessionCount === 1
                      ? t('home.sessionsLogged', { count: libraryInsights.sessionCount })
                      : t('home.sessionsLoggedPlural', { count: libraryInsights.sessionCount })}
                </span>
              </>
            ) : (
              <span className="locker-library-insight-meta">{t('home.localStats')}</span>
            )}
          </button>
        </section>
      ) : null}

      {(showArtistBrowse || showBrowseFilterArtists) ? (
        <LockerArtistGrid
          artists={filteredArtists}
          vaultEntries={vaultEntries}
          onSelectArtist={selectArtistFilter}
          emptyLabel={t('locker.browseFilters.artistsEmpty')}
        />
      ) : null}

      {showAlbumGrid ? (
        <>
          {gridCollectionSections.map((section) => (
            <React.Fragment key={section.id}>
              {section.label ? (
                <h3 className="locker-artist-hub-section">{section.label}</h3>
              ) : null}
              <div
                className={`locker-album-grid${
                  layoutMode === 'list' ? ' locker-album-grid--list' : ''
                }`}
              >
                {section.collections.length === 0 ? (
                  <div className="collection-placeholder col-span-full">
                    <p className="font-display text-lg font-bold text-[var(--text)]">
                      {lockerTab === 'singles' ? 'No singles yet' : 'No albums yet'}
                    </p>
                    <p className="text-sm text-[var(--text-mid)] mt-2 max-w-md">
                      {lockerTab === 'singles'
                        ? 'Single-track uploads and one-song releases show up here.'
                        : 'Upload album folders or multi-track releases to see them here.'}
                    </p>
                  </div>
                ) : null}
                {section.collections.map((collection) => {
            const edition = preferredEdition(collection);
            const album = editionToAlbumGroup(collection, edition);
            const art = albumArtSrc(album);
            const displayArt = art ? (proxiedArtworkUrl(art) ?? art) : undefined;
            const showArt = Boolean(displayArt);
            const year = edition.year ?? album.tracks.find((t) => t.releaseYear)?.releaseYear;
            const artistLine = formatArtistLine(collection.artist, year, collection.displayName);
            const downloadStatus = collectionDownloadStatus(album.tracks);
            const isExpanded = expandedGridKey === collection.key;
            const openCollection = (editionKey?: string) => {
              setExpandedGridKey(null);
              openCollectionDetail(collection.key, editionKey ?? null);
            };
            const activateGridCard = (editionKey?: string) => {
              if (collection.editionCount > 1 && !isExpanded) {
                setExpandedGridKey(collection.key);
                return;
              }
              if (section.id === 'singles' || lockerTab === 'singles') {
                playAlbum(album, false);
                return;
              }
              openCollection(editionKey);
            };
            const primaryTrack = album.tracks[0];
            const isSingleCard = isLockerSingleCollection(collection);
            const cardUsesTrackMenu = isSingleCard && Boolean(primaryTrack);
            return (
              <article
                key={collection.key}
                className={`locker-album-card group relative cursor-pointer touch-manipulation ${
                  isExpanded ? 'locker-album-card--expanded' : ''
                }`}
                onClick={() => activateGridCard()}
                {...bindAlbumLongPress(album, collection.displayName, collection.artist, collection.key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateGridCard();
                  }
                }}
                role="button"
                tabIndex={0}
                aria-expanded={collection.editionCount > 1 ? isExpanded : undefined}
              >
                <div className="locker-album-art">
                  {showArt ? (
                    <img
                      src={displayArt}
                      alt=""
                      onLoad={() => rememberKnownGoodAlbumArt(album.key, art)}
                      onError={(e) => handleAlbumArtError(album, e.currentTarget.src)}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div
                      className="locker-album-art-placeholder"
                      style={{ background: seedGradient(collection.displayName) }}
                    />
                  )}
                  {collection.editionCount > 1 ? (
                    <span className="locker-edition-badge font-mono">
                      {collection.editionCount} editions
                    </span>
                  ) : null}
                  {isLockerAlbumSynced(album.key, collection.key, syncAlbumFlags) ? (
                    <span className="locker-sync-pill font-mono">{t('locker.syncStatus.synced')}</span>
                  ) : null}
                  {downloadStatus === 'full' ? (
                    <span className="locker-download-pill font-mono">{t('locker.downloaded')}</span>
                  ) : downloadStatus === 'partial' ? (
                    <span className="locker-download-pill locker-download-pill--partial font-mono">
                      {t('locker.partialDownload')}
                    </span>
                  ) : null}
                  {isLockerPinned(collection.key) ? (
                    <span className="locker-pin-pill" aria-label={t('locker.pinned')}>
                      <Pin className="w-3 h-3" />
                    </span>
                  ) : null}
                </div>
                <div className="locker-album-meta">
                  <p className="locker-album-title">{collection.displayName}</p>
                  <p className="locker-album-artist">
                    {artistLine || '\u00A0'}
                  </p>
                  <p className="locker-album-sub font-mono">
                    {edition.trackCount} songs
                    {edition.duplicateTrackCopies > 0
                      ? ` · ${edition.duplicateTrackCopies} dupes`
                      : ''}
                  </p>
                  {isExpanded && collection.editionCount > 1 ? (
                    <div
                      className="locker-edition-picker locker-edition-picker--grid"
                      role="group"
                      aria-label="Album versions"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {collection.editions.map((ed) => (
                        <button
                          key={ed.key}
                          type="button"
                          className="locker-edition-pill touch-manipulation"
                          onClick={() => openCollection(ed.key)}
                          title={`${ed.label} · ${ed.trackCount} tracks · ${ed.year ?? 'unknown year'}`}
                        >
                          <span className="locker-edition-pill-label">{ed.label}</span>
                          {ed.year ? (
                            <span className="locker-edition-pill-meta">{ed.year}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div
                  className={`absolute top-1.5 right-1.5 z-20 transition-opacity ${
                    isMobile
                      ? 'opacity-100'
                      : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
                  }`}
                  onClick={(e) => e.stopPropagation()}
                  onKeyDown={(e) => e.stopPropagation()}
                  role="presentation"
                >
                  <LockerRowActions
                    menuKey={
                      cardUsesTrackMenu ? `track:${primaryTrack!.id}` : `album:${album.key}`
                    }
                    openMenuKey={openMenuKey}
                    onOpenMenuKeyChange={setOpenMenuKey}
                    actions={
                      cardUsesTrackMenu
                        ? buildTrackMenu(primaryTrack!)
                        : buildAlbumMenu(album, collection.key)
                    }
                    ariaLabel={
                      cardUsesTrackMenu
                        ? `Options for ${displayLockerTrackTitle(primaryTrack!.title)}`
                        : `Options for ${collection.displayName}`
                    }
                    sheetTitle={
                      cardUsesTrackMenu
                        ? displayLockerTrackTitle(primaryTrack!.title)
                        : collection.displayName
                    }
                    sheetSubtitle={
                      cardUsesTrackMenu
                        ? primaryTrack!.artist || collection.artist
                        : collection.artist
                    }
                    align="right"
                    portaled
                    alwaysVisible={isMobile}
                    panelClassName={cardUsesTrackMenu ? undefined : 'locker-album-menu-panel'}
                    maxHeightCapPx={cardUsesTrackMenu ? undefined : isNarrowMenu ? 700 : 448}
                  />
                </div>
              </article>
            );
          })}
              </div>
            </React.Fragment>
          ))}
        </>
      ) : null}

      {lockerTab !== 'videos' &&
        viewMode === 'tracks' &&
        !showArtistHub &&
        groupedVisibleTracks.length > 0 && (
        <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-card)]/40 overflow-hidden">
          {groupedVisibleTracks.map((group, index) => {
            const entry = group.primary;
            const active =
              activeEnvelopeId === entry.id ||
              isNowPlaying(vm, entry) ||
              group.entries.some((e) => activeEnvelopeId === e.id || isNowPlaying(vm, e));
            return (
              <li
                key={group.key}
                className={`flex items-center gap-3 group py-1 ${active ? 'is-active' : ''}`}
              >
                <span className="w-8 text-center text-sm text-[var(--text-dim)] shrink-0">
                  {index + 1}
                </span>
                <button
                  type="button"
                  onClick={() => onPlay(entryToEnvelope(entry))}
                  className="flex-1 py-3 text-left touch-manipulation min-w-0"
                >
                  <span
                    className={`track-list-title block truncate ${active ? 'is-active' : ''}`}
                  >
                    {entry.title}
                  </span>
                  <span className="track-list-meta block truncate">
                    {entry.artist}
                    {entry.albumName ? ` · ${formatAlbumDisplayName(entry.albumName)}` : ''}
                  </span>
                </button>
                <span className="text-xs text-[var(--text-dim)] shrink-0 tabular-nums">
                  {formatTime(entry.durationSeconds || 0)}
                </span>
                <span
                  className={`locker-album-track-actions shrink-0 ${
                    isMobile ? 'locker-album-track-actions--visible' : ''
                  }`}
                >
                  <TrackRowSources
                    envelopeId={entry.id}
                    title={entry.title}
                    baseEnvelope={entryToEnvelope(entry)}
                    onPlay={(env) => onPlay(env)}
                    open={openMenuKey === `sources:${entry.id}`}
                    onOpenChange={(o) =>
                      setOpenMenuKey(o ? `sources:${entry.id}` : null)
                    }
                    alwaysVisible={isMobile}
                  />
                  {onAnalyzeStems ? (
                    <AnalyzeStemsButton
                      trackId={entry.id}
                      title={entry.title}
                      onAnalyze={onAnalyzeStems}
                      alwaysVisible={isMobile}
                    />
                  ) : null}
                  {onSendToDj ? (
                    <LoadInDjMenu
                      trackId={entry.id}
                      title={entry.title}
                      onLoad={onSendToDj}
                      open={openMenuKey === `dj:${entry.id}`}
                      onOpenChange={(o) =>
                        setOpenMenuKey(o ? `dj:${entry.id}` : null)
                      }
                      alwaysVisible={isMobile}
                    />
                  ) : null}
                  <button
                    type="button"
                    className="search-results-action search-results-action--play touch-manipulation"
                    aria-label={`Play ${entry.title}`}
                    onClick={() => onPlay(entryToEnvelope(entry))}
                  >
                    <Play className="w-4 h-4 ml-0.5" />
                  </button>
                  <LockerRowActions
                    menuKey={`track:${entry.id}`}
                    openMenuKey={openMenuKey}
                    onOpenMenuKeyChange={setOpenMenuKey}
                    actions={buildTrackMenu(entry)}
                    ariaLabel={`Options for ${entry.title}`}
                    sheetTitle={entry.title}
                    sheetSubtitle={entry.artist}
                    portaled
                    alwaysVisible={isMobile}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <AddToPlaylistPicker
        open={playlistTracks !== null}
        onClose={() => setPlaylistTracks(null)}
        tracks={playlistTracks ?? []}
        onDone={(msg) => setToast(msg)}
        onOpenPlaylists={onGoToPlaylists}
      />

      <EditLockerInfoModal
        open={editTarget !== null}
        onClose={() => setEditTarget(null)}
        mode={editTarget?.mode ?? 'track'}
        initial={
          !editTarget
            ? {}
            : editTarget.mode === 'track'
              ? {
                  title: editTarget.entry.title,
                  artist: editTarget.entry.artist,
                  albumName: editTarget.entry.albumName,
                  composer: editTarget.entry.composer,
                  genre: editTarget.entry.genre,
                }
              : {
                  albumName: editTarget.album.name,
                  artist: resolveAlbumBannerArtist(
                    editTarget.album.name,
                    editTarget.album.artist,
                    editTarget.album.tracks,
                  ) || editTarget.album.artist,
                  albumArtist:
                    resolveAlbumBannerArtist(
                      editTarget.album.name,
                      editTarget.album.artist,
                      editTarget.album.tracks,
                    ) || '',
                  composer:
                    editTarget.album.tracks.find((t) => t.composer)?.composer ?? '',
                  releaseYear:
                    editTarget.album.tracks.find((t) => t.releaseYear)?.releaseYear ?? '',
                  discCount:
                    editTarget.album.tracks.find((t) => t.discCount)?.discCount ?? '',
                  genre: editTarget.album.tracks.find((t) => t.genre)?.genre ?? '',
                }
        }
        trackCount={editTarget?.mode === 'album' ? editTarget.album.tracks.length : undefined}
        coverUrl={
          editTarget?.mode === 'album'
            ? albumArtSrc(
                allEditionGroups.find((a) => a.key === editTarget.album.key) ?? editTarget.album,
              ) || undefined
            : undefined
        }
        onSave={saveEditInfo}
        onUploadCover={
          editTarget?.mode === 'album'
            ? () => openCoverArtPicker(editTarget.album)
            : undefined
        }
        onRefreshCover={
          editTarget?.mode === 'album'
            ? (hint) => refreshAlbumCover(editTarget.album, hint)
            : undefined
        }
        onIdentifyFromCatalog={
          editTarget?.mode === 'album'
            ? async () => {
                const album = editTarget.album;
                const result = await identifyAlbumFromCatalog(album);
                if (result === 'manual') {
                  setEditTarget({ mode: 'album', album, focusField: 'albumArtist' });
                  return;
                }
                refreshEditTargetAlbum(album);
              }
            : undefined
        }
        focusField={editTarget?.mode === 'album' ? editTarget.focusField : undefined}
      />

      <AlbumCreditsModal
        open={creditsTarget !== null}
        onClose={() => setCreditsTarget(null)}
        album={creditsAlbum}
        onSaved={() => {
          void refresh();
          setToast('Credits updated');
        }}
      />

      <MetadataRepairPanel modal open={repairOpen} onClose={() => setRepairOpen(false)} />

      <ModalOverlay
        open={uploadOpen}
        onClose={() => !uploading && closeUpload()}
        title={t('locker.uploadModalTitle')}
        maxWidth="max-w-[560px]"
        borderAccent
      >
        <div className="space-y-5 font-mono">
          <p className="text-xs text-[var(--text-mid)] -mt-1">{t('locker.uploadMusicOnlyHint')}</p>

          {showDeviceMusicScan && (
            <DeviceMusicScanPanel
              disabled={uploading}
              setToast={setToast}
              manualOpen={deviceScanManualOpen}
              onManualPick={() => setDeviceScanManualOpen((open) => !open)}
              onLockerRefresh={() => {
                void refresh().then(() => setViewMode('albums'));
              }}
              onDismiss={closeUpload}
            />
          )}

          {showManualUploadPickers && (
            <>
          <div className="flex gap-6 border-b border-[var(--border)]">
            {(
              [
                { id: 'track' as const, label: 'One track' },
                { id: 'album' as const, label: 'Full album' },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                disabled={uploading}
                onClick={() => setUploadKind(opt.id)}
                className={`pb-2 text-sm font-semibold touch-manipulation border-b-2 -mb-px transition-colors disabled:opacity-50 ${
                  uploadKind === opt.id
                    ? 'border-[var(--orange)] text-[var(--text)]'
                    : 'border-transparent text-[var(--text-dim)] hover:text-[var(--text-mid)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {uploadKind === 'album' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  value={formAlbum}
                  onChange={(e) => setFormAlbum(e.target.value)}
                  placeholder="Album name (auto-filled)"
                  className="w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
                />
                <input
                  value={formArtist}
                  onChange={(e) => setFormArtist(e.target.value)}
                  placeholder="Artist"
                  className="w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="number"
                  min="1900"
                  max="2030"
                  value={formYear}
                  onChange={(e) => setFormYear(e.target.value)}
                  placeholder="Release year"
                  className="w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
                />
                <input
                  type="text"
                  list="upload-genre-options"
                  value={formGenre}
                  onChange={(e) => setFormGenre(e.target.value)}
                  placeholder="Genre (optional)"
                  className="w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
                />
                <datalist id="upload-genre-options">
                  {GENRE_OPTIONS.map((g) => (
                    <option key={g} value={g} />
                  ))}
                </datalist>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Track title (optional)"
                className="w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
              />
              <input
                value={formArtist}
                onChange={(e) => setFormArtist(e.target.value)}
                placeholder="Artist (optional)"
                className="w-full h-11 px-3 border border-[var(--border)] rounded-lg input-elevated text-sm focus-accent"
              />
            </div>
          )}

          {uploadKind === 'album' ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-dashed border-[var(--border-hi)] bg-[var(--bg-card)] p-4 space-y-3">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => albumFolderRef.current?.click()}
                  className="w-full flex items-center justify-center gap-3 py-3 rounded-md hover:bg-[var(--bg-hover)] transition-colors touch-manipulation disabled:opacity-50"
                >
                  <FolderOpen className="w-6 h-6 text-accent shrink-0" />
                  <div className="text-left">
                    <p className="text-sm font-semibold">
                      {albumFiles.length > 0 ? 'Choose a different folder' : 'Choose album folder'}
                    </p>
                    <p className="text-xs text-[var(--text-mid)]">
                      {albumFiles.length > 0
                        ? 'Or review the details above and import.'
                        : 'Open the folder and click Upload. An empty file list in the dialog is normal — all audio inside is still imported.'}
                    </p>
                  </div>
                </button>

                {albumFiles.length > 0 &&
                  (albumAudioCount > 0 ? (
                    <div className="flex items-center gap-2 text-xs">
                      <Check className="w-4 h-4 text-accent shrink-0" />
                      <span className="text-accent font-semibold">
                        {albumAudioCount} audio files found
                      </span>
                      {albumFolderName && (
                        <span className="text-[var(--text-mid)] truncate">
                          in {albumFolderName}
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs" style={{ color: 'var(--warn)' }}>
                      No audio files found. Try a different folder.
                    </p>
                  ))}

                {albumAudioCount > 0 && (
                  <div className="flex items-center gap-2.5">
                    {coverPreview ? (
                      <img
                        src={coverPreview}
                        alt=""
                        className="w-11 h-11 rounded object-cover border border-[var(--border)]"
                      />
                    ) : (
                      <div className="w-11 h-11 rounded border border-[var(--border)] bg-[var(--bg-void)] flex items-center justify-center">
                        <Disc className="w-5 h-5 text-[var(--text-dim)]" />
                      </div>
                    )}
                    <span className="text-xs text-[var(--text-mid)]">
                      {coverPreview ? 'Cover art found' : 'No cover — will search online'}
                    </span>
                  </div>
                )}
              </div>

              <input
                ref={albumFolderRef}
                type="file"
                className="hidden"
                {...({ webkitdirectory: '', directory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
                onChange={(e) => {
                  prepareAlbumSelection(e.target.files);
                  e.target.value = '';
                }}
              />

              <button
                type="button"
                disabled={uploading}
                onClick={() => albumFilesRef.current?.click()}
                title={
                  isMobile ? undefined : 'Tip: press Ctrl+A in the file dialog to select all tracks'
                }
                className="w-full flex items-center justify-center gap-2 py-3 rounded-md border border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--orange)] transition-colors touch-manipulation disabled:opacity-50"
              >
                <Upload className="w-5 h-5 text-accent" />
                <span className="text-sm font-medium">
                  {isMobile ? 'Or pick individual tracks' : 'Or select all tracks'}
                </span>
              </button>
              <p className="text-[11px] text-[var(--text-dim)] text-center">
                Prefer to see your files? Use this — it opens a normal file picker.
              </p>
              <input
                ref={albumFilesRef}
                type="file"
                accept={MUSIC_UPLOAD_ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  prepareAlbumSelection(e.target.files);
                  e.target.value = '';
                }}
              />
            </div>
          ) : (
            <div className="space-y-3">
              <button
                type="button"
                disabled={uploading}
                onClick={() => trackFileRef.current?.click()}
                className="w-full flex flex-col items-center gap-2 py-8 rounded-lg border border-dashed border-[var(--border-hi)] bg-[var(--bg-card)] hover:border-[var(--orange)] transition-colors touch-manipulation disabled:opacity-50"
              >
                <Upload className="w-8 h-8 text-accent" />
                <span className="text-sm font-semibold">Choose audio file</span>
                <span className="text-xs text-[var(--text-mid)]">{t('locker.uploadFormatsHint')}</span>
              </button>
              {trackFile && (
                <div className="flex items-center gap-2 text-xs">
                  <Check className="w-4 h-4 text-accent shrink-0" />
                  <span className="text-accent truncate">{trackFile.name}</span>
                </div>
              )}
            </div>
          )}

          <input
            ref={trackFileRef}
            type="file"
            accept={MUSIC_UPLOAD_ACCEPT}
            className="hidden"
            onChange={(e) => {
              prepareTrackSelection(e.target.files);
              e.target.value = '';
            }}
          />

          {importProgress && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--text-mid)]">Saving to locker…</span>
                <span className="text-accent">
                  Saving track {Math.min(importProgress.current + 1, importProgress.total)} of{' '}
                  {importProgress.total}…
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--bg-void)] overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{
                    width: `${Math.round(
                      (importProgress.current / importProgress.total) * 100,
                    )}%`,
                  }}
                />
              </div>
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              disabled={uploading}
              onClick={closeUpload}
              className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-mid)] text-xs uppercase hover:border-[var(--orange)] hover:text-[var(--text)] transition-colors touch-manipulation disabled:opacity-40"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={!canImport}
              onClick={() => void runImport()}
              className="flex-1 h-11 px-4 rounded btn-accent text-xs font-bold uppercase tracking-wide flex items-center justify-center gap-2 touch-manipulation disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Importing…
                </>
              ) : (
                `Import ${importCount} ${importCount === 1 ? 'track' : 'tracks'}`
              )}
            </button>
          </div>
            </>
          )}

          {showDeviceMusicScan && !showManualUploadPickers && (
            <div className="flex justify-end pt-1">
              <button
                type="button"
                disabled={uploading}
                onClick={closeUpload}
                className="px-4 py-2 rounded border border-[var(--border)] text-[var(--text-mid)] text-xs uppercase hover:border-[var(--orange)] hover:text-[var(--text)] transition-colors touch-manipulation disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </ModalOverlay>

      <MobileTrackActionSheet
        open={Boolean(actionSheet)}
        onClose={() => setActionSheet(null)}
        title={actionSheet?.title ?? ''}
        subtitle={actionSheet?.subtitle}
        actions={actionSheet?.actions ?? []}
        ariaLabel={actionSheet?.ariaLabel ?? 'Library options'}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => {
          if (confirmDeleteBusy) return;
          setConfirmDelete(null);
        }}
        onConfirm={() => void runConfirmedDelete()}
        title={
          confirmDelete?.kind === 'album'
            ? t('locker.confirm.removeAlbumTitle')
            : t('locker.confirm.removeTrackTitle')
        }
        message={
          confirmDelete?.kind === 'album'
            ? t('locker.confirm.removeAlbumMessage', {
                name: confirmDelete.album.displayName,
                count: groupTracksByEnvelope(confirmDelete.album.tracks).length,
              })
            : confirmDelete?.kind === 'track'
              ? t('locker.confirm.removeTrackMessage', { title: confirmDelete.entry.title })
              : ''
        }
        confirmLabel={t('locker.confirm.remove')}
        confirmingLabel={t('locker.confirm.removing')}
        danger
        confirming={confirmDeleteBusy}
      />
    </div>
  );
}
