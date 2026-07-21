import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Play,
  Download,
  ExternalLink,
  FolderOpen,
  GripVertical,
  ImagePlus,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Shuffle,
  Trash2,
  Wifi,
  X,
  ArrowUpDown,
  CheckSquare,
} from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import { displayTrackTitle } from '../displaySanitize';
import {
  formatAlbumDisplayName,
  formatDisplayTrackTitle,
  inferArtistFromAlbumFolder,
} from '../lockerStorage';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import ModalOverlay from './ModalOverlay';
import MobileShellBackButton from '../components/MobileShellBackButton';
import PlaylistRowActions from '../components/playlists/PlaylistRowActions';
import AddToPlaylistPicker from '../components/AddToPlaylistPicker';
import ConfirmDialog from '../components/ConfirmDialog';
import PromptDialog from '../components/PromptDialog';

import {
  addTracksToPlaylist,
  createSmartPlaylist,
  createPlaylistWithTracks,
  deletePlaylistById,
  getPinnedPlaylists,
  isPlaylistPinned,
  isSmartPlaylist,
  loadPlaylists,
  MAX_PINNED_PLAYLISTS,
  movePlaylistToFolder,
  pinPlaylistById,
  playlistCoverUrl,
  refreshSmartPlaylists,
  removeTracksFromPlaylist,
  reorderPlaylistTracks,
  savePlaylists,
  subscribePlaylists,
  unpinPlaylistById,
  updatePlaylistCover,
  type StoredPlaylist,
} from '../playlistStorage';
import { LOCKER_SYNC_COMPLETE_EVENT } from '../lockerSync';
import { rematchAllPlaylistStubsFromLocker, rematchPlaylistStubsFromLocker, rematchPlaylistTracksFromLocker } from '../playlistStubRematch';
import { envelopeClaimsLocker } from '../play/ensureLockerPlayable';
import {
  computeAlbumDownloadProgress,
  getDownloadJobs,
  subscribeDownloadQueue,
  type DownloadJob,
} from '../downloadQueue';
import { lockerEntryIsPlayable } from '../lockerStorage';
import {
  playlistTrackSearchQuery,
  unmatchedImportStubs,
} from '../importPlaylistAcquisition';
import { describeAiPromptRules } from '../playlistAiPrompt';
import { curatePlaylistFromPrompt } from '../curatePlaylistFromPrompt';
import {
  createPlaylistFolder,
  loadPlaylistFolders,
  PLAYLIST_FOLDERS_CHANGE,
  renamePlaylistFolder,
  type PlaylistFolder,
} from '../playlistFolders';
import { useTranslation } from '../i18n';
import {
  primePlaylistSonicAnalysis,
  smartReorderCoverageHint,
  smartReorderDetail,
  smartReorderPlaylistTracks,
} from '../playlistSmartReorder';
import { ensureSonicAnalysisForEnvelope } from '../sonicAnalysisQueue';
import { getSonicFeaturesForEnvelope } from '../sonicFeatures';
import { formatSonicSummary } from '../sonicDisplay';
import { suggestPlaylistEnhancements } from '../playlistEnhance';
import PlaylistShareDialog from '../components/playlists/PlaylistShareDialog';
import { parsePlaylistShareFromHash, shareOrDownloadPlaylist } from '../playlistCollaborativeShare';
import PlaylistPinnedRow from '../components/playlists/PlaylistPinnedRow';
import { seedGradient } from '../seedGradient';
import { TASTE_FEEDBACK_CHANGE_EVENT } from '../tasteFeedback';
import { isSystemLikedPlaylist, syncLikedPlaylist } from '../likedPlaylist';
import { isSystemTrackRadioPlaylist } from '../radioSessionPlaylist';
import { getSmartPlaylistPlayHistory, subscribePlayHistory } from '../playHistory';
import { subscribeLockerCache } from '../lockerStorage';
import { useLockerVault } from '../LockerVaultContext';
import {
  BUILT_IN_SMART_PLAYLISTS,
  CORE_BUILTIN_SMART_PLAYLIST_IDS,
  SMART_RULE_FIELDS,
  applyBuiltInParam,
  defaultCustomSmartRules,
  describeSmartPlaylistRules,
  evaluateSmartPlaylistTracks,
  isCoreBuiltInSmartPlaylist,
  newSmartRule,
  operatorsForField,
  type BuiltInSmartPlaylistId,
  type SmartConditionLogic,
  type SmartPlaylistRules,
  type SmartRule,
  type SmartRuleField,
  type SmartRuleOperator,
} from '../smartPlaylistEngine';
import {
  IMPORT_PLATFORMS,
  applyImportedMetadata,
  clearPlaylistImportDraft,
  displayPlaylistName,
  extractFirstImportUrlFromText,
  fetchExternalPlaylistMetadata,
  findPlaylistBySourceUrl,
  getImportPlatform,
  inferImportPlatformFromUrl,
  formatPlaylistStatus,
  hasUsefulImportMetadata,
  isFallbackImportName,
  isImportedShellWithoutTracks,
  isValidImportPlatformUrl,
  matchLockerTracksFromStubs,
  needsImportMetadataRefresh,
  parseSourceUrlFromDescription,
  readPlaylistImportDraft,
  refreshExternalPlaylistMetadata,
  resolvePlaylistImportContext,
  sanitizePlaylistTitle,
  writePlaylistImportDraft,
  type ImportPlatformId,
} from '../importPlatforms';
import { imeTextInputProps, imeUrlInputProps } from '../imeInputProps';

export type { StoredPlaylist };

type ConsoleTab = 'manual' | 'smart' | 'ai' | 'external';

const SMART_PLAYLIST_REFRESH_DEBOUNCE_MS = 500;
const SMART_PLAYLIST_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const SMART_PLAYLIST_REFRESH_INDICATOR_DELAY_MS = 300;

function isImportedPlaylist(pl: StoredPlaylist): boolean {
  return Boolean(pl.sourceUrl || pl.importPlatformId || (pl.importTrackStubs?.length ?? 0) > 0);
}

function findPlaylistDownloadJob(playlistId: string): DownloadJob | undefined {
  return getDownloadJobs().find(
    (job) =>
      job.playlistId === playlistId &&
      job.status !== 'done' &&
      job.status !== 'error',
  );
}

