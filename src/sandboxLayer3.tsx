/**
 * Sandbox Music â€” Layer 3: Responsive Shell
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Home,
  HardDrive,
  Play,
  Pause,
  Loader2,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  ThumbsUp,
  ThumbsDown,
  Compass,
  Volume2,
  VolumeX,
  ListOrdered,
  ScrollText,
  BookOpen,
  Music as MusicIcon,
  X,
  Cast,
  ListMusic,
} from 'lucide-react';
import CollapsibleStationNav from './components/CollapsibleStationNav';
import { queueStemAnalyzeForLockerTrack } from './analyzeStemsAction';
import {
  loadBatterySaverEnabled,
  subscribeBatterySaver,
} from './batterySaverSettings';
import MobileNavMoreSheet from './components/MobileNavMoreSheet';
import UniversalSearchPanel from './components/UniversalSearchPanel';
import type { UniversalFormat, UniversalHit } from './universalSearch';
import { loadAudiobookSeeds } from './audiobookLibrary';
import PodcastChapterSheet from './components/podcasts/PodcastChapterSheet';
import MobileDockWithShell from './mobile/MobileDockWithShell';
import { useNarrationPlayback } from './hooks/useNarrationPlayback';
import { resumeAtSeconds } from './resumeRewind';
import {
  subscribeNarrationPlayerOpen,
} from './narrationPlayback';
import { useMobileShell } from './hooks/useMobileShell';
import { isNativeCapacitorNonTv, isTabletViewport } from './hooks/mobileShellLayout';
import {
  flushPendingShellScrollRestore,
  registerShellScrollContainer,
  requestShellScrollRestore,
  saveShellScroll,
  SEARCH_RESULTS_SCROLL_KEY,
  searchArtistScrollKey,
} from './scrollRestore';
import { renderShellEntryGates } from './shell/ShellEntryGates';
import { useShellPlayerDockFlags } from './shell/useShellPlayerDockFlags';
import {
  readAudiobooksEnabled,
  readCollectionStationEnabled,
  readDiscoverStationEnabled,
  readLibraryStationEnabled,
  readPodcastsEnabled,
  readProAudio,
  readSonicLockerStationEnabled,
  type MobileTabId,
  type NavItemId,
  type StationId,
} from './shell/shellNav';
import {
  audiobookBookKeyFromEnvelopeId,
  getAudiobookProgress,
  saveAudiobookProgress,
  shouldPersistAudiobookProgress,
} from './audiobookProgress';
import { installE2eLiveHandlers } from './e2eHandlerBootstrap';
import { buildE2eLiveHandlers } from './shell/shellE2eLiveHandlers';
import { markE2ePlaybackHandlersLive, registerE2eHandlers } from './e2eDevAction';
import {
  ensureNavPinTabsLayout,
  loadNavPinTabs,
  NAV_PINS_CHANGE_EVENT,
  navPinTabIdSet,
  type NavPinTabId,
} from './navPinTabs';
import { useShellDiscoverBadge } from './hooks/useShellDiscoverBadge';
import { useShellPodcastBadge } from './hooks/useShellPodcastBadge';
import { usePlayerHomeNavigation } from './hooks/usePlayerHomeNavigation';
import { useAndroidShellBridges } from './hooks/useAndroidShellBridges';
import {
  prepareCleanPlaybackStop,
  waitForStablePlayback,
  waitForTrackTransition,
} from './e2ePlaybackWait';
import {
  useProfile,
  useAudioFSM,
  type CandidateSource,
  type MediaEnvelope,
} from './sandboxLayer1';
import {
  findLockerEntryForTrack,
  findPlayableLockerEntryForTrack,
  findLockerEntryForTrackIncludingHollow,
  getLockerArtBlob,
  getLockerEntriesSnapshot,
  refreshLockerEntryPlayUrl,
  removeLockerEntry,
  resolveLockerEnvelopeForPlayback,
  buildLockerGroupArtMap,
  resolveLockerEntryGroupArtFromMap,
  subscribeLockerCache,
  type LockerEntry,
} from './lockerStorage';
import { LOCKER_USER_DELETE_CONFIRMED } from './lockerDeleteGuard';
import {
  playbackArtStabilizeScope,
} from './playerBarTrackMeta';
import {
  buildHealAttemptKey,
  resolveHealAction,
} from './play/playbackHealPolicy';
import {
  computeNextQueueIndex,
} from './play/queueAdvancePolicy';
import {
  buildPodcastQueueForFeed,
  computeNextQueueIndexWithUpNext,
  loadSovereignUpNextSettings,
  mergeIntoUpNextQueue,
} from './sovereignUpNext';
import { envelopeClaimsLocker } from './play/ensureLockerPlayable';
import { cacheUpcomingOnWifi, prefetchUpcomingOnWifi } from './wifiBackgroundPrefetch';
import {
  cacheEnvelopeForOffline,
  warmStreamCacheIndex,
} from './streamCache';
import {
  prefetchUpcomingQueueTracks,
  stageUpcomingQueueOnTier34,
} from './trackPrefetch';
import {
  engineSearch,
  engineExploreSearch,
  searchFeedback,
  type ResolvedSearchHit,
} from './sandboxLayer2';
import { formatTime, themeBadgeOutlineClass } from './stations/theme';
import { loadHeroDisplayMode, saveHeroDisplayMode, resolveHeroShowShades, applyHeroDisplayFromSettingsEvent, toggleHeroDisplayMode } from './heroDisplaySettings';
import {
  clickHomeVinylToggleButton,
  probeHeroVisualFromDom,
} from './homeHeroPlayerLogic';
import MixRadioSaveDialog from './components/MixRadioSaveDialog';
import AddToPlaylistPicker from './components/AddToPlaylistPicker';
import { type MixRadioSession } from './playerMixRadio';
import { initAndroidAppResume } from './androidAppResume';
import { initAndroidWiredDacStability } from './androidWiredDacPlayback';
import {
  initPlaylistImportShare,
  registerPlaylistImportShareHandler,
  type ExternalPlaylistImportSeed,
} from './playlistImportShare';
import { parsePlaylistShareFromHash } from './playlistCollaborativeShare';
import { buildSuggestedQueueTracks } from './suggestedQueueTracks';
import { seedGradientUniverseStyle } from './seedGradient';
import MusicUniverseBackdrop from './components/MusicUniverseBackdrop';
import HomeActiveWash from './components/HomeActiveWash';
import { useShowMusicUniverse } from './musicUniverse';
import HomeView from './stations/HomeView';
import type { DiscoverTabId } from './stations/DiscoverStationView';
import type { LockerSectionId } from './stations/CollectionView';
import type { SettingsTab } from './stations/SettingsView';
import SearchDropdown from './components/SearchDropdown';
import { fetchStemUrlsForTrack, stemUrlsComplete } from './stemSeparation';
import { useServerStemMix } from './hooks/useServerStemMix';
import { shouldPreferAndroidNativePlayback } from './androidNativePlayback';
import { loadDiscoverStationEnabled } from './discoverStationSettings';
import { useShellConnect, useShellConnectRuntime } from './shell/useShellConnect';
import { useShellPodcastControls } from './shell/useShellPodcastControls';
import { useShellCastRuntime } from './shell/useShellCastRuntime';
import { usePlayEnvelope } from './shell/usePlayEnvelope';
import { useShellPlayTriggers } from './shell/useShellPlayTriggers';
import {
  useShellSearchRunner,
  useShellExploreSearch,
  useShellSearchDropdownEffects,
  useShellSearchHistoryNav,
  useShellSearchDrillNav,
  useShellSearchNavigate,
  useShellSearchDropdownActions,
} from './shell/useShellSearch';
import {
  useShellQueuePersistWrites,
  useShellQueueRestore,
  useShellQueueResume,
  useShellQueueSave,
} from './shell/useShellQueuePersistence';
import { useShellPlaybackHeal } from './shell/useShellPlaybackHeal';
import { useShellLyricsResolve, useShellMediaSessionWiring } from './shell/useShellNowPlaying';
import {
  useShellNowPlayingDisplay,
  useShellNowPlayingChapters,
  useShellTogglePlay,
} from './shell/useShellNowPlayingDisplay';
import { buildE2eSearchHandlers } from './shell/shellE2eSearchHandlers';
import { useShellQueueAdvanceOnEnded } from './shell/useShellQueueAdvanceOnEnded';
import { useShellSkipControls } from './shell/useShellSkipControls';
import { usePlaybackQueue } from './shell/usePlaybackQueue';
import { useShellPlayActions } from './shell/useShellPlayActions';
import { useShellTvHome } from './shell/useShellTvHome';
import {
  useShellDownloadHandlers,
  useShellDownloadMix,
  useShellDownloadCurrentTrack,
} from './shell/useShellDownloads';
import { useShellNavConstruction } from './shell/useShellNavConstruction';
import { useShellMobileNavActions } from './shell/useShellMobileNavActions';
import { useShellCarModeAndSleepTimer } from './shell/useShellCarModeAndSleepTimer';
import { useShellHomeArtStyle } from './shell/useShellHomeArtStyle';
import { useShellArtworkResolution } from './shell/useShellArtworkResolution';
import { useShellConnectivityBanners } from './shell/useShellConnectivityBanners';
import { useShellPlaybackChrome } from './shell/useShellPlaybackChrome';
import { useShellQueuePlaybackFoundation } from './shell/useShellQueuePlaybackFoundation';
import { useShellExoTransition } from './shell/useShellExoTransition';
import { useShellPlaySessionEffects } from './shell/useShellPlaySessionEffects';
import {
  useShellTvBackHandler,
  useShellStationSettingsSync,
  useShellStationGuards,
  useShellBackNavigation,
  useShellGoToDiscover,
} from './shell/useShellNavigation';
import { ShellStationRouter } from './shell/ShellStationRouter';
import { ShellChrome } from './shell/ShellChrome';
import { loadLibraryStationEnabled } from './libraryStationSettings';
import { loadSonicLockerStationEnabled } from './sonicLockerStationSettings';
import {
  cyclePodcastPlaybackSpeed,
  loadPodcastPlaybackSpeed,
  loadPodcastsEnabled,
  loadPodcastSmartSpeedEnabled,
  loadPodcastSkipAdChaptersEnabled,
  loadPodcastVoiceBoostEnabled,
  savePodcastSmartSpeedEnabled,
  savePodcastSkipAdChaptersEnabled,
  savePodcastVoiceBoostEnabled,
  PODCAST_SETTINGS_CHANGE_EVENT,
} from './podcastSettings';
import {
  loadAudiobooksEnabled,
  saveAudiobooksEnabled,
} from './audiobooksSettings';
import {
  parsePodcastEpisodeId,
  parsePodcastFeedId,
  findEpisode,
  findSubscription,
  updateEpisodeChapters,
  updateSubscriptionMeta,
  PODCASTS_CHANGE_EVENT,
  getEpisodeResumePosition,
  getEpisodeResumeSavedAt,
  saveEpisodeResumePosition,
  markEpisodeCompleted,
  maybeAutoCompleteEpisode,
} from './podcastStorage';
import { type PodcastSearchHit } from './podcastSearch';
import { type PodcastCatalogEpisodeHit } from './podcastCatalog';
import { resolvePodcastEnvelopeForPlayback } from './podcastPlayback';
import { tapHaptic } from './uiTapFeedback';
import {
  type PlaybackDisplayFields,
} from './playbackSession';
import {
  type HeldNowPlaying,
} from './nowPlayingAuthority';
import {
  seekSecondsForPreviousChapter,
  type PodcastChapter,
} from './podcastChapters';
import { resolvePodcastChapters } from './podcastChapterResolution';
import { seekTargetAfterAdChapter, seekTargetForManualAdSkip, manualAdSkipHint } from './podcastAdSkip';
import {
  cycleEpisodeVolumeBoostDb,
  loadEpisodeVolumeBoostDb,
} from './podcastEpisodeBoost';
import { syncPodcastRulesToTier34 } from './podcastRulesSync';
import { resolveVoiceBoostEnabled } from './podcastVoiceBoost';
import { startPodcastSmartSpeed, type PodcastSmartSpeedController } from './podcastSmartSpeedController';
import { LockerVaultProvider } from './LockerVaultContext';
import { ConnectClient } from './tier34/peerSync';
import { catalogTrackIdFromEnvelope } from './catalogTrackId';
import {
  buildSyncState,
  queueSummaryToEnvelope,
  type ConnectCommand,
  type SyncStatePayload,
} from './tier34/connectProtocol';
import {
  resolveCatalogArtistByName,
  buildCatalogArtistStub,
  fetchAlbumTracks,
  fetchArtistTopTracks,
  resolveAlbumIntent,
  canonicalizeAlbumHint,
  catalogDisplayArtistName,
  findCatalogArtistByName,
  isLikelyArtistNameQuery,
  isLikelyTrackTitleQuery,
  needsWebTrackSupplement,
  catalogSatisfiesTrackQuery,
  type CatalogAlbum,
  type CatalogArtist,
  type CatalogSearchResult,
  type CatalogTrack,
} from './searchCatalog';
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
} from './searchHistory';
import {
  buildSearchDropdownItems,
  nextSearchActiveIndex,
  prevSearchActiveIndex,
  type SearchDropdownItem,
} from './searchDropdownModel';
import { useImeFriendlyInput } from './useImeFriendlyInput';
import { imeSearchInputProps } from './imeInputProps';
import {
  EMPTY_UNIFIED,
  instantLocalLockerSearch,
  runUnifiedSearch,
  applyWebSupplementToUnified,
  type UnifiedPlaylistResult,
  type UnifiedSearchResult,
  type UnifiedSearchSection,
} from './unifiedSearch';
import { fetchWebCatalogTracks, WEB_LEAK_SEARCH_MAX_WAIT_MS } from './webCatalogSearch';
import { searchYouTubeTracks } from './youtubeSearch';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import { exploreDisplayQuery, type ExploreGroup } from './exploreCatalog';
import { isNewMusicQuery, newMusicSearchLabel } from './newMusicQuery';
import type { QuickBrowseFilter } from './exploreBrowseData';
import {
  tier34HealDeadSource,
  getTier34BaseUrl,
  isTier34ReachableCached,
} from './tier34/client';
import { hasActiveMobileResolvers, getLastMobileResolveError, preferFreshMobileResolve } from './mobileResolverRegistry';
import { usePlaybackResolveElapsed } from './hooks/usePlaybackResolveElapsed';
import { useStableEnvelopeId } from './hooks/useStableEnvelopeId';
import { resolvePlaybackFidelityLabel } from './trackFidelityLabel';
import { subscribeNativeExoStatus } from './androidNativePlayback';
import { isNativeExoAudible, clearLastPlayIntent } from './lastPlayIntent';
import { getYtDlpMobileStatus } from './ytDlpMobile';
import {
  bumpPlayGeneration,
  formatMobilePlaybackError,
} from './playIntent';
import {
  displayTransportLabel,
} from './displaySanitize';
import {
  retryTrackInDownloadJob,
  scheduleCatalogAlbumDownload,
  scheduleCatalogTrackDownload,
} from './acquisitionPipeline';
import { filterTracksNeedingDownload } from './downloadLockerPrecheck';
import { primeDownloadBatteryMonitor } from './downloadBatteryGate';
import DownloadErrorToast from './components/DownloadErrorToast';
import DownloadActivitySheet from './components/DownloadActivitySheet';
import AcquireProgressToast from './components/AcquireProgressToast';
import ConfirmDialog from './components/ConfirmDialog';
import { acquireAndPlayHit } from './acquireAndPlay';
import CastPicker from './components/CastPicker';
import QueueDrawer from './components/QueueDrawer';
import TVNavigation, { type TVStationId } from './components/TVNavigation';
import TVQueuePanel from './components/TVQueuePanel';
import LyricsDrawer from './components/LyricsDrawer';
import SleepTimerPanel from './components/SleepTimerPanel';
import TVHomeView, { type TVRowId } from './stations/TVHomeView';
import TVPlaybackView from './stations/TVPlaybackView';
import { detectTVPlatform } from './tvDetection';
import {
  isAndroidNative,
  isCarModeActive,
  loadCarModeAutoOffer,
  loadCarModeOfferDismissed,
  saveCarModeOfferDismissed,
  subscribeCarMode,
  syncCarModeFromPrefs,
} from './carMode';
import {
  loadPlaylists,
  subscribePlaylists,
} from './playlistStorage';
import {
  EMPTY_LYRICS,
  type ResolvedLyrics,
} from './resolveTrackLyrics';
import {
  getCastState,
  type CastState,
} from './castState';
import {
  getCinemaCastMode,
  type CinemaCastMode,
} from './cinemaCast';
import { publishVinylWidgetState } from './vinylWidget';
import CinemaCastOverlay from './stations/CinemaCastOverlay';
import VerticalVideoFeed from './components/discovery/VerticalVideoFeed';
import { searchBarPlaceholder, searchConnectivityHint, useOfflineStatus } from './offlineStatus';
import { isAndroid } from './platformEnv';
import { resetMobileKeyboardInsets } from './androidSafeAreaInsets';
import { isTauriDesktop } from './castPlatform';
import { requestAndroidPermissions } from './androidPermissions';
import { useTranslation } from './i18n';
import {
  getOrCreateConnectDeviceId,
  loadConnectDeviceName,
  loadGaplessEnabled,
  loadOnboardingComplete,
  requestTauriCastGuidance,
  saveTvCoverageBannerDismissed,
  shouldShowOnboardingWizard,
  shouldShowServerSetup,
} from './sandboxSettings';
import { maybeAutoStartLocalSandboxServer } from './sandboxServerBridge';
import { useShellLockerSync } from './shell/useShellLockerSync';
import { prefsGetItem } from './prefsStorage';
import {
  enqueueDownloadJob,
  initJobTracks,
  loadDownloadTierPreference,
  trackTitleKeysMatch,
  type DownloadJob,
  type DownloadMode,
  type DownloadTierPreference,
} from './downloadQueue';
import {
  getMostPlayed,
  getRecentlyPlayed,
  storedHitToEnvelope,
  type StoredPlayHit,
} from './playHistory';
import {
  getTrackTasteFeedback,
  recordTasteFeedback,
} from './tasteFeedback';
import {
  isStablePlaybackFsmState,
  markActivePlaybackSession,
  sanitizeRestoredEnvelope,
  isLikelyPageReload,
  isColdPlaybackStart,
  type RepeatMode,
} from './queuePersistence';
import {
  type MediaKind,
} from './listeningAnalytics';
import { initNativeWakeAlarm } from './nativeWakeAlarm';
import { handleNativeWakeAlarmFired } from './sleepTimer';

const EMPTY_CATALOG: CatalogSearchResult = {
  suggestions: [],
  artists: [],
  albums: [],
  tracks: [],
};

export default function SandboxShell() {
  const { t, lang } = useTranslation();
  const profile = useProfile();
  const audio = useAudioFSM();

  const [station, setStation] = useState<StationId>('home');
  const [lockerSection, setLockerSection] = useState<LockerSectionId>('artists');
  const [lockerHomeResetKey, setLockerHomeResetKey] = useState(0);
  // Keep Podcasts/Audiobooks mounted after first visit (hidden when inactive) so
  // switching tabs does not unmount them and re-fetch Discover every time.
  /** Which pillar the search sheet is scoped to (Music / Pods / Books). */
  const [searchFormat, setSearchFormat] = useState<UniversalFormat>('music');
  /**
   * Seeds for the Books taste row. Read from the persisted audiobook scan rather than
   * re-scanning here â€” the Audiobooks station owns scanning, and search must stay cheap.
   */
  const [audiobookSeeds, setAudiobookSeeds] = useState(() => loadAudiobookSeeds());
  const audiobookAuthorSeeds = audiobookSeeds.authors;
  const audiobookOwnedTitles = audiobookSeeds.titles;
  // Re-read after visiting Books, which is when a scan may have refreshed them.
  useEffect(() => {
    if (station === 'audiobooks') return;
    setAudiobookSeeds(loadAudiobookSeeds());
  }, [station]);
  const [podcastsMounted, setPodcastsMounted] = useState(false);
  const [audiobooksMounted, setAudiobooksMounted] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const shellSearchField = useImeFriendlyInput(searchInput, setSearchInput, searchInputRef);
  const [narrowShell, setNarrowShell] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 639px)').matches,
  );
  const searchFormRef = useRef<HTMLFormElement>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);
  const searchBarBottomRafRef = useRef(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MediaEnvelope[]>([]);
  const searchResultsRef = useRef(searchResults);
  searchResultsRef.current = searchResults;
  const [searchHits, setSearchHits] = useState<ResolvedSearchHit[]>([]);
  const searchHitsRef = useRef(searchHits);
  searchHitsRef.current = searchHits;
  const [searchFromCache, setSearchFromCache] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchLoadingRef = useRef(searchLoading);
  searchLoadingRef.current = searchLoading;
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const [searchActiveIndex, setSearchActiveIndex] = useState(-1);
  const [searchHistoryTick, setSearchHistoryTick] = useState(0);
  const recentSearchMatches = useMemo(
    () => (searchDropdownOpen ? matchSearchHistory(searchInput) : []),
    [searchDropdownOpen, searchInput, searchHistoryTick],
  );
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [searchCatalog, setSearchCatalog] = useState<CatalogSearchResult>(EMPTY_CATALOG);
  const [unifiedSearchResult, setUnifiedSearchResult] = useState<UnifiedSearchResult>(EMPTY_UNIFIED);
  const unifiedSearchResultRef = useRef(unifiedSearchResult);
  unifiedSearchResultRef.current = unifiedSearchResult;
  const [unifiedSearchLoading, setUnifiedSearchLoading] = useState(false);
  const unifiedSearchLoadingRef = useRef(unifiedSearchLoading);
  unifiedSearchLoadingRef.current = unifiedSearchLoading;
  const [webSupplementLoading, setWebSupplementLoading] = useState(false);
  const [webSupplementError, setWebSupplementError] = useState<string | null>(null);
  const [searchSection, setSearchSection] = useState<UnifiedSearchSection>('all');
  const [focusPlaylistId, setFocusPlaylistId] = useState<string | null>(null);
  const [pendingShareImport, setPendingShareImport] = useState<{
    shareId: string;
    editToken?: string;
  } | null>(null);
  const [pendingExternalImport, setPendingExternalImport] =
    useState<ExternalPlaylistImportSeed | null>(null);
  const [selectedArtist, setSelectedArtist] = useState<CatalogArtist | null>(null);
  const [albumDrillQuery, setAlbumDrillQuery] = useState<string | null>(null);
  const [albumDrillAlbum, setAlbumDrillAlbum] = useState<CatalogAlbum | null>(null);
  const [albumDrillTracks, setAlbumDrillTracks] = useState<CatalogTrack[]>([]);
  const albumDrillTracksRef = useRef(albumDrillTracks);
  albumDrillTracksRef.current = albumDrillTracks;
  const albumDrillAlbumRef = useRef(albumDrillAlbum);
  albumDrillAlbumRef.current = albumDrillAlbum;

  useEffect(() => {
    if (!albumDrillQuery && !albumDrillAlbum) return;
    setSearchDropdownOpen(false);
    searchInputRef.current?.blur();
    setAppToast(null);
  }, [albumDrillQuery, albumDrillAlbum]);
  const artistHistoryPushedRef = useRef(false);
  const albumHistoryPushedRef = useRef(false);
  const searchHistoryPushedRef = useRef(false);
  const searchReturnStationRef = useRef<StationId>('home');
  /** Blocks mobile tab / backdrop bleed-through after a dropdown pick (Android). */
  const mobileSearchCommitGuardUntilRef = useRef(0);
  const searchSnapshotRef = useRef<{
    query: string;
    hits: ResolvedSearchHit[];
    results: MediaEnvelope[];
    fromCache: boolean;
    input: string;
  } | null>(null);
  const shellMainRef = useRef<HTMLElement | null>(null);
  const searchScrollParentRef = useRef(SEARCH_RESULTS_SCROLL_KEY);
  const catalogRequestRef = useRef(0);
  const searchRunGenerationRef = useRef(0);
  const artistOpenGenerationRef = useRef(0);
  const webSupplementTracksRef = useRef<CatalogTrack[]>([]);
  const [playQueue, setPlayQueue] = useState<MediaEnvelope[]>([]);
  const playQueueRef = useRef(playQueue);
  playQueueRef.current = playQueue;
  const [queueIndex, setQueueIndex] = useState(0);
  const queueIndexRef = useRef(queueIndex);
  queueIndexRef.current = queueIndex;
  const sessionEnvelopeRef = useRef<MediaEnvelope | null>(null);
  const [shuffleOn, setShuffleOn] = useState(false);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>('none');
  /*
   * Declared here (rather than next to the other queue-state refs further down) so
   * useShellPlayTriggers — called well before that point — can read repeatModeRef.current
   * without a temporal-dead-zone forward reference. Still synced every render like the rest.
   */
  const repeatModeRef = useRef(repeatMode);
  repeatModeRef.current = repeatMode;
  const [thumbUp, setThumbUp] = useState(false);
  const [thumbDown, setThumbDown] = useState(false);

  const syncThumbsFromFeedback = useCallback((envelopeId?: string) => {
    if (!envelopeId?.trim()) {
      setThumbUp(false);
      setThumbDown(false);
      return;
    }
    const feedback = getTrackTasteFeedback(envelopeId);
    setThumbUp(feedback === 'like');
    setThumbDown(feedback === 'dislike');
  }, []);

  const handleThumbUp = useCallback(() => {
    const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
    if (!env?.envelopeId?.trim()) return;
    if (audio.provider) {
      searchFeedback.update(audio.provider, true, 0);
    }
    const nextKind = getTrackTasteFeedback(env.envelopeId) === 'like' ? 'clear' : 'like';
    recordTasteFeedback({
      envelopeId: env.envelopeId,
      artist: env.artist,
      album: env.album,
      title: env.title,
      envelope: env,
      kind: nextKind,
    });
    if (nextKind === 'clear') {
      setThumbUp(false);
      setThumbDown(false);
    } else {
      setThumbUp(true);
      setThumbDown(false);
    }
  }, [audio.envelope, audio.provider]);

  const handleThumbDown = useCallback(() => {
    const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
    if (!env?.envelopeId?.trim()) return;
    if (audio.provider) {
      searchFeedback.update(audio.provider, false, 5000);
    }
    const nextKind = getTrackTasteFeedback(env.envelopeId) === 'dislike' ? 'clear' : 'dislike';
    recordTasteFeedback({
      envelopeId: env.envelopeId,
      artist: env.artist,
      album: env.album,
      title: env.title,
      envelope: env,
      kind: nextKind,
    });
    if (nextKind === 'clear') {
      setThumbUp(false);
      setThumbDown(false);
    } else {
      setThumbDown(true);
      setThumbUp(false);
    }
  }, [audio.envelope, audio.provider]);

  const [navOpen, setNavOpen] = useState(false);
  const settingsReturnStationRef = useRef<StationId>('home');
  const settingsDrillBackRef = useRef<(() => boolean) | null>(null);
  const playlistsDrillBackRef = useRef<(() => boolean) | null>(null);
  const exploreDrillBackRef = useRef<(() => boolean) | null>(null);
  const mfyDrillBackRef = useRef<(() => boolean) | null>(null);
  const lockerDrillBackRef = useRef<(() => boolean) | null>(null);
  const podcastsDrillBackRef = useRef<(() => boolean) | null>(null);
  const audiobooksDrillBackRef = useRef<(() => boolean) | null>(null);
  const audiobooksReturnStationRef = useRef<StationId>('home');
  const [, setSettingsMobileDrill] = useState<SettingsTab | null>(null);
  const offlineStatus = useOfflineStatus();
  const [isTV, setIsTV] = useState(false);
  const [carModeTick, setCarModeTick] = useState(0);
  const [carOfferDismissed, setCarOfferDismissed] = useState(loadCarModeOfferDismissed);
  const carHistoryPushedRef = useRef(false);
  const isCarMode = isCarModeActive();
  void carModeTick;
  const showMobileShell = useMobileShell() && !isTV && !isCarMode;
  const [tabletShell, setTabletShell] = useState(() => isTabletViewport());
  useEffect(() => {
    const sync = () => setTabletShell(isTabletViewport());
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  // Video discovery is a screen activity: allowed on desktop, tablet and Android TV, but
  // deliberately disabled on phone and in car mode â€” the phone is a listening-only device.
  const videosEnabled = !isCarMode && (isTV || tabletShell || !showMobileShell);
  const [onboardingComplete, setOnboardingComplete] = useState(() => loadOnboardingComplete());
  const [serverSetupDismissed, setServerSetupDismissed] = useState(false);
  const showOnboarding = !onboardingComplete && shouldShowOnboardingWizard();
  const showServerSetup =
    onboardingComplete && !serverSetupDismissed && shouldShowServerSetup();

  useEffect(() => {
    const onE2eOnboarding = () => setOnboardingComplete(true);
    window.addEventListener('sandbox-e2e-onboarding-complete', onE2eOnboarding);
    return () => window.removeEventListener('sandbox-e2e-onboarding-complete', onE2eOnboarding);
  }, []);

  useEffect(() => {
    void maybeAutoStartLocalSandboxServer();
  }, []);

  useEffect(() => {
    primeDownloadBatteryMonitor();
  }, []);

  useEffect(() => {
    const share = parsePlaylistShareFromHash(window.location.hash);
    if (!share) return;
    setStation('discover');
    setDiscoverTab('playlists');
    setPendingShareImport(share);
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);

  useEffect(() => {
    registerPlaylistImportShareHandler((seed) => {
      setStation('discover');
      setDiscoverTab('playlists');
      setPendingExternalImport(seed);
    });
    let disposed = false;
    let disposeShare: (() => void) | undefined;
    void initPlaylistImportShare().then((dispose) => {
      if (disposed) dispose();
      else disposeShare = dispose;
    });
    return () => {
      disposed = true;
      registerPlaylistImportShareHandler(null);
      disposeShare?.();
    };
  }, []);

  useEffect(() => {
    const onServerConfigChange = () => {
      void import('./deviceSecretSync').then(({ scheduleDeviceSecretPull }) =>
        scheduleDeviceSecretPull(),
      );
    };
    window.addEventListener('sandbox-settings-change', onServerConfigChange);
    return () => window.removeEventListener('sandbox-settings-change', onServerConfigChange);
  }, []);

  useEffect(() => {
    if (!isTV) return;
    if (!getTier34BaseUrl().trim()) return;
    void import('./deviceSecretSync').then(({ initDeviceSecretSyncForTvShell }) =>
      initDeviceSecretSyncForTvShell(),
    );
  }, [isTV]);

  // After onboarding, skip System Login on native phone/tablet â€” default Operator profile.
  useEffect(() => {
    if (!profile.requiresSystemLogin || showOnboarding || !onboardingComplete) return;
    if (!isNativeCapacitorNonTv()) return;
    try {
      profile.enterAs('Operator');
    } catch {
      /* ignore empty name */
    }
  }, [profile.requiresSystemLogin, profile.enterAs, showOnboarding, onboardingComplete]);
  const [tvScreen, setTvScreen] = useState<'home' | 'playback'>('home');
  const [tvQueueOpen, setTvQueueOpen] = useState(false);
  const [tvPlaylists, setTvPlaylists] = useState(loadPlaylists);
  const [artworkUrl, setArtworkUrl] = useState('');
  const [playbackDisplaySeed, setPlaybackDisplaySeed] =
    useState<PlaybackDisplayFields | null>(null);
  /**
   * Last track confirmed to be the one coming out of the speaker. Kept because the audio layer's
   * own envelope flips to the skip target the instant it is tapped, and without a copy of what is
   * actually audible there is nothing left to draw during the resolve gap.
   */
  const [heldNowPlaying, setHeldNowPlaying] = useState<HeldNowPlaying | null>(null);
  const [proAudio, setProAudio] = useState(readProAudio);
  const [batterySaver, setBatterySaver] = useState(loadBatterySaverEnabled);
  const [podcastsEnabled, setPodcastsEnabled] = useState(readPodcastsEnabled);
  const [audiobooksEnabled, setAudiobooksEnabled] = useState(readAudiobooksEnabled);
  const [libraryStationEnabled, setLibraryStationEnabled] = useState(readLibraryStationEnabled);
  const [discoverStationEnabled, setDiscoverStationEnabled] = useState(readDiscoverStationEnabled);
  const [collectionStationEnabled, setCollectionStationEnabled] = useState(
    readCollectionStationEnabled,
  );
  const [sonicLockerEnabled, setSonicLockerEnabled] = useState(readSonicLockerStationEnabled);
  const [discoverTab, setDiscoverTab] = useState<DiscoverTabId>('feed');
  const [discoverDrillFromTab, setDiscoverDrillFromTab] = useState<DiscoverTabId | null>(null);
  const stationRef = useRef(station);
  stationRef.current = station;
  const discoverTabRef = useRef(discoverTab);
  discoverTabRef.current = discoverTab;
  const discoverDrillFromTabRef = useRef(discoverDrillFromTab);
  discoverDrillFromTabRef.current = discoverDrillFromTab;
  const [videoFeedOpen, setVideoFeedOpen] = useState(false);
  const discoverReleaseBadge = useShellDiscoverBadge();
  const podcastEpisodeBadge = useShellPodcastBadge();
  const [podcastSearchHits, setPodcastSearchHits] = useState<PodcastSearchHit[]>([]);
  const [podcastCatalogHits, setPodcastCatalogHits] = useState<PodcastCatalogEpisodeHit[]>([]);
  const [castMode, setCastMode] = useState<CinemaCastMode>(getCinemaCastMode);
  const [speakerCast, setSpeakerCast] = useState<CastState>(getCastState);
  const [castPickerOpen, setCastPickerOpen] = useState(false);
  const [queueDrawerOpen, setQueueDrawerOpen] = useState(false);
  const [lyricsDrawerOpen, setLyricsDrawerOpen] = useState(false);
  /** After hard reload, keep home idle until the user plays or taps Resume Queue. */
  const [homeAwaitingUserResume, setHomeAwaitingUserResume] = useState(
    () => isLikelyPageReload() || isColdPlaybackStart(),
  );
  const [mobileNowPlayingOpen, setMobileNowPlayingOpen] = useState(false);
  /*
   * A book or document being read aloud drives the ordinary player rather than a second one. It
   * has no envelope, no queue and no seekable duration, so only the fields it can honestly fill
   * are overridden below; the rest of the player is left alone.
   */
  const narrationPlayback = useNarrationPlayback();
  useEffect(() => subscribeNarrationPlayerOpen(() => setMobileNowPlayingOpen(true)), []);
  const mobileNowPlayingOpenRef = useRef(mobileNowPlayingOpen);
  mobileNowPlayingOpenRef.current = mobileNowPlayingOpen;
  const [podcastChaptersOpen, setPodcastChaptersOpen] = useState(false);
  const podcastChaptersOpenRef = useRef(podcastChaptersOpen);
  podcastChaptersOpenRef.current = podcastChaptersOpen;
  const [mobilePlayerPending, setMobilePlayerPending] = useState(false);
  // Watchdog: online tracks resolve via yt-dlp, which can occasionally hang. Without this, a
  // hung resolve leaves the mini/full player stuck on "loading" with no way to stop it (the
  // user had to force-close the app). If we're still pending after this long, cancel the
  // in-flight play (bump the generation so its continuation no-ops), stop native audio, and
  // clear the loading state so the UI is usable again.
  useEffect(() => {
    if (!mobilePlayerPending) return;
    const timer = window.setTimeout(() => {
      bumpPlayGeneration();
      void prepareCleanPlaybackStop(() => audio.stop());
      setMobilePlayerPending(false);
      showAppToast(t('player.playbackTimedOut'), 3000);
    }, 30_000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobilePlayerPending]);

  const [androidNativePlaybackLive, setAndroidNativePlaybackLive] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileDownloadSheetOpen, setMobileDownloadSheetOpen] = useState(false);
  /** Undefined means every kind — the queue as it actually is, rather than one station's slice. */
  const [mobileDownloadSheetKind, setMobileDownloadSheetKind] = useState<MediaKind | undefined>(
    'music',
  );
  const openStationDownloads = useCallback((kind: MediaKind) => {
    setMobileDownloadSheetKind(kind);
    setMobileDownloadSheetOpen(true);
  }, []);
  /** From More: one runner serves every station, so this opens the whole queue. */
  const openAllDownloads = useCallback(() => {
    setMobileDownloadSheetKind(undefined);
    setMobileDownloadSheetOpen(true);
  }, []);
  const [lockerRemoveConfirm, setLockerRemoveConfirm] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [lockerRemoveBusy, setLockerRemoveBusy] = useState(false);
  const [navPinTabs, setNavPinTabsState] = useState<NavPinTabId[]>(() => ensureNavPinTabsLayout());
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab | undefined>();
  const [sleepTimerPanelOpen, setSleepTimerPanelOpen] = useState(false);
  const [sleepTimerTick, setSleepTimerTick] = useState(0);
  const [activeLyrics, setActiveLyrics] = useState<ResolvedLyrics>(EMPTY_LYRICS);
  const [downloadTierPreference, setDownloadTierPreference] = useState<DownloadTierPreference>(
    loadDownloadTierPreference,
  );
  const [lockerTracks, setLockerTracks] = useState<
    Array<{
      id: string;
      title: string;
      artist: string;
      genre: string;
      bitrate: number;
      durationSeconds: number;
      priority: number;
      url?: string;
    }>
  >([]);
  const [lockerEnvelopes, setLockerEnvelopes] = useState<MediaEnvelope[]>([]);
  const [pendingDjDeckLoad, setPendingDjDeckLoad] = useState<{
    deck: 'A' | 'B';
    trackId: string;
    openStemsTab?: boolean;
  } | null>(null);
  const [mixRadioSession, setMixRadioSession] = useState<MixRadioSession | null>(null);
  const mixRadioSessionRef = useRef(mixRadioSession);
  mixRadioSessionRef.current = mixRadioSession;
  const autoSimilarRadioSeedRef = useRef<string | null>(null);
  const scheduleAutoSimilarRadioRef = useRef<
    (
      playable: MediaEnvelope,
      opts?: {
        seedSearchQueue?: boolean;
        seamless?: boolean;
        playQueueOverride?: MediaEnvelope[];
      },
    ) => void
  >(() => {});
  const [mixRadioSaveOpen, setMixRadioSaveOpen] = useState(false);
  const [mixRadioSaveBusy, setMixRadioSaveBusy] = useState(false);
  /* Playlist picker for the track on the player â€” the players themselves never hold the envelope. */
  const [playerAddToPlaylistOpen, setPlayerAddToPlaylistOpen] = useState(false);
  const [appToast, setAppToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const {
    showAndroidServerBanner,
    setAndroidServerBannerDismissed,
    showMobileResolverBanner,
    setMobileResolverBannerDismissed,
    showTvCoverageBanner,
    setTvCoverageBannerDismissed,
  } = useShellConnectivityBanners({
    showMobileShell,
    isTV,
    station,
    tvScreen,
  });

  /**
   * Show a toast, or take one down.
   *
   * An empty message dismisses immediately rather than drawing an empty bar. Some notices describe
   * something that is about to happen — "streaming N MB on cellular" — and once it has happened
   * they are stale text sitting over the screen for the rest of their duration. The caller that
   * raised one is the only thing that knows when it stopped being true.
   */
  const showAppToast = useCallback((msg: string, durationMs = 3200) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    if (!msg) {
      setAppToast(null);
      return;
    }
    setAppToast(msg);
    toastTimerRef.current = window.setTimeout(() => setAppToast(null), durationMs);
  }, []);

  const openCastPicker = useCallback(() => {
    if (isTauriDesktop()) requestTauriCastGuidance();
    setCastPickerOpen(true);
  }, []);

  const handleSendToDj = useCallback(async (deck: 'A' | 'B', trackId: string) => {
    let openStemsTab = false;
    try {
      const urls = await fetchStemUrlsForTrack(trackId);
      openStemsTab = stemUrlsComplete(urls);
    } catch {
      /* stems optional */
    }
    setPendingDjDeckLoad({ deck, trackId, openStemsTab });
    setStation('dj');
  }, []);

  const handleAnalyzeStems = useCallback(
    async (trackId: string) => {
      const entry = lockerTracks.find((t) => t.id === trackId);
      try {
        const result = await queueStemAnalyzeForLockerTrack({
          trackId,
          title: entry?.title,
          artist: entry?.artist,
        });
        if (result.kind === 'already') {
          showAppToast(t('stems.alreadyCached'));
        } else {
          showAppToast(t('stems.analyzeQueued'));
        }
      } catch (err) {
        showAppToast(err instanceof Error ? err.message : t('stems.analyzeFailed'), 5000);
      }
    },
    [lockerTracks, showAppToast, t],
  );

  useEffect(() => subscribeBatterySaver(() => setBatterySaver(loadBatterySaverEnabled())), []);

  useEffect(() => {
    const onEarSafetyToast = (ev: Event) => {
      const key = (ev as CustomEvent<{ key?: string }>).detail?.key;
      if (key) showAppToast(t(key), 4500);
    };
    window.addEventListener('sandbox-ear-safety-toast', onEarSafetyToast);
    return () => window.removeEventListener('sandbox-ear-safety-toast', onEarSafetyToast);
  }, [showAppToast, t]);

  useEffect(() => {
    const syncPins = () => setNavPinTabsState(loadNavPinTabs());
    window.addEventListener(NAV_PINS_CHANGE_EVENT, syncPins);
    return () => window.removeEventListener(NAV_PINS_CHANGE_EVENT, syncPins);
  }, []);

  const {
    mobileTabItems,
    navItems,
    mobileMenuItems,
    mobileMenuActiveId,
    mobileTabActiveId,
    mobileNavBadges,
    mobileDownloadBadge,
    podcastDownloadBadge,
    audiobookDownloadBadge,
  } = useShellNavConstruction({
    navPinTabs,
    t,
    discoverStationEnabled,
    collectionStationEnabled,
    sonicLockerEnabled,
    podcastsEnabled,
    audiobooksEnabled,
    libraryStationEnabled,
    proAudio,
    profileDisplayName: profile.activeProfile?.displayName,
    station,
    discoverTab,
    mobileSearchOpen,
    discoverReleaseBadge,
    podcastEpisodeBadge,
  });

  /** Dismiss search overlay immediately (X, backdrop, hardware back). */
  const closeMobileSearchOverlayNow = useCallback(() => {
    setSearchDropdownOpen(false);
    setMobileSearchOpen(false);
    searchInputRef.current?.blur();
    resetMobileKeyboardInsets();
  }, []);

  /**
   * After picking a dropdown row / submitting search: close dropdown now but defer
   * unmounting the mobile header so the synthesized click cannot hit the tab bar.
   */
  const finishMobileSearchNavigation = useCallback(() => {
    setSearchDropdownOpen(false);
    searchInputRef.current?.blur();
    resetMobileKeyboardInsets();
    if (!showMobileShell) return;
    mobileSearchCommitGuardUntilRef.current = Date.now() + 360;
    window.setTimeout(() => setMobileSearchOpen(false), 320);
  }, [showMobileShell]);

  /** Close search chrome but keep the user on the search station (avoids home/locker flash). */
  const transitionToSearchStation = useCallback(() => {
    if (station !== 'search') {
      searchReturnStationRef.current = station;
    }
    setStation('search');
    finishMobileSearchNavigation();
  }, [station, finishMobileSearchNavigation]);

  const closeMobileSearch = useCallback(() => {
    closeMobileSearchOverlayNow();
  }, [closeMobileSearchOverlayNow]);

  const openMobileSearch = useCallback(() => {
    setMobileNowPlayingOpen(false);
    setMobileSearchOpen(true);
    setSearchDropdownOpen(true);
    void import('./stations/SearchResultsView');
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });
  }, []);

  const shellMobileNavActions = useShellMobileNavActions({
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
    openDownloads: openAllDownloads,
  });

  useEffect(() => {
    setIsTV(detectTVPlatform());
    syncCarModeFromPrefs();
    setCarModeTick((t) => t + 1);
    return subscribeCarMode(() => setCarModeTick((t) => t + 1));
  }, []);

  useEffect(() => {
    requestAndroidPermissions(showAppToast);
  }, [showAppToast]);

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const sync = () => setNarrowShell(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const form = searchFormRef.current;
    const showSearch =
      !isTV &&
      !isCarMode &&
      station !== 'settings' &&
      station !== 'dj' &&
      (!showMobileShell || mobileSearchOpen);
    if (!form || !showSearch) return;

    const updateSearchBarBottom = () => {
      if (searchBarBottomRafRef.current !== 0) return;
      searchBarBottomRafRef.current = window.requestAnimationFrame(() => {
        searchBarBottomRafRef.current = 0;
        const rect = form.getBoundingClientRect();
        document.documentElement.style.setProperty(
          '--search-bar-bottom',
          `${rect.bottom}px`,
        );
      });
    };

    updateSearchBarBottom();
    window.addEventListener('resize', updateSearchBarBottom);
    const observer = new ResizeObserver(updateSearchBarBottom);
    observer.observe(form);
    return () => {
      if (searchBarBottomRafRef.current !== 0) {
        window.cancelAnimationFrame(searchBarBottomRafRef.current);
        searchBarBottomRafRef.current = 0;
      }
      window.removeEventListener('resize', updateSearchBarBottom);
      observer.disconnect();
    };
  }, [isTV, isCarMode, station, showMobileShell, mobileSearchOpen]);

  useShellTvBackHandler({
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
  });

  useEffect(() => subscribePlaylists(() => setTvPlaylists(loadPlaylists())), []);

  useShellStationSettingsSync({
    station,
    setProAudio,
    setPodcastsEnabled,
    setAudiobooksEnabled,
    setDiscoverStationEnabled,
    setCollectionStationEnabled,
    setSonicLockerEnabled,
    audiobooksReturnStationRef,
  });

  useEffect(() => {
    if (station === 'podcasts') setPodcastsMounted(true);
    if (station === 'audiobooks') setAudiobooksMounted(true);
  }, [station]);

  useShellStationGuards({
    station,
    proAudio,
    podcastsEnabled,
    audiobooksEnabled,
    discoverStationEnabled,
    libraryStationEnabled,
    sonicLockerEnabled,
    settingsReturnStationRef,
    setStation,
  });

  useEffect(() => {
    const syncLockerTracks = () => {
      const entries = getLockerEntriesSnapshot();
      if (!entries) return;
      setLockerTracks(
        entries.map((e) => ({
          id: e.id,
          title: e.title,
          artist: e.artist,
          genre: e.genre,
          bitrate: 320,
          durationSeconds: e.durationSeconds || 210,
          priority: 5,
          url: e.url,
        })),
      );
      // Precompute album art once (O(n)) instead of resolveLockerEntryGroupArt per row (O(nÂ²)).
      // This runs inside setState on every vault cache update, so on a large vault the old path
      // was seconds of synchronous work re-rendering the whole shell each time.
      const groupArt = buildLockerGroupArtMap(entries);
      setLockerEnvelopes(
        entries.map((e) => ({
          envelopeId: `local-${e.id}`,
          title: e.title,
          artist: e.artist,
          album: e.albumName,
          url: e.url,
          durationSeconds: e.durationSeconds || 210,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: e.id,
          artworkUrl: resolveLockerEntryGroupArtFromMap(e, groupArt),
          releaseYear: e.releaseYear,
        })),
      );
    };
    syncLockerTracks();
    return subscribeLockerCache(syncLockerTracks);
  }, []);

  const { runSearch } = useShellSearchRunner({
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
  });

  useEffect(() => {
    registerE2eHandlers(
      buildE2eSearchHandlers({
        runSearch,
        handleMobileTabNavigate: shellMobileNavActions.handleMobileTabNavigate,
        transitionToSearchStation,
        setNavOpen,
        setOnboardingComplete,
        searchHitsRef,
        unifiedSearchResultRef,
        webSupplementTracksRef,
        station,
        setStation,
        setHomeAwaitingUserResume,
        audio,
        playEnvelopeRef,
        audioEnvelopeRef,
        audioCurrentTimeRef,
        audioDurationRef,
        audioStateRef,
        searchReturnStationRef,
        searchLoadingRef,
        unifiedSearchLoadingRef,
        setPodcastsEnabled,
      }),
    );
  }, [runSearch, shellMobileNavActions.handleMobileTabNavigate, transitionToSearchStation, station]);

  const { runExploreSearch, handleBrowsePick } = useShellExploreSearch({
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
  });

  const handleOpenVideoFeed = useCallback(() => {
    finishMobileSearchNavigation();
    setNavOpen(false);
    setVideoFeedOpen(true);
  }, [finishMobileSearchNavigation]);

  const handleQuickFilter = useCallback(
    (filter: QuickBrowseFilter) => {
      setSearchDropdownOpen(false);
      searchInputRef.current?.blur();
      closeMobileSearch();
      if (filter.action.kind === 'videoFeed') {
        handleOpenVideoFeed();
        return;
      }
      if (filter.action.kind === 'explore') {
        void runExploreSearch(filter.action.label, filter.action.group);
        return;
      }
      setStation(filter.action.station);
      setNavOpen(false);
    },
    [runExploreSearch, closeMobileSearch, handleOpenVideoFeed],
  );

  useShellSearchDropdownEffects({
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
  });

  useLayoutEffect(() => {
    registerShellScrollContainer(shellMainRef.current);
    return () => registerShellScrollContainer(null);
  }, []);

  useLayoutEffect(() => {
    flushPendingShellScrollRestore();
  }, [
    station,
    albumDrillQuery,
    selectedArtist?.id,
    searchHits.length,
    searchLoading,
    lockerSection,
    lockerHomeResetKey,
  ]);

  const { clearSearchView, handleAlbumBack, handleSearchBack, handleArtistBack } =
    useShellSearchHistoryNav({
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
    });

  const { handleShellBackRef } = useShellBackNavigation({
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
  });

  const { handleSelectArtist, handleOpenArtistByName, handleOpenAlbumByName, handleSelectAlbum } =
    useShellSearchDrillNav({
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
      audioEnvelopeArtworkUrl: audio.envelope?.artworkUrl,
      runSearch,
      setAppToast,
      selectedArtist,
      searchScrollParentRef,
    });

  const handleOpenDownloadJob = useCallback(
    (job: DownloadJob) => {
      setMobileDownloadSheetOpen(false);
      if (job.mode === 'album') {
        const albumTitle = job.albumTitle?.trim() || job.label.trim();
        if (albumTitle) {
          handleOpenAlbumByName(job.artist, albumTitle);
        }
        return;
      }
      if (job.albumTitle?.trim()) {
        handleOpenAlbumByName(job.artist, job.albumTitle);
        return;
      }
      const query = `${job.artist} ${job.label}`.trim();
      if (!query) return;
      setQueueDrawerOpen(false);
      setTvQueueOpen(false);
      setMobileNowPlayingOpen(false);
      setSearchDropdownOpen(false);
      setSelectedArtist(null);
      setAlbumDrillQuery(null);
      setAlbumDrillAlbum(null);
      setAlbumDrillTracks([]);
      albumHistoryPushedRef.current = false;
      setStation('search');
      setNavOpen(false);
      void runSearch(query);
    },
    [handleOpenAlbumByName, runSearch],
  );

  const shellDownloadHandlers = useShellDownloadHandlers({
    downloadTierPreference,
    setDownloadTierPreference,
    albumDrillAlbum,
    albumDrillAlbumRef,
    albumDrillTracksRef,
    showMobileShell,
    showAppToast,
  });

  /** Universal search row tapped â€” route to the pillar that owns it. */
  const handleUniversalSearchSelect = useCallback(
    (hit: UniversalHit) => {
      if (hit.format === 'music') {
        const entry = hit.payload as { id?: string } | undefined;
        if (hit.owned && entry?.id) {
          const env = (getLockerEntriesSnapshot() ?? []).find((e) => e.id === entry.id);
          if (env) {
            void handlePlayEnvelope(lockerEntryToEnvelope(env));
            return;
          }
        }
        void runSearch(`${hit.title} ${hit.subtitle}`.trim());
        return;
      }
      // Podcast/audiobook rows open their own station, which owns subscribe/download.
      closeMobileSearch();
      setStation(hit.format === 'podcast' ? 'podcasts' : 'audiobooks');
    },
    [closeMobileSearch, runSearch],
  );

  const handleUniversalOpenFormat = useCallback(
    (format: UniversalFormat) => {
      if (format === 'music') return;
      closeMobileSearch();
      setStation(format === 'podcast' ? 'podcasts' : 'audiobooks');
    },
    [closeMobileSearch],
  );

  const handleCacheSearchHit = useCallback(
    (hit: ResolvedSearchHit) => {
      void cacheEnvelopeForOffline(hit.primaryEnvelope, hit.sources).catch((err) => {
        console.warn('[handleCacheSearchHit] failed:', err);
      });
    },
    [],
  );

  const handleCacheTrack = useCallback((track: CatalogTrack) => {
    if (!track.envelope) return;
    void cacheEnvelopeForOffline(track.envelope).catch((err) => {
      console.warn('[handleCacheTrack] failed:', err);
    });
  }, []);

  const { navigateSearchQuery, handleSelectSuggestion } = useShellSearchNavigate({
    setSearchInput,
    transitionToSearchStation,
    runExploreSearch,
    handleSelectArtist,
    runSearch,
    searchCatalogArtists: searchCatalog.artists,
    unifiedSearchArtists: unifiedSearchResult.artists,
  });

  const {
    connectClientRef,
    isConnectRemoteRef,
    connectRolePref,
    networkSyncEnabled,
    remoteMirror,
    setRemoteMirror,
    effectiveConnectRole,
    sendConnectCommand,
  } = useShellConnect();

  const {
    playGenerationRef,
    primeLockerNativeQueueFrom,
    seedLockerAlbumPlayQueue,
    logLockerQueueInstrumentation,
    nowPlayingDisplayRef,
    authoritativeEnvelopeRef,
    audioEnvelopeRef,
    audioStateRef,
    audioVolumeRef,
    audioCurrentTimeRef,
    audioDurationRef,
    audioStreamDurationRef,
    trackReachedPlayingRef,
    trackReachedPlayingAtRef,
    exoGaplessTransitionAtRef,
    instantHandoffEnvelopeIdRef,
    sessionPeakSecondsRef,
    flushPlaySession,
    findHitCandidates,
  } = useShellQueuePlaybackFoundation({
    audio,
    playQueueRef,
    queueIndexRef,
    setPlayQueue,
    setQueueIndex,
    setShuffleOn,
    setRepeatMode,
    setMixRadioSession,
    mixRadioSessionRef,
    autoSimilarRadioSeedRef,
    sessionEnvelopeRef,
    searchHitsRef,
  });

  const { handlePlayEnvelope, adoptInPlaceQueueTrack, persistLockerPlayRepair } = usePlayEnvelope({
    audio,
    playQueue,
    playQueueRef,
    queueIndex,
    queueIndexRef,
    setPlayQueue,
    setQueueIndex,
    setRepeatMode,
    setMixRadioSession,
    autoSimilarRadioSeedRef,
    albumDrillAlbum,
    albumDrillAlbumRef,
    albumDrillTracksRef,
    searchHitsRef,
    searchResultsRef,
    setHomeAwaitingUserResume,
    setMobilePlayerPending,
    showMobileShell,
    showAppToast,
    t,
    openSettings: shellMobileNavActions.openSettings,
    connectRolePref,
    networkSyncEnabled,
    isConnectRemoteRef,
    remoteMirror,
    sendConnectCommand,
    syncThumbsFromFeedback,
    playGenerationRef,
    trackReachedPlayingRef,
    trackReachedPlayingAtRef,
    instantHandoffEnvelopeIdRef,
    audioEnvelopeRef,
    setPlaybackDisplaySeed,
    setArtworkUrl,
    scheduleAutoSimilarRadioRef,
  });

  // scheduleAutoSimilarRadio is intentionally unread here — the hook wires
  // scheduleAutoSimilarRadioRef.current itself; downstream code always calls through the ref.
  const shellPlayTriggers = useShellPlayTriggers({
    audio,
    t,
    handlePlayEnvelope,
    findHitCandidates,
    primeLockerNativeQueueFrom,
    showAppToast,
    setHomeAwaitingUserResume,
    setMobilePlayerPending,
    setPlayQueue,
    setQueueIndex,
    setMixRadioSession,
    setRepeatMode,
    setShuffleOn,
    setMixRadioSaveOpen,
    playQueueRef,
    mixRadioSessionRef,
    autoSimilarRadioSeedRef,
    repeatModeRef,
    audioEnvelopeRef,
    albumDrillTracksRef,
    albumDrillAlbumRef,
    searchHitsRef,
    scheduleAutoSimilarRadioRef,
    logLockerQueueInstrumentation,
    seedLockerAlbumPlayQueue,
  });

  const podcastsActiveEnvelopeId = useStableEnvelopeId(audio.envelope?.envelopeId);

  const primePlayEnvelope = useCallback(
    (env: MediaEnvelope) => {
      tapHaptic();
      audio.primePlaybackGesture(env);
      if (showMobileShell) {
        setMobilePlayerPending(true);
      }
    },
    [audio, showMobileShell],
  );

  const handleMobileTrackTitleTap = useCallback(
    async (env: MediaEnvelope, candidates?: CandidateSource[]) => {
      const sameTrack =
        audio.envelope?.envelopeId === env.envelopeId &&
        audio.state !== 'Idle' &&
        audio.state !== 'Failed' &&
        Boolean(audio.envelope?.url?.trim());
      const ok =
        sameTrack ||
        (await handlePlayEnvelope(env, candidates, { seedSearchQueue: true }));
      void ok;
    },
    [
      audio.envelope?.envelopeId,
      audio.envelope?.url,
      audio.state,
      handlePlayEnvelope,
    ],
  );

  const openMobileNowPlaying = useCallback(() => {
    setMobileNowPlayingOpen(true);
  }, []);

  const openHomePlayer = usePlayerHomeNavigation({
    showMobileShell,
    station,
    audio,
    setMobileSearchOpen,
    setMobileNowPlayingOpen,
    setNavOpen,
    setQueueDrawerOpen,
    setLyricsDrawerOpen,
    setStation,
  });

  const shellSearchDropdownActions = useShellSearchDropdownActions({
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
    unifiedPlaylists: unifiedSearchResult.playlists,
    searchActiveIndex,
    setSearchInput,
    setSearchCatalog,
    setUnifiedSearchResult,
    setSearchActiveIndex,
    searchInputRef,
  });

  const handleAcquireAndPlayHit = useCallback(
    (hit: ResolvedSearchHit) => {
      void acquireAndPlayHit(hit, {
        tier: downloadTierPreference,
        onPlay: (env, candidates) =>
          handlePlayEnvelope(env, candidates ?? hit.sources, { seedSearchQueue: true }),
        onToast: showAppToast,
      });
    },
    [downloadTierPreference, handlePlayEnvelope, showAppToast],
  );

  const { goToDiscover } = useShellGoToDiscover({
    setDiscoverTab,
    setStation,
    setNavOpen,
  });

  const playEnvelopeRef = useRef(handlePlayEnvelope);
  playEnvelopeRef.current = handlePlayEnvelope;

  useEffect(() => {
    installE2eLiveHandlers(
      buildE2eLiveHandlers({
        audio,
        playEnvelopeRef,
        setHomeAwaitingUserResume,
        setSelectedArtist,
        setStation,
        setNavOpen,
        runSearch,
        searchLoadingRef,
        albumDrillTracksRef,
        unifiedSearchResultRef,
        setAlbumDrillTracks,
        setAlbumDrillAlbum,
        setAlbumDrillQuery,
        audioEnvelopeRef,
        audioCurrentTimeRef,
        audioDurationRef,
        audioStateRef,
        setPlayQueue,
        setQueueIndex,
        navigateSearchQuery,
        nowPlayingDisplayRef,
        authoritativeEnvelopeRef,
        sessionEnvelopeRef,
        playQueueRef,
        queueIndexRef,
        shortcutCtxRef,
        lastSkipOutcomeRef,
        handleThumbUp,
        handleThumbDown,
        setHeroDisplayMode,
        handleShellBackRef,
        setMobileNowPlayingOpen,
        downloadTierPreference,
        setMixRadioSession,
        setShuffleOn,
        setRepeatMode,
        autoSimilarRadioSeedRef,
        logLockerQueueInstrumentation,
        primeLockerNativeQueueFrom,
        persistLockerPlayRepair,
        setMobilePlayerPending,
      }),
    );
    markE2ePlaybackHandlersLive();
  }, [audio.title, audio.artist, runSearch, downloadTierPreference, navigateSearchQuery, handleThumbUp, handleThumbDown]);

  const {
    podcastPlaybackSpeed,
    podcastSmartSpeedEnabled,
    podcastVoiceBoostEnabled,
    podcastSkipAdChaptersEnabled,
    podcastChapters,
    episodeVolumeBoostDb,
    handleCyclePodcastSpeed,
    handleTogglePodcastSmartSpeed,
    handleTogglePodcastSkipAdChapters,
    handleTogglePodcastVoiceBoost,
    handleCycleEpisodeVolumeBoost,
    handlePodcastPrevChapter,
    handlePodcastNextChapter,
    handleSkipPodcastAd,
    podcastSkipAdHint,
  } = useShellPodcastControls(audio, audioCurrentTimeRef, audioEnvelopeRef);

  useShellCastRuntime({
    audio,
    artworkUrl,
    playQueue,
    queueIndex,
    setCastMode,
    setSpeakerCast,
    speakerCast,
    audioCurrentTimeRef,
  });

  useEffect(() => {
    publishVinylWidgetState({
      title: audio.title || 'Sandbox Music',
      artist: audio.artist || '',
      artworkUrl: artworkUrl || audio.envelope?.artworkUrl,
      playing: audio.state === 'Playing',
      currentTimeSeconds: audio.currentTimeSeconds,
      durationSeconds: audio.durationSeconds,
    });
  }, [
    audio.title,
    audio.artist,
    audio.state,
    audio.currentTimeSeconds,
    audio.durationSeconds,
    audio.envelope?.artworkUrl,
    artworkUrl,
  ]);

  useEffect(() => {
    if (isConnectRemoteRef.current || playQueue.length === 0) return;
    if (!audio.envelope?.url?.trim()) return;
    if (audio.state === 'Idle' || audio.state === 'Failed') return;
    // Prefetch upcoming tracks while loading or playing â€” don't wait for Playing only
    // (locked-screen WebView throttling can delay prefetch if we defer too long).
    if (audio.state !== 'Playing' && audio.state !== 'Ready' && audio.state !== 'Connecting') {
      return;
    }

    prefetchUpcomingQueueTracks({
      playQueue,
      queueIndex,
      repeatMode,
      findCandidates: findHitCandidates,
      onResolvedUrl: (url, envelope) =>
        audio.prebufferUrl(url, {
          title: envelope.title,
          artist: envelope.artist,
          album: envelope.album,
          artworkUrl: envelope.artworkUrl,
          envelopeId: envelope.envelopeId,
        }),
    });

    const wifiPrefetchInput = {
      playQueue,
      queueIndex,
      repeatMode,
      findCandidates: findHitCandidates,
    };
    prefetchUpcomingOnWifi(wifiPrefetchInput);
    cacheUpcomingOnWifi(wifiPrefetchInput);

    if (getTier34BaseUrl().trim()) {
      stageUpcomingQueueOnTier34({
        playQueue,
        queueIndex,
        repeatMode,
        findCandidates: findHitCandidates,
      });
    }
  }, [
    audio.prebufferUrl,
    audio.state,
    audio.envelope?.url,
    playQueue,
    queueIndex,
    repeatMode,
    findHitCandidates,
  ]);

  const shuffleOnRef = useRef(shuffleOn);
  const sovereignUpNextPodcastCountRef = useRef(0);

  /*
   * Which queue positions this shuffle cycle has already used, so every track plays once before any
   * of them comes round again. Held across tracks because the advance itself is pure.
   *
   * The cycle starts over when the queue is no longer the same queue, or when shuffle is switched.
   * Carrying positions from one queue into the next would mark tracks as heard that have never
   * played, and shuffle would stop early on a queue it had barely started.
   */
  const shufflePlayedRef = useRef<number[]>([]);
  const shuffleCycleKeyRef = useRef('');
  const shuffleCycleKey = `${shuffleOn}|${playQueue.length}|${
    playQueue[0]?.envelopeId ?? ''
  }|${playQueue[playQueue.length - 1]?.envelopeId ?? ''}`;
  if (shuffleCycleKeyRef.current !== shuffleCycleKey) {
    shuffleCycleKeyRef.current = shuffleCycleKey;
    shufflePlayedRef.current = [];
  }

  playQueueRef.current = playQueue;
  queueIndexRef.current = queueIndex;
  repeatModeRef.current = repeatMode;
  shuffleOnRef.current = shuffleOn;
  mixRadioSessionRef.current = mixRadioSession;

  useShellExoTransition({
    audio,
    playQueueRef,
    audioEnvelopeRef,
    queueIndexRef,
    repeatModeRef,
    exoGaplessTransitionAtRef,
    setQueueIndex,
    syncThumbsFromFeedback,
    findHitCandidates,
    adoptInPlaceQueueTrack,
    primeLockerNativeQueueFrom,
  });

  const { queuePersistReady, queueRestorePendingRef } = useShellQueueRestore({
    audio,
    setPlayQueue,
    setQueueIndex,
    setShuffleOn,
    setRepeatMode,
    setHomeAwaitingUserResume,
    playEnvelopeRef,
    findHitCandidates,
    audioEnvelopeRef,
    audioStateRef,
    playGenerationRef,
  });

  useEffect(() => {
    if (isStablePlaybackFsmState(audio.state)) {
      markActivePlaybackSession();
    }
  }, [audio.state]);

  useEffect(() => {
    if (!isAndroid()) return;
    return subscribeNativeExoStatus((status) => {
      setAndroidNativePlaybackLive(isNativeExoAudible(status));
    });
  }, []);

  useEffect(() => {
    if (!showMobileShell || !isAndroid()) return;
    return initAndroidAppResume({
      reconcileFromNativeExo: () => audio.reconcileFromNativeExo(),
      setMobileNowPlayingOpen,
      setLyricsDrawerOpen,
      setHomeAwaitingUserResume,
    });
  }, [showMobileShell, audio.reconcileFromNativeExo]);

  // Stable callbacks via refs â€” must NOT depend on audio.play (recreated on
  // position ticks) or route watcher stop/start + soft-bind will stutter DAC.
  const wiredReconcileRef = useRef(audio.reconcileFromNativeExo);
  const wiredResumePlayRef = useRef(audio.play);
  wiredReconcileRef.current = audio.reconcileFromNativeExo;
  wiredResumePlayRef.current = audio.play;

  useEffect(() => {
    if (!showMobileShell || !isAndroid()) return;
    return initAndroidWiredDacStability({
      reconcileFromNativeExo: () => wiredReconcileRef.current(),
      resumePlayback: () => {
        void wiredResumePlayRef.current();
      },
    });
  }, [showMobileShell]);

  /** Mobile: keep home idle chrome until playback actually starts (player bar visible). */
  useEffect(() => {
    if (!showMobileShell) return;
    if (
      audio.envelope ||
      audio.state === 'Playing' ||
      audio.state === 'Ready' ||
      audio.state === 'Connecting' ||
      audio.state === 'Resolving'
    ) {
      setHomeAwaitingUserResume(false);
    }
  }, [showMobileShell, audio.envelope, audio.state]);


  const { handleDismissStuckPlayback } = useShellPlaybackHeal({
    audio,
    audioEnvelopeRef,
    audioStateRef,
    audioCurrentTimeRef,
    handlePlayEnvelope,
    findHitCandidates,
    showAppToast,
    t,
    setMobilePlayerPending,
    playGenerationRef,
  });

  useShellQueuePersistWrites({
    audio,
    queueRestorePendingRef,
    isConnectRemoteRef,
    playQueueRef,
    queueIndexRef,
    shuffleOnRef,
    repeatModeRef,
    audioEnvelopeRef,
    audioStateRef,
    audioCurrentTimeRef,
  });

  /*
   * Per-book listening position. The queue persistence below is one global slot: play a song and
   * your place in a ten-hour book is gone. This keys on the book instead, so every title keeps its
   * own position indefinitely.
   *
   * Polls refs on an interval rather than running per render â€” position updates fire several
   * times a second and this must not drive React work. The cleanup write is what captures the
   * position when the chapter changes, the player closes, or the app is backgrounded.
   */
  useEffect(() => {
    const bookKey = audiobookBookKeyFromEnvelopeId(audio.envelope?.envelopeId);
    if (!bookKey) return;
    let last = getAudiobookProgress(bookKey) ?? undefined;
    const persist = () => {
      const env = audioEnvelopeRef.current;
      const next = {
        bookKey,
        chapterIndex: Math.max(0, queueIndexRef.current),
        offsetSeconds: Math.max(0, Math.floor(audioCurrentTimeRef.current)),
        durationSeconds: Math.max(0, Math.floor(audioDurationRef.current)),
        chapterCount: playQueueRef.current.length,
        updatedAt: Date.now(),
        // The book, not the chapter â€” album carries the book title for an audiobook envelope.
        title: env?.album?.trim() || env?.title?.trim(),
        author: env?.artist?.trim(),
        artworkUrl: env?.artworkUrl,
      };
      if (!shouldPersistAudiobookProgress(last, next)) return;
      saveAudiobookProgress(next);
      last = next;
    };
    const timer = window.setInterval(persist, 5000);
    return () => {
      window.clearInterval(timer);
      persist();
    };
  }, [audio.envelope?.envelopeId]);

  useShellQueueSave({
    audio,
    playQueue,
    queueIndex,
    shuffleOn,
    repeatMode,
    queuePersistReady,
    isConnectRemoteRef,
  });

  useEffect(() => {
    if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) {
      if (!trackReachedPlayingRef.current) {
        trackReachedPlayingAtRef.current = Date.now();
      }
      trackReachedPlayingRef.current = true;
    }
  }, [audio.state, audio.nativeExoEffectivePlaying]);

  useShellQueueAdvanceOnEnded({
    audio,
    playQueueRef,
    queueIndexRef,
    repeatModeRef,
    shuffleOnRef,
    shufflePlayedRef,
    audioCurrentTimeRef,
    audioStreamDurationRef,
    audioDurationRef,
    trackReachedPlayingRef,
    trackReachedPlayingAtRef,
    sessionPeakSecondsRef,
    audioEnvelopeRef,
    exoGaplessTransitionAtRef,
    playEnvelopeRef,
    findHitCandidates,
    searchHitsRef,
    mixRadioSessionRef,
    setPlayQueue,
    setQueueIndex,
    setMixRadioSession,
    setRepeatMode,
    setShuffleOn,
    autoSimilarRadioSeedRef,
    primeLockerNativeQueueFrom,
    sovereignUpNextPodcastCountRef,
    showAppToast,
    t,
    adoptInPlaceQueueTrack,
    syncThumbsFromFeedback,
  });

  const shellPlaybackQueue = usePlaybackQueue({
    playQueue,
    setPlayQueue,
    queueIndex,
    setQueueIndex,
    isConnectRemoteRef,
    sendConnectCommand,
    handlePlayEnvelope,
    findHitCandidates,
    setMixRadioSession,
    autoSimilarRadioSeedRef,
    sovereignUpNextPodcastCountRef,
    showAppToast,
    t,
  });

  const recentPlayHistory = useMemo(
    () => getRecentlyPlayed(5),
    [audio.envelope?.envelopeId, audio.state, playQueue.length],
  );

  const shellPlayActions = useShellPlayActions({
    audio,
    isConnectRemoteRef,
    sendConnectCommand,
    setPlayQueue,
    setQueueIndex,
    playQueueRef,
    queueIndexRef,
    setRepeatMode,
    setShuffleOn,
    setMixRadioSession,
    mixRadioSession,
    playQueue,
    autoSimilarRadioSeedRef,
    primeLockerNativeQueueFrom,
    handlePlayEnvelope,
    findHitCandidates,
    syncThumbsFromFeedback,
    setArtworkUrl,
    showAppToast,
    setAppToast,
    goToDiscover,
    setLockerSection,
    setMixRadioSaveOpen,
    setMixRadioSaveBusy,
    downloadTierPreference,
    t,
  });

  const shellQueueResume = useShellQueueResume({
    playQueue,
    audioState: audio.state,
    handlePlayAlbum: shellPlayActions.handlePlayAlbum,
    setHomeAwaitingUserResume,
  });

  // Mix-page Download lives in useShellDownloadMix, called right below Share since the two used
  // to be declared as one pair (Download reuses the travel prefetch; Share exports/copies M3U).
  const { handleDownloadMix } = useShellDownloadMix({
    handlePrepareForTravel: shellPlayActions.handlePrepareForTravel,
  });

  const suggestedQueueTracks = useMemo(
    () =>
      queueDrawerOpen
        ? buildSuggestedQueueTracks(audio.envelope, playQueue)
        : [],
    [queueDrawerOpen, audio.envelope, playQueue],
  );

  const cycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === 'none' ? 'one' : m === 'one' ? 'all' : 'none'));
  }, []);

  const { skipBack, skipForward, lastSkipOutcomeRef } = useShellSkipControls({
    isConnectRemoteRef,
    sendConnectCommand,
    audio,
    queueIndex,
    setQueueIndex,
    playQueue,
    repeatMode,
    shuffleOn,
    shufflePlayedRef,
    syncThumbsFromFeedback,
    adoptInPlaceQueueTrack,
    handlePlayEnvelope,
    findHitCandidates,
    sovereignUpNextPodcastCountRef,
  });

  const { homeListeningPreview } = useShellPlaySessionEffects({
    audio,
    audioEnvelopeRef,
    audioDurationRef,
    audioCurrentTimeRef,
    sessionEnvelopeRef,
    sessionPeakSecondsRef,
    flushPlaySession,
    syncThumbsFromFeedback,
  });

  const playbackResolveElapsed = usePlaybackResolveElapsed(
    audio.state,
    audio.envelope?.envelopeId,
  );

  const playbackFidelityLabel = useMemo(() => {
    const mobileOfflineResolve =
      isAndroid() && hasActiveMobileResolvers() && preferFreshMobileResolve();
    const streamLabel = audio.envelope
      ? mobileOfflineResolve
        ? 'MOBILE'
        : displayTransportLabel(
            audio.envelope.provider,
            audio.envelope.transport,
            audio.envelope.url,
            audio.envelope.resolutionSource,
          )
      : null;
    return resolvePlaybackFidelityLabel(audio.envelope, { streamLabel, t });
  }, [audio.envelope, t]);

  const handleOpenPlaylistsPrompt = useCallback(() => {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem('sandbox-playlists-open-ai', '1');
    }
    goToDiscover('playlists');
  }, [goToDiscover]);

  const homeRecentlyAdded = useMemo(() => {
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return [];
    return [...entries]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 4)
      .map((e) => ({
        id: `local-${e.id}`,
        title: e.title,
        subtitle: e.artist || 'Unknown artist',
      }));
  }, [lockerEnvelopes]);

  const shellTvHome = useShellTvHome({
    lockerEnvelopes,
    playQueue,
    searchHits,
    homeLastQueue: shellQueueResume.homeLastQueue,
    audio,
    tvPlaylists,
    handlePlayEnvelope,
    findHitCandidates,
    handleResumeLastQueue: shellQueueResume.handleResumeLastQueue,
    handlePlayAlbum: shellPlayActions.handlePlayAlbum,
    goToDiscover,
    setTvScreen,
    setStation,
  });

  useShellConnectRuntime({
    audio,
    playQueue,
    queueIndex,
    setPlayQueue,
    setQueueIndex,
    setArtworkUrl,
    setRemoteMirror,
    effectiveConnectRole,
    networkSyncEnabled,
    connectClientRef,
    resolveEnvelopeById: shellTvHome.resolveEnvelopeById,
    playEnvelopeRef,
    findHitCandidates,
    skipForward,
    skipBack,
    handleAddToQueue: shellPlaybackQueue.handleAddToQueue,
    handleRemoveFromQueue: shellPlaybackQueue.handleRemoveFromQueue,
    handleReorderQueue: shellPlaybackQueue.handleReorderQueue,
    handleClearQueue: shellPlaybackQueue.handleClearQueue,
    audioEnvelopeRef,
    audioCurrentTimeRef,
    audioDurationRef,
    audioStateRef,
    audioVolumeRef,
    playQueueRef,
    queueIndexRef,
  });

  useShellArtworkResolution({
    audio,
    artworkUrl,
    setArtworkUrl,
    lockerEnvelopes,
  });

  const isConnectRemote = effectiveConnectRole === 'remote';

  const [nativePlaybackPreferred, setNativePlaybackPreferred] = useState(false);
  useEffect(() => {
    void shouldPreferAndroidNativePlayback().then(setNativePlaybackPreferred);
  }, []);

  const stemMixBlocked =
    isConnectRemote || nativePlaybackPreferred || Boolean(audio.nativeExoEffectivePlaying);

  const serverStemMix = useServerStemMix({
    envelope: audio.envelope,
    currentTimeSeconds: audio.currentTimeSeconds,
    mainIsPlaying: audio.state === 'Playing' || audio.nativeExoEffectivePlaying,
    stemMixBlocked,
    onStemMixActivate: () => {
      if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) audio.pause();
    },
    resumeMainPlayback: () => {
      audio.primePlaybackGesture();
      void audio.play({ userGesture: true });
    },
  });

  const stemSlidersPanelProps = useMemo(
    () => ({
      enabled: serverStemMix.stemMixEnabled,
      onEnabledChange: serverStemMix.setStemMixEnabled,
      stemsAvailable: serverStemMix.stemsAvailable,
      stemsLoading: serverStemMix.stemsLoading,
      blocked: stemMixBlocked,
      gains: serverStemMix.gains,
      onGainChange: serverStemMix.setStemGain,
    }),
    [
      serverStemMix.stemMixEnabled,
      serverStemMix.setStemMixEnabled,
      serverStemMix.stemsAvailable,
      serverStemMix.stemsLoading,
      serverStemMix.gains,
      serverStemMix.setStemGain,
      stemMixBlocked,
    ],
  );

  const shellLyricsResolve = useShellLyricsResolve({
    isConnectRemote,
    remoteMirror,
    resolveEnvelopeById: shellTvHome.resolveEnvelopeById,
    audio,
    effectiveConnectRole,
    sendConnectCommand,
    serverStemMix,
    lyricsDrawerOpen,
    mobileNowPlayingOpen,
    setActiveLyrics,
  });

  useEffect(() => {
    if (!audio.envelope && audio.state === 'Idle') {
      setPlaybackDisplaySeed(null);
      setArtworkUrl('');
    }
  }, [audio.envelope, audio.state]);

  const profileName = profile.activeProfile?.displayName ?? 'Operator';

  const { lockerFeatured, hasActivePlayback, homeHasLoadedTrack } = useShellPlaybackChrome({
    audio,
    lockerEnvelopes,
    homeAwaitingUserResume,
    queuePersistReady,
    effectiveConnectRole,
    remoteMirrorCurrentTrackId: remoteMirror?.currentTrackId,
    androidNativePlaybackLive,
    showMobileShell,
    mobilePlayerPending,
    setMobilePlayerPending,
    mobileNowPlayingOpen,
    station,
  });

  const {
    liveNowPlayingDisplay,
    nowPlayingAuthority,
    authoritativeEnvelope,
    nowPlayingDisplay,
    homeTitle,
    homeArtist,
    homeAlbum,
    homeArt,
    homeDisplayState,
  } = useShellNowPlayingDisplay({
    audio,
    playbackDisplaySeed,
    artworkUrl,
    lockerFeatured,
    hasActivePlayback,
    heldNowPlaying,
    setHeldNowPlaying,
    instantHandoffEnvelopeIdRef,
    playbackResolveElapsed,
    lockerEnvelopes,
    playGenerationRef,
    audioEnvelopeRef,
    showAppToast,
    t,
    setMobilePlayerPending,
  });
  nowPlayingDisplayRef.current = nowPlayingDisplay;
  authoritativeEnvelopeRef.current = authoritativeEnvelope;

  const playerDownloadEnabled =
    homeHasLoadedTrack &&
    Boolean(
      audio.envelope?.envelopeId ||
        audio.envelope?.title?.trim() ||
        audio.title?.trim() ||
        homeTitle.trim(),
    );

  const { downloadCurrentTrack } = useShellDownloadCurrentTrack({
    audioEnvelope: audio.envelope,
    audioTitle: audio.title,
    audioArtist: audio.artist,
    homeTitle,
    homeArtist,
    homeAlbum,
    handleDownloadTrack: shellDownloadHandlers.handleDownloadTrack,
  });

  const [heroDisplayMode, setHeroDisplayMode] = useState(loadHeroDisplayMode);
  useEffect(() => {
    const sync = (event: Event) => {
      applyHeroDisplayFromSettingsEvent(event, setHeroDisplayMode);
    };
    window.addEventListener('sandbox-settings-change', sync);
    return () => window.removeEventListener('sandbox-settings-change', sync);
  }, []);

  const homeGradientSeed = homeTitle.trim() || homeAlbum?.trim() || 'Sandbox';
  const homeShowShades = resolveHeroShowShades(
    heroDisplayMode,
    Boolean(homeArt?.trim()),
    { idleHome: !homeHasLoadedTrack },
  );
  const showMusicUniverse = useShowMusicUniverse({
    isCarMode,
    station,
    hasLoadedTrack: homeHasLoadedTrack,
    isTV,
    tvScreen,
  });
  const {
    showHomeActiveWash,
    homeGenreBucket,
    vinylCssVars,
    vinylPsycheClass,
    musicUniverseStyle,
    homeArtUniverseClass,
    miniPlayerNavigatesHome,
    mobilePlayingFromLabel,
  } = useShellHomeArtStyle({
    station,
    homeHasLoadedTrack,
    showMusicUniverse,
    isCarMode,
    showMobileShell,
    isTV,
    audioEnvelope: audio.envelope,
    homeArt,
    homeGradientSeed,
    mixRadioSession,
    t,
  });

  // embeddedChapters / scannedChapters feed bookChapterMarks inside the hook and are not
  // read again here.
  const shellNowPlayingChapters = useShellNowPlayingChapters({
    serverStemMix,
    isConnectRemote,
    remoteMirror,
    nowPlayingAuthority,
    nowPlayingDisplay,
    audio,
    lockerFeatured,
    lyricsEnvelope: shellLyricsResolve.lyricsEnvelope,
    authoritativeEnvelope,
    podcastChapters,
    playQueue,
    queueIndex,
    homeTitle,
    homeArtist,
    homeAlbum,
  });

  const displayArt = homeArt;
  const showTopSearchBase = !isTV && !isCarMode && station !== 'settings' && station !== 'dj';
  const showHomeIdleChrome =
    showTopSearchBase && !showMobileShell && station === 'home' && !homeHasLoadedTrack;
  const showTopSearch =
    showTopSearchBase && (!showMobileShell || mobileSearchOpen || station === 'search');
  /** Album drill is full-page â€” never stack the typeahead panel over it. */
  const blockSearchDropdown = Boolean(albumDrillAlbum);
  const searchDropdownEffectiveOpen = searchDropdownOpen && !blockSearchDropdown;
  /**
   * Mobile shell header â€” only the search overlay needs it now.
   *
   * It used to render on 'locker' purely to host the downloads button, costing a 52px empty band
   * above the content. Discover never had it, so the segment tabs jumped 52px when you crossed
   * between segments. Downloads live in each station's own overflow menu (filtered by media kind),
   * so every Music segment starts flush at the top.
   */
  const showMobileShellHeader = showMobileShell && (mobileSearchOpen || station === 'search');
  const showShellHeaderOffset = showTopSearch;

  const navActiveId: NavItemId = navItems.some((i) => i.id === station) ? station : 'home';
  const tvActiveStation: TVStationId =
    station === 'discover' ||
    station === 'locker' ||
    station === 'sonic-locker' ||
    station === 'dj' ||
    station === 'settings'
      ? station === 'sonic-locker'
        ? 'locker'
        : station
      : 'home';
  const tvNowPlaying =
    homeHasLoadedTrack && (homeTitle || homeArtist)
      ? {
          id: audio.envelope?.envelopeId ?? lockerFeatured?.envelopeId ?? 'now',
          title: homeTitle,
          subtitle: homeArtist,
          artworkUrl: homeArt,
        }
      : null;

  const { togglePlay } = useShellTogglePlay({
    serverStemMix,
    isConnectRemoteRef,
    remoteMirror,
    sendConnectCommand,
    audio,
    showAppToast,
    t,
    persistLockerPlayRepair,
  });

  const { shortcutCtxRef } = useShellMediaSessionWiring({
    audio,
    togglePlay,
    skipBack,
    skipForward,
    narrationPlayback,
    showMobileShell,
    openMobileSearch,
    searchInputRef,
    setSearchDropdownOpen,
    isTV,
    isCarMode,
    nowPlayingDisplay,
    homeArt,
    t,
    authoritativeEnvelope,
    artworkUrl,
    nowPlayingAuthority,
  });

  const { handleEnterCarMode, handleExitCarMode, sleepTimerLabel } = useShellCarModeAndSleepTimer({
    isTV,
    isCarMode,
    closeMobileSearch,
    setNavOpen,
    setQueueDrawerOpen,
    setLyricsDrawerOpen,
    setSleepTimerPanelOpen,
    setCastPickerOpen,
    carHistoryPushedRef,
    t,
    shortcutCtxRef,
    audio,
    sendConnectCommand,
    findHitCandidates,
    playEnvelopeRef,
    isConnectRemoteRef,
    sleepTimerTick,
    setSleepTimerTick,
  });

  /*
   * Above the entry gates like the rest of the hooks, and unconditional: a device left on the
   * login screen is still a device whose library should be up to date when somebody signs in.
   */
  useShellLockerSync();

  useAndroidShellBridges({
    playQueue,
    playQueueRef,
    playEnvelopeRef,
    shortcutCtxRef,
    sendConnectCommand,
  });

  const showCarModeOffer =
    !isTV &&
    !isCarMode &&
    !showMobileShell &&
    isAndroidNative() &&
    loadCarModeAutoOffer() &&
    !carOfferDismissed;

  /*
   * Above the entry gates, because it is a hook and they return early.
   *
   * The gates replace the whole shell -- login, onboarding, server setup, car mode -- so anything
   * below the return is skipped on those renders. Putting hook calls under them meant the first
   * render ran a short list and the render right after (signing in, finishing onboarding, leaving
   * car mode) ran a longer one, which is React error #310: the shell died at the moment it should
   * have appeared, and only ever on the transition, so a device with a profile already saved never
   * showed it.
   *
   * Nothing here depends on the gates. It reads state that exists either way.
   */
  const {
    showBottomPlayer,
    playbackChromeActive,
    narrationForPlayer,
    handleClearPlayer,
    nowPlayingPillar,
    nowPlayingControls,
    mobilePlaybackShellActive,
    mobileUsesPlayerPadding,
    showMobileDockBar,
    hideHomePlaybackChrome,
  } = useShellPlayerDockFlags({
    isTV,
    showMobileShell,
    station,
    hasActivePlayback,
    narrationPlayback,
    mobilePlayerPending,
    queueDrawerOpen,
    lyricsDrawerOpen,
    sleepTimerPanelOpen,
    audio,
    setPlayQueue,
    setQueueIndex,
    setMobileNowPlayingOpen,
    setQueueDrawerOpen,
    setLyricsDrawerOpen,
    mobileSearchOpen,
    mobileNowPlayingOpen,
  });

  const entryGate = renderShellEntryGates({
    isCarMode,
    isTV,
    showOnboarding,
    showServerSetup,
    profile,
    setOnboardingComplete,
    setServerSetupDismissed,
    audio,
    artworkUrl,
    homeTitle,
    homeArtist,
    homeDisplayState,
    effectiveConnectRole,
    remoteMirror,
    isConnectRemoteRef,
    togglePlay,
    skipBack,
    skipForward,
    sendConnectCommand,
    handleExitCarMode,
  });
  if (entryGate) return entryGate;


  return (
    <ShellChrome
      {...{
        ...shellSearchDropdownActions,
        activeLyrics,
        ...shellNowPlayingChapters,
        albumDrillAlbum,
        albumDrillQuery,
        albumDrillTracks,
        appToast,
        audio,
        audiobookAuthorSeeds,
        audiobookDownloadBadge,
        audiobookOwnedTitles,
        audiobooksDrillBackRef,
        audiobooksEnabled,
        audiobooksMounted,
        authoritativeEnvelope,
        batterySaver,
        blockSearchDropdown,
        castMode,
        castPickerOpen,
        catalogLoading,
        closeMobileSearch,
        cycleRepeat,
        discoverDrillFromTab,
        discoverReleaseBadge,
        discoverStationEnabled,
        discoverTab,
        displayArt,
        downloadCurrentTrack,
        downloadTierPreference,
        effectiveConnectRole,
        episodeVolumeBoostDb,
        exploreDrillBackRef,
        findHitCandidates,
        focusPlaylistId,
        ...shellMobileNavActions,
        handleAcquireAndPlayHit,
        handleAlbumBack,
        handleAnalyzeStems,
        handleArtistBack,
        handleBrowsePick,
        handleCacheSearchHit,
        handleCacheTrack,
        handleClearPlayer,
        handleCycleEpisodeVolumeBoost,
        handleCyclePodcastSpeed,
        handleDismissStuckPlayback,
        ...shellDownloadHandlers,
        handleDownloadMix,
        handleEnterCarMode,
        ...shellPlayActions,
        ...shellTvHome,
        ...shellPlayTriggers,
        ...shellLyricsResolve,
        handleMobileTrackTitleTap,
        handleOpenAlbumByName,
        handleOpenArtistByName,
        handleOpenDownloadJob,
        handleOpenPlaylistsPrompt,
        handleOpenVideoFeed,
        handlePlayEnvelope,
        handlePodcastNextChapter,
        handlePodcastPrevChapter,
        handleQuickFilter,
        ...shellPlaybackQueue,
        ...shellQueueResume,
        handleSearchBack,
        handleSelectAlbum,
        handleSelectArtist,
        handleSelectSuggestion,
        handleSendToDj,
        handleSkipPodcastAd,
        handleThumbDown,
        handleThumbUp,
        handleTogglePodcastSkipAdChapters,
        handleTogglePodcastSmartSpeed,
        handleTogglePodcastVoiceBoost,
        handleUniversalOpenFormat,
        handleUniversalSearchSelect,
        hasActivePlayback,
        hideHomePlaybackChrome,
        homeAlbum,
        homeArt,
        homeArtUniverseClass,
        homeArtist,
        homeAwaitingUserResume,
        homeDisplayState,
        homeGenreBucket,
        homeGradientSeed,
        homeHasLoadedTrack,
        homeListeningPreview,
        homeRecentlyAdded,
        homeShowShades,
        homeTitle,
        isCarMode,
        isConnectRemote,
        isTV,
        lang,
        libraryStationEnabled,
        lockerDrillBackRef,
        lockerEnvelopes,
        lockerFeatured,
        lockerHomeResetKey,
        lockerRemoveBusy,
        lockerRemoveConfirm,
        lockerSection,
        lockerTracks,
        lyricsDrawerOpen,
        mfyDrillBackRef,
        miniPlayerNavigatesHome,
        mixRadioSaveBusy,
        mixRadioSaveOpen,
        mixRadioSession,
        mobileDownloadBadge,
        mobileDownloadSheetKind,
        mobileDownloadSheetOpen,
        mobileMenuActiveId,
        mobileMenuItems,
        mobileMenuOpen,
        mobileNavBadges,
        mobileNowPlayingOpen,
        mobilePlaybackShellActive,
        mobilePlayerPending,
        mobilePlayingFromLabel,
        mobileSearchCommitGuardUntilRef,
        mobileSearchOpen,
        mobileTabActiveId,
        mobileTabItems,
        mobileUsesPlayerPadding,
        musicUniverseStyle,
        narrationForPlayer,
        narrowShell,
        navActiveId,
        navItems,
        navOpen,
        navPinTabs,
        nowPlayingAuthority,
        nowPlayingControls,
        nowPlayingDisplay,
        offlineStatus,
        openCastPicker,
        openHomePlayer,
        openMobileNowPlaying,
        openMobileSearch,
        openStationDownloads,
        pendingDjDeckLoad,
        pendingExternalImport,
        pendingShareImport,
        persistLockerPlayRepair,
        playQueue,
        playbackFidelityLabel,
        playbackResolveElapsed,
        playerAddToPlaylistOpen,
        playerDownloadEnabled,
        playlistsDrillBackRef,
        podcastCatalogHits,
        podcastChapters,
        podcastChaptersOpen,
        podcastDownloadBadge,
        podcastEpisodeBadge,
        podcastPlaybackSpeed,
        podcastSearchHits,
        podcastSkipAdChaptersEnabled,
        podcastSkipAdHint,
        podcastSmartSpeedEnabled,
        podcastVoiceBoostEnabled,
        podcastsActiveEnvelopeId,
        podcastsDrillBackRef,
        podcastsEnabled,
        podcastsMounted,
        primePlayEnvelope,
        proAudio,
        profile,
        profileName,
        queueDrawerOpen,
        queueIndex,
        recentPlayHistory,
        recentSearchMatches,
        remoteMirror,
        repeatMode,
        runExploreSearch,
        runSearch,
        searchActiveIndex,
        searchCatalog,
        searchDropdownEffectiveOpen,
        searchDropdownRef,
        searchFormRef,
        searchFormat,
        searchFromCache,
        searchHits,
        searchInput,
        searchInputRef,
        searchLoading,
        searchQuery,
        searchResults,
        searchSection,
        selectedArtist,
        sendConnectCommand,
        serverStemMix,
        setAndroidServerBannerDismissed,
        setAudiobooksEnabled,
        setCarOfferDismissed,
        setCastPickerOpen,
        setDiscoverDrillFromTab,
        setDiscoverStationEnabled,
        setDiscoverTab,
        setFocusPlaylistId,
        setHeroDisplayMode,
        setLibraryStationEnabled,
        setLockerRemoveBusy,
        setLockerRemoveConfirm,
        setLockerSection,
        setLyricsDrawerOpen,
        setMixRadioSaveOpen,
        setMobileDownloadSheetOpen,
        setMobileMenuOpen,
        setMobileNowPlayingOpen,
        setMobileResolverBannerDismissed,
        setNavOpen,
        setPendingDjDeckLoad,
        setPendingExternalImport,
        setPendingShareImport,
        setPlayQueue,
        setPlayerAddToPlaylistOpen,
        setPodcastChaptersOpen,
        setPodcastSearchHits,
        setPodcastsEnabled,
        setProAudio,
        setQueueDrawerOpen,
        setSearchActiveIndex,
        setSearchDropdownOpen,
        setSearchFormat,
        setSearchSection,
        setSettingsInitialTab,
        setSettingsMobileDrill,
        setShuffleOn,
        setSleepTimerPanelOpen,
        setSonicLockerEnabled,
        setStation,
        setTvCoverageBannerDismissed,
        setTvQueueOpen,
        setTvScreen,
        setVideoFeedOpen,
        settingsDrillBackRef,
        settingsInitialTab,
        shellMainRef,
        shellSearchField,
        showAndroidServerBanner,
        showAppToast,
        showBottomPlayer,
        showCarModeOffer,
        showHomeActiveWash,
        showHomeIdleChrome,
        showMobileDockBar,
        showMobileResolverBanner,
        showMobileShell,
        showMobileShellHeader,
        showMusicUniverse,
        showShellHeaderOffset,
        showTopSearch,
        showTvCoverageBanner,
        shuffleOn,
        skipBack,
        skipForward,
        sleepTimerLabel,
        sleepTimerPanelOpen,
        sonicLockerEnabled,
        speakerCast,
        station,
        stemSlidersPanelProps,
        suggestedQueueTracks,
        t,
        tabletShell,
        thumbDown,
        thumbUp,
        togglePlay,
        tvActiveStation,
        tvNowPlaying,
        tvQueueOpen,
        tvScreen,
        unifiedSearchLoading,
        unifiedSearchResult,
        videoFeedOpen,
        videosEnabled,
        vinylCssVars,
        vinylPsycheClass,
        webSupplementError,
        webSupplementLoading,
      }}
    />
  );
}
