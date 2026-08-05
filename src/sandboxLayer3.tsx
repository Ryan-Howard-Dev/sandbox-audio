/**
 * Sandbox Music â€” Layer 3: Responsive Shell
 */

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Home,
  HardDrive,
  Settings,
  Search,
  Play,
  Pause,
  Loader2,
  User,
  Sliders,
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
  Podcast,
  BookOpen,
  BookAudio,
  Music as MusicIcon,
  X,
  Cast,
  Radio,
  Activity,
  Server,
  ListMusic,
  Menu,
} from 'lucide-react';
import CollapsibleStationNav from './components/CollapsibleStationNav';
import { queueStemAnalyzeForLockerTrack } from './analyzeStemsAction';
import {
  loadBatterySaverEnabled,
  subscribeBatterySaver,
} from './batterySaverSettings';
import MobileNavMoreSheet, { type MobileNavMoreItem } from './components/MobileNavMoreSheet';
import MusicSegmentBar, { type MusicSegmentId } from './components/MusicSegmentBar';
import UniversalSearchPanel from './components/UniversalSearchPanel';
import type { UniversalFormat, UniversalHit } from './universalSearch';
import { loadAudiobookSeeds } from './audiobookLibrary';
import OnboardingWizard from './components/OnboardingWizard';
import ServerSetup from './components/ServerSetup';
import PodcastChapterSheet from './components/podcasts/PodcastChapterSheet';
import MobileDockWithShell from './mobile/MobileDockWithShell';
import { useNarrationPlayback } from './hooks/useNarrationPlayback';
import { controlsForPillar, resolveMediaPillar } from './mediaPillar';
import { seekIntervalsFor, seekTargetSeconds } from './spokenSeekIntervals';
import { resumeAtSeconds } from './resumeRewind';
import {
  clearNarrationPlayback,
  getNarrationPlayback,
  subscribeNarrationPlayerOpen,
} from './narrationPlayback';
import { endNarrationSession } from './narrationMediaSession';
import PlayerBar from './components/PlayerBar';
import {
  hasMobilePlaybackShell,
  mobileShellUsesPlayerPadding,
  shouldShowMobileInfoStrip,
  shouldShowMobileMiniBar,
  shouldUseAndroidInlinePlayerDock,
} from './mobile/mobilePlayerShellLogic';
import { resolveMobileTabActiveId } from './mobile/mobileTabActiveLogic';
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
import SystemLogin from './shell/SystemLogin';
import {
  BASE_NAV,
  NAV_PIN_META,
  readAudiobooksEnabled,
  readDiscoverStationEnabled,
  readLibraryStationEnabled,
  readPodcastsEnabled,
  readProAudio,
  readSonicLockerStationEnabled,
  type MobileTabId,
  type NavItemId,
  type StationId,
} from './shell/shellNav';
import { usesIntervalSeekTransport } from './spokenWordPlayback';
import {
  audiobookBookKeyFromEnvelopeId,
  getAudiobookProgress,
  saveAudiobookProgress,
  shouldPersistAudiobookProgress,
} from './audiobookProgress';
import { installE2eLiveHandlers } from './e2eHandlerBootstrap';
import { buildE2eLiveHandlers } from './shell/shellE2eLiveHandlers';
import { logE2e, markE2ePlaybackHandlersLive, registerE2eHandlers } from './e2eDevAction';
import {
  ensureNavPinTabsLayout,
  loadNavPinTabs,
  NAV_PINS_CHANGE_EVENT,
  navPinTabIdSet,
  type NavPinTabId,
} from './navPinTabs';
import { mobilePinTabIdsFromNavPins } from './mobile/buildMobileTabItems';
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
  inferArtistFromAlbumFolder,
  lockerTitleMatches,
  refreshLockerEntryPlayUrl,
  removeLockerEntry,
  resolveLockerEnvelopeForPlayback,
  resolveLockerEntryGroupArt,
  buildLockerGroupArtMap,
  resolveLockerEntryGroupArtFromMap,
  adoptPlaybackLockerArtwork,
  subscribeLockerCache,
  tracksForAlbumGroup,
  type LockerEntry,
} from './lockerStorage';
import { sortLockerTracks } from './lockerTrackOrder';
import { LOCKER_USER_DELETE_CONFIRMED } from './lockerDeleteGuard';
import {
  playbackArtStabilizeScope,
  resolveLockerEntryAlbumArt,
  resolveLockerEntryId,
  stabilizePlaybackArtSrc,
} from './playerBarTrackMeta';
import {
  buildHealAttemptKey,
  resolveHealAction,
} from './play/playbackHealPolicy';
import {
  computeNextQueueIndex,
  computeSkipBackIndex,
} from './play/queueAdvancePolicy';
import {
  shouldAdoptNativeExoTransition,
} from './play/queueAdvanceGate';
import {
  buildPodcastQueueForFeed,
  computeNextQueueIndexWithUpNext,
  loadSovereignUpNextSettings,
  mergeIntoUpNextQueue,
} from './sovereignUpNext';
import {
  tryQueueInPlaceSeek,
} from './play/playTapFastPath';
import { startAutoSimilarRadioIfNeeded } from './play/standaloneSimilarRadio';
import { ensureLockerPlayable, envelopeClaimsLocker } from './play/ensureLockerPlayable';
import { findQueueIndexForExoTransition, isExoMediaItemTransitionEvent } from './play/exoQueueSync';
import { cacheUpcomingOnWifi, prefetchUpcomingOnWifi } from './wifiBackgroundPrefetch';
import {
  cacheEnvelopeForOffline,
  warmStreamCacheIndex,
} from './streamCache';
import {
  prefetchUpcomingQueueTracks,
  primeLockerNativeQueue,
  isLockerVaultPlayQueue,
  stageUpcomingQueueOnTier34,
} from './trackPrefetch';
import {
  resolveQueueTrackSeekTarget,
  shouldSeekQueueTrackInPlace,
} from './queueNavigation';
import {
  engineSearch,
  engineExploreSearch,
  fetchTrackMetadata,
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
import { useTrackUniverseStyle } from './hooks/useTrackUniverseStyle';
import MusicUniverseBackdrop from './components/MusicUniverseBackdrop';
import HomeActiveWash from './components/HomeActiveWash';
import { useShowMusicUniverse } from './musicUniverse';
import { getGenreBucketForTrack } from './vinylGenreThemes';
import { useVinylVisualStyle } from './vinylVisualSettings';
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
import { usePlaybackQueue } from './shell/usePlaybackQueue';
import { useShellPlayActions } from './shell/useShellPlayActions';
import { useShellTvHome } from './shell/useShellTvHome';
import {
  useShellDownloadQueueBadge,
  useShellDownloadHandlers,
  useShellDownloadMix,
  useShellDownloadCurrentTrack,
} from './shell/useShellDownloads';
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
  loadPodcastSeekIntervalSeconds,
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
  isPodcastEnvelopeId,
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
  isServerReachableCached,
  isTier34ReachableCached,
  refreshTier34Reachability,
} from './tier34/client';
import { hasActiveMobileResolvers, getLastMobileResolveError, ensureYtDlpMobileReady, preferFreshMobileResolve } from './mobileResolverRegistry';
import { usePlaybackResolveElapsed } from './hooks/usePlaybackResolveElapsed';
import { useStableEnvelopeId } from './hooks/useStableEnvelopeId';
import { resolvePlaybackFidelityLabel } from './trackFidelityLabel';
import {
  lastJsInitiatedNativeNav,
  subscribeNativeExoStatus,
} from './androidNativePlayback';
import { isNativeExoAudible, clearLastPlayIntent } from './lastPlayIntent';
import { getYtDlpMobileStatus, waitForYtDlpInit } from './ytDlpMobile';
import {
  bumpPlayGeneration,
  currentPlayGeneration,
  formatMobilePlaybackError,
} from './playIntent';
import {
  coalesceArtworkUrl,
  displayTransportLabel,
  proxiedArtworkUrl,
} from './displaySanitize';
import {
  preserveTappedEnvelopeIdentity,
} from './playbackPipeline';
import {
  retryTrackInDownloadJob,
  scheduleCatalogAlbumDownload,
  scheduleCatalogTrackDownload,
} from './acquisitionPipeline';
import { filterTracksNeedingDownload } from './downloadLockerPrecheck';
import { primeDownloadBatteryMonitor } from './downloadBatteryGate';
import DownloadErrorToast from './components/DownloadErrorToast';
import DownloadActivitySheet, {
  countDownloadSheetBadge,
} from './components/DownloadActivitySheet';
import AcquireProgressToast from './components/AcquireProgressToast';
import ConfirmDialog from './components/ConfirmDialog';
import { getDownloadJobs } from './downloadQueue';
import { acquireAndPlayHit } from './acquireAndPlay';
import CastPicker from './components/CastPicker';
import QueueDrawer from './components/QueueDrawer';
import TVNavigation, { type TVStationId } from './components/TVNavigation';
import TVQueuePanel from './components/TVQueuePanel';
import LyricsDrawer from './components/LyricsDrawer';
import SleepTimerPanel from './components/SleepTimerPanel';
import TVHomeView, { type TVRowId } from './stations/TVHomeView';
import TVPlaybackView from './stations/TVPlaybackView';
import CarModeView from './stations/CarModeView';
import { detectTVPlatform } from './tvDetection';
import {
  enterCarMode as activateCarMode,
  exitCarMode as deactivateCarMode,
  isAndroidNative,
  isCarModeActive,
  loadCarModeAutoOffer,
  loadCarModeOfferDismissed,
  registerCarVoiceActions,
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
import { isAndroid, isCapacitorNative } from './platformEnv';
import { resetMobileKeyboardInsets } from './androidSafeAreaInsets';
import { isTauriDesktop } from './castPlatform';
import { requestAndroidPermissions } from './androidPermissions';
import { useTranslation } from './i18n';
import {
  getOrCreateConnectDeviceId,
  loadConnectDeviceName,
  ensureAndroidLocalPlaybackOnLaunch,
  loadGaplessEnabled,
  loadOnboardingComplete,
  loadTvCoverageBannerDismissed,
  requestTauriCastGuidance,
  saveTvCoverageBannerDismissed,
  shouldShowOnboardingWizard,
  shouldShowServerSetup,
} from './sandboxSettings';
import { maybeAutoStartLocalSandboxServer } from './sandboxServerBridge';
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
  computeSkipped,
  getMostPlayed,
  getRecentlyPlayed,
  recordPlay,
  recordPlaySession,
  storedHitToEnvelope,
  subscribePlayHistory,
  type StoredPlayHit,
} from './playHistory';
import { scrobbleNowPlaying, scrobbleTrack } from './scrobble';
import {
  getTrackTasteFeedback,
  recordTasteFeedback,
  subscribeTasteFeedback,
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
  formatMinutesHuman,
  getListeningStats,
  type MediaKind,
} from './listeningAnalytics';
import { initNativeWakeAlarm } from './nativeWakeAlarm';
import {
  formatSleepRemaining,
  getSleepTimerSnapshot,
  handleNativeWakeAlarmFired,
  registerSleepTimerCallbacks,
  subscribeSleepTimer,
} from './sleepTimer';

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
  const [mobileDownloadSheetKind, setMobileDownloadSheetKind] = useState<MediaKind>('music');
  const openStationDownloads = useCallback((kind: MediaKind) => {
    setMobileDownloadSheetKind(kind);
    setMobileDownloadSheetOpen(true);
  }, []);
  const [lockerRemoveConfirm, setLockerRemoveConfirm] = useState<{
    id: string;
    title: string;
  } | null>(null);
  const [lockerRemoveBusy, setLockerRemoveBusy] = useState(false);
  const [downloadQueueRevision, setDownloadQueueRevision] = useState(0);
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
  const ANDROID_SERVER_BANNER_KEY = 'sandbox_android_server_banner_dismissed';
  const MOBILE_RESOLVER_BANNER_KEY = 'sandbox_mobile_resolver_banner_dismissed';
  const [androidServerBannerDismissed, setAndroidServerBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(ANDROID_SERVER_BANNER_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileResolverBannerDismissed, setMobileResolverBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(MOBILE_RESOLVER_BANNER_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [serverReachable, setServerReachable] = useState(() => isServerReachableCached());
  const [mobileResolversActive, setMobileResolversActive] = useState(() =>
    hasActiveMobileResolvers(),
  );
  const showAndroidServerBanner =
    isAndroid() && !getTier34BaseUrl().trim() && !androidServerBannerDismissed && !showMobileShell;
  const showMobileResolverBanner =
    isCapacitorNative() &&
    getTier34BaseUrl().trim() &&
    !serverReachable &&
    !mobileResolversActive &&
    !mobileResolverBannerDismissed;
  const [tvCoverageBannerDismissed, setTvCoverageBannerDismissed] = useState(
    loadTvCoverageBannerDismissed,
  );
  const showTvCoverageBanner =
    isTV && station === 'home' && tvScreen === 'home' && !tvCoverageBannerDismissed;

  useEffect(() => {
    if (!isAndroid()) return;
    ensureAndroidLocalPlaybackOnLaunch();
    ensureYtDlpMobileReady();
    void waitForYtDlpInit();
  }, []);

  useEffect(() => {
    const syncReachability = () => {
      setServerReachable(isServerReachableCached());
      setMobileResolversActive(hasActiveMobileResolvers());
    };
    const onSettingsChange = () => {
      syncReachability();
      if (getTier34BaseUrl().trim()) {
        void refreshTier34Reachability().then(syncReachability);
      }
    };
    window.addEventListener('sandbox-settings-change', onSettingsChange);
    window.addEventListener('sandbox-resolution-change', syncReachability);
    if (getTier34BaseUrl().trim()) {
      void refreshTier34Reachability().then(syncReachability);
    }
    return () => {
      window.removeEventListener('sandbox-settings-change', onSettingsChange);
      window.removeEventListener('sandbox-resolution-change', syncReachability);
    };
  }, []);

  const showAppToast = useCallback((msg: string, durationMs = 3200) => {
    setAppToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
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
      label: t('shell.profile', { name: profile.activeProfile?.displayName ?? 'Operator' }),
      icon: User,
    });
    return items;
  }, [proAudio, podcastsEnabled, audiobooksEnabled, libraryStationEnabled, discoverStationEnabled, sonicLockerEnabled, navPinTabs, profile.activeProfile?.displayName, t]);

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
  }, [audiobooksEnabled, discoverReleaseBadge, discoverStationEnabled, sonicLockerEnabled, t]);

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

  useShellDownloadQueueBadge({ setDownloadQueueRevision });

  const mobileDownloadBadge = countDownloadSheetBadge(getDownloadJobs(), 'music');
  const podcastDownloadBadge = countDownloadSheetBadge(getDownloadJobs(), 'podcast');
  const audiobookDownloadBadge = countDownloadSheetBadge(getDownloadJobs(), 'audiobook');

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
      handleMobileTabNavigate(id as MobileTabId);
    },
    [closeMobileSearch, openSettings, handleMobileTabNavigate],
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
        handleMobileTabNavigate,
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
  }, [runSearch, handleMobileTabNavigate, transitionToSearchStation, station]);

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

  const {
    handleDownloadTierChange,
    handleDownloadAlbum,
    handleDownloadTrack,
    handleDownloadSearchHit,
    handleDownloadImportedPlaylist,
  } = useShellDownloadHandlers({
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

  const playGenerationRef = useRef(0);
  playGenerationRef.current = currentPlayGeneration();
  const primeLockerNativeQueueFrom = useCallback(
    (tracks: MediaEnvelope[], fromIndex: number) => {
      if (!isAndroid() || !isLockerVaultPlayQueue(tracks) || fromIndex >= tracks.length - 1) {
        return Promise.resolve();
      }
      return primeLockerNativeQueue(
        tracks,
        fromIndex,
        (url, envelope) =>
          audio.prebufferUrl(url, {
            title: envelope.title,
            artist: envelope.artist,
            album: envelope.album,
            artworkUrl: envelope.artworkUrl,
            envelopeId: envelope.envelopeId,
          }),
        audio.flushNativeExoEnqueueChain,
      );
    },
    [audio.prebufferUrl, audio.flushNativeExoEnqueueChain],
  );

  const seedLockerAlbumPlayQueue = useCallback(
    (
      entries: LockerEntry[],
      albumTitle: string,
      artistName: string,
      selectedSourceId?: string,
      selectedTitle?: string,
    ): { envs: MediaEnvelope[]; index: number } | null => {
      const sorted = sortLockerTracks(tracksForAlbumGroup(entries, albumTitle, artistName));
      if (sorted.length < 2) return null;
      const envs = sorted.map((entry) => lockerEntryToEnvelope(entry));
      let index = -1;
      const sourceId = selectedSourceId?.trim();
      if (sourceId) {
        index = envs.findIndex((env) => env.sourceId === sourceId);
      }
      if (index < 0 && selectedTitle?.trim()) {
        index = envs.findIndex((env) => lockerTitleMatches(env.title, selectedTitle));
      }
      if (index < 0) return null;
      setPlayQueue(envs);
      setQueueIndex(index);
      playQueueRef.current = envs;
      queueIndexRef.current = index;
      setShuffleOn(false);
      setRepeatMode('none');
      setMixRadioSession(null);
      autoSimilarRadioSeedRef.current = null;
      return { envs, index };
    },
    [],
  );

  const logLockerQueueInstrumentation = useCallback(
    (
      phase: string,
      selectedSourceId: string | undefined,
      selectedIndex: number,
      envs: MediaEnvelope[],
    ) => {
      if (!import.meta.env.DEV) return;
      console.warn(
        `[locker-queue] ${phase} ${JSON.stringify({
          selectedTrackId: selectedSourceId ?? envs[selectedIndex]?.sourceId ?? 'unknown',
          selectedIndex,
          jsQueueIds: envs.map((env) => env.sourceId ?? env.envelopeId),
          trackTitles: envs.map((env) => env.title),
        })}`,
      );
    },
    [],
  );

  /**
   * What the screen currently says, for consumers that run outside render (the E2E playback probe).
   * Reading audio.envelope there reported the track being resolved, which is exactly the drift the
   * probe was built to detect.
   */
  const nowPlayingDisplayRef = useRef<PlaybackDisplayFields | null>(null);
  const authoritativeEnvelopeRef = useRef<MediaEnvelope | null>(null);
  const audioEnvelopeRef = useRef(audio.envelope);
  const audioStateRef = useRef(audio.state);
  audioEnvelopeRef.current = audio.envelope;
  audioStateRef.current = audio.state;
  const audioVolumeRef = useRef(audio.volume);
  audioVolumeRef.current = audio.volume;
  const audioCurrentTimeRef = useRef(audio.currentTimeSeconds);
  audioCurrentTimeRef.current = audio.currentTimeSeconds;
  const audioDurationRef = useRef(audio.durationSeconds);
  audioDurationRef.current = audio.durationSeconds;
  const audioStreamDurationRef = useRef(audio.streamDurationSeconds);
  audioStreamDurationRef.current = audio.streamDurationSeconds;
  /** True once the current track reaches Playing â€” gates gapless auto-advance. */
  const trackReachedPlayingRef = useRef(false);
  /** Wall-clock ms timestamp of the false->true edge above â€” see trackPlaybackMatureForAdvance. */
  const trackReachedPlayingAtRef = useRef(0);
  /** Native Exo gapless queue advanced â€” suppress duplicate JS resolve/advance. */
  const exoGaplessTransitionAtRef = useRef(0);
  /**
   * Envelope handed to the audio layer as an already-playable stream (tryInstantPlayable, sync
   * cache, locker hit). Those tracks start with no silent gap, so their metadata must swap at once
   * â€” holding the previous track's identity there would invent the very delay the fast path
   * removes.
   */
  const instantHandoffEnvelopeIdRef = useRef('');

  const sessionPeakSecondsRef = useRef(0);

  const flushPlaySession = useCallback((completed = false) => {
    const env = sessionEnvelopeRef.current;
    const peak = sessionPeakSecondsRef.current;
    if (env && peak >= 5) {
      const listenedMs = Math.floor(peak * 1000);
      const durationMs =
        env.durationSeconds != null && env.durationSeconds > 0
          ? Math.round(env.durationSeconds * 1000)
          : 0;
      const skipped =
        !completed && computeSkipped(listenedMs, durationMs, false);
      // Derive listening context so taste weighting can tell an album listen from a single tap.
      const queueNow = playQueueRef.current;
      const playContext: 'album' | 'single' | 'radio' | 'playlist' = mixRadioSessionRef.current
        ? 'radio'
        : queueNow.length > 1 && queueNow.some((tr) => tr.envelopeId === env.envelopeId)
          ? 'album'
          : 'single';
      recordPlaySession(env, peak, completed, skipped, playContext);
      if (completed || !skipped) {
        void scrobbleTrack(env, listenedMs);
      }
    }
    sessionPeakSecondsRef.current = 0;
    if (!completed) sessionEnvelopeRef.current = null;
  }, []);

  const findHitCandidates = useCallback(
    (env: MediaEnvelope): CandidateSource[] | undefined => {
      const hit = searchHitsRef.current.find(
        (h) => h.primaryEnvelope.envelopeId === env.envelopeId,
      );
      return hit?.sources;
    },
    [],
  );

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
    openSettings,
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

  const scheduleAutoSimilarRadio = useCallback(
    (
      playable: MediaEnvelope,
      opts?: { seedSearchQueue?: boolean; seamless?: boolean; playQueueOverride?: MediaEnvelope[] },
    ) => {
      if (opts?.seamless) return;

      const queueNow = opts?.playQueueOverride ?? playQueueRef.current;
      const refQueue = playQueueRef.current;
      const lockerAlbumFromRef =
        refQueue.length > queueNow.length &&
        isLockerVaultPlayQueue(refQueue) &&
        refQueue.some((track) => track.envelopeId === playable.envelopeId)
          ? refQueue
          : null;
      const effectiveQueue = lockerAlbumFromRef ?? queueNow;
      if (
        autoSimilarRadioSeedRef.current === playable.envelopeId &&
        effectiveQueue.length > 1 &&
        effectiveQueue.some((track) => track.envelopeId === playable.envelopeId)
      ) {
        return;
      }

      const midRadio =
        Boolean(mixRadioSessionRef.current) &&
        effectiveQueue.length > 1 &&
        effectiveQueue.some((track) => track.envelopeId === playable.envelopeId);

      const primeRadioContinuation = (queue: MediaEnvelope[], index: number) => {
        void primeLockerNativeQueueFrom(queue, index);
        prefetchUpcomingQueueTracks({
          playQueue: queue,
          queueIndex: index,
          repeatMode: repeatModeRef.current,
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
      };

      if (
        !opts?.seedSearchQueue &&
        effectiveQueue.length > 1 &&
        isLockerVaultPlayQueue(effectiveQueue) &&
        effectiveQueue.some((track) => track.envelopeId === playable.envelopeId)
      ) {
        const idx = effectiveQueue.findIndex((track) => track.envelopeId === playable.envelopeId);
        primeRadioContinuation(effectiveQueue, idx >= 0 ? idx : 0);
        return;
      }

      void startAutoSimilarRadioIfNeeded(
        {
          envelope: playable,
          playQueue: effectiveQueue,
          // Seeded singles must not be blocked by a stale album-drill listing
          // (e.g. American Dream still in refs after playing one locker track).
          albumTracks: opts?.seedSearchQueue ? undefined : albumDrillTracksRef.current,
          searchHits: searchHitsRef.current,
          albumTitle: opts?.seedSearchQueue ? undefined : albumDrillAlbumRef.current?.title,
          expectedTrackCount: opts?.seedSearchQueue
            ? undefined
            : albumDrillAlbumRef.current?.trackCount,
          seedSearchQueue: opts?.seedSearchQueue,
          hasMixRadioSession: midRadio,
        },
        {
          setPlayQueue,
          setQueueIndex,
          setMixRadioSession,
          setRepeatMode,
          setShuffleOn,
          isStillCurrent: () => audioEnvelopeRef.current?.envelopeId === playable.envelopeId,
          labelFor: (key) =>
            key === 'unknownTitle' ? t('player.unknownTitle') : t('player.unknownArtist'),
          persistRadioPlaylist: true,
        },
      ).then((result) => {
        if (!result.started) return;
        autoSimilarRadioSeedRef.current = playable.envelopeId;
        primeRadioContinuation(result.queue, result.index);
      });
    },
    [t, audio.prebufferUrl, findHitCandidates, primeLockerNativeQueueFrom],
  );
  scheduleAutoSimilarRadioRef.current = scheduleAutoSimilarRadio;

  const handleLockerTrackPlay = useCallback(
    async (env: MediaEnvelope): Promise<boolean> => {
      setHomeAwaitingUserResume(false);
      const artistName = env.artist?.trim() ?? '';
      const albumTitle = env.album?.trim();
      const sourceId = env.sourceId?.trim();
      const trackTitle = env.title?.trim() ?? '';

      if (albumTitle && artistName) {
        const snapshot = getLockerEntriesSnapshot() ?? [];
        const seeded = seedLockerAlbumPlayQueue(
          snapshot,
          albumTitle,
          artistName,
          sourceId,
          trackTitle,
        );
        if (seeded) {
          logLockerQueueInstrumentation('tap', sourceId, seeded.index, seeded.envs);
          const target = seeded.envs[seeded.index]!;
          const locker = await ensureLockerPlayable(target);
          if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) {
            return false;
          }
          const playable = preserveTappedEnvelopeIdentity(target, locker.envelope);
          const started = await handlePlayEnvelope(playable, findHitCandidates(playable), {
            autoPlay: true,
            preservePlayQueue: true,
          });
          if (started) {
            await primeLockerNativeQueueFrom(seeded.envs, seeded.index);
            await audio.flushNativeExoEnqueueChain();
          }
          return started;
        }
      }

      return handlePlayEnvelope(env, findHitCandidates(env), {
        autoPlay: true,
        preservePlayQueue: true,
      });
    },
    [
      audio,
      findHitCandidates,
      handlePlayEnvelope,
      logLockerQueueInstrumentation,
      primeLockerNativeQueueFrom,
      seedLockerAlbumPlayQueue,
    ],
  );

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

  const handleSearchPlay = useCallback(
    (env: MediaEnvelope, candidates?: CandidateSource[]) => {
      /*
       * The entry point, logged before anything can swallow it. handlePlayEnvelope already times
       * itself, but a silent log there is ambiguous: it means either the tap was slow or the tap
       * never arrived, and those need opposite investigations. This line separates them â€” if it
       * appears and the timing does not, the play call itself is being dropped; if neither
       * appears, the gesture never reached this handler at all.
       */
      console.warn(
        `[handleSearchPlay] play requested track="${env.artist} â€” ${env.title}" ` +
          `provider=${env.provider} sources=${candidates?.length ?? 0}`,
      );
      void handlePlayEnvelope(env, candidates, { seedSearchQueue: true }).catch((err) => {
        console.warn('[handleSearchPlay] playback failed:', err);
        showAppToast(t('artist.playbackHybridUnavailable'), 3800);
        setMobilePlayerPending(false);
      });
    },
    [handlePlayEnvelope, showAppToast, t],
  );

  const handleStreamSearchHit = useCallback(
    (hit: ResolvedSearchHit) => {
      handleSearchPlay(hit.primaryEnvelope, hit.sources);
    },
    [handleSearchPlay],
  );

  const {
    handleSelectTrack,
    handleSelectPlaylist,
    handleActivateRecentSearch,
    searchDropdownItems,
    activateSearchDropdownItem,
    submitSearch,
    handleRemoveRecentSearch,
    handleClearSearchHistory,
    handleClearSearchInput,
  } = useShellSearchDropdownActions({
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

  const handleSonicLockerPlayQueue = useCallback(
    (tracks: MediaEnvelope[], shuffle = false) => {
      if (tracks.length === 0) return;
      const ordered = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
      setPlayQueue(ordered);
      setQueueIndex(0);
      setMixRadioSession({
        kind: 'radio',
        seedTitle: ordered[0]?.title?.trim() || t('player.unknownTitle'),
        seedArtist: ordered[0]?.artist?.trim() || t('player.unknownArtist'),
      });
      setShuffleOn(shuffle);
      handlePlayEnvelope(ordered[0], findHitCandidates(ordered[0]));
    },
    [handlePlayEnvelope, findHitCandidates, t],
  );

  const handleSonicLockerSaveMix = useCallback((tracks: MediaEnvelope[]) => {
    if (tracks.length === 0) return;
    setPlayQueue(tracks);
    setQueueIndex(0);
    setMixRadioSession({
      kind: 'radio',
      seedTitle: 'Sonic Locker',
      seedArtist: 'Saved mix',
    });
    setMixRadioSaveOpen(true);
  }, []);

  const handleSonicLockerDiscoveryStation = useCallback(
    (tracks: MediaEnvelope[]) => {
      if (tracks.length === 0) return;
      setPlayQueue(tracks);
      setQueueIndex(0);
      setMixRadioSession({
        kind: 'discovery-station',
        skipOnly: true,
        seedTitle: 'Discovery Station',
        seedArtist: 'Sonic Locker',
      });
      setShuffleOn(false);
      setRepeatMode('all');
      handlePlayEnvelope(tracks[0], findHitCandidates(tracks[0]));
    },
    [handlePlayEnvelope, findHitCandidates],
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

  const repeatModeRef = useRef(repeatMode);
  const shuffleOnRef = useRef(shuffleOn);
  const sovereignUpNextPodcastCountRef = useRef(0);
  playQueueRef.current = playQueue;
  queueIndexRef.current = queueIndex;
  repeatModeRef.current = repeatMode;
  shuffleOnRef.current = shuffleOn;
  mixRadioSessionRef.current = mixRadioSession;

  useEffect(() => {
    const onExoTransition = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!isExoMediaItemTransitionEvent(detail)) return;
      void (async () => {
        const queue = playQueueRef.current;
        /*
         * mediaId first, URL as fallback â€” the remaining half of #36, now landed.
         *
         * This was deliberately left on URL matching because mediaId resolved skip echoes too and
         * caused a visible double-advance. shouldAdoptNativeExoTransition below is the real fix
         * for that: playUrl records what JS navigated to and echoes are ignored however they were
         * matched, so URL matching was only ever suppressing the race by accident.
         *
         * What forced the change: URL matching misses whenever the stream cache serves a track,
         * because the queue holds an https URL and the transition reports content://â€¦stream-cache.
         * On a cached LibriVox book that meant JS adopted nothing â€” native advanced two chapters
         * while envelopeId stayed frozen on the first, so the queue index never moved.
         *
         * Verified on device, which is what it was waiting for: queue-skip-probe across chapter
         * boundaries on a 22-chapter book, index advancing by exactly one with no stray indexes.
         */
        const idx = await findQueueIndexForExoTransition(queue, {
          mediaId: detail.mediaId,
          url: detail.url,
        });
        if (idx < 0) return;
        const track = queue[idx];
        if (!track) return;
        const jsNav = lastJsInitiatedNativeNav();
        const adopt = shouldAdoptNativeExoTransition({
          transitionEnvelopeId: track.envelopeId,
          activeEnvelopeId: audioEnvelopeRef.current?.envelopeId,
          pendingJsNavEnvelopeId: jsNav.envelopeId,
          pendingJsNavAtMs: jsNav.atMs,
          reason: typeof detail.reason === 'number' ? detail.reason : undefined,
        });
        /*
         * Both sides of the R-018 race, in one line each. The probe can say the index overshot but
         * not why: an adopted echo and a second JS advance land identically. This prints the gate's
         * inputs at the moment it decides, so a failing run shows which one moved the index.
         */
        logE2e(
          'exo-transition',
          adopt,
          `idx=${idx} from=${queueIndexRef.current} reason=${detail.reason ?? 'none'} adopt=${adopt} sinceJsNavMs=${Date.now() - (jsNav.atMs || 0)} jsNavEnv=${jsNav.envelopeId ?? 'none'} transitionEnv=${track.envelopeId} activeEnv=${audioEnvelopeRef.current?.envelopeId ?? 'none'}`,
        );
        if (!adopt) {
          return;
        }
        exoGaplessTransitionAtRef.current = Date.now();
        setQueueIndex(idx);
        syncThumbsFromFeedback(track.envelopeId);
        void adoptInPlaceQueueTrack(track, 0);
        // Do NOT force trackReachedPlayingRef true here â€” a native transition is not proof this
        // track is actually audible yet (an erroneous/corrupted transition would "prove" it
        // instantly, defeating trackPlaybackMatureForAdvance's minimum-play-time guard and
        // letting a bad transition cascade into rapid-fire track skipping). Let the dedicated
        // state-driven effect confirm real playback before this flag flips.
        void primeLockerNativeQueueFrom(queue, idx);
        prefetchUpcomingQueueTracks({
          playQueue: playQueueRef.current,
          queueIndex: idx,
          repeatMode: repeatModeRef.current,
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
      })();
    };
    window.addEventListener('sandbox-exo-media-transition', onExoTransition);
    return () => window.removeEventListener('sandbox-exo-media-transition', onExoTransition);
  }, [audio, syncThumbsFromFeedback, findHitCandidates, adoptInPlaceQueueTrack, primeLockerNativeQueueFrom]);

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

  const {
    handleAddToQueue,
    handleRemoveFromQueue,
    handleReorderUpNext,
    handleReorderQueue,
    handleClearQueue,
    handleSaveQueueAsPlaylist,
    handlePlayNext,
    handleQueueShowUnplayed,
  } = usePlaybackQueue({
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

  const {
    handlePlayAlbum,
    handleExploreInstantMix,
    handlePlayDiscoveryMix,
    handleSaveInstantPlaylist,
    handlePrepareForTravel,
    handleShareMix,
    handleArtistMix,
    handleTrackRadio,
    handleSaveMixRadio,
    handlePlaySource,
  } = useShellPlayActions({
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

  const {
    homeLastQueue,
    handleResumeLastQueue,
    resumeQueueCandidate,
    showResumeQueuePrompt,
  } = useShellQueueResume({
    playQueue,
    audioState: audio.state,
    handlePlayAlbum,
    setHomeAwaitingUserResume,
  });

  // Mix-page Download lives in useShellDownloadMix, called right below Share since the two used
  // to be declared as one pair (Download reuses the travel prefetch; Share exports/copies M3U).
  const { handleDownloadMix } = useShellDownloadMix({ handlePrepareForTravel });

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

  const skipBack = useCallback(() => {
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'SKIP_PREV' });
      return;
    }
    // Audiobooks included: a twelve-hour book had music's transport, so this button jumped a
    // whole chapter instead of stepping back a few seconds. See spokenWordPlayback.
    //
    // Back is deliberately shorter than forward. Pressing it means a name or a clause went past
    // while you were doing something else, and the shortest jump that recovers it is the right
    // one; the same thirty seconds that usefully clears a sponsor read puts you back into a
    // minute you already understood. See spokenSeekIntervals.
    if (audio.envelope && usesIntervalSeekTransport(audio.envelope.envelopeId)) {
      const { back } = seekIntervalsFor(
        resolveMediaPillar({ envelopeId: audio.envelope.envelopeId }),
        loadPodcastSeekIntervalSeconds(),
      );
      audio.seek(
        seekTargetSeconds({
          currentSeconds: audio.currentTimeSeconds,
          deltaSeconds: -back,
          durationSeconds:
            audio.streamDurationSeconds ||
            audio.durationSeconds ||
            audio.envelope.durationSeconds ||
            0,
        }),
      );
      return;
    }
    const back = computeSkipBackIndex({
      queueIndex,
      queueLength: playQueue.length,
      currentTimeSeconds: audio.currentTimeSeconds,
    });
    if (back === 'seek-start') {
      audio.seek(
        playQueue.length > 0
          ? resolveQueueTrackSeekTarget(playQueue, queueIndex)
          : 0,
      );
      return;
    }
    const prev = back;
    const track = playQueue[prev];
    if (!track) return;
    const currentUrl = audio.envelope?.url?.trim() ?? '';
    const inPlaceSeek = tryQueueInPlaceSeek({
      playQueue,
      queueIndex,
      targetQueueIdx: prev,
      currentUrl,
      streamDurationSeconds: audio.streamDurationSeconds,
      envelopeDurationSeconds: audio.envelope?.durationSeconds ?? 0,
    });
    if (currentUrl && inPlaceSeek != null) {
      setQueueIndex(prev);
      syncThumbsFromFeedback(track.envelopeId);
      void adoptInPlaceQueueTrack(track, inPlaceSeek);
      return;
    }
    setQueueIndex(prev);
    void handlePlayEnvelope(track, findHitCandidates(track));
  }, [
    audio,
    playQueue,
    queueIndex,
    handlePlayEnvelope,
    findHitCandidates,
    sendConnectCommand,
    syncThumbsFromFeedback,
    adoptInPlaceQueueTrack,
  ]);

  /*
   * Why the last skip did what it did. A skip that Up Next declines ('none') and a skip the queue
   * loses look identical from outside â€” both leave the index where it was â€” so the probe could
   * only ever report "did not advance". Recorded here so it can report which.
   */
  const lastSkipOutcomeRef = useRef<
    '' | 'remote' | 'seek' | 'none' | 'no-track' | 'in-place' | 'advance'
  >('');

  const skipForward = useCallback(() => {
    lastSkipOutcomeRef.current = '';
    if (isConnectRemoteRef.current) {
      lastSkipOutcomeRef.current = 'remote';
      sendConnectCommand({ cmd: 'SKIP_NEXT' });
      return;
    }
    if (audio.envelope && usesIntervalSeekTransport(audio.envelope.envelopeId)) {
      // Forward keeps the configured interval: that setting was always really about how much
      // sponsor read or theme music one press should clear.
      const { forward } = seekIntervalsFor(
        resolveMediaPillar({ envelopeId: audio.envelope.envelopeId }),
        loadPodcastSeekIntervalSeconds(),
      );
      lastSkipOutcomeRef.current = 'seek';
      audio.seek(
        seekTargetSeconds({
          currentSeconds: audio.currentTimeSeconds,
          deltaSeconds: forward,
          durationSeconds:
            audio.streamDurationSeconds ||
            audio.durationSeconds ||
            audio.envelope.durationSeconds ||
            0,
        }),
      );
      return;
    }
    const upNextSettings = loadSovereignUpNextSettings();
    const advance = computeNextQueueIndexWithUpNext({
      queueIndex,
      queueLength: playQueue.length,
      repeatMode: repeatMode === 'one' ? 'none' : repeatMode,
      shuffleOn,
      queue: playQueue,
      settings: upNextSettings,
    });
    if (advance.action === 'none') {
      lastSkipOutcomeRef.current = 'none';
      return;
    }
    const next =
      advance.action === 'repeat-one'
        ? queueIndex
        : advance.action === 'wrap' || advance.action === 'advance'
          ? advance.index
          : queueIndex;
    const track = playQueue[next];
    if (!track) {
      lastSkipOutcomeRef.current = 'no-track';
      return;
    }
    if (!isPodcastEnvelopeId(track.envelopeId)) {
      sovereignUpNextPodcastCountRef.current = 0;
    }
    const currentUrl = audio.envelope?.url?.trim() ?? '';
    const inPlaceSeek = tryQueueInPlaceSeek({
      playQueue,
      queueIndex,
      targetQueueIdx: next,
      currentUrl,
      streamDurationSeconds: audio.streamDurationSeconds,
      envelopeDurationSeconds: audio.envelope?.durationSeconds ?? 0,
    });
    if (currentUrl && inPlaceSeek != null && !(inPlaceSeek < 0.25 && next > 0)) {
      setQueueIndex(next);
      syncThumbsFromFeedback(track.envelopeId);
      lastSkipOutcomeRef.current = 'in-place';
      void adoptInPlaceQueueTrack(track, inPlaceSeek);
      return;
    }
    lastSkipOutcomeRef.current = 'advance';
    logE2e('js-skip', true, `from=${queueIndex} to=${next} env=${track.envelopeId}`);
    setQueueIndex(next);
    void handlePlayEnvelope(track, findHitCandidates(track), { preservePlayQueue: true });
  }, [
    audio,
    playQueue,
    queueIndex,
    repeatMode,
    shuffleOn,
    handlePlayEnvelope,
    findHitCandidates,
    sendConnectCommand,
    syncThumbsFromFeedback,
    adoptInPlaceQueueTrack,
  ]);

  useEffect(() => {
    if (audio.envelope) {
      sessionEnvelopeRef.current = audio.envelope;
    }
  }, [audio.envelope?.envelopeId]);

  useEffect(() => {
    if (!audio.envelope) return;
    sessionPeakSecondsRef.current = Math.max(
      sessionPeakSecondsRef.current,
      audio.currentTimeSeconds,
    );
  }, [audio.envelope?.envelopeId, audio.currentTimeSeconds]);

  useEffect(() => {
    const envelopeId = audio.envelope?.envelopeId;
    return () => {
      if (envelopeId) flushPlaySession(false);
    };
  }, [audio.envelope?.envelopeId, flushPlaySession]);

  useEffect(() => {
    return audio.subscribeEnded(() => {
      const env = audioEnvelopeRef.current;
      if (env) {
        const peak = Math.max(
          sessionPeakSecondsRef.current,
          audioDurationRef.current || audioCurrentTimeRef.current,
        );
        sessionPeakSecondsRef.current = peak;
        recordPlaySession(env, peak, true);
        void scrobbleTrack(env, Math.floor(peak * 1000));
        sessionPeakSecondsRef.current = 0;
        sessionEnvelopeRef.current = env;
        recordPlay(env);
      }
    });
  }, [audio]);

  useEffect(() => {
    if (audio.state !== 'Playing' || !audio.envelope) return;
    void scrobbleNowPlaying(audio.envelope);
  }, [audio.state, audio.envelope?.envelopeId]);

  const [listeningTick, setListeningTick] = useState(0);
  useEffect(() => subscribePlayHistory(() => setListeningTick((t) => t + 1)), []);

  useEffect(() => {
    syncThumbsFromFeedback(audio.envelope?.envelopeId);
  }, [audio.envelope?.envelopeId, syncThumbsFromFeedback]);

  useEffect(
    () =>
      subscribeTasteFeedback(() => {
        syncThumbsFromFeedback(audio.envelope?.envelopeId);
      }),
    [audio.envelope?.envelopeId, syncThumbsFromFeedback],
  );

  const homeListeningPreview = useMemo(() => {
    void listeningTick;
    const stats = getListeningStats('month');
    return {
      minutesLabel: formatMinutesHuman(stats.minutesListened),
      topArtist: stats.topArtists[0]?.label,
      sessionCount: stats.sessionCount,
    };
  }, [listeningTick]);

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

  const {
    tvRecentlyAdded,
    tvContinueListening,
    tvPlaylistCards,
    tvCollectionCards,
    resolveEnvelopeById,
    handleHomePlayById,
    handleTVHomeSelect,
  } = useShellTvHome({
    lockerEnvelopes,
    playQueue,
    searchHits,
    homeLastQueue,
    audio,
    tvPlaylists,
    handlePlayEnvelope,
    findHitCandidates,
    handleResumeLastQueue,
    handlePlayAlbum,
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
    resolveEnvelopeById,
    playEnvelopeRef,
    findHitCandidates,
    skipForward,
    skipBack,
    handleAddToQueue,
    handleRemoveFromQueue,
    handleReorderQueue,
    handleClearQueue,
    audioEnvelopeRef,
    audioCurrentTimeRef,
    audioDurationRef,
    audioStateRef,
    audioVolumeRef,
    playQueueRef,
    queueIndexRef,
  });

  useEffect(() => {
    if (!audio.title || !audio.artist || artworkUrl) return;
    if (audio.envelope?.envelopeId && isPodcastEnvelopeId(audio.envelope.envelopeId)) return;
    void fetchTrackMetadata(audio.artist, audio.title).then((meta) => {
      const fetched = coalesceArtworkUrl(meta.albumArt, audio.envelope?.artworkUrl);
      if (fetched) {
        setArtworkUrl((prev) => proxiedArtworkUrl(fetched) ?? fetched ?? prev);
      }
    });
  }, [audio.title, audio.artist, audio.envelope?.envelopeId, audio.envelope?.artworkUrl, artworkUrl]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env?.envelopeId) return;
    void (async () => {
      try {
        let raw = env.artworkUrl?.trim();
        if (!raw) {
          raw = resolveLockerEntryAlbumArt(env)?.trim() ?? '';
        }
        if (!raw) {
          const id = resolveLockerEntryId(env);
          if (id) raw = (await adoptPlaybackLockerArtwork(id)) ?? '';
        }
        if (!raw) return;
        const next = proxiedArtworkUrl(raw) ?? raw;
        setArtworkUrl((prev) => stabilizePlaybackArtSrc(prev, next, env.envelopeId) || next);
      } catch (err) {
        console.warn('[sandboxLayer3] artwork backfill failed:', err);
      }
    })();
  }, [
    audio.envelope?.envelopeId,
    audio.envelope?.artworkUrl,
    audio.envelope?.provider,
    audio.envelope?.sourceId,
    lockerEnvelopes,
  ]);

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

  const {
    lyricsEnvelope,
    lyricsTitle,
    lyricsArtist,
    lyricsCurrentTimeSeconds,
    lyricsIsPlaying,
    handleLyricsSeek,
    resolveActiveLyrics,
  } = useShellLyricsResolve({
    isConnectRemote,
    remoteMirror,
    resolveEnvelopeById,
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

  const lockerFeatured = useMemo(() => {
    if (audio.envelope || homeAwaitingUserResume || !queuePersistReady) return null;
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return null;
    const recent = [...entries].sort((a, b) => b.addedAt - a.addedAt)[0];
    if (!recent) return null;
    return {
      envelopeId: `local-${recent.id}`,
      title: recent.title,
      artist: inferArtistFromAlbumFolder(recent.albumName ?? '', recent.artist),
      album: recent.albumName,
      artworkUrl: resolveLockerEntryGroupArt(recent, entries),
      url: recent.url,
      durationSeconds: recent.durationSeconds || 210,
      provider: 'local-vault' as const,
      transport: 'element-src' as const,
      sourceId: recent.id,
    };
  }, [audio.envelope, lockerEnvelopes, homeAwaitingUserResume, queuePersistReady]);

  const hasActivePlayback =
    effectiveConnectRole === 'remote'
      ? Boolean(remoteMirror?.currentTrackId)
      : Boolean(audio.envelope) ||
        audio.state === 'Playing' ||
        audio.state === 'Ready' ||
        audio.state === 'Resolving' ||
        audio.state === 'Connecting' ||
        audio.state === 'Failed' ||
        androidNativePlaybackLive;

  useEffect(() => {
    if (!showMobileShell) return;
    if (hasActivePlayback) {
      setMobilePlayerPending(false);
      return;
    }
    if (
      mobilePlayerPending &&
      audio.state === 'Idle' &&
      !audio.envelope &&
      effectiveConnectRole !== 'remote'
    ) {
      setMobilePlayerPending(false);
    }
  }, [
    showMobileShell,
    hasActivePlayback,
    mobilePlayerPending,
    audio.state,
    audio.envelope,
    effectiveConnectRole,
  ]);

  /** Android: one nudge per track when Exo has a native-playable URL (home vinyl). */
  const androidHomePlayNudgeRef = useRef<string | null>(null);
  useEffect(() => {
    if (!showMobileShell || !isAndroid()) return;
    if (!audio.nativeExoActive) return;
    const env = audio.envelope;
    const url = env?.url?.trim() ?? '';
    if (!url) return;
    if (url.startsWith('blob:')) return;
    if (env?.envelopeId && isPodcastEnvelopeId(env.envelopeId)) return;
    if (audio.state === 'Failed') return;
    if (audio.state === 'Playing' || audio.state === 'Idle') {
      androidHomePlayNudgeRef.current = null;
      return;
    }
    if (audio.state !== 'Connecting') return;
    const key = env.envelopeId;
    if (androidHomePlayNudgeRef.current === key) return;
    androidHomePlayNudgeRef.current = key;
    audio.primePlaybackGesture();
    void audio.play({ userGesture: true });
  }, [
    showMobileShell,
    audio.state,
    audio.envelope?.envelopeId,
    audio.envelope?.url,
    audio.nativeExoActive,
    audio,
  ]);

  /** Resume ExoPlayer when now-playing opens with a resolved URL but native state is idle. */
  useEffect(() => {
    if (!mobileNowPlayingOpen || !showMobileShell) return;
    if (station === 'home') return;
    const env = audio.envelope;
    if (!env?.url?.trim()) return;
    if (env.envelopeId && isPodcastEnvelopeId(env.envelopeId)) return;
    if (
      audio.state === 'Playing' ||
      audio.state === 'Resolving' ||
      audio.state === 'Connecting'
    ) {
      return;
    }
    audio.primePlaybackGesture();
    void audio.play();
  }, [
    mobileNowPlayingOpen,
    showMobileShell,
    station,
    audio.envelope?.envelopeId,
    audio.envelope?.url,
    audio.state,
    audio,
  ]);

  const homeHasLoadedTrack =
    hasActivePlayback ||
    Boolean(audio.envelope?.envelopeId?.trim()) ||
    (!showMobileShell && !homeAwaitingUserResume && Boolean(lockerFeatured));
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
    handleDownloadTrack,
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
  const showHomeActiveWash =
    station === 'home' && homeHasLoadedTrack && !showMusicUniverse && !isCarMode;
  const homeGenreBucket = useMemo(
    () => (showHomeActiveWash ? getGenreBucketForTrack(audio.envelope) : null),
    [showHomeActiveWash, audio.envelope?.envelopeId, audio.envelope?.title, audio.envelope?.artist],
  );
  const { cssVars: vinylCssVars, vinylClass: vinylPsycheClass } = useVinylVisualStyle(
    audio.envelope,
  );
  const { universeStyle: trackUniverseStyle, isArtDriven: homeArtDriven, isMonochrome: homeArtMono } =
    useTrackUniverseStyle(homeArt?.trim() ? homeArt : undefined, homeGradientSeed);
  const musicUniverseStyle = useMemo(
    () => ({ ...trackUniverseStyle, ...vinylCssVars }),
    [trackUniverseStyle, vinylCssVars],
  );
  const homeArtUniverseClass =
    homeHasLoadedTrack && homeArtDriven
      ? ` music-universe-backdrop--art-driven${homeArtMono ? ' music-universe-backdrop--art-monochrome' : ''}`
      : '';
  const miniPlayerNavigatesHome = showMobileShell || (!isTV && !isCarMode && !showMobileShell);

  const mobilePlayingFromLabel = useMemo(() => {
    if (mixRadioSession) {
      if (mixRadioSession.kind === 'discovery-station') {
        return t('nowPlaying.discoveryStation', { defaultValue: 'Discovery Station' });
      }
      if (mixRadioSession.kind === 'discovery-mfy') {
        return t('nowPlaying.fromDiscoveryMix', { title: mixRadioSession.seedTitle });
      }
      return mixRadioSession.kind === 'mix'
        ? t('nowPlaying.fromArtistMix', { artist: mixRadioSession.seedArtist })
        : t('nowPlaying.fromTrackRadio', { title: mixRadioSession.seedTitle });
    }
    switch (station) {
      case 'podcasts':
        return t('nav.podcasts');
      case 'audiobooks':
        return t('nav.audiobooks');
      case 'search':
        return t('nowPlaying.fromSearch');
      case 'locker':
        return t('nowPlaying.fromLocker');
      case 'discover':
        return t('nowPlaying.fromDiscover');
      case 'library':
        return t('library.title');
      case 'home':
        return t('nowPlaying.fromHome');
      default:
        return t('nowPlaying.fromQueue');
    }
  }, [mixRadioSession, station, t]);

  const {
    npCurrentTimeSeconds,
    npDurationSeconds,
    npIsPlaying,
    npEnvelope,
    npIsPodcast,
    npIsBusy,
    activePodcastChapter,
    canPodcastPrevChapter,
    canPodcastNextChapter,
    embeddedChapters,
    scannedChapters,
    bookChapterMarks,
    nowPlayingChapterWindow,
    playerBarHeldNowPlaying,
  } = useShellNowPlayingChapters({
    serverStemMix,
    isConnectRemote,
    remoteMirror,
    nowPlayingAuthority,
    nowPlayingDisplay,
    audio,
    lockerFeatured,
    lyricsEnvelope,
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

  const handleEnterCarMode = useCallback(() => {
    if (isTV || isCarModeActive()) return;
    setNavOpen(false);
    closeMobileSearch();
    setQueueDrawerOpen(false);
    setLyricsDrawerOpen(false);
    setSleepTimerPanelOpen(false);
    setCastPickerOpen(false);
    activateCarMode();
  }, [isTV, closeMobileSearch]);

  const handleExitCarMode = useCallback(() => {
    if (!isCarModeActive()) return;
    deactivateCarMode();
    if (carHistoryPushedRef.current) {
      carHistoryPushedRef.current = false;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!isCarMode || isTV || carHistoryPushedRef.current) return;
    window.history.pushState({ sandboxCarMode: true }, '');
    carHistoryPushedRef.current = true;
  }, [isCarMode, isTV]);

  useEffect(() => {
    if (!isCarMode) return;
    const onPopState = () => {
      if (carHistoryPushedRef.current) {
        carHistoryPushedRef.current = false;
        deactivateCarMode();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [isCarMode]);

  useEffect(() => {
    return registerCarVoiceActions([
      { id: 'play', label: t('carMode.play'), handler: () => shortcutCtxRef.current.play() },
      { id: 'pause', label: t('carMode.pause'), handler: () => shortcutCtxRef.current.pause() },
      { id: 'next', label: t('carMode.nextTrack'), handler: () => shortcutCtxRef.current.skipForward() },
      { id: 'previous', label: t('carMode.previousTrack'), handler: () => shortcutCtxRef.current.skipBack() },
      { id: 'exit', label: t('carMode.exit'), handler: () => handleExitCarMode() },
    ]);
  }, [handleExitCarMode, t]);

  useEffect(() => {
    return subscribeSleepTimer(() => setSleepTimerTick((t) => t + 1));
  }, []);

  useEffect(() => {
    return registerSleepTimerCallbacks({
      onSleepExpire: () => {
        if (isConnectRemoteRef.current) {
          sendConnectCommand({ cmd: 'PAUSE' });
        } else {
          audio.pause();
        }
      },
      onWakeAlarm: (track) => {
        const env: MediaEnvelope = {
          envelopeId: track.envelopeId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          url: track.url ?? '',
          artworkUrl: track.artworkUrl,
          provider: track.provider ?? 'unknown',
          sourceId: track.sourceId,
          durationSeconds: track.durationSeconds ?? 0,
          transport: track.transport ?? 'element-src',
        };
        void playEnvelopeRef.current(env, findHitCandidates(env));
      },
    });
  }, [audio, sendConnectCommand, findHitCandidates]);

  const sleepTimerLabel = useMemo(() => {
    const snap = getSleepTimerSnapshot();
    if (!snap.active) return null;
    return formatSleepRemaining(snap.remainingSeconds, snap.isEventBased, snap.preset);
  }, [sleepTimerTick]);

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

  if (isCarMode && !isTV) {
    const carArt =
      proxiedArtworkUrl(artworkUrl || audio.envelope?.artworkUrl) ??
      (artworkUrl || audio.envelope?.artworkUrl || '');
    return (
      <LockerVaultProvider>
        <div className="shell-root shell-root--car h-dvh w-full min-w-0 flex flex-col relative z-[1]">
          <CarModeView
            title={homeTitle}
            artist={homeArtist}
            albumArt={carArt}
            state={homeDisplayState}
            isPlaying={audio.state === 'Playing' || audio.nativeExoEffectivePlaying}
            volume={audio.volume}
            isMuted={audio.isMuted}
            connectRemote={effectiveConnectRole === 'remote'}
            remoteMirror={remoteMirror}
            onTogglePlay={togglePlay}
            onSkipBack={skipBack}
            onSkipForward={skipForward}
            onSetVolume={(level) => {
              if (isConnectRemoteRef.current) {
                sendConnectCommand({ cmd: 'SET_VOLUME', volume: level });
              } else {
                audio.setVolume(level);
              }
            }}
            onToggleMute={() => {
              if (isConnectRemoteRef.current) {
                const v = remoteMirror?.volume ?? 0;
                sendConnectCommand({ cmd: 'SET_VOLUME', volume: v > 0 ? 0 : 1 });
              } else {
                audio.toggleMute();
              }
            }}
            onExit={handleExitCarMode}
          />
        </div>
      </LockerVaultProvider>
    );
  }

  if (showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => setOnboardingComplete(true)}
        enterAs={profile.enterAs}
      />
    );
  }

  if (showServerSetup) {
    return (
      <ServerSetup
        onComplete={() => setServerSetupDismissed(true)}
      />
    );
  }

  if (profile.requiresSystemLogin) {
    return (
      <SystemLogin
        profiles={profile.profiles}
        onEnter={profile.enterAs}
        onSelect={profile.selectProfile}
      />
    );
  }

  const showBottomPlayer =
    !isTV &&
    !(showMobileShell && station === 'home') &&
    (hasActivePlayback ||
      narrationPlayback !== null ||
      (showMobileShell && mobilePlayerPending) ||
      queueDrawerOpen ||
      (!showMobileShell && (lyricsDrawerOpen || sleepTimerPanelOpen)));

  /*
   * Narration counts as playback for the player chrome only.
   *
   * hasActivePlayback is derived from the audio state machine and is threaded through queueing,
   * scrobbling and resume, none of which a spoken document should touch. This narrower flag says
   * one thing: something is playing, so the player should be on screen.
   */
  const playbackChromeActive = hasActivePlayback || narrationPlayback !== null;
  /*
   * What is playing decides which controls exist, rather than the player offering everything and
   * each medium quietly ignoring what does not apply to it. Shuffling a novel is not an unused
   * button, it is a destroyed book.
   */
  /*
   * Music starting ends the reading.
   *
   * Narration deliberately survives navigating away, so a book keeps being read while you browse.
   * It must not survive something else starting to play: two things cannot make sound at once, and
   * the session was still overriding the player, which left a track showing the book's cover.
   *
   * Keyed on the envelope id rather than a play/pause flag, so pausing a book to look at your
   * library does not silently end it.
   */
  const audibleEnvelopeId = audio.envelope?.envelopeId ?? null;
  useEffect(() => {
    if (!audibleEnvelopeId) return;
    const reading = getNarrationPlayback();
    if (!reading) return;
    reading.controls.stop();
    clearNarrationPlayback(reading.sourceId);
    /*
     * Release the media session too, not just the store.
     *
     * beginNarrationSession wrote the book into the native session, and stopping the reader does
     * not take it back out -- only 'finished' released it. So a track played afterwards kept the
     * book's title and cover on the bar and the lock screen, because the audio layer reads that
     * metadata back.
     */
    void endNarrationSession();
  }, [audibleEnvelopeId]);

  /*
   * Narration may only drive the player while nothing else is loaded.
   *
   * Ownership used to follow the narration store alone, so a session that failed to clear kept the
   * book's title on a music track and, worse, kept play/pause wired to the reader -- the buttons
   * appeared to do nothing because they were controlling something that was no longer playing.
   * A loaded envelope is the audio layer's own statement that it owns the output.
   */
  const narrationForPlayer = audibleEnvelopeId ? null : narrationPlayback;

  /**
   * Stop everything and empty the player.
   *
   * Pause leaves the track loaded, the queue intact and the lock screen occupied, so there was
   * no way to say "I am finished" short of force-closing the app. Everything that can be making
   * sound is stopped here rather than only the one the screen happens to be showing: audio and
   * narration are separate engines, and stopping one while the other keeps talking is the bug
   * this is meant to prevent.
   */
  const handleClearPlayer = useCallback(async () => {
    const reading = getNarrationPlayback();
    if (reading) {
      reading.controls.stop();
      clearNarrationPlayback(reading.sourceId);
    }
    // Releases the foreground notification, which otherwise outlives the thing that raised it.
    await endNarrationSession();
    await prepareCleanPlaybackStop(() => audio.stop());
    setPlayQueue([]);
    setQueueIndex(0);
    setMobileNowPlayingOpen(false);
    setQueueDrawerOpen(false);
    setLyricsDrawerOpen(false);
  }, [audio]);
  const nowPlayingPillar = resolveMediaPillar({
    envelopeId: audio.envelope?.envelopeId,
    narrating: narrationForPlayer !== null,
  });
  const nowPlayingControls = controlsForPillar(nowPlayingPillar);
  const mobilePlaybackShellActive = showMobileShell
    ? hasMobilePlaybackShell(playbackChromeActive, mobilePlayerPending)
    : false;
  const mobileUsesPlayerPadding = showMobileShell
    ? mobileShellUsesPlayerPadding(
        station,
        mobilePlaybackShellActive,
        mobileSearchOpen,
        isAndroid(),
        mobileNowPlayingOpen,
      )
    : false;
  const showMobileDockBar =
    mobilePlaybackShellActive &&
    (shouldShowMobileMiniBar(
      station,
      true,
      mobileSearchOpen,
      mobileNowPlayingOpen,
    ) ||
      shouldShowMobileInfoStrip(station, true, mobileNowPlayingOpen));
  const hideHomePlaybackChrome = showMobileShell && mobileSearchOpen;

  return (
    <ShellChrome
      {...{
        activateSearchDropdownItem,
        activeLyrics,
        activePodcastChapter,
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
        bookChapterMarks,
        canPodcastNextChapter,
        canPodcastPrevChapter,
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
        goToLockerHome,
        handleAcquireAndPlayHit,
        handleActivateRecentSearch,
        handleAddToQueue,
        handleAlbumBack,
        handleAnalyzeStems,
        handleArtistBack,
        handleArtistMix,
        handleBrowsePick,
        handleCacheSearchHit,
        handleCacheTrack,
        handleClearPlayer,
        handleClearQueue,
        handleClearSearchHistory,
        handleClearSearchInput,
        handleCycleEpisodeVolumeBoost,
        handleCyclePodcastSpeed,
        handleDismissStuckPlayback,
        handleDownloadAlbum,
        handleDownloadImportedPlaylist,
        handleDownloadMix,
        handleDownloadSearchHit,
        handleDownloadTierChange,
        handleDownloadTrack,
        handleEnterCarMode,
        handleExploreInstantMix,
        handleHomePlayById,
        handleLockerTrackPlay,
        handleLyricsSeek,
        handleMobileMenuSelect,
        handleMobileTabNavigate,
        handleMobileTrackTitleTap,
        handleOpenAlbumByName,
        handleOpenArtistByName,
        handleOpenDownloadJob,
        handleOpenPlaylistsPrompt,
        handleOpenVideoFeed,
        handlePlayAlbum,
        handlePlayDiscoveryMix,
        handlePlayEnvelope,
        handlePlayNext,
        handlePlaySource,
        handlePodcastNextChapter,
        handlePodcastPrevChapter,
        handlePrepareForTravel,
        handleQueueShowUnplayed,
        handleQuickFilter,
        handleRemoveFromQueue,
        handleRemoveRecentSearch,
        handleReorderQueue,
        handleReorderUpNext,
        handleResumeLastQueue,
        handleSaveInstantPlaylist,
        handleSaveMixRadio,
        handleSaveQueueAsPlaylist,
        handleSearchBack,
        handleSearchPlay,
        handleSelectAlbum,
        handleSelectArtist,
        handleSelectPlaylist,
        handleSelectSuggestion,
        handleSelectTrack,
        handleSendToDj,
        handleShareMix,
        handleSkipPodcastAd,
        handleSonicLockerDiscoveryStation,
        handleSonicLockerPlayQueue,
        handleSonicLockerSaveMix,
        handleStreamSearchHit,
        handleTVHomeSelect,
        handleThumbDown,
        handleThumbUp,
        handleTogglePodcastSkipAdChapters,
        handleTogglePodcastSmartSpeed,
        handleTogglePodcastVoiceBoost,
        handleTrackRadio,
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
        homeLastQueue,
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
        lyricsArtist,
        lyricsCurrentTimeSeconds,
        lyricsDrawerOpen,
        lyricsIsPlaying,
        lyricsTitle,
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
        musicSegmentBar,
        musicUniverseStyle,
        narrationForPlayer,
        narrowShell,
        navActiveId,
        navItems,
        navOpen,
        navPinTabs,
        nowPlayingAuthority,
        nowPlayingChapterWindow,
        nowPlayingControls,
        nowPlayingDisplay,
        npCurrentTimeSeconds,
        npDurationSeconds,
        npEnvelope,
        npIsBusy,
        npIsPlaying,
        npIsPodcast,
        offlineStatus,
        openCastPicker,
        openHomePlayer,
        openMobileNowPlaying,
        openMobileSearch,
        openSettings,
        openStationDownloads,
        pendingDjDeckLoad,
        pendingExternalImport,
        pendingShareImport,
        persistLockerPlayRepair,
        playQueue,
        playbackFidelityLabel,
        playbackResolveElapsed,
        playerAddToPlaylistOpen,
        playerBarHeldNowPlaying,
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
        resolveActiveLyrics,
        resumeQueueCandidate,
        runExploreSearch,
        runSearch,
        searchActiveIndex,
        searchCatalog,
        searchDropdownEffectiveOpen,
        searchDropdownItems,
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
        showResumeQueuePrompt,
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
        submitSearch,
        suggestedQueueTracks,
        t,
        tabletShell,
        thumbDown,
        thumbUp,
        togglePlay,
        tvActiveStation,
        tvCollectionCards,
        tvContinueListening,
        tvNowPlaying,
        tvPlaylistCards,
        tvQueueOpen,
        tvRecentlyAdded,
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