function PlaylistDownloadProgressBar({
  job,
  compact = false,
}: {
  job: DownloadJob;
  compact?: boolean;
}) {
  const stats = computeAlbumDownloadProgress(job);
  const total = stats.total > 0 ? stats.total : job.totalTracks;
  if (total <= 0) return null;
  const processed = stats.processed > 0 ? stats.processed : job.completedTracks;
  const label =
    job.currentTrack === 'Resolving catalog…'
      ? `Resolving ${processed}/${total}…`
      : `Downloading ${processed}/${total}…`;

  return (
    <div
      className={`playlist-download-progress${compact ? ' playlist-download-progress--compact' : ''}`}
      role="progressbar"
      aria-valuenow={stats.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="playlist-download-progress-meta">
        <span>{label}</span>
        <span className="playlist-download-progress-count">{stats.percent}%</span>
      </div>
      <div className="playlist-download-progress-track">
        <div
          className="playlist-download-progress-bar"
          style={{ width: `${Math.max(stats.percent, processed > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

function formatPlaylistDisplayStatus(pl: StoredPlaylist): string {
  if (isSmartPlaylist(pl)) {
    const n = pl.tracks.length;
    const ruleHint = pl.rules
      ? describeSmartPlaylistRules(pl.rules, pl.builtInId, pl.builtInParam)
      : 'Smart';
    return `Smart · ${n} track${n === 1 ? '' : 's'} · ${ruleHint}`;
  }
  return formatPlaylistStatus(pl);
}

export interface PlaylistsViewProps {
  meshResults: MediaEnvelope[];
  lockerTracks?: MediaEnvelope[];
  activeEnvelopeId: string | null;
  initialOpenPlaylistId?: string | null;
  onOpenPlaylistHandled?: () => void;
  initialShareImport?: { shareId: string; editToken?: string } | null;
  onShareImportHandled?: () => void;
  /** Shared playlist URL from Android share sheet or deep link. */
  initialExternalImport?: { url: string; name?: string; platformId?: ImportPlatformId } | null;
  onExternalImportHandled?: () => void;
  /** Inside Discover station tab (no duplicate page title). */
  embedded?: boolean;
  /** Mobile-native card layout inside Discover. */
  mobile?: boolean;
  playlistsDrillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayNext?: (tracks: MediaEnvelope[]) => void;
  onPrepareForTravel?: (tracks: MediaEnvelope[]) => void;
  onRunSearch?: (query: string) => void;
  onGoToLocker?: (section?: import('./CollectionView').LockerSectionId) => void;
  onGoToSearch?: () => void;
  onDownloadImportedPlaylist?: (playlist: StoredPlaylist) => void;
}

function writePlaylists(
  setPlaylists: React.Dispatch<React.SetStateAction<StoredPlaylist[]>>,
  next: StoredPlaylist[],
): void {
  setPlaylists(next);
  savePlaylists(next);
}

const FOLDER_STYLE_TITLE =
  /\b(?:24\s*bit|16\s*bit|web\s*flac|flac|mp3|wav|preluxe|deluxe|edition|remaster)\b/i;

function compileTrackLabel(track: MediaEnvelope): { title: string; artist: string; album?: string } {
  const albumRaw = track.album?.trim();
  const album = albumRaw ? formatAlbumDisplayName(albumRaw) : undefined;
  let title = displayTrackTitle(formatDisplayTrackTitle(track.title));
  if (FOLDER_STYLE_TITLE.test(track.title)) {
    const cleaned = formatAlbumDisplayName(track.title);
    if (cleaned) title = cleaned;
  } else if (album && title.toLowerCase() === album.toLowerCase()) {
    title = album;
  }
  const artist = inferArtistFromAlbumFolder(albumRaw ?? '', track.artist);
  return {
    title,
    artist: artist === 'Local Upload' ? '' : artist,
    album,
  };
}

type CompileMatchField = 'title' | 'artist' | 'album';

function compileTrackMatchFields(track: MediaEnvelope, query: string): CompileMatchField[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const { title, artist, album } = compileTrackLabel(track);
  const fields: CompileMatchField[] = [];
  if (title.toLowerCase().includes(q)) fields.push('title');
  if (artist.toLowerCase().includes(q)) fields.push('artist');
  if (album?.toLowerCase().includes(q)) fields.push('album');
  return fields;
}

function compileTrackMatchHint(fields: CompileMatchField[]): string {
  if (fields.length === 0) return '';
  const labels: Record<CompileMatchField, string> = {
    title: 'title',
    artist: 'artist',
    album: 'album',
  };
  return `Matched ${fields.map((f) => labels[f]).join(', ')}`;
}

function compileTrackMatchesQuery(track: MediaEnvelope, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return compileTrackMatchFields(track, query).length > 0;
}

function PillTab({
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
      className={`px-4 py-2 rounded-sm font-mono text-[10px] font-bold uppercase tracking-wide border touch-manipulation transition-colors ${
        active
          ? 'bg-accent border-accent text-[var(--bg-void)]'
          : 'bg-slate-800/30 text-slate-400 border-slate-700/50 hover:bg-slate-800/60'
      }`}
    >
      {label}
    </button>
  );
}

export default function PlaylistsView({
  meshResults,
  lockerTracks = [],
  activeEnvelopeId,
  initialOpenPlaylistId,
  onOpenPlaylistHandled,
  initialShareImport = null,
  onShareImportHandled,
  initialExternalImport = null,
  onExternalImportHandled,
  embedded = false,
  mobile = false,
  playlistsDrillBackRef,
  onPlay,
  onPlayAlbum,
  onPlayNext,
  onPrepareForTravel,
  onRunSearch,
  onGoToLocker,
  onGoToSearch,
  onDownloadImportedPlaylist,
}: PlaylistsViewProps) {
  const { t } = useTranslation();
  const { entries: lockerEntries } = useLockerVault();
  const [playlists, setPlaylists] = useState<StoredPlaylist[]>(loadPlaylists);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleTab, setConsoleTab] = useState<ConsoleTab>('manual');
  const [openPlaylistId, setOpenPlaylistId] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editTarget, setEditTarget] = useState<StoredPlaylist | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [addToPlaylistTracks, setAddToPlaylistTracks] = useState<MediaEnvelope[] | null>(null);

  const [plTitle, setPlTitle] = useState('');
  const [plDesc, setPlDesc] = useState('');
  const [compileSearch, setCompileSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiStatus, setAiStatus] = useState('');
  const [importPlatformId, setImportPlatformId] = useState<ImportPlatformId>(
    () => readPlaylistImportDraft()?.platformId ?? 'spotify',
  );
  const importPlatform = getImportPlatform(importPlatformId);
  const [importUrl, setImportUrl] = useState(() => readPlaylistImportDraft()?.url ?? '');
  const [importName, setImportName] = useState(() => readPlaylistImportDraft()?.name ?? '');
  const [importMsg, setImportMsg] = useState('');
  const [importSyncing, setImportSyncing] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [downloadingPlaylistId, setDownloadingPlaylistId] = useState<string | null>(null);
  const [smartRefreshing, setSmartRefreshing] = useState(false);
  const [smartRefreshBusy, setSmartRefreshBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'error' } | null>(null);
  const [shareDialogPlaylist, setShareDialogPlaylist] = useState<StoredPlaylist | null>(null);
  const [shareImportSeed, setShareImportSeed] = useState<{ shareId: string; editToken?: string } | null>(
    null,
  );
  const [confirmDeletePlaylist, setConfirmDeletePlaylist] = useState<StoredPlaylist | null>(null);
  const [renameFolderTarget, setRenameFolderTarget] = useState<PlaylistFolder | null>(null);

  const [smartTitle, setSmartTitle] = useState('');
  const [smartDesc, setSmartDesc] = useState('');
  const [smartRules, setSmartRules] = useState<SmartPlaylistRules>(defaultCustomSmartRules);
  const [selectedBuiltIn, setSelectedBuiltIn] = useState<BuiltInSmartPlaylistId | null>(null);
  const [builtInParam, setBuiltInParam] = useState('');
  const [editSmartRules, setEditSmartRules] = useState<SmartPlaylistRules | null>(null);
  const [folders, setFolders] = useState<PlaylistFolder[]>(loadPlaylistFolders);
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [detailSelectionMode, setDetailSelectionMode] = useState(false);
  const [detailSelectedIds, setDetailSelectedIds] = useState<Set<string>>(new Set());
  const [detailDragId, setDetailDragId] = useState<string | null>(null);
  const [showEnhancePanel, setShowEnhancePanel] = useState(false);
  const [importMatchProgress, setImportMatchProgress] = useState<{ matched: number; total: number } | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const resolvedImport = useMemo(
    () => extractFirstImportUrlFromText(importUrl),
    [importUrl],
  );
  const effectiveImportUrl = resolvedImport?.url ?? importUrl.trim();
  const effectiveImportPlatformId = resolvedImport?.platformId ?? importPlatformId;
  const importUrlReady = isValidImportPlatformUrl(effectiveImportPlatformId, effectiveImportUrl);
  const importCanProceed = importUrlReady && !importSyncing;

  useEffect(() => {
    writePlaylistImportDraft({
      url: importUrl,
      name: importName,
      platformId: importPlatformId,
    });
  }, [importUrl, importName, importPlatformId]);

  const persistPlaylists = useCallback(
    (next: StoredPlaylist[]) => writePlaylists(setPlaylists, next),
    [],
  );

  useEffect(() => subscribePlaylists(() => setPlaylists(loadPlaylists())), []);

  useEffect(() => {
    const onFolders = () => setFolders(loadPlaylistFolders());
    window.addEventListener(PLAYLIST_FOLDERS_CHANGE, onFolders);
    return () => window.removeEventListener(PLAYLIST_FOLDERS_CHANGE, onFolders);
  }, []);

  useEffect(() => {
    setDetailSelectionMode(false);
    setDetailSelectedIds(new Set());
    setImportMatchProgress(null);
    setShowEnhancePanel(false);
    setDetailDragId(null);
  }, [openPlaylistId]);

  useEffect(() => {
    if (!initialOpenPlaylistId) return;
    const exists = loadPlaylists().some((pl) => pl.id === initialOpenPlaylistId);
    if (exists) setOpenPlaylistId(initialOpenPlaylistId);
    onOpenPlaylistHandled?.();
  }, [initialOpenPlaylistId, onOpenPlaylistHandled]);

  useEffect(() => {
    const seed =
      initialShareImport ??
      (typeof window !== 'undefined' ? parsePlaylistShareFromHash(window.location.hash) : null);
    if (!seed) return;
    setShareImportSeed(seed);
    setShareDialogPlaylist(null);
    onShareImportHandled?.();
    if (typeof window !== 'undefined' && window.history.replaceState) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, [initialShareImport, onShareImportHandled]);

  useEffect(() => {
    if (!resolvedImport) return;
    if (resolvedImport.platformId !== importPlatformId) {
      setImportPlatformId(resolvedImport.platformId);
    }
  }, [resolvedImport, importPlatformId]);

  useEffect(() => {
    const seed = initialExternalImport;
    if (!seed?.url?.trim()) return;
    const resolved = extractFirstImportUrlFromText(seed.url);
    setConsoleOpen(true);
    setConsoleTab('external');
    setImportPlatformId(resolved?.platformId ?? seed.platformId ?? inferImportPlatformFromUrl(seed.url) ?? 'spotify');
    setImportUrl(resolved?.url ?? seed.url.trim());
    if (seed.name?.trim()) setImportName(seed.name.trim());
    onExternalImportHandled?.();
  }, [initialExternalImport, onExternalImportHandled]);

  useEffect(() => {
    const onSyncComplete = () => setPlaylists(loadPlaylists());
    window.addEventListener(LOCKER_SYNC_COMPLETE_EVENT, onSyncComplete);
    return () => window.removeEventListener(LOCKER_SYNC_COMPLETE_EVENT, onSyncComplete);
  }, []);

  const lockerEntriesRef = useRef(lockerEntries);
  lockerEntriesRef.current = lockerEntries;

  const smartRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const smartRefreshIndicatorRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearSmartRefreshIndicator = useCallback(() => {
    if (smartRefreshIndicatorRef.current) {
      window.clearTimeout(smartRefreshIndicatorRef.current);
      smartRefreshIndicatorRef.current = null;
    }
    setSmartRefreshing(false);
  }, []);

  const runSmartRefresh = useCallback(() => {
    setSmartRefreshBusy(true);
    smartRefreshIndicatorRef.current = window.setTimeout(() => {
      smartRefreshIndicatorRef.current = null;
      setSmartRefreshing(true);
    }, SMART_PLAYLIST_REFRESH_INDICATOR_DELAY_MS);

    const history = getSmartPlaylistPlayHistory();
    const refreshed = refreshSmartPlaylists(lockerEntriesRef.current, history);
    const withLiked = syncLikedPlaylist(lockerEntriesRef.current);
    setPlaylists(withLiked.length ? withLiked : refreshed);
    clearSmartRefreshIndicator();
    setSmartRefreshBusy(false);
  }, [clearSmartRefreshIndicator]);

  const scheduleSmartRefresh = useCallback(() => {
    if (smartRefreshDebounceRef.current) {
      window.clearTimeout(smartRefreshDebounceRef.current);
    }
    smartRefreshDebounceRef.current = window.setTimeout(() => {
      smartRefreshDebounceRef.current = null;
      runSmartRefresh();
    }, SMART_PLAYLIST_REFRESH_DEBOUNCE_MS);
  }, [runSmartRefresh]);

  useEffect(() => {
    runSmartRefresh();
    const unsubLocker = subscribeLockerCache(scheduleSmartRefresh);
    const unsubHistory = subscribePlayHistory(scheduleSmartRefresh);
    const onLikedChange = () => scheduleSmartRefresh();
    window.addEventListener(TASTE_FEEDBACK_CHANGE_EVENT, onLikedChange);
    const intervalId = window.setInterval(runSmartRefresh, SMART_PLAYLIST_REFRESH_INTERVAL_MS);
    return () => {
      unsubLocker();
      unsubHistory();
      window.removeEventListener(TASTE_FEEDBACK_CHANGE_EVENT, onLikedChange);
      window.clearInterval(intervalId);
      if (smartRefreshDebounceRef.current) {
        window.clearTimeout(smartRefreshDebounceRef.current);
        smartRefreshDebounceRef.current = null;
      }
      clearSmartRefreshIndicator();
    };
  }, [runSmartRefresh, scheduleSmartRefresh, clearSmartRefreshIndicator]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(t);
  }, [toast]);

  const meshResultsRef = useRef(meshResults);
  meshResultsRef.current = meshResults;
  const lockerTracksRef = useRef(lockerTracks);
  lockerTracksRef.current = lockerTracks;

  const stubMatchPool = useCallback((): typeof meshResults => {
    return lockerTracksRef.current.length > 0 ? lockerTracksRef.current : meshResultsRef.current;
  }, []);

  const applyMetadataRefresh = useCallback(
    (
      existing: StoredPlaylist,
      metadata: NonNullable<Awaited<ReturnType<typeof refreshExternalPlaylistMetadata>>>,
    ): StoredPlaylist => {
      const { sourceUrl, importPlatformId } = resolvePlaylistImportContext(existing);
      if (!sourceUrl || !importPlatformId) return existing;
      const autoMatched = matchLockerTracksFromStubs(
        metadata.trackStubs,
        stubMatchPool(),
      );
      return applyImportedMetadata(
        existing,
        importPlatformId,
        sourceUrl,
        metadata,
        autoMatched,
      );
    },
    [stubMatchPool],
  );

  useEffect(() => {
    if (lockerTracks.length === 0) return;
    if (downloadingPlaylistId) return;
    const timer = window.setTimeout(() => {
      void (async () => {
        const verified: MediaEnvelope[] = [];
        for (const track of lockerTracksRef.current.length > 0
          ? lockerTracksRef.current
          : lockerTracks) {
          if (track.provider === 'local-vault' && track.sourceId) {
            if (await lockerEntryIsPlayable(track.sourceId)) verified.push(track);
          } else {
            verified.push(track);
          }
        }
        if (verified.length === 0) return;
        const stubPass = rematchAllPlaylistStubsFromLocker(loadPlaylists(), verified);
        let next = stubPass.playlists;
        let repaired = 0;
        for (const pl of next) {
          const { playlist, repaired: plRepaired } = await rematchPlaylistTracksFromLocker(pl);
          if (plRepaired > 0) {
            repaired += plRepaired;
            next = next.map((p) => (p.id === pl.id ? playlist : p));
          }
        }
        if (stubPass.totalMatched > 0 || repaired > 0) savePlaylists(next);
      })();
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [lockerTracks, downloadingPlaylistId]);

  useEffect(() => {
    const syncDownloading = () => {
      const active = getDownloadJobs().find(
        (job) =>
          job.playlistId &&
          job.status !== 'done' &&
          job.status !== 'error',
      );
      setDownloadingPlaylistId(active?.playlistId ?? null);
    };
    syncDownloading();
    return subscribeDownloadQueue(syncDownloading);
  }, []);

  useEffect(() => {
    const onSync = () => {
      if (downloadingPlaylistId) return;
      if (lockerTracksRef.current.length === 0) return;
      void (async () => {
        const verified: MediaEnvelope[] = [];
        for (const track of lockerTracksRef.current) {
          if (track.provider === 'local-vault' && track.sourceId) {
            if (await lockerEntryIsPlayable(track.sourceId)) verified.push(track);
          } else {
            verified.push(track);
          }
        }
        if (verified.length === 0) return;
        const stubPass = rematchAllPlaylistStubsFromLocker(loadPlaylists(), verified);
        let next = stubPass.playlists;
        let repaired = 0;
        for (const pl of next) {
          const { playlist, repaired: plRepaired } = await rematchPlaylistTracksFromLocker(pl);
          if (plRepaired > 0) {
            repaired += plRepaired;
            next = next.map((p) => (p.id === pl.id ? playlist : p));
          }
        }
        if (stubPass.totalMatched > 0 || repaired > 0) savePlaylists(next);
      })();
    };
    window.addEventListener(LOCKER_SYNC_COMPLETE_EVENT, onSync);
    return () => window.removeEventListener(LOCKER_SYNC_COMPLETE_EVENT, onSync);
  }, [downloadingPlaylistId]);

  useEffect(() => {
    const snapshot = loadPlaylists();
    const stale = snapshot.filter(needsImportMetadataRefresh);
    if (stale.length === 0) return;

    let cancelled = false;
    void (async () => {
      const patches = await Promise.all(
        stale.map(async (pl) => {
          const metadata = await refreshExternalPlaylistMetadata(pl);
          if (!hasUsefulImportMetadata(metadata)) return null;
          return { id: pl.id, metadata: metadata! };
        }),
      );
      if (cancelled) return;

      const resolved = patches.filter(
        (entry): entry is { id: string; metadata: NonNullable<Awaited<ReturnType<typeof refreshExternalPlaylistMetadata>>> } =>
          entry !== null,
      );
      if (resolved.length === 0) return;

      writePlaylists(
        setPlaylists,
        snapshot.map((existing) => {
          const patch = resolved.find((entry) => entry.id === existing.id);
          if (!patch) return existing;
          return applyMetadataRefresh(existing, patch.metadata);
        }),
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [applyMetadataRefresh]);

  const showToast = useCallback((text: string, tone: 'success' | 'error' = 'success') => {
    setToast({ text, tone });
  }, []);

  const closeConsole = () => {
    setConsoleOpen(false);
    setPlTitle('');
    setPlDesc('');
    setCompileSearch('');
    setSelectedIds(new Set());
    setSmartTitle('');
    setSmartDesc('');
    setSmartRules(defaultCustomSmartRules());
    setSelectedBuiltIn(null);
    setBuiltInParam('');
  };
  useDismissableOverlay(consoleOpen, closeConsole);

  useEffect(() => {
    if (typeof sessionStorage === 'undefined') return;
    if (sessionStorage.getItem('sandbox-playlists-open-ai') !== '1') return;
    sessionStorage.removeItem('sandbox-playlists-open-ai');
    setConsoleOpen(true);
    setConsoleTab('ai');
  }, []);

  const openPlaylist = playlists.find((p) => p.id === openPlaylistId);

  const optionalBuiltInTemplates = useMemo(
    () => BUILT_IN_SMART_PLAYLISTS.filter((p) => !CORE_BUILTIN_SMART_PLAYLIST_IDS.includes(p.id)),
    [],
  );

  const { autoPlaylists, userSmartPlaylists, manualPlaylists, pinnedPlaylists } = useMemo(() => {
    const auto: StoredPlaylist[] = [];
    const userSmart: StoredPlaylist[] = [];
    const manual: StoredPlaylist[] = [];
    for (const pl of playlists) {
      if (isSmartPlaylist(pl)) {
        if (isCoreBuiltInSmartPlaylist(pl.builtInId)) auto.push(pl);
        else userSmart.push(pl);
      } else {
        manual.push(pl);
      }
    }
    const coreOrder = new Map(CORE_BUILTIN_SMART_PLAYLIST_IDS.map((id, i) => [id, i]));
    auto.sort((a, b) => {
      const aCore = a.builtInId ? coreOrder.get(a.builtInId) : undefined;
      const bCore = b.builtInId ? coreOrder.get(b.builtInId) : undefined;
      if (aCore != null && bCore != null) return aCore - bCore;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });
    userSmart.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    const sortManual = (list: StoredPlaylist[]) =>
      [...list].sort((a, b) => {
        const aSys =
          (isSystemLikedPlaylist(a) ? 2 : 0) + (isSystemTrackRadioPlaylist(a) ? 1 : 0);
        const bSys =
          (isSystemLikedPlaylist(b) ? 2 : 0) + (isSystemTrackRadioPlaylist(b) ? 1 : 0);
        if (aSys !== bSys) return bSys - aSys;
        const ap = isPlaylistPinned(a) ? a.pinnedAt ?? 0 : 0;
        const bp = isPlaylistPinned(b) ? b.pinnedAt ?? 0 : 0;
        if (ap !== bp) return bp - ap;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
    const filteredManual =
      selectedFolderId == null
        ? sortManual(manual)
        : sortManual(manual.filter((pl) => pl.folderId === selectedFolderId));
    const pinned = getPinnedPlaylists(playlists);
    const pinnedIds = new Set(pinned.map((p) => p.id));
    const withoutPinned = <T extends StoredPlaylist>(list: T[]) =>
      list.filter((pl) => !pinnedIds.has(pl.id));
    return {
      autoPlaylists: auto,
      userSmartPlaylists: withoutPinned(userSmart),
      manualPlaylists: filteredManual.filter((pl) => !pinnedIds.has(pl.id)),
      pinnedPlaylists: pinned,
    };
  }, [playlists, selectedFolderId]);

  const renderPlaylistRow = (pl: StoredPlaylist) => {
    const pending = isImportedShellWithoutTracks(pl);
    const isSmart = isSmartPlaylist(pl);
    const isImported = isImportedPlaylist(pl);
    const cover = playlistCoverUrl(pl);
    const name = displayPlaylistName(pl);
    const rowDownloadJob = findPlaylistDownloadJob(pl.id);
    const rowUnmatchedStubs = unmatchedImportStubs(pl).length;

    return (
      <li key={pl.id}>
        <div
          className={`relative group rounded-xl border bg-[var(--bg-card)] hover:border-accent transition-colors flex items-stretch ${
            mobile ? 'playlists-mobile-card' : ''
          } ${
            openPlaylistId === pl.id
              ? 'border-accent ring-2 ring-[var(--accent-stroke)] station-rail-glow'
              : 'border-[var(--border)]'
          }`}
        >
          <button
            type="button"
            onClick={() => setOpenPlaylistId(pl.id)}
            className={`flex-1 min-w-0 text-left rounded-xl touch-manipulation flex gap-3 items-center ${
              mobile ? 'playlists-mobile-card-btn' : 'p-4'
            }`}
          >
            <span
              className="playlist-row-cover shrink-0 rounded-lg overflow-hidden border border-[var(--border)]"
              aria-hidden
            >
              {cover ? (
                <img src={cover} alt="" className="w-full h-full object-cover" />
              ) : (
                <span className="playlist-row-cover-fallback" style={{ background: seedGradient(name) }} />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <p className="font-mono text-sm font-bold uppercase flex items-center gap-2">
                {isPlaylistPinned(pl) && <Pin className="w-3 h-3 text-accent shrink-0" />}
                {name}
              </p>
              <p className="font-mono text-[10px] text-[var(--text-mid)] mt-1">
                {formatPlaylistDisplayStatus(pl)}
              </p>
              {isSmart && (
                <p className="font-mono text-[9px] text-accent/80 mt-0.5 uppercase">
                  Auto-refresh · local only
                </p>
              )}
              {pending && !rowDownloadJob && (
                <p className="font-mono text-[9px] text-accent mt-0.5">
                  {isImported ? 'Tap to download tracks' : 'Add audio from Locker'}
                </p>
              )}
              {rowDownloadJob ? (
                <div className="mt-1.5">
                  <PlaylistDownloadProgressBar job={rowDownloadJob} compact />
                </div>
              ) : null}
            </span>
          </button>
          <div className={`shrink-0 flex items-center pr-2${mobile ? '' : ' pr-3'}`}>
            <PlaylistRowActions
              playlist={pl}
              menuOpen={openMenuId === pl.id}
              onMenuOpenChange={(o) => setOpenMenuId(o ? pl.id : null)}
              pendingImport={pending}
              folders={folders}
              onMoveToFolder={
                isSmart
                  ? undefined
                  : (folderId) => {
                      setPlaylists(movePlaylistToFolder(pl.id, folderId));
                      setOpenMenuId(null);
                      showToast(folderId ? 'Moved to folder' : 'Removed from folder');
                    }
              }
              onPin={() => {
                const ok = pinPlaylistById(pl.id);
                setPlaylists(loadPlaylists());
                setOpenMenuId(null);
                showToast(
                  ok ? 'Playlist pinned' : `Pin limit reached (${MAX_PINNED_PLAYLISTS})`,
                  ok ? 'success' : 'error',
                );
              }}
              onUnpin={() => {
                unpinPlaylistById(pl.id);
                setPlaylists(loadPlaylists());
                setOpenMenuId(null);
                showToast('Playlist unpinned');
              }}
              onAddTracksFromLocker={isSmart ? undefined : () => addTracksFromLocker(pl)}
              onSearchForTracks={() => searchForTracks(pl)}
              onPlayNow={() => playPlaylist(pl, false)}
              onShuffle={() => playPlaylist(pl, true)}
              onPlayNext={() => queuePlaylistNext(pl)}
              onAddToPlaylist={() => {
                setAddToPlaylistTracks(pl.tracks);
                setOpenMenuId(null);
              }}
              onDownload={
                onDownloadImportedPlaylist && rowUnmatchedStubs > 0
                  ? () => downloadImportedPlaylist(pl)
                  : onPrepareForTravel && pl.tracks.length > 0
                    ? () => onPrepareForTravel(pl.tracks)
                    : undefined
              }
              downloadLabel={
                onDownloadImportedPlaylist && rowUnmatchedStubs > 0
                  ? 'Download to Locker'
                  : undefined
              }
              onEdit={() => openEdit(pl)}
              onDelete={isSystemLikedPlaylist(pl) ? undefined : () => deletePlaylist(pl)}
              onShare={() => openShareDialog(pl)}
              shareLabel={t('playlists.share.menuLabel')}
              onExportJson={() => void exportPlaylist(pl, 'json')}
              onExportM3u={() => void exportPlaylist(pl, 'm3u')}
              onRematchLocker={
                pl.importTrackStubs?.length || pl.tracks.some(envelopeClaimsLocker)
                  ? () => void rematchPlaylistFromLocker(pl)
                  : undefined
              }
              onRefreshImport={
                resolvePlaylistImportContext(pl).sourceUrl
                  ? () => void refreshImport(pl)
                  : undefined
              }
            />
          </div>
        </div>
      </li>
    );
  };

  const toggleTrack = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const compilePool = lockerTracks.length > 0 ? lockerTracks : meshResults;

  const filteredCompilePool = useMemo(
    () => compilePool.filter((t) => compileTrackMatchesQuery(t, compileSearch)),
    [compilePool, compileSearch],
  );

  const compileSearchResults = useMemo(
    () => filteredCompilePool.filter((t) => !selectedIds.has(t.envelopeId)),
    [filteredCompilePool, selectedIds],
  );

  const compileQueueTracks = useMemo(
    () => compilePool.filter((t) => selectedIds.has(t.envelopeId)),
    [compilePool, selectedIds],
  );

  const createManual = () => {
    const name = plTitle.trim();
    if (!name) return;
    const tracks = compilePool.filter((t) => selectedIds.has(t.envelopeId));
    if (tracks.length === 0) {
      showToast('Add at least one track to the playlist', 'error');
      return;
    }
    persistPlaylists([
      ...playlists,
      {
        id: `pl-${Date.now()}`,
        name,
        description: plDesc.trim() || 'Human-authored compilation',
        tracks,
        type: 'manual',
        updatedAt: Date.now(),
      },
    ]);
    setPlTitle('');
    setPlDesc('');
    setCompileSearch('');
    setSelectedIds(new Set());
    closeConsole();
    showToast(`Compiled "${name}" · ${tracks.length} track${tracks.length === 1 ? '' : 's'}`);
  };

  const createFromBuiltIn = (builtInId: BuiltInSmartPlaylistId) => {
    const preset = BUILT_IN_SMART_PLAYLISTS.find((p) => p.id === builtInId);
    if (!preset) return;
    if (preset.requiresParam && !builtInParam.trim()) {
      setSelectedBuiltIn(builtInId);
      showToast(`Enter ${preset.paramLabel?.toLowerCase() ?? 'a value'} for this template`, 'error');
      return;
    }
    const name = smartTitle.trim() || (preset.requiresParam && builtInParam.trim()
      ? `${preset.name}: ${builtInParam.trim()}`
      : preset.name);
    const rules = preset.requiresParam
      ? applyBuiltInParam(preset.rules, builtInId, builtInParam)
      : preset.rules;
    const pl = createSmartPlaylist({
      name,
      description: smartDesc.trim() || preset.description,
      rules,
      builtInId,
      builtInParam: builtInParam.trim() || undefined,
      lockerEntries,
      playHistory: getSmartPlaylistPlayHistory(),
    });
    setPlaylists(loadPlaylists());
    closeConsole();
    showToast(`Smart playlist "${pl.name}" · ${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`);
    setOpenPlaylistId(pl.id);
  };

  const createCustomSmart = () => {
    const name = smartTitle.trim();
    if (!name) {
      showToast('Enter a playlist name', 'error');
      return;
    }
    if (!smartRules.conditions.length) {
      showToast('Add at least one rule condition', 'error');
      return;
    }
    const pl = createSmartPlaylist({
      name,
      description: smartDesc.trim() || 'Custom smart playlist',
      rules: smartRules,
      lockerEntries,
      playHistory: getSmartPlaylistPlayHistory(),
    });
    setPlaylists(loadPlaylists());
    closeConsole();
    showToast(`Smart playlist "${pl.name}" · ${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`);
    setOpenPlaylistId(pl.id);
  };

  const updateSmartRule = (ruleId: string, patch: Partial<SmartRule>) => {
    setSmartRules((prev) => ({
      ...prev,
      conditions: prev.conditions.map((r) => (r.id === ruleId ? { ...r, ...patch } : r)),
    }));
  };

  const removeSmartRule = (ruleId: string) => {
    setSmartRules((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((r) => r.id !== ruleId),
    }));
  };

  const runAiCuration = () => {
    const prompt = aiPrompt.trim();
    if (!prompt) return;
    setAiStatus('Building vibe playlist from locker…');
    void (async () => {
      try {
        const { tracks, source } = await curatePlaylistFromPrompt(prompt, lockerEntries, 80);
        const name = prompt.length > 32 ? `Vibe: ${prompt.slice(0, 32)}…` : `Vibe: ${prompt}`;
        if (tracks.length === 0) {
          setAiStatus('No locker tracks matched that vibe yet.');
          showToast('Add tracks to Locker first', 'error');
          return;
        }
        const description =
          source === 'gemini'
            ? `${describeAiPromptRules(prompt)} · Gemini-ranked`
            : describeAiPromptRules(prompt);
        const pl = createPlaylistWithTracks(name, tracks, description);
        setPlaylists(loadPlaylists());
        setAiStatus(
          source === 'gemini'
            ? `Gemini matched ${pl.tracks.length} tracks`
            : `Matched ${pl.tracks.length} tracks · local taste + vibe`,
        );
        setAiPrompt('');
        window.setTimeout(() => {
          closeConsole();
          setOpenPlaylistId(pl.id);
          showToast(`Vibe playlist · ${pl.tracks.length} tracks`);
        }, 500);
      } catch {
        setAiStatus('Could not build playlist — try again.');
        showToast('Vibe playlist failed', 'error');
      }
    })();
  };

  const syncUrlExternal = async () => {
    const url = effectiveImportUrl;
    const platformId = effectiveImportPlatformId;
    const platform = getImportPlatform(platformId);
    const nameOverride = sanitizePlaylistTitle(importName.trim());
    if (!isValidImportPlatformUrl(platformId, url)) {
      setImportMsg(`Enter a valid ${platform.label} playlist URL.`);
      showToast(`Invalid ${platform.label} playlist URL`, 'error');
      return;
    }
    setImportSyncing(true);
    try {
      let metadata: Awaited<ReturnType<typeof fetchExternalPlaylistMetadata>> = {
        validated: false,
      };
      if (nameOverride) {
        setImportMsg('Creating playlist shell…');
        void fetchExternalPlaylistMetadata(platformId, url).then((fetched) => {
          if (!hasUsefulImportMetadata(fetched)) return;
          const existing = findPlaylistBySourceUrl<StoredPlaylist>(loadPlaylists(), platformId, url);
          if (!existing) return;
          const enriched = applyImportedMetadata(existing, platformId, url, fetched, undefined, nameOverride);
          persistPlaylists(
            loadPlaylists().map((pl) => (pl.id === existing.id ? enriched : pl)),
          );
        });
      } else {
        setImportMsg('Fetching playlist metadata…');
        metadata = await fetchExternalPlaylistMetadata(platformId, url);
        if (!hasUsefulImportMetadata(metadata) && !metadata.blocked) {
          setImportMsg('Retrying metadata fetch…');
          metadata = await fetchExternalPlaylistMetadata(platformId, url);
        }
      }

      if (metadata.blocked && !nameOverride) {
        const reason =
          metadata.blockedReason ??
          'This platform did not expose playlist metadata. Enter a playlist name below, or try another public playlist link.';
        setImportMsg(reason);
        showToast(
          platformId === 'tidal'
            ? 'This service blocked metadata — enter playlist name or try another public playlist link'
            : 'Metadata blocked — enter playlist name manually',
          'error',
        );
        return;
      }

      if (!hasUsefulImportMetadata(metadata) && !nameOverride) {
        setImportMsg(
          metadata.blocked
            ? (metadata.blockedReason ??
              'Could not load playlist name — enter it in Playlist name (optional) below.')
            : 'Could not load playlist name from URL — enter it below, or check your Sandbox Server is running.',
        );
        showToast('Metadata fetch failed — enter playlist name or check URL', 'error');
        return;
      }

      const autoMatched: MediaEnvelope[] = matchLockerTracksFromStubs(
        metadata.trackStubs,
        stubMatchPool(),
      );
      const stubTotal = metadata.trackStubs?.length ?? 0;
      if (stubTotal > 0) {
        setImportMatchProgress({ matched: autoMatched.length, total: stubTotal });
      }
      const existing = findPlaylistBySourceUrl<StoredPlaylist>(playlists, platformId, url);
      const id = existing?.id ?? `pl-url-${Date.now()}`;
      const base: StoredPlaylist = existing ?? {
        id,
        name: '',
        description: '',
        tracks: autoMatched,
        pendingImport: false,
      };
      const imported: StoredPlaylist = applyImportedMetadata(
        base,
        platformId,
        url,
        metadata,
        autoMatched,
        nameOverride,
      );
      const nextPlaylists = existing
        ? playlists.map((pl) => (pl.id === existing.id ? imported : pl))
        : [...playlists, imported];
      persistPlaylists(nextPlaylists);
      console.log('[playlist-import]', existing ? 'updated' : 'created', {
        id,
        name: imported.name,
        sourceUrl: imported.sourceUrl,
        stubCount: imported.importTrackStubs?.length ?? 0,
        matchedCount: autoMatched.length,
        validated: metadata.validated,
        tracksUnavailable: metadata.tracksUnavailable,
        blocked: metadata.blocked,
      });
      setImportMsg('');
      setImportUrl('');
      setImportName('');
      clearPlaylistImportDraft();
      const stubCount = metadata.trackStubs?.length ?? 0;
      const toastParts = [
        existing ? `Updated "${imported.name}"` : `Imported "${imported.name}"`,
      ];
      if (stubCount > 0) toastParts.push(`${stubCount} title${stubCount === 1 ? '' : 's'}`);
      if (autoMatched.length > 0) toastParts.push(`${autoMatched.length} matched from Locker`);
      else if (stubCount > 0) toastParts.push('add audio from Locker');
      else if (metadata.tracksUnavailable || metadata.blocked) {
        toastParts.push('track list unavailable — add audio from Locker');
      }
      showToast(toastParts.join(' · '));
      closeConsole();
      window.setTimeout(() => setOpenPlaylistId(id), 0);
      if (isFallbackImportName(imported.name)) {
        window.setTimeout(() => openEdit(imported), 50);
      }
    } catch {
      setImportMsg('Import failed — check the URL and try again.');
      showToast('Could not import playlist — try again', 'error');
    } finally {
      setImportSyncing(false);
      window.setTimeout(() => setImportMatchProgress(null), 1500);
    }
  };

  const syncExternal = async () => {
    if (importUrl.trim()) {
      await syncUrlExternal();
      return;
    }
    setImportMsg(`Paste a ${importPlatform.label} playlist URL to import.`);
  };

  const deletePlaylist = (pl: StoredPlaylist) => {
    if (isSystemLikedPlaylist(pl)) return;
    setConfirmDeletePlaylist(pl);
  };

  const runConfirmedPlaylistDelete = () => {
    if (!confirmDeletePlaylist) return;
    const pl = confirmDeletePlaylist;
    setPlaylists(deletePlaylistById(pl.id));
    if (openPlaylistId === pl.id) setOpenPlaylistId(null);
    setOpenMenuId(null);
    showToast(t('playlists.confirm.deleted'));
    setConfirmDeletePlaylist(null);
  };

  const openShareDialog = (pl: StoredPlaylist) => {
    setShareDialogPlaylist(pl);
    setShareImportSeed(null);
    setOpenMenuId(null);
  };

  const exportPlaylist = async (pl: StoredPlaylist, format: 'json' | 'm3u') => {
    try {
      const result = await shareOrDownloadPlaylist(pl, format);
      if (result === 'shared') showToast('Playlist shared');
      else if (result === 'clipboard') showToast(`${format.toUpperCase()} copied to clipboard`);
      else showToast(`${format.toUpperCase()} downloaded`);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      showToast('Export failed', 'error');
    }
    setOpenMenuId(null);
  };

  const rematchPlaylistFromLocker = async (pl: StoredPlaylist) => {
    setOpenMenuId(null);
    await new Promise((r) => window.setTimeout(r, 50));
    const verifiedLockerTracks: MediaEnvelope[] = [];
    for (const track of lockerTracks) {
      if (track.provider === 'local-vault' && track.sourceId) {
        if (await lockerEntryIsPlayable(track.sourceId)) verifiedLockerTracks.push(track);
      } else {
        verifiedLockerTracks.push(track);
      }
    }
    const stubTotal = pl.importTrackStubs?.length ?? 0;
    if (stubTotal > 0) {
      setImportMatchProgress({ matched: pl.tracks.length, total: stubTotal });
    }
    const { playlist: stubPlaylist, newlyMatched } = rematchPlaylistStubsFromLocker(
      pl,
      verifiedLockerTracks,
    );
    const { playlist, repaired } = await rematchPlaylistTracksFromLocker(stubPlaylist);
    if (stubTotal > 0) {
      setImportMatchProgress({ matched: playlist.tracks.length, total: stubTotal });
    }
    const total = newlyMatched + repaired;
    if (total > 0) {
      persistPlaylists(playlists.map((p) => (p.id === pl.id ? playlist : p)));
      if (newlyMatched > 0 && repaired > 0) {
        showToast(`Matched ${newlyMatched} and repaired ${repaired} locker track${total === 1 ? '' : 's'}`);
      } else if (repaired > 0) {
        showToast(`Repaired ${repaired} locker reference${repaired === 1 ? '' : 's'}`);
      } else {
        showToast(`Matched ${newlyMatched} track${newlyMatched === 1 ? '' : 's'} from Locker`);
      }
    } else {
      showToast('No locker matches with playable audio on this device', 'error');
    }
    window.setTimeout(() => setImportMatchProgress(null), 1200);
  };

  const applySmartReorder = (pl: StoredPlaylist) => {
    if (isSmartPlaylist(pl) || pl.tracks.length < 2) return;
    primePlaylistSonicAnalysis(pl.tracks, 16, ensureSonicAnalysisForEnvelope);
    const reordered = smartReorderPlaylistTracks(pl.tracks);
    setPlaylists(
      reorderPlaylistTracks(
        pl.id,
        reordered.map((t) => t.envelopeId),
      ),
    );
    const detail = smartReorderDetail(pl.tracks);
    showToast(
      detail === 'full'
        ? t('playlists.smartReorder.toastFull')
        : detail === 'bpm'
          ? t('playlists.smartReorder.toastBpm')
          : t('playlists.smartReorder.toastLimited'),
    );
  };

  const toggleDetailTrack = (id: string) => {
    setDetailSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeDetailSelection = (pl: StoredPlaylist) => {
    const count = detailSelectedIds.size;
    if (count === 0) return;
    setPlaylists(removeTracksFromPlaylist(pl.id, [...detailSelectedIds]));
    setDetailSelectedIds(new Set());
    setDetailSelectionMode(false);
    showToast(`Removed ${count} track${count === 1 ? '' : 's'}`);
  };

  const reorderDetailTrack = (pl: StoredPlaylist, fromId: string, toId: string) => {
    if (fromId === toId || isSmartPlaylist(pl)) return;
    const ids = pl.tracks.map((t) => t.envelopeId);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setPlaylists(reorderPlaylistTracks(pl.id, next));
  };

  const addEnhanceTracks = (pl: StoredPlaylist, tracks: MediaEnvelope[]) => {
    if (tracks.length === 0 || isSmartPlaylist(pl)) return;
    setPlaylists(addTracksToPlaylist(pl.id, tracks));
    showToast(`Added ${tracks.length} track${tracks.length === 1 ? '' : 's'}`);
  };

  const handleCoverPick = (pl: StoredPlaylist, file: File | null) => {
    if (!file || isSmartPlaylist(pl)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) return;
      setPlaylists(updatePlaylistCover(pl.id, dataUrl));
      showToast('Cover updated');
    };
    reader.readAsDataURL(file);
  };

  const createFolder = () => {
    const name = folderNameDraft.trim();
    if (!name) return;
    const folder = createPlaylistFolder(name);
    setFolders(loadPlaylistFolders());
    setFolderNameDraft('');
    setShowNewFolder(false);
    setSelectedFolderId(folder.id);
    showToast(`Folder "${folder.name}" created`);
  };

  const openEdit = (pl: StoredPlaylist) => {
    setEditTarget(pl);
    setEditName(displayPlaylistName(pl));
    setEditDesc(pl.description);
    setEditSmartRules(pl.rules ? { ...pl.rules, conditions: [...pl.rules.conditions] } : null);
    setEditLoading(false);
    setOpenMenuId(null);

    if (!needsImportMetadataRefresh(pl)) return;

    const { sourceUrl, importPlatformId } = resolvePlaylistImportContext(pl);
    if (!sourceUrl || !importPlatformId) return;

    setEditLoading(true);
    void (async () => {
      const metadata = await refreshExternalPlaylistMetadata(pl);
      if (!hasUsefulImportMetadata(metadata)) {
        setEditLoading(false);
        return;
      }
      const refreshed = applyMetadataRefresh(pl, metadata!);
      writePlaylists(
        setPlaylists,
        loadPlaylists().map((p) => (p.id === pl.id ? refreshed : p)),
      );
      setEditTarget(refreshed);
      setEditName(refreshed.name);
      setEditDesc(refreshed.description);
      setEditLoading(false);
    })();
  };

  const saveEdit = () => {
    if (!editTarget) return;
    const name = editName.trim();
    if (!name) return;
    const isSmart = isSmartPlaylist(editTarget);
    const nextRules = isSmart && editSmartRules ? editSmartRules : editTarget.rules;
    const rules =
      isSmart && nextRules && editTarget.builtInId && editTarget.builtInParam
        ? applyBuiltInParam(nextRules, editTarget.builtInId, editTarget.builtInParam)
        : nextRules;
    const tracks =
      isSmart && rules
        ? evaluateSmartPlaylistTracks(rules, lockerEntries, getSmartPlaylistPlayHistory())
        : editTarget.tracks;
    if (isSmart && rules) {
      persistPlaylists(
        playlists.map((p) =>
          p.id === editTarget.id
            ? {
                ...p,
                name,
                description: editDesc.trim(),
                rules,
                tracks,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
    } else {
      persistPlaylists(
        playlists.map((p) =>
          p.id === editTarget.id
            ? { ...p, name, description: editDesc.trim(), updatedAt: Date.now() }
            : p,
        ),
      );
    }
    setEditTarget(null);
    setEditSmartRules(null);
    showToast(isSmart ? 'Smart playlist updated' : 'Playlist updated');
  };

  const playPlaylist = (pl: StoredPlaylist, shuffle?: boolean) => {
    if (pl.tracks.length === 0) return;
    if (onPlayAlbum) onPlayAlbum(pl.tracks, shuffle);
    else onPlay(pl.tracks[0]);
    setOpenMenuId(null);
  };

  const queuePlaylistNext = (pl: StoredPlaylist) => {
    if (pl.tracks.length === 0) return;
    if (onPlayNext) onPlayNext(pl.tracks);
    else if (onPlayAlbum) onPlayAlbum(pl.tracks, false);
    else onPlay(pl.tracks[0]);
    setOpenMenuId(null);
    showToast('Queued to play next');
  };

  const addTracksFromLocker = (pl: StoredPlaylist) => {
    setOpenMenuId(null);
    setOpenPlaylistId(pl.id);
  };

  const refreshImport = async (pl: StoredPlaylist) => {
    const { sourceUrl, importPlatformId } = resolvePlaylistImportContext(pl);
    if (!sourceUrl || !importPlatformId) {
      showToast('Could not refresh — missing source URL', 'error');
      return;
    }
    setRefreshingId(pl.id);
    setOpenMenuId(null);
    try {
      const metadata = await refreshExternalPlaylistMetadata(pl);
      if (!hasUsefulImportMetadata(metadata)) {
        showToast('Refresh failed — could not load metadata', 'error');
        return;
      }
      const refreshed = applyMetadataRefresh(pl, metadata!);
      persistPlaylists(playlists.map((p) => (p.id === pl.id ? refreshed : p)));
      if (editTarget?.id === pl.id) {
        setEditTarget(refreshed);
        setEditName(refreshed.name);
        setEditDesc(refreshed.description);
        setEditLoading(false);
      }
      const stubCount = metadata!.trackStubs?.length ?? 0;
      showToast(
        stubCount > 0
          ? `Refreshed "${refreshed.name}" · ${stubCount} titles`
          : `Refreshed "${refreshed.name}"`,
      );
      setOpenPlaylistId(pl.id);
    } catch {
      showToast('Refresh failed — try again', 'error');
    } finally {
      setRefreshingId(null);
    }
  };

  const searchForTracks = (pl: StoredPlaylist) => {
    setOpenMenuId(null);
    setOpenPlaylistId(null);
    const query = playlistTrackSearchQuery(pl);
    const nextStub = unmatchedImportStubs(pl)[0];
    if (onRunSearch) {
      onRunSearch(query);
      onGoToSearch?.();
      showToast(
        nextStub
          ? `Searching for "${nextStub.title}"${nextStub.artist ? ` — ${nextStub.artist}` : ''}`
          : `Searching for "${pl.name}"`,
      );
      return;
    }
    onGoToLocker?.();
    showToast('Open Locker to add tracks');
  };

  const downloadImportedPlaylist = (pl: StoredPlaylist) => {
    if (!onDownloadImportedPlaylist) return;
    const remaining = unmatchedImportStubs(pl).length;
    if (remaining === 0) {
      showToast('All tracks already in Locker');
      return;
    }
    onDownloadImportedPlaylist(pl);
  };

  const goToLockerSingles = () => {
    setOpenPlaylistId(null);
    onGoToLocker?.('singles');
  };

  const renderAddFromLockerLink = (extraClass = '') =>
    onGoToLocker ? (
      <button
        type="button"
        onClick={goToLockerSingles}
        className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-[var(--text-dim)] hover:text-accent touch-manipulation ${extraClass}`.trim()}
      >
        <FolderOpen className="w-3 h-3" />
        Add songs from Locker
      </button>
    ) : null;

  const renderAddFromLockerButton = (label = 'Add tracks from Locker') =>
    onGoToLocker ? (
      <button
        type="button"
        onClick={goToLockerSingles}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg btn-accent font-mono text-xs font-bold uppercase touch-manipulation"
      >
        <FolderOpen className="w-3.5 h-3.5" />
        {label}
      </button>
    ) : null;

  useEffect(() => {
    if (!mobile || !playlistsDrillBackRef) return;
    playlistsDrillBackRef.current = () => {
      if (!openPlaylistId) return false;
      setOpenPlaylistId(null);
      return true;
    };
    return () => {
      playlistsDrillBackRef.current = null;
    };
  }, [mobile, openPlaylistId, playlistsDrillBackRef]);

  return (
    <div className={embedded ? `playlists-embedded${mobile ? ' playlists-mobile' : ''}` : 'locker-page'}>
      <header className={`page-header-row mb-0 ${embedded ? 'justify-end' : ''}`}>
        {!embedded ? (
          <h1 className="font-display text-[1.75rem] font-bold tracking-tight leading-none text-[var(--text)]">
            Playlists
          </h1>
        ) : null}
        <button
          type="button"
          onClick={() => setConsoleOpen(true)}
          className="h-9 px-4 rounded btn-accent text-xs font-semibold touch-manipulation shrink-0"
        >
          New playlist
        </button>
      </header>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-24 left-1/2 -translate-x-1/2 z-[80] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl border shadow-2xl font-mono text-xs font-bold uppercase tracking-wide ${
            toast.tone === 'error'
              ? 'bg-red-950/90 border-red-500/40 text-red-300'
              : 'bg-accent-soft border-accent/30 text-accent'
          }`}
        >
          {toast.text}
        </div>
      )}

      <div className={`${embedded ? 'pt-2 mt-2' : 'pt-4 mt-4'} space-y-6 playlists-list-body`}>
      {playlists.length === 0 ? (
        <p className="font-mono text-xs text-[var(--text-dim)]">Tap New playlist to create your first compilation.</p>
      ) : (
        <>
          <PlaylistPinnedRow
            playlists={pinnedPlaylists}
            title="Pinned playlists"
            onOpen={(pl) => setOpenPlaylistId(pl.id)}
            onUnpin={(id) => {
              unpinPlaylistById(id);
              setPlaylists(loadPlaylists());
            }}
          />

          {folders.length > 0 || showNewFolder ? (
            <div className="playlist-folder-bar">
              <button
                type="button"
                className={`playlist-folder-chip${selectedFolderId == null ? ' is-active' : ''}`}
                onClick={() => setSelectedFolderId(null)}
              >
                All
              </button>
              {folders.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`playlist-folder-chip${selectedFolderId === f.id ? ' is-active' : ''}`}
                  onClick={() => setSelectedFolderId(f.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setRenameFolderTarget(f);
                  }}
                >
                  {f.name}
                </button>
              ))}
              {showNewFolder ? (
                <span className="playlist-folder-new inline-flex items-center gap-1">
                  <input
                    value={folderNameDraft}
                    onChange={(e) => setFolderNameDraft(e.target.value)}
                    placeholder="Folder name"
                    className="input-elevated px-2 py-1 font-mono text-[10px] w-28"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') createFolder();
                      if (e.key === 'Escape') setShowNewFolder(false);
                    }}
                  />
                  <button type="button" className="playlist-folder-chip" onClick={createFolder}>
                    Save
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  className="playlist-folder-chip playlist-folder-chip-add"
                  onClick={() => setShowNewFolder(true)}
                >
                  + Folder
                </button>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="font-mono text-[10px] uppercase text-[var(--text-dim)] hover:text-accent touch-manipulation"
              onClick={() => setShowNewFolder(true)}
            >
              + New folder
            </button>
          )}

          {(autoPlaylists.length > 0 || userSmartPlaylists.length > 0) && (
            <section>
              <div className="flex items-center justify-between gap-2 mb-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-accent">
                  Made for you
                </p>
                <div className="flex items-center gap-2">
                  {smartRefreshing && (
                    <span className="font-mono text-[9px] uppercase text-[var(--text-dim)] animate-pulse">
                      Refreshing…
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={runSmartRefresh}
                    disabled={smartRefreshBusy}
                    className="p-1 rounded-sm border border-slate-700/50 text-[var(--text-dim)] hover:text-accent hover:border-accent/50 disabled:opacity-40 touch-manipulation transition-colors"
                    aria-label="Refresh smart playlists"
                    title="Refresh smart playlists"
                  >
                    <RefreshCw className={`w-3 h-3 ${smartRefreshBusy ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>
              {autoPlaylists.length > 0 && (
                <>
                  <p className="font-mono text-[9px] uppercase text-[var(--text-dim)] mb-2">Auto playlists</p>
                  <ul className="space-y-2 mb-4">{autoPlaylists.map(renderPlaylistRow)}</ul>
                </>
              )}
              {userSmartPlaylists.length > 0 && (
                <>
                  <p className="font-mono text-[9px] uppercase text-[var(--text-dim)] mb-2">Your smart playlists</p>
                  <ul className="space-y-2">{userSmartPlaylists.map(renderPlaylistRow)}</ul>
                </>
              )}
            </section>
          )}
          {manualPlaylists.length > 0 && (
            <section>
              {(autoPlaylists.length > 0 || userSmartPlaylists.length > 0) && (
                <p className="font-mono text-[10px] font-bold uppercase tracking-widest text-[var(--text-dim)] mb-3">
                  Your playlists
                </p>
              )}
              <ul className="space-y-2">{manualPlaylists.map(renderPlaylistRow)}</ul>
            </section>
          )}
        </>
      )}
      </div>

      {consoleOpen &&
        createPortal(
        <div className="playlist-console-overlay">
          <button
            type="button"
            className="absolute inset-0 bg-black/60 backdrop-blur-md"
            aria-label="Close"
            onClick={closeConsole}
          />
          <div
            className="playlist-console-panel relative w-full max-w-3xl overflow-y-auto music-scrollbar rounded-sm panel-accent-border p-5 sm:p-8 bg-[var(--bg-card)]"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent mb-1">
              — Your playlists
            </p>
            <h3 className="font-display text-2xl font-black uppercase mb-2">Playlist Console</h3>
            <p className="font-mono text-[11px] text-[var(--text-mid)] mb-6 leading-relaxed">
              Craft compilations from your Locker, generate AI-curated blocks, or import playlist
              structure from a streaming URL into a local shell.
            </p>

            <div className="flex flex-wrap gap-2 mb-6 pb-6 border-b border-[var(--border)]">
              <PillTab active={consoleTab === 'manual'} label="Custom Compiler" onClick={() => setConsoleTab('manual')} />
              <PillTab active={consoleTab === 'smart'} label="Smart Playlist" onClick={() => setConsoleTab('smart')} />
              <PillTab active={consoleTab === 'ai'} label="Smart Filter" onClick={() => setConsoleTab('ai')} />
              <PillTab active={consoleTab === 'external'} label="External Transfer" onClick={() => setConsoleTab('external')} />
            </div>

            {consoleTab === 'manual' && (
              <div className="space-y-4 border border-[var(--border)] rounded-sm p-4 bg-[#06080f]">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent">Custom Compiler</p>
                <p className="font-mono text-xs font-bold uppercase text-slate-300">Manual Creator</p>
                <p className="font-mono text-[10px] text-[var(--text-mid)]">
                  Build a playlist from tracks you add here. Your Locker uploads are not listed
                  automatically — search by title, artist, or album to add them one at a time.
                </p>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">Playlist compilation title</label>
                <input
                  value={plTitle}
                  onChange={(e) => setPlTitle(e.target.value)}
                  placeholder="Enter playlist name…"
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                />
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">Description (optional)</label>
                <input
                  value={plDesc}
                  onChange={(e) => setPlDesc(e.target.value)}
                  placeholder="Enter playlist description…"
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                />
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Tracks in this playlist ({compileQueueTracks.length})
                </label>
                {compileQueueTracks.length === 0 ? (
                  <p className="font-mono text-[10px] text-[var(--text-mid)] py-2 border border-dashed border-[var(--border)] rounded-lg px-3">
                    No tracks yet. Search your Locker below and tap Add on each track you want.
                  </p>
                ) : (
                  <ul className="max-h-40 overflow-y-auto music-scrollbar space-y-0.5 border border-[var(--border)] rounded-lg p-2 bg-[var(--bg-void)]">
                    {compileQueueTracks.map((t) => {
                      const { title, artist } = compileTrackLabel(t);
                      return (
                        <li key={t.envelopeId}>
                          <div className="flex items-center gap-2 font-mono text-[10px] py-1 px-1 rounded hover:bg-white/[0.03]">
                            <span className="min-w-0 flex-1 truncate">
                              <span className="text-[var(--text)]">{title}</span>
                              {artist ? (
                                <span className="text-[var(--text-dim)]"> — {artist}</span>
                              ) : null}
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleTrack(t.envelopeId)}
                              className="shrink-0 p-1 rounded text-[var(--text-dim)] hover:text-red-400 touch-manipulation"
                              aria-label={`Remove ${title}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Search Locker to add tracks
                </label>
                {compilePool.length === 0 ? (
                  <p className="font-mono text-[10px] text-[var(--text-mid)] py-3">
                    Upload tracks in the Locker station first, then return here to search and add them.
                  </p>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-dim)]" />
                      <input
                        value={compileSearch}
                        onChange={(e) => setCompileSearch(e.target.value)}
                        placeholder="Search title, artist, or album…"
                        className="input-elevated w-full pl-9 pr-4 py-3 font-mono text-[10px] focus-accent"
                      />
                    </div>
                    {!compileSearch.trim() ? (
                      <p className="font-mono text-[10px] text-[var(--text-dim)] py-1">
                        Type to search your Locker — results appear here; nothing is listed until you search.
                      </p>
                    ) : compileSearchResults.length === 0 ? (
                      <p className="font-mono text-[10px] text-[var(--text-mid)] py-3">
                        No locker tracks match &ldquo;{compileSearch.trim()}&rdquo; in title, artist, or
                        album.
                      </p>
                    ) : (
                      <ul className="max-h-48 overflow-y-auto music-scrollbar space-y-0.5 border border-[var(--border)] rounded-lg p-2 bg-[var(--bg-void)]">
                        {compileSearchResults.map((t) => {
                          const { title, artist } = compileTrackLabel(t);
                          const matchHint = compileTrackMatchHint(
                            compileTrackMatchFields(t, compileSearch),
                          );
                          return (
                            <li key={t.envelopeId}>
                              <div className="flex items-center gap-2 font-mono text-[10px] py-1 px-1 rounded hover:bg-white/[0.03]">
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="text-[var(--text)]">{title}</span>
                                  {artist ? (
                                    <span className="text-[var(--text-dim)]"> — {artist}</span>
                                  ) : null}
                                </span>
                                {matchHint ? (
                                  <span
                                    className="shrink-0 text-[8px] uppercase tracking-wide text-accent/80 hidden sm:inline"
                                    title={matchHint}
                                  >
                                    {matchHint}
                                  </span>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => toggleTrack(t.envelopeId)}
                                  className="shrink-0 flex items-center gap-1 px-2 py-1 rounded border border-accent/40 text-accent text-[9px] uppercase font-bold hover:bg-accent-soft touch-manipulation"
                                >
                                  <Plus className="w-3 h-3" />
                                  Add
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </>
                )}
                <button type="button" onClick={createManual} className="w-full py-3 rounded-lg btn-accent font-mono text-xs font-bold uppercase touch-manipulation">
                  Compile Playlist
                </button>
              </div>
            )}

            {consoleTab === 'smart' && (
              <div className="space-y-4 border border-[var(--border)] rounded-sm p-4 bg-[#06080f]">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent">
                  Smart Playlist Engine
                </p>
                <p className="font-mono text-[10px] text-[var(--text-mid)]">
                  Dynamically generated from locker metadata and play history. Track lists refresh
                  automatically when your library or listening habits change — read-only (no manual adds).
                </p>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Playlist name (optional for templates)
                </label>
                <input
                  value={smartTitle}
                  onChange={(e) => setSmartTitle(e.target.value)}
                  placeholder="Leave blank to use template name…"
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                />
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">
                  Description (optional)
                </label>
                <input
                  value={smartDesc}
                  onChange={(e) => setSmartDesc(e.target.value)}
                  placeholder="Optional description…"
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                />
                <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400 pt-2">
                  Built-in templates
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {optionalBuiltInTemplates.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => {
                        setSelectedBuiltIn(preset.id);
                        if (!preset.requiresParam) void createFromBuiltIn(preset.id);
                      }}
                      className={`py-2 px-2 font-mono text-[9px] uppercase border rounded-lg touch-manipulation text-left ${
                        selectedBuiltIn === preset.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-[var(--border)] hover:border-accent/50'
                      }`}
                    >
                      <span className="block font-bold">{preset.name}</span>
                      <span className="block text-[var(--text-dim)] normal-case mt-0.5 line-clamp-2">
                        {preset.description}
                      </span>
                    </button>
                  ))}
                </div>
                {selectedBuiltIn && (() => {
                  const preset = optionalBuiltInTemplates.find((p) => p.id === selectedBuiltIn);
                  if (!preset?.requiresParam) return null;
                  return (
                    <div className="space-y-2 border border-accent/30 rounded-lg p-3 bg-accent-soft/20">
                      <label className="block font-mono text-[10px] font-bold uppercase text-accent">
                        {preset.paramLabel}
                      </label>
                      <input
                        value={builtInParam}
                        onChange={(e) => setBuiltInParam(e.target.value)}
                        placeholder={preset.paramPlaceholder}
                        className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      />
                      <button
                        type="button"
                        onClick={() => createFromBuiltIn(selectedBuiltIn)}
                        disabled={!builtInParam.trim()}
                        className="w-full py-2 rounded-lg btn-accent font-mono text-[10px] font-bold uppercase disabled:opacity-40 touch-manipulation"
                      >
                        Create {preset.name}
                      </button>
                    </div>
                  );
                })()}
                <div className="border-t border-[var(--border)] pt-4 space-y-3">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">
                    Custom rules
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] uppercase text-[var(--text-dim)]">
                      Match
                    </span>
                    <select
                      value={smartRules.conditionLogic ?? 'and'}
                      onChange={(e) =>
                        setSmartRules((prev) => ({
                          ...prev,
                          conditionLogic: e.target.value as SmartConditionLogic,
                        }))
                      }
                      className="input-elevated px-2 py-1.5 font-mono text-[10px] focus-accent"
                    >
                      <option value="and">All conditions (AND)</option>
                      <option value="or">Any condition (OR)</option>
                    </select>
                  </div>
                  {smartRules.conditions.map((rule) => (
                    <div key={rule.id} className="flex flex-wrap gap-2 items-center">
                      <select
                        value={rule.field}
                        onChange={(e) => {
                          const field = e.target.value as SmartRuleField;
                          updateSmartRule(rule.id, {
                            field,
                            operator: operatorsForField(field)[0],
                            value: field === 'playCount' ? 1 : '',
                          });
                        }}
                        className="input-elevated px-2 py-2 font-mono text-[10px] focus-accent"
                      >
                        {SMART_RULE_FIELDS.map((f) => (
                          <option key={f.field} value={f.field}>{f.label}</option>
                        ))}
                      </select>
                      <select
                        value={rule.operator}
                        onChange={(e) =>
                          updateSmartRule(rule.id, { operator: e.target.value as SmartRuleOperator })
                        }
                        className="input-elevated px-2 py-2 font-mono text-[10px] focus-accent"
                      >
                        {operatorsForField(rule.field).map((op) => (
                          <option key={op} value={op}>{op}</option>
                        ))}
                      </select>
                      <input
                        value={String(rule.value)}
                        onChange={(e) => {
                          const fieldMeta = SMART_RULE_FIELDS.find((f) => f.field === rule.field);
                          const value =
                            fieldMeta?.type === 'number'
                              ? Number(e.target.value) || 0
                              : e.target.value;
                          updateSmartRule(rule.id, { value });
                        }}
                        placeholder="Value…"
                        className="input-elevated flex-1 min-w-[6rem] px-3 py-2 font-mono text-[10px] focus-accent"
                      />
                      <button
                        type="button"
                        onClick={() => removeSmartRule(rule.id)}
                        className="p-2 text-[var(--text-dim)] hover:text-red-400 touch-manipulation"
                        aria-label="Remove rule"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() =>
                      setSmartRules((prev) => ({
                        ...prev,
                        conditions: [...prev.conditions, newSmartRule()],
                      }))
                    }
                    className="font-mono text-[10px] uppercase text-accent hover:underline touch-manipulation"
                  >
                    + Add condition
                  </button>
                  <div className="flex flex-wrap gap-2">
                    <select
                      value={smartRules.sortBy ?? 'title'}
                      onChange={(e) =>
                        setSmartRules((prev) => ({
                          ...prev,
                          sortBy: e.target.value as SmartPlaylistRules['sortBy'],
                        }))
                      }
                      className="input-elevated px-2 py-2 font-mono text-[10px] focus-accent"
                    >
                      <option value="title">Sort: Title</option>
                      <option value="artist">Sort: Artist</option>
                      <option value="dateAdded">Sort: Date added</option>
                      <option value="playCount">Sort: Play count</option>
                      <option value="lastPlayed">Sort: Last played</option>
                    </select>
                    <select
                      value={smartRules.sortDirection ?? 'asc'}
                      onChange={(e) =>
                        setSmartRules((prev) => ({
                          ...prev,
                          sortDirection: e.target.value as 'asc' | 'desc',
                        }))
                      }
                      className="input-elevated px-2 py-2 font-mono text-[10px] focus-accent"
                    >
                      <option value="asc">Ascending</option>
                      <option value="desc">Descending</option>
                    </select>
                    <input
                      type="number"
                      min={0}
                      value={smartRules.limit ?? ''}
                      onChange={(e) =>
                        setSmartRules((prev) => ({
                          ...prev,
                          limit: e.target.value ? Number(e.target.value) : undefined,
                        }))
                      }
                      placeholder="Limit (optional)"
                      className="input-elevated w-28 px-3 py-2 font-mono text-[10px] focus-accent"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={createCustomSmart}
                    className="w-full py-3 rounded-lg btn-accent font-mono text-xs font-bold uppercase touch-manipulation"
                  >
                    Create Custom Smart Playlist
                  </button>
                </div>
              </div>
            )}

            {consoleTab === 'ai' && (
              <div className="space-y-4 border border-[var(--border)] rounded-sm p-4 bg-[#06080f]">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent">Prompted playlist</p>
                <p className="font-mono text-xs font-bold uppercase text-slate-300">Describe a vibe</p>
                <p className="font-mono text-[10px] text-[var(--text-mid)]">
                  Describe mood, genre, or energy. Sandbox builds a smart playlist from your Locker
                  using metadata and sonic analysis — offline, no cloud AI.
                </p>
                <label className="block font-mono text-[10px] font-bold uppercase tracking-wide text-slate-400">Vibe prompt</label>
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={4}
                  placeholder="e.g., Chill lofi hip-hop sunset with deep bass grooves…"
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent resize-none"
                />
                {aiStatus && <p className="font-mono text-[10px] text-accent">{aiStatus}</p>}
                <button
                  type="button"
                  onClick={runAiCuration}
                  disabled={!aiPrompt.trim()}
                  className="w-full py-3 rounded-lg bg-accent-muted text-text-on-accent font-mono text-xs font-bold uppercase disabled:opacity-40 touch-manipulation"
                >
                  Create vibe playlist
                </button>
              </div>
            )}

            {consoleTab === 'external' && (
              <div className="space-y-4 border border-[var(--border)] rounded-sm p-4 bg-[#06080f]">
                <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-accent flex items-center gap-1">
                  <Download className="w-3 h-3" /> External Transfer
                </p>
                <p className="font-mono text-xs font-bold uppercase text-slate-300">Import Playlist Shell</p>
                <p className="font-mono text-[10px] text-[var(--text-mid)]">
                  Paste a playlist URL to extract its name and structure into a local shell. Add your own
                  tracks from Locker — no platform connection required.
                </p>
                <div className="grid grid-cols-3 gap-2 max-h-36 overflow-y-auto music-scrollbar pr-0.5">
                  {IMPORT_PLATFORMS.map((platform) => (
                    <button
                      key={platform.id}
                      type="button"
                      onClick={() => setImportPlatformId(platform.id)}
                      className={`py-2 px-1 font-mono text-[9px] uppercase border rounded-lg touch-manipulation truncate ${
                        importPlatformId === platform.id
                          ? 'border-accent bg-accent-soft'
                          : 'border-[var(--border)]'
                      }`}
                    >
                      {platform.label}
                    </button>
                  ))}
                </div>
                <input
                  {...imeUrlInputProps}
                  value={importUrl}
                  onChange={(e) => {
                    setImportUrl(e.target.value);
                    if (importMsg) setImportMsg('');
                  }}
                  onPaste={(e) => {
                    const pasted = e.clipboardData.getData('text');
                    const resolved = extractFirstImportUrlFromText(pasted);
                    if (!resolved) return;
                    e.preventDefault();
                    setImportUrl(resolved.url);
                    setImportPlatformId(resolved.platformId);
                    if (importMsg) setImportMsg('');
                  }}
                  placeholder={importPlatform.urlPlaceholder}
                  className={`input-elevated w-full px-4 py-3 font-mono text-xs focus-accent ${
                    importUrl.trim() && !importUrlReady
                      ? 'border-red-500/50'
                      : importUrlReady
                        ? 'border-[#C2410C] ring-1 ring-[#C2410C]'
                        : ''
                  }`}
                />
                <input
                  {...imeTextInputProps}
                  value={importName}
                  onChange={(e) => {
                    setImportName(e.target.value);
                    if (importMsg) setImportMsg('');
                  }}
                  placeholder="Playlist name (optional — use if fetch fails)"
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                />
                {importMsg && <p className="font-mono text-[10px] text-accent">{importMsg}</p>}
                {(importSyncing || importMatchProgress) && importMatchProgress && importMatchProgress.total > 0 && (
                  <div>
                    <p className="font-mono text-[9px] text-[var(--text-dim)] uppercase mb-1">
                      Locker match {importMatchProgress.matched}/{importMatchProgress.total}
                    </p>
                    <div className="playlist-import-progress">
                      <div
                        className="playlist-import-progress-fill"
                        style={{
                          width: `${Math.min(100, (importMatchProgress.matched / importMatchProgress.total) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void syncExternal()}
                  disabled={!importCanProceed}
                  className={`w-full py-3 rounded-lg font-mono text-xs font-bold uppercase touch-manipulation transition-all ${
                    importCanProceed
                      ? 'btn-accent ring-2 ring-[var(--accent-stroke)] station-rail-glow'
                      : 'bg-accent-muted opacity-40 cursor-not-allowed'
                  }`}
                >
                  {importSyncing ? 'Importing…' : 'Import Playlist'}
                </button>
              </div>
            )}
          </div>
        </div>,
        document.body,
      )}

      <AddToPlaylistPicker
        open={addToPlaylistTracks !== null}
        onClose={() => setAddToPlaylistTracks(null)}
        tracks={addToPlaylistTracks ?? []}
        onDone={(msg) => showToast(msg)}
      />

      <ModalOverlay
        open={editTarget !== null}
        onClose={() => {
          setEditTarget(null);
          setEditSmartRules(null);
        }}
        title={editTarget && isSmartPlaylist(editTarget) ? 'Edit smart playlist' : 'Edit playlist'}
        maxWidth="max-w-md"
        borderAccent
      >
        <div className="p-4 space-y-4">
          {editLoading && (
            <p className="font-mono text-[10px] text-accent uppercase">
              Loading playlist metadata…
            </p>
          )}
          {editTarget && isSmartPlaylist(editTarget) && editSmartRules && (
            <p className="font-mono text-[10px] text-[var(--text-mid)] border border-[var(--border)] rounded-lg p-3">
              Smart playlist — tracks are auto-generated and read-only. Edit rules below; pinning
              exceptions may be added in a future release.
            </p>
          )}
          <label className="block text-sm font-medium text-slate-400">
            Playlist name
          </label>
          <input
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            disabled={editLoading}
            placeholder="Enter playlist name…"
            className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent disabled:opacity-50"
          />
          <label className="block text-sm font-medium text-slate-400">
            Description (optional)
          </label>
          <input
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
            disabled={editLoading}
            placeholder="Enter playlist description…"
            className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent disabled:opacity-50"
          />
          {editTarget && resolvePlaylistImportContext(editTarget).sourceUrl && (
            <a
              href={resolvePlaylistImportContext(editTarget).sourceUrl ?? '#'}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-[var(--text-dim)] hover:text-accent"
            >
              <ExternalLink className="w-3 h-3" />
              View original
            </a>
          )}
          {editTarget &&
            isSmartPlaylist(editTarget) &&
            editSmartRules &&
            !isCoreBuiltInSmartPlaylist(editTarget.builtInId) && (
            <div className="space-y-2 border border-[var(--border)] rounded-lg p-3">
              <p className="font-mono text-[10px] font-bold uppercase text-slate-400">Rules</p>
              {editSmartRules.conditions.map((rule) => (
                <div key={rule.id} className="flex flex-wrap gap-2 items-center">
                  <select
                    value={rule.field}
                    onChange={(e) => {
                      const field = e.target.value as SmartRuleField;
                      setEditSmartRules((prev) =>
                        prev
                          ? {
                              ...prev,
                              conditions: prev.conditions.map((r) =>
                                r.id === rule.id
                                  ? {
                                      ...r,
                                      field,
                                      operator: operatorsForField(field)[0],
                                      value: field === 'playCount' ? 1 : '',
                                    }
                                  : r,
                              ),
                            }
                          : prev,
                      );
                    }}
                    className="input-elevated px-2 py-2 font-mono text-[10px] focus-accent"
                  >
                    {SMART_RULE_FIELDS.map((f) => (
                      <option key={f.field} value={f.field}>{f.label}</option>
                    ))}
                  </select>
                  <select
                    value={rule.operator}
                    onChange={(e) =>
                      setEditSmartRules((prev) =>
                        prev
                          ? {
                              ...prev,
                              conditions: prev.conditions.map((r) =>
                                r.id === rule.id
                                  ? { ...r, operator: e.target.value as SmartRuleOperator }
                                  : r,
                              ),
                            }
                          : prev,
                      )
                    }
                    className="input-elevated px-2 py-2 font-mono text-[10px] focus-accent"
                  >
                    {operatorsForField(rule.field).map((op) => (
                      <option key={op} value={op}>{op}</option>
                    ))}
                  </select>
                  <input
                    value={String(rule.value)}
                    onChange={(e) => {
                      const fieldMeta = SMART_RULE_FIELDS.find((f) => f.field === rule.field);
                      const value =
                        fieldMeta?.type === 'number' ? Number(e.target.value) || 0 : e.target.value;
                      setEditSmartRules((prev) =>
                        prev
                          ? {
                              ...prev,
                              conditions: prev.conditions.map((r) =>
                                r.id === rule.id ? { ...r, value } : r,
                              ),
                            }
                          : prev,
                      );
                    }}
                    className="input-elevated flex-1 min-w-[5rem] px-3 py-2 font-mono text-[10px] focus-accent"
                  />
                </div>
              ))}
              <p className="font-mono text-[9px] text-[var(--text-dim)]">
                {describeSmartPlaylistRules(
                  editSmartRules,
                  editTarget.builtInId,
                  editTarget.builtInParam,
                )}
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={saveEdit}
            disabled={!editName.trim() || editLoading}
            className="w-full py-3 rounded-lg btn-accent font-mono text-xs font-bold uppercase disabled:opacity-40 touch-manipulation"
          >
            Save changes
          </button>
        </div>
      </ModalOverlay>

      <ModalOverlay
        open={Boolean(openPlaylist)}
        onClose={() => setOpenPlaylistId(null)}
        title={mobile ? undefined : openPlaylist ? displayPlaylistName(openPlaylist) : undefined}
        maxWidth={mobile ? 'max-w-none' : 'max-w-lg'}
        overlayClassName={mobile ? 'playlists-mobile-modal-overlay' : ''}
        panelClassName={mobile ? 'playlists-mobile-modal-panel' : ''}
        contentClassName={mobile ? 'playlists-mobile-modal-content' : ''}
        contentPadding={!mobile}
      >
        {mobile && openPlaylist ? (
          <header className="mobile-shell-toolbar playlists-mobile-modal-toolbar">
            <MobileShellBackButton onClick={() => setOpenPlaylistId(null)} />
            <h1 className="mobile-shell-toolbar-title">{displayPlaylistName(openPlaylist)}</h1>
          </header>
        ) : null}
        {openPlaylist ? (
          (() => {
            const stubs = openPlaylist.importTrackStubs ?? [];
            const hasStubs = stubs.length > 0;
            const hasTracks = openPlaylist.tracks.length > 0;
            const unmatchedStubs = unmatchedImportStubs(openPlaylist);
            const unmatchedStubCount = unmatchedStubs.length;
            const isShell = isImportedShellWithoutTracks(openPlaylist);
            const isImported = isImportedPlaylist(openPlaylist);
            const isSmart = isSmartPlaylist(openPlaylist);
            const showDownloadToLocker =
              isImported && hasStubs && unmatchedStubCount > 0 && Boolean(onDownloadImportedPlaylist);
            const showPrepareForOffline =
              Boolean(onPrepareForTravel) && hasTracks && !showDownloadToLocker;
            const platformLabel = openPlaylist.importPlatformId
              ? getImportPlatform(openPlaylist.importPlatformId).label
              : null;
            const cover = playlistCoverUrl(openPlaylist);
            const plName = displayPlaylistName(openPlaylist);
            const enhanceSuggestions =
              !isSmart && hasTracks && showEnhancePanel
                ? suggestPlaylistEnhancements(openPlaylist, lockerTracks)
                : [];
            const leavePlaylistAfterPlay = () => {
              if (!mobile) setOpenPlaylistId(null);
            };
            const activeDownloadJob = findPlaylistDownloadJob(openPlaylist.id);
            const isPlaylistDownloading = Boolean(activeDownloadJob);
            const detailHeader = (
              <div className={mobile ? 'playlists-detail-header' : 'playlists-detail-sticky'}>
                <div className="flex gap-3 items-start">
                  <div className="relative shrink-0">
                    {cover ? (
                      <img
                        src={cover}
                        alt=""
                        className="w-20 h-20 rounded-lg object-cover border border-[var(--border)]"
                      />
                    ) : (
                      <div
                        className="w-20 h-20 rounded-lg border border-[var(--border)]"
                        style={{ background: seedGradient(plName) }}
                      />
                    )}
                    {!isSmart && (
                      <>
                        <button
                          type="button"
                          className="absolute -bottom-1 -right-1 p-1 rounded-full bg-[var(--bg-card)] border border-[var(--border)] text-accent touch-manipulation"
                          aria-label="Change cover"
                          onClick={() => coverInputRef.current?.click()}
                        >
                          <ImagePlus className="w-3 h-3" />
                        </button>
                        <input
                          ref={coverInputRef}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            handleCoverPick(openPlaylist, e.target.files?.[0] ?? null);
                            e.target.value = '';
                          }}
                        />
                      </>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    {openPlaylist.importCreator && (
                      <p className="font-mono text-[10px] text-[var(--text-dim)] uppercase">
                        {openPlaylist.importCreator}
                      </p>
                    )}
                    <p className="font-mono text-[10px] text-[var(--text-mid)] mt-0.5">
                      {formatPlaylistDisplayStatus(openPlaylist)}
                    </p>
                    {isSmart && openPlaylist.rules?.extensions?.aiPrompt && (
                      <p className="font-mono text-[9px] text-accent/90 mt-1 normal-case">
                        Why: {describeAiPromptRules(openPlaylist.rules.extensions.aiPrompt)}
                      </p>
                    )}
                    {isSmart && openPlaylist.rules && !openPlaylist.rules.extensions?.aiPrompt && (
                      <p className="font-mono text-[9px] text-accent mt-1 uppercase">
                        Auto-refresh · read-only track list
                      </p>
                    )}
                    {platformLabel && (
                      <p className="font-mono text-[9px] text-accent mt-1 uppercase">
                        Imported from {platformLabel}
                      </p>
                    )}
                    {refreshingId === openPlaylist.id && (
                      <p className="font-mono text-[9px] text-accent mt-1">Refreshing metadata…</p>
                    )}
                    {importMatchProgress && hasStubs && (
                      <p className="font-mono text-[9px] text-accent mt-1">
                        Locker match {importMatchProgress.matched}/{importMatchProgress.total}
                      </p>
                    )}
                  </div>
                </div>
                {showDownloadToLocker ? (
                  <div className="playlists-detail-play-row flex-col items-stretch gap-2">
                    <button
                      type="button"
                      className="playlists-detail-play-btn touch-manipulation w-full"
                      disabled={isPlaylistDownloading}
                      onClick={() => void downloadImportedPlaylist(openPlaylist)}
                    >
                      <Download className="w-4 h-4" />
                      {isPlaylistDownloading
                        ? 'Downloading…'
                        : `Download to Locker (${unmatchedStubCount})`}
                    </button>
                    {activeDownloadJob ? (
                      <PlaylistDownloadProgressBar job={activeDownloadJob} />
                    ) : null}
                  </div>
                ) : null}
                {hasTracks ? (
                  <div className="playlists-detail-play-row">
                    <button
                      type="button"
                      className="playlists-detail-play-btn touch-manipulation"
                      onClick={() => {
                        playPlaylist(openPlaylist, false);
                        leavePlaylistAfterPlay();
                      }}
                    >
                      <Play className="w-4 h-4" />
                      Play
                    </button>
                    <button
                      type="button"
                      className="playlists-detail-play-btn touch-manipulation"
                      onClick={() => {
                        playPlaylist(openPlaylist, true);
                        leavePlaylistAfterPlay();
                      }}
                    >
                      <Shuffle className="w-4 h-4" />
                      Shuffle
                    </button>
                  </div>
                ) : null}
              </div>
            );
            const detailToolbar =
              hasTracks && !isSmart ? (
                <div className="flex flex-wrap gap-2 mb-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDetailSelectionMode((v) => !v);
                      setDetailSelectedIds(new Set());
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border)] font-mono text-[9px] uppercase touch-manipulation"
                  >
                    <CheckSquare className="w-3 h-3" />
                    {detailSelectionMode ? 'Cancel' : 'Select'}
                  </button>
                  {detailSelectionMode && detailSelectedIds.size > 0 && (
                    <button
                      type="button"
                      onClick={() => removeDetailSelection(openPlaylist)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-500/40 text-red-300 font-mono text-[9px] uppercase touch-manipulation"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove ({detailSelectedIds.size})
                    </button>
                  )}
                  {openPlaylist.tracks.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => applySmartReorder(openPlaylist)}
                      title={smartReorderCoverageHint(openPlaylist.tracks) ?? undefined}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border)] font-mono text-[9px] uppercase touch-manipulation hover:border-accent"
                    >
                      <ArrowUpDown className="w-3 h-3" />
                      {t('playlists.smartReorder.label')}
                    </button>
                  )}
                  {lockerTracks.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setShowEnhancePanel((v) => !v)}
                      className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border font-mono text-[9px] uppercase touch-manipulation ${
                        showEnhancePanel
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-[var(--border)] hover:border-accent'
                      }`}
                    >
                      Enhance playlist
                    </button>
                  )}
                  {(hasStubs || openPlaylist.tracks.some(envelopeClaimsLocker)) && (
                    <button
                      type="button"
                      onClick={() => void rematchPlaylistFromLocker(openPlaylist)}
                      className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-[var(--border)] font-mono text-[9px] uppercase touch-manipulation hover:border-accent"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Match locker
                    </button>
                  )}
                </div>
              ) : null;

            if (!hasTracks && !hasStubs) {
              return (
            <div className="space-y-4">
              {detailHeader}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-void)] p-4">
                  <>
                    <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-2">
                      {isImported ? 'Imported playlist' : 'Empty playlist'}
                    </p>
                    <p className="font-mono text-[11px] text-[var(--text-mid)] leading-relaxed">
                      {isSmart
                        ? 'No locker tracks match these rules yet. Upload matching audio or edit the smart rules.'
                        : isImported && openPlaylist.importPlatformId === 'tidal' && openPlaylist.importMetadataBlocked
                          ? 'This service blocked public metadata for this playlist (private or region-locked). Edit the name below, try the same playlist from another source, or add matching audio from Locker.'
                          : isImported && openPlaylist.importPlatformId === 'tidal'
                            ? 'Could not load the track list for this playlist on this device. Add tracks from Locker, try another public playlist link, or set a Sandbox Server URL in Settings → Addons for richer imports.'
                            : isImported
                            ? 'Playlist imported — track titles unavailable. Add audio from Locker or search.'
                            : 'No tracks yet — add from Locker or search.'}
                    </p>
                    {isImported && (
                      <button
                        type="button"
                        onClick={() => openEdit(openPlaylist)}
                        className="mt-3 font-mono text-[10px] uppercase text-accent hover:underline touch-manipulation"
                      >
                        Edit playlist name
                      </button>
                    )}
                  </>
              </div>
              {(openPlaylist.sourceUrl ?? parseSourceUrlFromDescription(openPlaylist.description)) && (
                <a
                  href={openPlaylist.sourceUrl ?? parseSourceUrlFromDescription(openPlaylist.description) ?? '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-[var(--text-dim)] hover:text-accent"
                >
                  <ExternalLink className="w-3 h-3" />
                  View original
                </a>
              )}
              {!isSmart && !isImported && (
                <div className="flex flex-col gap-2">
                  {renderAddFromLockerButton()}
                </div>
              )}
              {!isSmart && isImported && renderAddFromLockerLink('mt-2')}
            </div>
              );
            }

            if (!hasTracks && hasStubs) {
              const shellActions = (
                <>
                  {(onGoToSearch ?? onRunSearch) && (
                    <button
                      type="button"
                      onClick={() => searchForTracks(openPlaylist)}
                      className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-accent font-mono text-xs font-bold uppercase text-accent touch-manipulation hover:bg-accent-soft"
                    >
                      <Search className="w-3.5 h-3.5" />
                      Search for tracks
                    </button>
                  )}
                  {!isImported && renderAddFromLockerButton('Add songs from Locker')}
                  {isImported && renderAddFromLockerLink('self-center py-1')}
                </>
              );
              return (
            <div className={mobile ? 'flex flex-col flex-1 min-h-0' : undefined}>
              <div className={mobile ? 'playlists-mobile-detail-scroll space-y-4' : 'space-y-4'}>
              {detailHeader}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-void)] p-4">
                {isImportedShellWithoutTracks(openPlaylist) ? (
                  <>
                    <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-2">
                      Imported
                    </p>
                    <p className="font-mono text-[11px] text-[var(--text-mid)] leading-relaxed">
                      {openPlaylist.importTrackStubs?.length
                        ? `${openPlaylist.importTrackStubs.length} track title${openPlaylist.importTrackStubs.length === 1 ? '' : 's'} imported. Use Download to Locker to save audio to Singles.`
                        : 'Playlist imported — use Download to Locker or search for tracks.'}
                    </p>
                    {(openPlaylist.sourceUrl ?? parseSourceUrlFromDescription(openPlaylist.description)) && (
                      <a
                        href={openPlaylist.sourceUrl ?? parseSourceUrlFromDescription(openPlaylist.description) ?? '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-[var(--text-dim)] hover:text-accent mt-3"
                      >
                        <ExternalLink className="w-3 h-3" />
                        View original
                      </a>
                    )}
                  </>
                ) : (
                  <>
                    <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-2">
                      Empty playlist
                    </p>
                    <p className="font-mono text-[11px] text-[var(--text-mid)] leading-relaxed">
                      No tracks yet — add from Locker or search.
                    </p>
                  </>
                )}
              </div>
              {openPlaylist.importTrackStubs && openPlaylist.importTrackStubs.length > 0 && (
                <ul
                  className={
                    mobile
                      ? 'space-y-1 rounded-xl border border-[var(--border)] p-2'
                      : 'max-h-56 overflow-y-auto music-scrollbar space-y-1 rounded-xl border border-[var(--border)] p-2'
                  }
                >
                  {openPlaylist.importTrackStubs.map((stub, i) => (
                    <li
                      key={`${stub.title}-${i}`}
                      className="px-2 py-1.5 rounded-lg border border-dashed border-[var(--border)] font-mono text-[10px] uppercase text-[var(--text-mid)]"
                    >
                      <span className="text-[var(--text-dim)] mr-2">{i + 1}.</span>
                      {stub.title}
                      {stub.artist ? (
                        <span className="text-[var(--text-dim)] normal-case"> — {stub.artist}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              </div>
              {mobile ? (
                <div className="playlists-mobile-detail-actions">{shellActions}</div>
              ) : (
                <div className="flex flex-col gap-2">{shellActions}</div>
              )}
            </div>
              );
            }

            const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
            const matchedKeys = new Set(
              openPlaylist.tracks.map((t) => `${normalize(t.title)}|${normalize(t.artist)}`),
            );
            const unmatchedStubsInList = stubs.filter((stub) => {
              const key = `${normalize(stub.title)}|${normalize(stub.artist ?? '')}`;
              return !matchedKeys.has(key);
            });

            return mobile ? (
              <div className="flex flex-col flex-1 min-h-0">
                <div className="playlists-mobile-detail-scroll space-y-3">
                  {detailHeader}
                  {detailToolbar}
                  {isShell && hasStubs && (
                    <p className="font-mono text-[10px] text-[var(--text-mid)]">
                      {stubs.length} imported title{stubs.length === 1 ? '' : 's'}
                      {hasTracks ? ` · ${openPlaylist.tracks.length} with audio` : ''}
                    </p>
                  )}
                  {hasTracks && (
                    <>
                      {showEnhancePanel && enhanceSuggestions.length > 0 ? (
                        <div className="playlists-enhance-panel mb-3">
                          <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-2">
                            Suggested from Locker
                          </p>
                          <ul className="space-y-1 max-h-40 overflow-y-auto music-scrollbar">
                            {enhanceSuggestions.map((track) => (
                              <li
                                key={track.envelopeId}
                                className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)]"
                              >
                                <span className="font-mono text-[10px] truncate flex-1">
                                  {track.title}
                                  <span className="text-[var(--text-dim)]"> — {track.artist}</span>
                                </span>
                                <button
                                  type="button"
                                  className="font-mono text-[9px] uppercase text-accent touch-manipulation shrink-0"
                                  onClick={() => addEnhanceTracks(openPlaylist, [track])}
                                >
                                  Add
                                </button>
                              </li>
                            ))}
                          </ul>
                          <button
                            type="button"
                            className="mt-2 font-mono text-[9px] uppercase text-accent touch-manipulation"
                            onClick={() => addEnhanceTracks(openPlaylist, enhanceSuggestions)}
                          >
                            Add all ({enhanceSuggestions.length})
                          </button>
                        </div>
                      ) : null}
                      {showPrepareForOffline ? (
                        <button
                          type="button"
                          onClick={() => onPrepareForTravel!(openPlaylist.tracks)}
                          className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-[var(--border)] font-mono text-xs font-bold uppercase text-[var(--text-mid)] touch-manipulation hover:border-accent hover:text-accent"
                        >
                          <Wifi className="w-3.5 h-3.5" />
                          {t('travel.prepare')}
                        </button>
                      ) : null}
                      <ul className="space-y-2">
                        {openPlaylist.tracks.map((track) => (
                          <li
                            key={track.envelopeId}
                            draggable={!detailSelectionMode && !isSmart}
                            onDragStart={() => setDetailDragId(track.envelopeId)}
                            onDragEnd={() => setDetailDragId(null)}
                            onDragOver={(e) => {
                              if (!detailDragId || detailSelectionMode || isSmart) return;
                              e.preventDefault();
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              if (detailDragId) {
                                reorderDetailTrack(openPlaylist, detailDragId, track.envelopeId);
                              }
                              setDetailDragId(null);
                            }}
                            className={detailDragId === track.envelopeId ? 'opacity-50' : ''}
                          >
                            <div
                              className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left ${
                                detailSelectionMode && detailSelectedIds.has(track.envelopeId)
                                  ? 'border-accent bg-accent-soft'
                                  : track.envelopeId === activeEnvelopeId
                                    ? 'border-accent bg-accent-soft'
                                    : 'border-[var(--border)]'
                              }`}
                            >
                              {!detailSelectionMode && !isSmart ? (
                                <span
                                  className="playlist-drag-handle shrink-0 touch-manipulation cursor-grab"
                                  aria-hidden
                                >
                                  <GripVertical className="w-4 h-4 text-[var(--text-dim)]" />
                                </span>
                              ) : null}
                              <button
                                type="button"
                                onClick={() => {
                                  if (detailSelectionMode) {
                                    toggleDetailTrack(track.envelopeId);
                                    return;
                                  }
                                  onPlay(track);
                                  leavePlaylistAfterPlay();
                                }}
                                className="flex-1 min-w-0 flex items-center gap-2 text-left touch-manipulation"
                              >
                                {detailSelectionMode ? (
                                  <span
                                    className={`w-3.5 h-3.5 rounded border shrink-0 ${
                                      detailSelectedIds.has(track.envelopeId)
                                        ? 'bg-accent border-accent'
                                        : 'border-[var(--border)]'
                                    }`}
                                  />
                                ) : (
                                  <Play className="w-3.5 h-3.5 text-accent shrink-0" />
                                )}
                                <span className="font-mono text-[10px] uppercase truncate flex-1 min-w-0">
                                  {track.title}
                                  <span className="text-[var(--text-dim)] normal-case">
                                    {' '}
                                    — {track.artist}
                                  </span>
                                </span>
                                {(() => {
                                  const sonicLabel = formatSonicSummary(
                                    getSonicFeaturesForEnvelope(track),
                                  );
                                  return sonicLabel ? (
                                    <span className="shrink-0 font-mono text-[8px] text-[var(--text-dim)] uppercase whitespace-nowrap">
                                      {sonicLabel}
                                    </span>
                                  ) : null;
                                })()}
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {unmatchedStubsInList.length > 0 && (
                    <ul className="space-y-1 rounded-xl border border-[var(--border)] p-2">
                      {unmatchedStubsInList.map((stub, i) => (
                        <li
                          key={`${stub.title}-${i}`}
                          className="px-2 py-1.5 rounded-lg border border-dashed border-[var(--border)] font-mono text-[10px] uppercase text-[var(--text-mid)]"
                        >
                          <span className="text-[var(--text-dim)] mr-2">{i + 1}.</span>
                          {stub.title}
                          {stub.artist ? (
                            <span className="text-[var(--text-dim)] normal-case"> — {stub.artist}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {!isSmart && !isImported && (unmatchedStubsInList.length > 0 || isShell) && onGoToLocker && (
                  <div className="playlists-mobile-detail-actions">
                    {renderAddFromLockerButton('Add songs from Locker')}
                  </div>
                )}
                {!isSmart && isImported && onGoToLocker && (unmatchedStubsInList.length > 0 || isShell) && (
                  <div className="playlists-mobile-detail-actions border-t-0 pt-0">
                    {renderAddFromLockerLink('self-center py-2')}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {detailHeader}
                {detailToolbar}
                {isShell && hasStubs && (
                  <p className="font-mono text-[10px] text-[var(--text-mid)]">
                    {stubs.length} imported title{stubs.length === 1 ? '' : 's'}
                    {hasTracks ? ` · ${openPlaylist.tracks.length} with audio` : ''}
                  </p>
                )}
                {hasTracks && (
                  <>
                    {showEnhancePanel && enhanceSuggestions.length > 0 ? (
                      <div className="playlists-enhance-panel mb-3">
                        <p className="font-mono text-[9px] uppercase tracking-widest text-accent mb-2">
                          Suggested from Locker
                        </p>
                        <ul className="space-y-1 max-h-40 overflow-y-auto music-scrollbar">
                          {enhanceSuggestions.map((track) => (
                            <li
                              key={track.envelopeId}
                              className="flex items-center gap-2 p-2 rounded-lg border border-[var(--border)]"
                            >
                              <span className="font-mono text-[10px] truncate flex-1">
                                {track.title}
                                <span className="text-[var(--text-dim)]"> — {track.artist}</span>
                              </span>
                              <button
                                type="button"
                                className="font-mono text-[9px] uppercase text-accent touch-manipulation shrink-0"
                                onClick={() => addEnhanceTracks(openPlaylist, [track])}
                              >
                                Add
                              </button>
                            </li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="mt-2 font-mono text-[9px] uppercase text-accent touch-manipulation"
                          onClick={() => addEnhanceTracks(openPlaylist, enhanceSuggestions)}
                        >
                          Add all ({enhanceSuggestions.length})
                        </button>
                      </div>
                    ) : null}
                    {showPrepareForOffline ? (
                      <button
                        type="button"
                        onClick={() => onPrepareForTravel!(openPlaylist.tracks)}
                        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-[var(--border)] font-mono text-xs font-bold uppercase text-[var(--text-mid)] touch-manipulation hover:border-accent hover:text-accent"
                      >
                        <Wifi className="w-3.5 h-3.5" />
                        {t('travel.prepare')}
                      </button>
                    ) : null}
                    <ul className="space-y-2">
                    {openPlaylist.tracks.map((track) => (
                      <li
                        key={track.envelopeId}
                        draggable={!detailSelectionMode && !isSmart}
                        onDragStart={() => setDetailDragId(track.envelopeId)}
                        onDragEnd={() => setDetailDragId(null)}
                        onDragOver={(e) => {
                          if (!detailDragId || detailSelectionMode || isSmart) return;
                          e.preventDefault();
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (detailDragId) {
                            reorderDetailTrack(openPlaylist, detailDragId, track.envelopeId);
                          }
                          setDetailDragId(null);
                        }}
                        className={detailDragId === track.envelopeId ? 'opacity-50' : ''}
                      >
                        <div
                          className={`w-full flex items-center gap-2 p-2 rounded-lg border text-left ${
                            detailSelectionMode && detailSelectedIds.has(track.envelopeId)
                              ? 'border-accent bg-accent-soft'
                              : track.envelopeId === activeEnvelopeId
                                ? 'border-accent bg-accent-soft'
                                : 'border-[var(--border)]'
                          }`}
                        >
                          {!detailSelectionMode && !isSmart ? (
                            <span
                              className="playlist-drag-handle shrink-0 touch-manipulation cursor-grab"
                              aria-hidden
                            >
                              <GripVertical className="w-4 h-4 text-[var(--text-dim)]" />
                            </span>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              if (detailSelectionMode) {
                                toggleDetailTrack(track.envelopeId);
                                return;
                              }
                              onPlay(track);
                              leavePlaylistAfterPlay();
                            }}
                            className="flex-1 min-w-0 flex items-center gap-2 text-left touch-manipulation"
                          >
                          {detailSelectionMode ? (
                            <span
                              className={`w-3.5 h-3.5 rounded border shrink-0 ${
                                detailSelectedIds.has(track.envelopeId)
                                  ? 'bg-accent border-accent'
                                  : 'border-[var(--border)]'
                              }`}
                            />
                          ) : (
                            <Play className="w-3.5 h-3.5 text-accent shrink-0" />
                          )}
                          <span className="font-mono text-[10px] uppercase truncate flex-1 min-w-0">
                            {track.title}
                            <span className="text-[var(--text-dim)] normal-case">
                              {' '}
                              — {track.artist}
                            </span>
                          </span>
                          {(() => {
                            const sonicLabel = formatSonicSummary(
                              getSonicFeaturesForEnvelope(track),
                            );
                            return sonicLabel ? (
                              <span className="shrink-0 font-mono text-[8px] text-[var(--text-dim)] uppercase whitespace-nowrap">
                                {sonicLabel}
                              </span>
                            ) : null;
                          })()}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                  </>
                )}
                {unmatchedStubsInList.length > 0 && (
                  <ul className="max-h-56 overflow-y-auto music-scrollbar space-y-1 rounded-xl border border-[var(--border)] p-2">
                    {unmatchedStubsInList.map((stub, i) => (
                      <li
                        key={`${stub.title}-${i}`}
                        className="px-2 py-1.5 rounded-lg border border-dashed border-[var(--border)] font-mono text-[10px] uppercase text-[var(--text-mid)]"
                      >
                        <span className="text-[var(--text-dim)] mr-2">{i + 1}.</span>
                        {stub.title}
                        {stub.artist ? (
                          <span className="text-[var(--text-dim)] normal-case"> — {stub.artist}</span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )}
                {!isSmart && !isImported && (unmatchedStubsInList.length > 0 || isShell) && onGoToLocker && (
                  renderAddFromLockerButton('Add songs from Locker')
                )}
                {!isSmart && isImported && onGoToLocker && (unmatchedStubsInList.length > 0 || isShell) && (
                  <div className="pt-1">{renderAddFromLockerLink()}</div>
                )}
              </div>
            );
          })()
        ) : null}
      </ModalOverlay>

      <PlaylistShareDialog
        open={Boolean(shareDialogPlaylist || shareImportSeed)}
        playlist={shareDialogPlaylist}
        initialImport={shareImportSeed}
        onClose={() => {
          setShareDialogPlaylist(null);
          setShareImportSeed(null);
        }}
        onPlaylistUpdated={() => setPlaylists(loadPlaylists())}
        onImported={(pl) => {
          setPlaylists(loadPlaylists());
          setOpenPlaylistId(pl.id);
          showToast(t('playlists.share.imported', { name: pl.name }));
        }}
      />

      <ConfirmDialog
        open={confirmDeletePlaylist !== null}
        onClose={() => setConfirmDeletePlaylist(null)}
        onConfirm={runConfirmedPlaylistDelete}
        title={t('playlists.confirm.deleteTitle')}
        message={
          confirmDeletePlaylist
            ? t('playlists.confirm.deleteMessage', { name: confirmDeletePlaylist.name })
            : ''
        }
        confirmLabel={t('playlists.confirm.delete')}
        danger
      />

      <PromptDialog
        open={renameFolderTarget !== null}
        onClose={() => setRenameFolderTarget(null)}
        onSubmit={(name) => {
          if (!renameFolderTarget) return;
          renamePlaylistFolder(renameFolderTarget.id, name);
          setFolders(loadPlaylistFolders());
        }}
        title={t('playlists.folder.renameTitle')}
        label={t('playlists.folder.renameLabel')}
        defaultValue={renameFolderTarget?.name ?? ''}
        placeholder={t('playlists.folder.renamePlaceholder')}
      />
    </div>
  );
}
