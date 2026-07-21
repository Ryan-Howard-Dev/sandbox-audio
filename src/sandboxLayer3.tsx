/**
 * Sandbox Music — Layer 3: Responsive Shell
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
  X,
  Cast,
  Radio,
  Activity,
  Server,
  ListMusic,
  Menu,
  Download,
} from 'lucide-react';
import CollapsibleStationNav from './components/CollapsibleStationNav';
import { queueStemAnalyzeForLockerTrack } from './analyzeStemsAction';
import {
  loadBatterySaverEnabled,
  subscribeBatterySaver,
} from './batterySaverSettings';
import MobileNavMoreSheet, { type MobileNavMoreItem } from './components/MobileNavMoreSheet';
import OnboardingWizard from './components/OnboardingWizard';
import ServerSetup from './components/ServerSetup';
import PodcastChapterSheet from './components/podcasts/PodcastChapterSheet';
import MobileDockWithShell from './mobile/MobileDockWithShell';
import PlayerBar from './components/PlayerBar';
import {
  hasMobilePlaybackShell,
  mobileShellUsesPlayerPadding,
  shouldShowMobileInfoStrip,
  shouldShowMobileMiniBar,
  shouldUseAndroidInlinePlayerDock,
} from './mobile/mobilePlayerShellLogic';
import { resolveDiscoverHardwareBack } from './mobile/discoverAndroidBack';
import { resolveMobileTabActiveId } from './mobile/mobileTabActiveLogic';
import { useMobileShell } from './hooks/useMobileShell';
import { isNativeCapacitorNonTv, isTabletViewport } from './hooks/mobileShellLayout';
import { useAndroidBackNavigation } from './hooks/useAndroidBackNavigation';
import {
  flushPendingShellScrollRestore,
  registerShellScrollContainer,
  requestShellScrollRestore,
  saveShellScroll,
  SEARCH_RESULTS_SCROLL_KEY,
  searchArtistScrollKey,
} from './scrollRestore';
import { closeSandboxOverlay } from './hooks/useDismissableOverlay';
import { installE2eLiveHandlers } from './e2eHandlerBootstrap';
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
  waitForPlaybackStarted,
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
  lockerEntryIsPlayable,
  lockerTitleMatches,
  refreshLockerEntryPlayUrl,
  removeLockerEntry,
  resolveLockerArtworkUrl,
  resolveLockerEnvelopeForPlayback,
  resolveLockerEntryGroupArt,
  subscribeLockerCache,
  tracksForAlbumGroup,
  warmLockerCache,
  type LockerEntry,
} from './lockerStorage';
import { sortLockerTracks } from './lockerTrackOrder';
import { LOCKER_USER_DELETE_CONFIRMED } from './lockerDeleteGuard';
import {
  playbackArtStabilizeScope,
  resolveLockerEntryAlbumArt,
  resolvePlaybackCoverArt,
  stabilizePlaybackArtSrc,
} from './playerBarTrackMeta';
import { runDeferredPlaySideEffects } from './play/deferredPlaySideEffects';
import {
  buildHealAttemptKey,
  resolveHealAction,
} from './play/playbackHealPolicy';
import {
  computeNextQueueIndex,
  computeSkipBackIndex,
  tryExtendMixRadioQueue,
} from './play/queueAdvancePolicy';
import {
  resolveActivePlayQueue,
  shouldSuppressJsAdvanceAfterNativeGapless,
  trackPlaybackMatureForAdvance,
} from './play/queueAdvanceGate';
import {
  buildPodcastQueueForFeed,
  computeNextQueueIndexWithUpNext,
  loadSovereignUpNextSettings,
  mergeIntoUpNextQueue,
  shouldStopUpNextAfterPodcast,
} from './sovereignUpNext';
import {
  needsMobileResolveEarly as needsMobileResolveEarlyPath,
  readSyncCachedFastPath,
  tryQueueInPlaceSeek,
} from './play/playTapFastPath';
import { computePlayQueueSeed } from './play/albumPlayQueue';
import { startAutoSimilarRadioIfNeeded } from './play/standaloneSimilarRadio';
import { ensureLockerPlayable, envelopeClaimsLocker, shouldRunLockerPlaybackGate } from './play/ensureLockerPlayable';
import { attemptDeadLockerReacquire } from './lockerDeadTrackReacquire';
import { findQueueIndexForExoUrl, isExoMediaItemTransitionEvent } from './play/exoQueueSync';
import {
  estimateStreamDownloadMb,
  formatCellularDownloadNotice,
  isCellularNetwork,
  needsUncachedRemoteResolve,
} from './networkPlayPolicy';
import { cacheUpcomingOnWifi, prefetchUpcomingOnWifi } from './wifiBackgroundPrefetch';
import { prepareTracksForTravel } from './prepareForTravel';
import { lookupLockerReplayGainDb } from './replayGainPlayback';
import {
  cacheEnvelopeForOffline,
  getStreamCacheEnvelope,
  isEnvelopeStreamCached,
  warmStreamCacheIndex,
} from './streamCache';
import {
  dismissPrefetchProgress,
  notifyPrefetchProgress,
} from './prefetchProgressNotify';
import { loadAggressiveOfflineCacheEnabled } from './sandboxSettings';
import {
  prefetchUpcomingQueueTracks,
  primeLockerNativeQueue,
  isLockerVaultPlayQueue,
  stageUpcomingQueueOnTier34,
  tryInstantPlayable,
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
  isNowPlayingSheetDomOpen,
  probeHeroVisualFromDom,
} from './homeHeroPlayerLogic';
import MixRadioSaveDialog, { type MixRadioSaveMode } from './components/MixRadioSaveDialog';
import {
  buildArtistMix,
  buildTrackRadio,
  discoveryMixRadioSession,
  prepareDiscoveryMixQueue,
  saveMixRadioToLocker,
  type MixRadioSession,
} from './playerMixRadio';
import { buildDiscoveryMixContinuation } from './discoveryMixRadio';
import type { DiscoveryMix } from './discoveryMixes';
import { initAndroidAppResume } from './androidAppResume';
import { initAndroidWiredDacStability, resolveNativeExoTransitionPrefs } from './androidWiredDacPlayback';
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
import AppErrorBoundary from './components/AppErrorBoundary';
import ArtistDetailView from './stations/ArtistDetailView';
import {
  LazyArtistDetailView,
  LazyAudiobooksView,
  LazyCollectionView,
  LazyDiscoverStationView,
  LazyDJStationView,
  LazyLibraryStationView,
  LazyListeningStatsView,
  LazyPodcastsView,
  LazySearchResultsView,
  LazySettingsView,
  LazySonicLockerStationView,
  withStationSuspense,
} from './shell/lazyStationViews';
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
  savePodcastsEnabled,
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
  saveEpisodeResumePosition,
  markEpisodeCompleted,
  maybeAutoCompleteEpisode,
} from './podcastStorage';
import { type PodcastSearchHit } from './podcastSearch';
import {
  resolveOnlineCatalogEpisode,
  searchPodcastsUnified,
  subscribeFromCatalogShow,
  type PodcastCatalogEpisodeHit,
} from './podcastCatalog';
import { episodeEnvelope } from './podcastSearch';
import { loadOfflinePodcastEpisodes } from './podcastOfflineEpisodes';
import { resolvePodcastEnvelopeForPlayback, hasPlayablePodcastStreamUrl } from './podcastPlayback';
import {
  hasPlayableAudiobookCatalogStreamUrl,
  resolveAudiobookCatalogEnvelopeForPlayback,
} from './audiobookCatalogPlayback';
import { isAudiobookCatalogEnvelopeId } from './audiobookCatalog';
import { tapHaptic, yieldToMain } from './uiTapFeedback';
import {
  playbackSwitchRequiresHardPreempt,
  resolveNowPlayingDisplay,
  seedPlaybackDisplayFromEnvelope,
  shouldSkipLockerPlaybackGate,
  type PlaybackDisplayFields,
} from './playbackSession';
import {
  getActiveChapter,
  seekSecondsForNextChapter,
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
import { resolveCatalogAwareDuration } from './catalogPlaybackDuration';
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
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import { exploreDisplayQuery, type ExploreGroup } from './exploreCatalog';
import { isNewMusicQuery, newMusicSearchLabel } from './newMusicQuery';
import type { QuickBrowseFilter } from './exploreBrowseData';
import {
  tier34DhtResolve,
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
import { isOfflineUnplayableStreamUrl } from './nativeExoStreamResolver';
import { getNativeExoPlaybackStatus, nativeExoPlaybackStatus, subscribeNativeExoStatus } from './androidNativePlayback';
import { isNativeExoAudible, clearLastPlayIntent, lastPlayIntentToEnvelope, loadLastPlayIntent } from './lastPlayIntent';
import { getYtDlpMobileStatus, waitForYtDlpInit } from './ytDlpMobile';
import {
  beginPlayIntent,
  bumpPlayGeneration,
  currentPlayGeneration,
  formatMobilePlaybackError,
  isPlayIntentCurrent,
} from './playIntent';
import {
  coalesceArtworkUrl,
  displayTransportLabel,
  isCatalogPreviewUrl,
  proxiedArtworkUrl,
} from './displaySanitize';
import {
  executeTrack,
  ensureCatalogPlaybackIdentity,
  isPlaybackDowngrade,
  preserveTappedEnvelopeIdentity,
} from './playbackPipeline';
import {
  retryTrackInDownloadJob,
  scheduleCatalogAlbumDownload,
  scheduleCatalogTrackDownload,
  scheduleSearchHitDownload,
} from './acquisitionPipeline';
import {
  filterTracksNeedingDownload,
  resolveCatalogLockerCoverage,
} from './downloadLockerPrecheck';
import { primeDownloadBatteryMonitor } from './downloadBatteryGate';
import {
  acquireImportedPlaylist,
  unmatchedImportStubs,
} from './importPlaylistAcquisition';
import { rematchAllPlaylistStubsFromLocker } from './playlistStubRematch';
import DownloadErrorToast from './components/DownloadErrorToast';
import DownloadActivitySheet, {
  countDownloadSheetBadge,
} from './components/DownloadActivitySheet';
import AcquireProgressToast from './components/AcquireProgressToast';
import ConfirmDialog from './components/ConfirmDialog';
import { getDownloadJobs, subscribeDownloadQueue } from './downloadQueue';
import { acquireAndPlayHit } from './acquireAndPlay';
import { notifyAcquireProgress } from './acquireProgressNotify';
import { resolveCastStreamUrl } from './castStreamResolver';
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
  createPlaylistWithTracks,
  loadPlaylists,
  patchPlaylistTrackLockerRef,
  savePlaylists,
  subscribePlaylists,
  type StoredPlaylist,
} from './playlistStorage';
import {
  EMPTY_LYRICS,
  resolveTrackLyrics,
  type ResolvedLyrics,
} from './resolveTrackLyrics';
import {
  getCastState,
  isSpeakerCastActive,
  loadAutoCastEnabled,
  loadDefaultCastDevice,
  startCastToDevice,
  subscribeCastState,
  syncCastEnvelope,
  type CastState,
} from './castState';
import {
  getCinemaCastMode,
  publishCinemaCast,
  subscribeCastSession,
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
  loadConnectRolePref,
  loadFidelityPolicy,
  loadGaplessEnabled,
  loadNetworkSyncEnabled,
  loadOnboardingComplete,
  loadTvCoverageBannerDismissed,
  requestTauriCastGuidance,
  resolveConnectRole,
  saveTvCoverageBannerDismissed,
  shouldShowOnboardingWizard,
  shouldShowServerSetup,
} from './sandboxSettings';
import { maybeAutoStartLocalSandboxServer, ensureTier34ForPlayback, getLastTier34StartError, isSandboxServerDesktop } from './sandboxServerBridge';
import { prefsGetItem } from './prefsStorage';
import {
  enqueueDownloadJob,
  findAlbumDownloadJob,
  getActiveDownloadJobs,
  initJobTracks,
  loadDownloadTierPreference,
  patchDownloadJob,
  saveDownloadTierPreference,
  trackTitleKeysMatch,
  type DownloadJob,
  type DownloadMode,
  type DownloadTierPreference,
} from './downloadQueue';
import {
  computeSkipped,
  getAllPlayHistory,
  getMostPlayed,
  getRecentlyPlayed,
  loadLastQueue,
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
  clearPersistedQueue,
  initQueuePersistenceLifecycle,
  isStablePlaybackFsmState,
  loadQueueState,
  markActivePlaybackSession,
  persistableCurrentTrackId,
  rehydrateQueueState,
  sanitizeRestoredEnvelope,
  saveQueueState,
  isLikelyPageReload,
  isColdPlaybackStart,
  shouldAutoRestorePlayerOnLoad,
  shouldSkipPlayerRestoreOnLoad,
  shouldRestoreLastPlayIntentOnLoad,
  type RepeatMode,
} from './queuePersistence';
import {
  formatMinutesHuman,
  getListeningStats,
} from './listeningAnalytics';
import {
  registerKeyboardShortcuts,
  registerMediaSession,
  syncMediaSessionState,
  type MediaSessionTrackMetadata,
} from './keyboardShortcuts';
import {
  syncAndroidBackgroundMedia,
} from './backgroundMedia';
import { initNativeWakeAlarm } from './nativeWakeAlarm';
import {
  formatSleepRemaining,
  getSleepTimerSnapshot,
  handleNativeWakeAlarmFired,
  handleSleepTimerTrackEnd,
  registerSleepTimerCallbacks,
  subscribeSleepTimer,
} from './sleepTimer';

const PLAYBACK_RESOLVE_STUCK_TIMEOUT_MS = 90_000;
const PLAYBACK_CONNECT_STUCK_TIMEOUT_MS = 30_000;
const MOBILE_EXECUTE_TRACK_TIMEOUT_MS = 300_000;

const EMPTY_CATALOG: CatalogSearchResult = {
  suggestions: [],
  artists: [],
  albums: [],
  tracks: [],
};

type StationId =
  | 'home'
  | 'discover'
  | 'library'
  | 'sonic-locker'
  | 'search'
  | 'locker'
  | 'podcasts'
  | 'audiobooks'
  | 'insights'
  | 'settings'
  | 'dj';

type MobileTabId = StationId | 'mobile-search' | 'mobile-menu';
type NavItemId = StationId | 'profile';

const NAV_PIN_META: Record<
  NavPinTabId,
  { labelKey: string; shortLabelKey?: string; icon: React.ElementType }
> = {
  home: { labelKey: 'nav.home', icon: Home },
  locker: { labelKey: 'nav.library', icon: HardDrive },
  discover: { labelKey: 'nav.discover', shortLabelKey: 'nav.discoverShort', icon: Compass },
  search: { labelKey: 'nav.search', icon: Search },
  podcasts: { labelKey: 'nav.podcasts', shortLabelKey: 'nav.podcastsShort', icon: Podcast },
  audiobooks: { labelKey: 'nav.audiobooks', shortLabelKey: 'nav.audiobooksShort', icon: BookOpen },
  settings: { labelKey: 'nav.settings', shortLabelKey: 'nav.settingsShort', icon: Settings },
};


const BASE_NAV: Array<{ id: StationId; labelKey: string; icon: React.ElementType }> = [
  { id: 'home', labelKey: 'nav.home', icon: Home },
  { id: 'locker', labelKey: 'nav.locker', icon: HardDrive },
  { id: 'discover', labelKey: 'nav.discover', icon: Compass },
  { id: 'sonic-locker', labelKey: 'nav.sonicLocker', icon: Radio },
];

function readProAudio(): boolean {
  return prefsGetItem('isProAudioEnabled') === 'true';
}

function readLibraryStationEnabled(): boolean {
  return loadLibraryStationEnabled();
}

function readPodcastsEnabled(): boolean {
  return loadPodcastsEnabled();
}

function readAudiobooksEnabled(): boolean {
  return loadAudiobooksEnabled();
}

function readDiscoverStationEnabled(): boolean {
  return loadDiscoverStationEnabled();
}

function readSonicLockerStationEnabled(): boolean {
  return loadSonicLockerStationEnabled();
}

function SystemLogin({
  profiles,
  onEnter,
  onSelect,
}: {
  profiles: ReturnType<typeof useProfile>['profiles'];
  onEnter: (name: string) => void;
  onSelect: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const { t } = useTranslation();

  return (
    <div className="h-screen overflow-hidden flex flex-col items-center justify-center px-6 bg-[var(--bg-void)] text-[var(--text)]">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <p className="font-display text-2xl font-black uppercase tracking-[0.2em] text-accent">
            {t('login.appName')}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-mid)]">
            {t('login.title')}
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onEnter(name.trim());
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('login.placeholder')}
            className="w-full h-12 px-4 rounded-lg font-mono text-sm border border-[var(--border)] bg-[var(--bg-surface)] focus-accent"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full h-12 rounded-lg font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 btn-accent touch-manipulation"
          >
            {t('login.enterStation')}
          </button>
        </form>
        {profiles.length > 0 && (
          <ul className="space-y-1.5 max-h-48 overflow-y-auto music-scrollbar">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] font-mono text-xs uppercase touch-manipulation"
                >
                  <User className="w-4 h-4 shrink-0 text-accent" />
                  <span className="truncate text-[var(--text-mid)]">{p.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default function SandboxShell() {
  const { t, lang } = useTranslation();
  const profile = useProfile();
  const audio = useAudioFSM();

  const [station, setStation] = useState<StationId>('home');
  const [lockerSection, setLockerSection] = useState<LockerSectionId>('artists');
  const [lockerHomeResetKey, setLockerHomeResetKey] = useState(0);
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
  const lockerDrillBackRef = useRef<(() => boolean) | null>(null);
  const podcastsDrillBackRef = useRef<(() => boolean) | null>(null);
  const audiobooksDrillBackRef = useRef<(() => boolean) | null>(null);
  const audiobooksReturnStationRef = useRef<StationId>('home');
  const prevStationForAudiobooksRef = useRef<StationId>(station);
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

  // After onboarding, skip System Login on native phone/tablet — default Operator profile.
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
  const mobileNowPlayingOpenRef = useRef(mobileNowPlayingOpen);
  mobileNowPlayingOpenRef.current = mobileNowPlayingOpen;
  const [podcastChaptersOpen, setPodcastChaptersOpen] = useState(false);
  const podcastChaptersOpenRef = useRef(podcastChaptersOpen);
  podcastChaptersOpenRef.current = podcastChaptersOpen;
  const [mobilePlayerPending, setMobilePlayerPending] = useState(false);

  const [androidNativePlaybackLive, setAndroidNativePlaybackLive] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileDownloadSheetOpen, setMobileDownloadSheetOpen] = useState(false);
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
    (playable: MediaEnvelope, opts?: { seedSearchQueue?: boolean; seamless?: boolean }) => void
  >(() => {});
  const [mixRadioSaveOpen, setMixRadioSaveOpen] = useState(false);
  const [mixRadioSaveBusy, setMixRadioSaveBusy] = useState(false);
  const [appToast, setAppToast] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        n.id === 'locker' && navPinTabs.includes('locker') ? t('nav.library') : t(n.labelKey),
      icon: n.icon,
    }));
    items.push({ id: 'search', label: t('nav.search'), icon: Search });
    if (podcastsEnabled) {
      items.push({ id: 'podcasts', label: t('nav.podcasts'), icon: Podcast });
    }
    if (audiobooksEnabled) {
      items.push({ id: 'audiobooks', label: t('nav.audiobooks'), icon: BookOpen });
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
    const feedBadge =
      discoverStationEnabled && discoverReleaseBadge > 0 ? discoverReleaseBadge : undefined;
    const items: MobileNavMoreItem[] = [
      {
        id: 'discover-feed',
        label: t('discover.tabs.feed'),
        subtitle: t('discover.home.lead'),
        icon: Radio,
        tone: 'accent',
        badge: feedBadge,
      },
      {
        id: 'discover-explore',
        label: t('nav.menuExplore'),
        subtitle: t('nav.menuExploreHint'),
        icon: Compass,
        tone: 'accent',
      },
      {
        id: 'discover-playlists',
        label: t('nav.menuPlaylists'),
        subtitle: t('nav.menuPlaylistsHint'),
        icon: ListMusic,
        tone: 'accent-bright',
      },
    ];
    if (sonicLockerEnabled) {
      items.push({
        id: 'sonic-locker',
        label: t('nav.sonicLocker'),
        subtitle: t('nav.browseSonicLockerHint'),
        icon: Radio,
        tone: 'accent',
      });
    }
    if (audiobooksEnabled) {
      items.push({
        id: 'audiobooks',
        label: t('nav.audiobooks'),
        subtitle: t('nav.browseAudiobooksHint'),
        icon: BookOpen,
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
    if (station === 'discover' && discoverTab === 'feed') return 'discover-feed';
    if (station === 'discover' && discoverTab === 'explore') return 'discover-explore';
    if (station === 'discover' && discoverTab === 'playlists') return 'discover-playlists';
    if (station === 'sonic-locker') return 'sonic-locker';
    if (station === 'audiobooks') return 'audiobooks';
    if (station === 'insights') return 'insights';
    if (station === 'settings') return 'settings';
    return undefined;
  }, [station, discoverTab]);

  const mobileTabActiveId = useMemo((): MobileTabId => {
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
    const downloadErrors = countDownloadSheetBadge(getDownloadJobs());
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

  useEffect(() => subscribeDownloadQueue(() => setDownloadQueueRevision((n) => n + 1)), []);

  const mobileDownloadBadge = countDownloadSheetBadge(getDownloadJobs());

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
    void import('./stations/ArtistDetailView');
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

  useEffect(() => subscribePlaylists(() => setTvPlaylists(loadPlaylists())), []);

  useEffect(() => {
    const sync = () => {
      setProAudio(readProAudio());
      setPodcastsEnabled(readPodcastsEnabled());
      setAudiobooksEnabled(readAudiobooksEnabled());
      setDiscoverStationEnabled(readDiscoverStationEnabled());
      setSonicLockerEnabled(readSonicLockerStationEnabled());
    };
    window.addEventListener('storage', sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  useEffect(() => {
    const prev = prevStationForAudiobooksRef.current;
    if (station === 'audiobooks' && prev !== 'audiobooks') {
      audiobooksReturnStationRef.current = prev;
    }
    prevStationForAudiobooksRef.current = station;
  }, [station]);

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
  }, [station, proAudio, podcastsEnabled, audiobooksEnabled, discoverStationEnabled, libraryStationEnabled, sonicLockerEnabled]);

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
          artworkUrl: resolveLockerEntryGroupArt(e, entries),
          releaseYear: e.releaseYear,
        })),
      );
    };
    syncLockerTracks();
    return subscribeLockerCache(syncLockerTracks);
  }, []);

  const runSearch = useCallback(
    async (
      q: string,
      options?: { preserveArtist?: boolean; albumHint?: CatalogAlbum; albumDrill?: boolean },
    ) => {
      const trimmed = q.trim();
      if (!trimmed) return 0;
      recordSearchQuery(trimmed);
      setSearchHistoryTick((n) => n + 1);
      setSearchInput(trimmed);
      setSearchQuery(trimmed);
      setSearchLoading(true);
      setSearchHits([]);
      setSearchResults([]);
      setSearchFromCache(false);
      setWebSupplementLoading(false);
      setWebSupplementError(null);
      webSupplementTracksRef.current = [];
      setPodcastSearchHits([]);
      setPodcastCatalogHits([]);
      if (podcastsEnabled && trimmed.length >= 2) {
        void searchPodcastsUnified(trimmed).then(({ localHits, catalogHits }) => {
          setPodcastSearchHits(localHits);
          setPodcastCatalogHits(catalogHits);
        });
      }
      if (!options?.preserveArtist) {
        setSelectedArtist(null);
        if (!options?.albumDrill) {
          setAlbumDrillQuery(null);
          setAlbumDrillAlbum(null);
          setAlbumDrillTracks([]);
        }
        albumHistoryPushedRef.current = false;
        searchSnapshotRef.current = null;
      }
      if (options?.albumDrill) {
        setAlbumDrillQuery(trimmed);
        setAlbumDrillAlbum(options.albumHint ?? null);
        setAppToast(null);
      }
      setSearchDropdownOpen(false);
      setSearchSection(isLikelyTrackTitleQuery(trimmed) ? 'tracks' : 'all');
      if (station !== 'search') {
        searchReturnStationRef.current = station;
      }
      if (!options?.preserveArtist && !searchHistoryPushedRef.current) {
        window.history.pushState({ sandboxSearch: true }, '');
        searchHistoryPushedRef.current = true;
      }
      setStation('search');
      finishMobileSearchNavigation();
      setNavOpen(false);
      const runGen = ++searchRunGenerationRef.current;
      const supplementQuery = needsWebTrackSupplement(trimmed);
      const loadingGuardMs = supplementQuery ? WEB_LEAK_SEARCH_MAX_WAIT_MS : 45_000;
      const loadingGuard = window.setTimeout(() => {
        if (searchRunGenerationRef.current !== runGen) return;
        setSearchLoading(false);
        setUnifiedSearchLoading(false);
        setWebSupplementLoading(false);
        if (supplementQuery) {
          setWebSupplementError((prev) => prev ?? t('searchResults.onlineSearchTimedOut'));
        }
      }, loadingGuardMs);
      setUnifiedSearchLoading(true);

      const applyWebTracks = (tracks: CatalogTrack[]) => {
        if (tracks.length === 0) return;
        webSupplementTracksRef.current = tracks;
        setWebSupplementError(null);
        setUnifiedSearchResult((prev) => {
          const next = applyWebSupplementToUnified(prev, tracks, trimmed);
          setSearchCatalog(next.catalog);
          return next;
        });
      };

      const finalizeUnifiedWithWeb = (unified: UnifiedSearchResult) => {
        const web = webSupplementTracksRef.current;
        if (web.length === 0) return unified;
        return applyWebSupplementToUnified(unified, web, trimmed);
      };

      if (supplementQuery) {
        setWebSupplementLoading(true);
        void fetchWebCatalogTracks(trimmed, {
          maxWaitMs: WEB_LEAK_SEARCH_MAX_WAIT_MS,
          onPartial: (tracks) => {
            if (searchRunGenerationRef.current !== runGen) return;
            applyWebTracks(tracks);
          },
        })
          .then((tracks) => {
            if (searchRunGenerationRef.current !== runGen) return;
            if (tracks.length > 0) {
              applyWebTracks(tracks);
              return;
            }
            const hasWeb = unifiedSearchResultRef.current.tracks.some((t) =>
              t.id.startsWith('youtube-'),
            );
            if (!hasWeb) setWebSupplementError(t('searchResults.onlineSearchTimedOut'));
          })
          .catch(() => {
            if (searchRunGenerationRef.current !== runGen) return;
            setWebSupplementError(t('searchResults.onlineSearchTimedOut'));
          })
          .finally(() => {
            if (searchRunGenerationRef.current === runGen) {
              setWebSupplementLoading(false);
            }
          });
      }

      void runUnifiedSearch(trimmed, {
        limit: 60,
        onArtistImagesUpdated: (unified) => {
          if (searchRunGenerationRef.current !== runGen) return;
          const merged = finalizeUnifiedWithWeb(unified);
          setUnifiedSearchResult(merged);
          setSearchCatalog(merged.catalog);
        },
      })
        .then((unified) => {
          if (searchRunGenerationRef.current !== runGen) return;
          const merged = finalizeUnifiedWithWeb(unified);
          setUnifiedSearchResult(merged);
          setSearchCatalog(merged.catalog);
        })
        .finally(() => {
          if (searchRunGenerationRef.current === runGen) {
            setUnifiedSearchLoading(false);
            window.clearTimeout(loadingGuard);
          }
        });

      void engineSearch(
        trimmed,
        (partial) => {
          if (searchRunGenerationRef.current !== runGen) return;
          setSearchHits(partial);
          setSearchResults(partial.map((h) => h.primaryEnvelope));
        },
        options?.albumHint,
        { catalogOnly: !needsWebTrackSupplement(trimmed) },
      )
        .then((result) => {
          if (searchRunGenerationRef.current !== runGen) return;
          setSearchHits(result.hits);
          setSearchResults(result.envelopes);
          setSearchFromCache(result.fromCache);
          const albumCtx = result.albumContext ?? options?.albumHint ?? null;
          const trackYear = result.albumTracks?.find((t) => t.releaseYear?.trim())?.releaseYear?.trim();
          const fetchedCount = result.albumTracks?.length ?? 0;
          const metaCount = Math.max(
            albumCtx?.trackCount ?? 0,
            options?.albumHint?.trackCount ?? 0,
          );
          const albumWithTracks =
            albumCtx && fetchedCount > 0
              ? {
                  ...albumCtx,
                  trackCount: Math.max(metaCount, fetchedCount) || fetchedCount,
                }
              : albumCtx;
          setAlbumDrillAlbum(
            albumWithTracks && trackYear && !albumWithTracks.releaseYear
              ? { ...albumWithTracks, releaseYear: trackYear }
              : albumWithTracks,
          );
          setAlbumDrillTracks(result.albumTracks ?? []);
        })
        .catch(() => {
          if (searchRunGenerationRef.current !== runGen) return;
          setSearchResults([]);
          setSearchHits([]);
          setAlbumDrillAlbum(null);
          setAlbumDrillTracks([]);
        })
        .finally(() => {
          if (searchRunGenerationRef.current === runGen) {
            setSearchLoading(false);
            window.clearTimeout(loadingGuard);
          }
        });
      return;
    },
    [station, podcastsEnabled, finishMobileSearchNavigation, t],
  );

  useEffect(() => {
    registerE2eHandlers({
      runSearch: (q) => runSearch(q),
      navigateTab: (tab) => {
        if (tab === 'search') {
          handleMobileTabNavigate('mobile-search');
        } else {
          handleMobileTabNavigate(tab);
        }
      },
      completeOnboarding: () => setOnboardingComplete(true),
      getSearchHitCount: () => {
        const hits = searchHitsRef.current.length;
        const unifiedTracks = unifiedSearchResultRef.current.tracks?.length ?? 0;
        const webBuffered = webSupplementTracksRef.current.length;
        return Math.max(hits, unifiedTracks, webBuffered);
      },
      playMobileQuery: async (query) => {
        const env: MediaEnvelope = {
          envelopeId: `e2e-mobile-${Date.now()}`,
          title: query,
          artist: '',
          url: '',
          durationSeconds: 0,
          provider: 'https',
          transport: 'element-src',
          sourceId: `e2e-mobile-${Date.now()}`,
        };
        setStation('home');
        setHomeAwaitingUserResume(false);
        if (isAndroid() && hasActiveMobileResolvers()) {
          ensureYtDlpMobileReady();
          await waitForYtDlpInit();
        }
        await playEnvelopeRef.current(env, undefined, { autoPlay: true });
        const nudgePlayback = async () => {
          audio.primePlaybackGesture();
          await audio.play();
        };
        return waitForPlaybackStarted({
          expectedTitle: query,
          getProbeTitle: () => audioEnvelopeRef.current?.title,
          getProbePosition: () => audioCurrentTimeRef.current,
          getProbeDuration: () => audioDurationRef.current,
          getProbeState: () => audioStateRef.current,
          timeoutMs: 300_000,
          onStuck: nudgePlayback,
        });
      },
      playSearchQuery: async (query, hitIndex = 0) => {
        setHomeAwaitingUserResume(false);
        if (station !== 'search') {
          searchReturnStationRef.current = station;
        }
        setStation('search');
        setNavOpen(false);
        await runSearch(query);
        const searchDeadline = Date.now() + 90_000;
        while (Date.now() < searchDeadline) {
          const loading = searchLoadingRef.current || unifiedSearchLoadingRef.current;
          if (!loading) {
            const hit = searchHitsRef.current[hitIndex];
            const catalogTrack = unifiedSearchResultRef.current.tracks[hitIndex];
            if (hit?.primaryEnvelope || catalogTrack?.envelope) break;
          }
          await new Promise((r) => window.setTimeout(r, 250));
        }
        const hit = searchHitsRef.current[hitIndex];
        const catalogTrack = unifiedSearchResultRef.current.tracks[hitIndex];
        const envelope = hit?.primaryEnvelope ?? catalogTrack?.envelope;
        const candidates = hit?.sources;
        if (!envelope) {
          console.warn('[playSearchQuery] no envelope', { query, hitIndex, hits: searchHitsRef.current.length });
          return false;
        }
        if (isAndroid() && hasActiveMobileResolvers()) {
          ensureYtDlpMobileReady();
          await waitForYtDlpInit();
        }
        await playEnvelopeRef.current(envelope, candidates, {
          autoPlay: true,
          seedSearchQueue: true,
        });
        const nudgePlayback = async () => {
          audio.primePlaybackGesture();
          await audio.play();
        };
        return waitForPlaybackStarted({
          expectedTitle: envelope.title,
          getProbeTitle: () => audioEnvelopeRef.current?.title,
          getProbePosition: () => audioCurrentTimeRef.current,
          getProbeDuration: () => audioDurationRef.current,
          getProbeState: () => audioStateRef.current,
          timeoutMs: 300_000,
          onStuck: nudgePlayback,
        });
      },
      playOfflinePodcast: async (index = 0, titleQuery) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const rows = loadOfflinePodcastEpisodes();
        if (!rows.length) return false;
        let row = rows[Math.max(0, Math.min(rows.length - 1, index))];
        if (titleQuery?.trim()) {
          const q = titleQuery.trim().toLowerCase();
          row =
            rows.find(
              (r) =>
                r.episode.title.toLowerCase().includes(q) ||
                r.feedTitle.toLowerCase().includes(q),
            ) ?? row;
        }
        const base = episodeEnvelope(row.episode, row.feedTitle, row.feedArtworkUrl);
        if (!isEnvelopeStreamCached(base)) return false;
        await playEnvelopeRef.current(base, undefined, { autoPlay: true });
        return true;
      },
      cachePodcastQueryOffline: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const { catalogShows, catalogHits, localHits } = await searchPodcastsUnified(query, {
          catalogLimit: 8,
        });
        let envelope = localHits[0]?.envelope ?? catalogHits[0]?.envelope;
        if (!envelope?.url?.trim()) {
          const show = catalogShows.find((s) =>
            s.title.toLowerCase().includes(query.toLowerCase().split(' ')[0] ?? ''),
          ) ?? catalogShows[0];
          if (!show) return false;
          const { subscription, episodes } = await subscribeFromCatalogShow(show);
          const ep = episodes[0];
          if (!ep?.audioUrl?.trim()) return false;
          envelope = episodeEnvelope(ep, subscription.title, subscription.artworkUrl);
        }
        await playEnvelopeRef.current(envelope, undefined, { autoPlay: true });
        const deadline = Date.now() + 180_000;
        while (Date.now() < deadline) {
          const state = audioStateRef.current;
          if (state === 'Playing' || (state === 'Ready' && Boolean(audioEnvelopeRef.current?.url?.trim()))) break;
          if (state === 'Failed') return false;
          await new Promise((r) => window.setTimeout(r, 300));
        }
        const playingEnv = audioEnvelopeRef.current;
        if (!playingEnv?.url?.trim()) return false;
        await cacheEnvelopeForOffline(playingEnv);
        return Boolean(await getStreamCacheEnvelope(playingEnv));
      },
      playPodcastQuery: async (query) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const q = query.trim();
        const qLower = q.toLowerCase();
        const episodeNum = q.match(/#?(\d{3,5})\b/)?.[1];
        const guestTokens = qLower
          .split(/\s+/)
          .filter((t) => t.length > 2 && !/^\d{3,5}$/.test(t));
        const { catalogShows, catalogHits, localHits } = await searchPodcastsUnified(q, {
          catalogLimit: 12,
        });
        const pickCatalogHit = () => {
          if (!catalogHits.length) return undefined;
          if (episodeNum) {
            return (
              catalogHits.find((h) => (h.episode?.title ?? h.envelope?.title ?? '').includes(episodeNum)) ??
              catalogHits.find((h) => (h.envelope?.artist ?? '').includes(episodeNum))
            );
          }
          const tokens = qLower.split(/\s+/).filter((t) => t.length > 2);
          if (!tokens.length) return catalogHits[0];
          return catalogHits.find((h) => {
            const blob = `${h.envelope?.artist ?? ''} ${h.episode?.title ?? h.envelope?.title ?? ''}`.toLowerCase();
            return tokens.every((t) => blob.includes(t));
          });
        };
        const catalogHit = pickCatalogHit() ?? catalogHits[0];
        const localHit = localHits[0];
        const localTitle = localHit?.envelope?.title ?? '';
        const useLocal =
          Boolean(localHit?.envelope?.url?.trim()) &&
          (!episodeNum || localTitle.includes(episodeNum)) &&
          guestTokens.length < 2;
        if (useLocal) {
          return await playEnvelopeRef.current(localHit!.envelope, undefined, { autoPlay: true });
        }
        if (catalogHit?.envelope?.url?.trim()) {
          return await playEnvelopeRef.current(catalogHit.envelope, undefined, { autoPlay: true });
        }
        const show = catalogShows.find((s) =>
          s.title.toLowerCase().includes(qLower.split(' ')[0] ?? ''),
        ) ?? catalogShows[0];
        if (!show) return false;
        const { subscription, episodes } = await subscribeFromCatalogShow(show);
        const ep = episodeNum
          ? episodes.find((e) => e.title.includes(episodeNum)) ?? episodes[0]
          : episodes[0];
        if (!ep?.audioUrl?.trim()) return false;
        return await playEnvelopeRef.current(
          episodeEnvelope(ep, subscription.title, subscription.artworkUrl),
          undefined,
          { autoPlay: true },
        );
      },
      playPodcastEpisode: async (feedQuery, episodeQuery, options) => {
        setPodcastsEnabled(true);
        savePodcastsEnabled(true);
        setStation('podcasts');
        setNavOpen(false);
        const onlineOnly = options?.online !== false;
        if (onlineOnly) {
          const resolved = await resolveOnlineCatalogEpisode(feedQuery, episodeQuery);
          if (!resolved?.episode?.audioUrl?.trim()) return false;
          const env = episodeEnvelope(
            resolved.episode,
            resolved.feedTitle,
            resolved.feedArtworkUrl,
          );
          if (env.provider === 'stream-cache') return false;
          return await playEnvelopeRef.current(env, undefined, { autoPlay: true });
        }
        return false;
      },
    });
  }, [runSearch, handleMobileTabNavigate, station]);

  const runExploreSearch = useCallback(
    async (label: string, group: ExploreGroup = 'quick') => {
      const displayQuery = exploreDisplayQuery(group, label);
      setSearchInput(displayQuery);
      setSearchQuery(displayQuery);
      setSearchLoading(true);
      setSearchHits([]);
      setSearchResults([]);
      setSearchFromCache(false);
      setPodcastSearchHits([]);
      setSelectedArtist(null);
      setAlbumDrillAlbum(null);
      setAlbumDrillTracks([]);
      setSearchDropdownOpen(false);
      if (station !== 'search') {
        searchReturnStationRef.current = station;
      }
      if (!searchHistoryPushedRef.current) {
        window.history.pushState({ sandboxSearch: true }, '');
        searchHistoryPushedRef.current = true;
      }
      setStation('search');
      finishMobileSearchNavigation();
      setNavOpen(false);
      try {
        const result = await engineExploreSearch(group, label);
        setSearchHits(result.hits);
        setSearchResults(result.envelopes);
        setSearchFromCache(result.fromCache);
      } catch {
        setSearchResults([]);
        setSearchHits([]);
      } finally {
        setSearchLoading(false);
      }
    },
    [station, finishMobileSearchNavigation],
  );

  const handleBrowsePick = useCallback(
    (label: string, group: ExploreGroup) => {
      setSearchDropdownOpen(false);
      searchInputRef.current?.blur();
      void runExploreSearch(label, group);
    },
    [runExploreSearch],
  );

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

  useEffect(() => {
    setSearchActiveIndex(-1);
  }, [searchInput]);

  useEffect(() => {
    const q = searchInput.trim();
    if (!searchDropdownOpen) {
      setCatalogLoading(false);
      return;
    }

    if (q.length < 1) {
      setSearchCatalog(EMPTY_CATALOG);
      setUnifiedSearchResult(EMPTY_UNIFIED);
      setCatalogLoading(false);
      return;
    }

    const instantFrame = window.requestAnimationFrame(() => {
      const instant = instantLocalLockerSearch(q, 16);
      setSearchCatalog(instant);
      setUnifiedSearchResult((prev) => ({
        ...prev,
        catalog: instant,
        tracks: instant.tracks,
        albums: instant.albums,
        artists: instant.artists,
      }));
    });

    if (q.length < 2) {
      setCatalogLoading(false);
      return () => window.cancelAnimationFrame(instantFrame);
    }

    const requestId = ++catalogRequestRef.current;
    setCatalogLoading(true);

    const timer = window.setTimeout(() => {
      void runUnifiedSearch(q, {
        limit: 24,
        onArtistImagesUpdated: (unified) => {
          if (catalogRequestRef.current !== requestId) return;
          setUnifiedSearchResult(unified);
          setSearchCatalog(unified.catalog);
        },
      })
        .then((unified) => {
          if (catalogRequestRef.current !== requestId) return;
          setUnifiedSearchResult(unified);
          setSearchCatalog(unified.catalog);
        })
        .finally(() => {
          if (catalogRequestRef.current === requestId) setCatalogLoading(false);
        });
    }, 280);

    return () => {
      window.cancelAnimationFrame(instantFrame);
      window.clearTimeout(timer);
    };
  }, [searchInput, searchDropdownOpen]);

  useEffect(() => {
    if (!searchDropdownOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (searchFormRef.current?.contains(target)) return;
      if (searchDropdownRef.current?.contains(target)) return;
      setSearchDropdownOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [searchDropdownOpen]);

  const restoreSearchSnapshot = useCallback(() => {
    const snapshot = searchSnapshotRef.current;
    if (!snapshot) return;
    setSearchInput(snapshot.input);
    setSearchQuery(snapshot.query);
    setSearchHits(snapshot.hits);
    setSearchResults(snapshot.results);
    setSearchFromCache(snapshot.fromCache);
    setSearchLoading(false);
    requestShellScrollRestore(SEARCH_RESULTS_SCROLL_KEY);
  }, []);

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

  const clearSearchView = useCallback((returnStation?: StationId) => {
    setSearchQuery('');
    setSearchHits([]);
    setSearchResults([]);
    setSearchInput('');
    setSearchLoading(false);
    setAlbumDrillQuery(null);
    setAlbumDrillAlbum(null);
    setAlbumDrillTracks([]);
    albumHistoryPushedRef.current = false;
    searchSnapshotRef.current = null;
    setStation(returnStation ?? searchReturnStationRef.current ?? 'home');
  }, []);

  useEffect(() => {
    const onPopState = () => {
      const state = window.history.state as Record<string, unknown> | null;

      if (albumDrillQuery) {
        if (state?.sandboxAlbum) {
          return;
        }
        albumHistoryPushedRef.current = false;
        setAlbumDrillQuery(null);
        setAlbumDrillAlbum(null);
        setAlbumDrillTracks([]);
        setSearchQuery('');
        setSearchHits([]);
        setSearchResults([]);
        setSearchInput('');
        setSearchLoading(false);
        requestShellScrollRestore(searchScrollParentRef.current);
        return;
      }
      if (selectedArtist) {
        if (state?.sandboxArtist) {
          return;
        }
        artistHistoryPushedRef.current = false;
        setSelectedArtist(null);
        if (searchSnapshotRef.current) {
          restoreSearchSnapshot();
        } else {
          clearSearchView(searchReturnStationRef.current);
        }
        return;
      }
      if (searchHistoryPushedRef.current || searchQuery) {
        if (state?.sandboxSearch) {
          return;
        }
        searchHistoryPushedRef.current = false;
        clearSearchView();
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [albumDrillQuery, selectedArtist, searchQuery, clearSearchView, restoreSearchSnapshot]);

  const handleAlbumBack = useCallback(() => {
    if (albumHistoryPushedRef.current) {
      albumHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setAlbumDrillQuery(null);
    setAlbumDrillAlbum(null);
    setAlbumDrillTracks([]);
    setSearchQuery('');
    setSearchHits([]);
    setSearchResults([]);
    setSearchInput('');
    setSearchLoading(false);
    requestShellScrollRestore(searchScrollParentRef.current);
  }, []);

  const handleSearchBack = useCallback(() => {
    const returnTo = searchReturnStationRef.current || 'home';
    if (searchHistoryPushedRef.current) {
      searchHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    clearSearchView(returnTo);
  }, [clearSearchView]);

  const handleArtistBack = useCallback(() => {
    if (artistHistoryPushedRef.current) {
      artistHistoryPushedRef.current = false;
      window.history.back();
      return;
    }
    setSelectedArtist(null);
    if (searchSnapshotRef.current) {
      restoreSearchSnapshot();
    } else {
      requestShellScrollRestore(SEARCH_RESULTS_SCROLL_KEY);
      clearSearchView(searchReturnStationRef.current);
    }
  }, [restoreSearchSnapshot, clearSearchView]);

  const handleShellBack = useCallback((): boolean => {
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
      return false;
    }
    if (station === 'locker') {
      if (lockerDrillBackRef.current?.()) {
        return true;
      }
      return false;
    }
    if (station === 'podcasts') {
      if (podcastsDrillBackRef.current?.()) {
        return true;
      }
      return false;
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
    return false;
  }, [
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

  const handleSelectArtist = useCallback((
    artist: CatalogArtist,
    options?: { returnStation?: StationId; skipStationTransition?: boolean },
  ) => {
    const name = artist?.name?.trim();
    const id = artist?.id?.trim();
    if (!name || !id) {
      console.warn('[search] handleSelectArtist skipped — missing artist name or id', artist);
      return;
    }
    const t0 = performance.now();
    logE2e('artist-select', true, `artist=${name} ts=${Date.now()}`);
    recordSearchArtist(artist);
    setSearchHistoryTick((n) => n + 1);
    searchRunGenerationRef.current += 1;
    catalogRequestRef.current += 1;
    setSearchDropdownOpen(false);
    if (!options?.skipStationTransition) {
      finishMobileSearchNavigation();
    }
    setSelectedArtist({
      ...artist,
      name: catalogDisplayArtistName(artist.name),
    });
    if (!options?.skipStationTransition) {
      setStation('search');
    }
    setCatalogLoading(false);
    setSearchCatalog(EMPTY_CATALOG);
    setUnifiedSearchResult(EMPTY_UNIFIED);
    setSearchLoading(false);
    setUnifiedSearchLoading(false);
    setWebSupplementLoading(false);
    setWebSupplementError(null);
    webSupplementTracksRef.current = [];
    if (options?.returnStation) {
      searchReturnStationRef.current = options.returnStation;
      searchSnapshotRef.current = null;
    } else if (searchQuery && searchHits.length > 0) {
      saveShellScroll(SEARCH_RESULTS_SCROLL_KEY);
      searchSnapshotRef.current = {
        query: searchQuery,
        hits: searchHits,
        results: searchResults,
        fromCache: searchFromCache,
        input: searchInput,
      };
    }
    setAlbumDrillQuery(null);
    setAlbumDrillAlbum(null);
    setAlbumDrillTracks([]);
    albumHistoryPushedRef.current = false;
    setNavOpen(false);
    window.history.pushState({ sandboxArtist: artist.id }, '');
    artistHistoryPushedRef.current = true;
    logE2e(
      'search-nav',
      true,
      `artist=${artist.name} id=${artist.id} ms=${Math.round(performance.now() - t0)}`,
    );
  }, [searchQuery, searchHits, searchResults, searchFromCache, searchInput, finishMobileSearchNavigation]);

  const handleOpenArtistByName = useCallback(
    async (artistName: string) => {
      const trimmed = artistName?.trim();
      if (!trimmed || /^local upload$/i.test(trimmed)) return;
      setQueueDrawerOpen(false);
      setTvQueueOpen(false);
      setMobileNowPlayingOpen(false);
      try {
        const artist = await resolveCatalogArtistByName(trimmed);
        if (!artist?.name?.trim() || !artist?.id?.trim()) {
          handleSelectArtist(buildCatalogArtistStub(trimmed), { returnStation: station });
          return;
        }
        handleSelectArtist(artist, { returnStation: station });
      } catch (err) {
        console.warn('[search] handleOpenArtistByName failed', trimmed, err);
        handleSelectArtist(buildCatalogArtistStub(trimmed), { returnStation: station });
      }
    },
    [station, handleSelectArtist],
  );

  const handleOpenAlbumByName = useCallback(
    (artistName: string, albumTitle: string) => {
      const artist = artistName.trim();
      const album = albumTitle.trim();
      if (!artist || !album || /^local upload$/i.test(artist)) return;
      setQueueDrawerOpen(false);
      setTvQueueOpen(false);
      setMobileNowPlayingOpen(false);
      setSearchDropdownOpen(false);
      setSelectedArtist(null);
      const hint: CatalogAlbum = {
        kind: 'album',
        id: `album-${artist}-${album}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: album,
        artist,
        artworkUrl: audio.envelope?.artworkUrl,
      };
      setStation('search');
      setNavOpen(false);
      void runSearch(`${artist} ${album}`, { albumHint: hint, albumDrill: true });
    },
    [audio.envelope?.artworkUrl, runSearch],
  );

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

  const handleSelectAlbum = useCallback(
    (album: CatalogAlbum) => {
      recordSearchAlbum(album);
      setSearchHistoryTick((n) => n + 1);
      setSearchDropdownOpen(false);
      setAppToast(null);
      if (selectedArtist) {
        const parentKey = searchArtistScrollKey(selectedArtist.id);
        saveShellScroll(parentKey);
        searchScrollParentRef.current = parentKey;
        if (!albumHistoryPushedRef.current) {
          window.history.pushState({ sandboxAlbum: album.id }, '');
          albumHistoryPushedRef.current = true;
        }
        void runSearch(`${album.artist} ${album.title}`, {
          preserveArtist: true,
          albumDrill: true,
          albumHint: album,
        });
        return;
      }
      if (searchQuery) {
        saveShellScroll(SEARCH_RESULTS_SCROLL_KEY);
        searchScrollParentRef.current = SEARCH_RESULTS_SCROLL_KEY;
      }
      void runSearch(`${album.artist} ${album.title}`, {
        albumHint: album,
        albumDrill: true,
      });
    },
    [runSearch, selectedArtist, searchQuery],
  );

  const handleDownloadTierChange = useCallback((tier: DownloadTierPreference) => {
    setDownloadTierPreference(tier);
    saveDownloadTierPreference(tier);
  }, []);

  const handleDownloadAlbum = useCallback(
    async (album: CatalogAlbum, mode: DownloadMode) => {
      const existing = findAlbumDownloadJob(album.artist, album.title, album.id);
      if (
        existing &&
        existing.status !== 'done' &&
        existing.status !== 'error'
      ) {
        showAppToast('Album already queued or downloading');
        return;
      }

      const drillAlbum = albumDrillAlbumRef.current;
      const drillTracks = albumDrillTracksRef.current;
      const sameDrillAlbum =
        drillAlbum &&
        (drillAlbum.id === album.id ||
          (drillAlbum.title.trim().toLowerCase() === album.title.trim().toLowerCase() &&
            drillAlbum.artist.trim().toLowerCase().includes(album.artist.trim().toLowerCase().split(',')[0] ?? '')));
      const albumWithCount: CatalogAlbum = {
        ...album,
        trackCount: Math.max(
          album.trackCount ?? 0,
          sameDrillAlbum ? (drillAlbum.trackCount ?? drillTracks.length) : 0,
        ),
      };
      let listing = await fetchAlbumTracks(albumWithCount);
      if (sameDrillAlbum && drillTracks.length > listing.length) {
        listing = drillTracks;
      }

      const albumName = mode === 'album' ? album.title : undefined;
      const coverage = await resolveCatalogLockerCoverage(albumWithCount, {
        listing,
        albumName,
      });

      if (coverage.listing.length > 0 && coverage.fullyInLocker) {
        showAppToast(`"${album.title}" is already in your Locker`);
        return;
      }

      if (coverage.needing.length > 0 && coverage.needing.length < coverage.listing.length) {
        showAppToast(
          `Downloading ${coverage.needing.length} missing track${coverage.needing.length === 1 ? '' : 's'}…`,
        );
      }

      const job = enqueueDownloadJob({
        label: album.title,
        artist: album.artist,
        albumTitle: album.title,
        albumId: album.id,
        mode,
        tier: downloadTierPreference,
        totalTracks:
          coverage.needing.length > 0 ? coverage.needing.length : coverage.listing.length,
      });
      if (coverage.needing.length > 0) {
        initJobTracks(
          job.id,
          coverage.needing.map((t) => ({ id: t.id, title: t.title })),
        );
      }
      scheduleCatalogAlbumDownload(albumWithCount, mode, downloadTierPreference, job.id);
    },
    [downloadTierPreference, showAppToast],
  );

  const handleDownloadTrack = useCallback(
    (track: CatalogTrack, mode: DownloadMode) => {
      const job = enqueueDownloadJob({
        label: track.title,
        artist: track.artist,
        albumTitle: mode === 'album' ? track.album : undefined,
        mode,
        tier: downloadTierPreference,
        totalTracks: 1,
      });
      if (mode === 'album' && track.album) {
        const pseudoAlbum: CatalogAlbum = {
          kind: 'album',
          id: track.id,
          title: track.album,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
          releaseYear: track.releaseYear,
        };
        scheduleCatalogTrackDownload(track, downloadTierPreference, job.id, {
          album: pseudoAlbum,
          mode: 'album',
        });
        return;
      }
      scheduleCatalogTrackDownload(track, downloadTierPreference, job.id);
    },
    [downloadTierPreference],
  );

  const handleDownloadSearchHit = useCallback(
    (hit: ResolvedSearchHit, mode: DownloadMode) => {
      void mode;
      const catalogTrack = albumDrillTracksRef.current.find((t) =>
        trackTitleKeysMatch(t.title, hit.title),
      );
      const jobArtist =
        albumDrillAlbum?.artist ?? hit.primaryEnvelope.artist ?? hit.artist;
      if (albumDrillAlbum) {
        const activeAlbumJob = findAlbumDownloadJob(
          albumDrillAlbum.artist,
          albumDrillAlbum.title,
          albumDrillAlbum.id,
        );
        if (
          activeAlbumJob &&
          activeAlbumJob.status !== 'done' &&
          activeAlbumJob.status !== 'error'
        ) {
          showAppToast('Album download already in progress');
          return;
        }
      }
      const duplicateTrackJob = getActiveDownloadJobs().find(
        (j) =>
          j.mode === 'tracks' &&
          j.totalTracks <= 1 &&
          trackTitleKeysMatch(j.label, hit.title) &&
          j.artist.toLowerCase().includes(jobArtist.toLowerCase().split(',')[0] ?? ''),
      );
      if (duplicateTrackJob) {
        showAppToast('Track download already in progress');
        return;
      }
      const job = enqueueDownloadJob({
        label: catalogTrack?.title ?? hit.title,
        artist: jobArtist,
        albumTitle: albumDrillAlbum?.title ?? catalogTrack?.album ?? hit.primaryEnvelope.album,
        mode: 'tracks',
        tier: downloadTierPreference,
        totalTracks: 1,
      });
      notifyAcquireProgress(job);
      if (showMobileShell) {
        showAppToast('Downloading in background — tap ↓ for progress');
      }
      if (catalogTrack) {
        scheduleCatalogTrackDownload(catalogTrack, downloadTierPreference, job.id);
      } else {
        scheduleSearchHitDownload(
          hit.primaryEnvelope,
          downloadTierPreference,
          job.id,
          hit.sources,
        );
      }
    },
    [downloadTierPreference, albumDrillAlbum, showMobileShell, showAppToast],
  );

  const handleDownloadImportedPlaylist = useCallback(
    (pl: StoredPlaylist) => {
      const remaining = unmatchedImportStubs(pl);
      if (remaining.length === 0) {
        showAppToast('All tracks already in Locker');
        return;
      }
      const job = enqueueDownloadJob({
        label: pl.name,
        artist: pl.importCreator ?? '',
        mode: 'tracks',
        tier: downloadTierPreference,
        totalTracks: remaining.length,
        playlistId: pl.id,
      });
      showAppToast(`Downloading ${remaining.length} tracks in background…`);
      notifyAcquireProgress(job);
      void (async () => {
        try {
          const result = await acquireImportedPlaylist(
            pl,
            downloadTierPreference,
            job.id,
            (resolved, total) => {
              patchDownloadJob(job.id, {
                completedTracks: resolved,
                progress: Math.min(30, Math.round((resolved / Math.max(total, 1)) * 30)),
                currentTrack: resolved < total ? 'Resolving catalog…' : undefined,
              });
            },
          );
          const lockerPool: MediaEnvelope[] = [];
          for (const entry of getLockerEntriesSnapshot() ?? []) {
            if (await lockerEntryIsPlayable(entry.id)) {
              lockerPool.push(lockerEntryToEnvelope(entry));
            }
          }
          const rematch = rematchAllPlaylistStubsFromLocker(loadPlaylists(), lockerPool);
          if (rematch.totalMatched > 0) savePlaylists(rematch.playlists);
          const { acquisition, unresolved, tracks } = result;
          if (tracks.length === 0) {
            patchDownloadJob(job.id, {
              status: 'error',
              error: 'No tracks to download',
            });
            showAppToast('No tracks to download', 'error');
            return;
          }
          const parts = [
            `${acquisition.saved} saved`,
            acquisition.skipped > 0 ? `${acquisition.skipped} skipped` : '',
            acquisition.failed > 0 ? `${acquisition.failed} failed` : '',
            unresolved.length > 0 ? `${unresolved.length} not found` : '',
            rematch.totalMatched > 0 ? `${rematch.totalMatched} linked to playlist` : '',
          ].filter(Boolean);
          showAppToast(parts.join(' · '));
        } catch (err) {
          patchDownloadJob(job.id, { status: 'error', error: String(err) });
          showAppToast(err instanceof Error ? err.message : String(err), 'error');
        }
      })();
    },
    [downloadTierPreference, showAppToast],
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

  const navigateSearchQuery = useCallback(
    (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;
      logE2e('search-nav', true, `query=${trimmed}`);
      setSearchInput(trimmed);
      transitionToSearchStation();

      if (isNewMusicQuery(trimmed)) {
        void runExploreSearch(newMusicSearchLabel(), 'quick');
        return;
      }

      if (isLikelyArtistNameQuery(trimmed)) {
        void resolveCatalogArtistByName(trimmed).then((artist) => {
          handleSelectArtist(artist, { skipStationTransition: true });
        });
        return;
      }

      const cachedArtist = findCatalogArtistByName(
        trimmed,
        searchCatalog.artists,
        unifiedSearchResult.artists,
      );
      if (cachedArtist) {
        handleSelectArtist(cachedArtist, { skipStationTransition: true });
        return;
      }

      const lockerArtist = findCatalogArtistByName(
        trimmed,
        instantLocalLockerSearch(trimmed, 8).artists,
      );
      if (lockerArtist) {
        handleSelectArtist(lockerArtist, { skipStationTransition: true });
        return;
      }

      void runSearch(trimmed);
    },
    [
      transitionToSearchStation,
      handleSelectArtist,
      runExploreSearch,
      runSearch,
      searchCatalog.artists,
      unifiedSearchResult.artists,
    ],
  );

  const handleSelectSuggestion = useCallback(
    (suggestion: string) => navigateSearchQuery(suggestion),
    [navigateSearchQuery],
  );

  const healAttemptRef = useRef<string | null>(null);
  const connectClientRef = useRef<ConnectClient | null>(null);
  const isConnectRemoteRef = useRef(false);
  const [connectRolePref, setConnectRolePref] = useState(loadConnectRolePref);
  const [networkSyncEnabled, setNetworkSyncEnabled] = useState(loadNetworkSyncEnabled);
  const [remoteMirror, setRemoteMirror] = useState<SyncStatePayload | null>(null);
  const effectiveConnectRole = networkSyncEnabled
    ? resolveConnectRole(connectRolePref)
    : null;
  isConnectRemoteRef.current = effectiveConnectRole === 'remote';
  useEffect(() => {
    const sync = () => {
      setConnectRolePref(loadConnectRolePref());
      setNetworkSyncEnabled(loadNetworkSyncEnabled());
    };
    window.addEventListener('storage', sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  const sendConnectCommand = useCallback((command: ConnectCommand) => {
    connectClientRef.current?.sendCommand(command);
  }, []);

  const playGenerationRef = useRef(0);
  playGenerationRef.current = currentPlayGeneration();
  const applyPlaybackDisplaySeed = useCallback((env: MediaEnvelope, artwork?: string) => {
    const seed = seedPlaybackDisplayFromEnvelope(env, artwork);
    setPlaybackDisplaySeed(seed);
    setArtworkUrl(seed.artworkUrl);
    return seed;
  }, []);
  const syncPlaybackArtwork = useCallback((envelopeId: string, art: string) => {
    const trimmed = art?.trim();
    if (!trimmed || !envelopeId?.trim()) return;
    setPlaybackDisplaySeed((prev) =>
      prev?.envelopeId === envelopeId ? { ...prev, artworkUrl: trimmed } : prev,
    );
    setArtworkUrl(trimmed);
  }, []);
  /** In-place queue seek — sync display seed atomically so player UI never flashes album view. */
  const adoptInPlaceQueueTrack = useCallback(
    (track: MediaEnvelope, seekSeconds: number) => {
      const lockerArt = resolveLockerEntryAlbumArt(track);
      const displayArt = resolvePlaybackCoverArt(track.artworkUrl, track, lockerArt);
      const resolvedArt = displayArt?.trim() || '';
      const enriched =
        resolvedArt && resolvedArt !== track.artworkUrl?.trim()
          ? { ...track, artworkUrl: resolvedArt }
          : track;
      applyPlaybackDisplaySeed(enriched, resolvedArt);
      audio.adoptQueueTrack(enriched, seekSeconds);
    },
    [audio, applyPlaybackDisplaySeed],
  );
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
  /** True once the current track reaches Playing — gates gapless auto-advance. */
  const trackReachedPlayingRef = useRef(false);
  /** Native Exo gapless queue advanced — suppress duplicate JS resolve/advance. */
  const exoGaplessTransitionAtRef = useRef(0);

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
      recordPlaySession(env, peak, completed, skipped);
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

  const seedSearchPlayQueue = useCallback((env: MediaEnvelope) => {
    const seed = computePlayQueueSeed(env, {
      searchHits: searchHitsRef.current,
      searchResults: searchResultsRef.current,
      albumTracks: albumDrillTracksRef.current,
      albumTitle: albumDrillAlbumRef.current?.title,
      expectedTrackCount: albumDrillAlbumRef.current?.trackCount,
      seedSearchOnly: true,
    });
    if (!seed) return null;
    setPlayQueue(seed.queue);
    setQueueIndex(seed.index);
    return seed;
  }, []);

  const persistLockerPlayRepair = useCallback((tapped: MediaEnvelope, playable: MediaEnvelope) => {
    if (playable.provider !== 'local-vault' || !playable.sourceId?.trim() || !playable.url?.trim()) {
      return;
    }
    patchPlaylistTrackLockerRef(tapped.envelopeId, playable);
  }, []);

  const handlePlayEnvelope = useCallback(
    async (
      env: MediaEnvelope,
      candidates?: CandidateSource[],
      options?: {
        autoPlay?: boolean;
        seedSearchQueue?: boolean;
        seedSearchEnvelope?: MediaEnvelope;
        seamless?: boolean;
        /** Keep multi-track album queue when resolving the next track after end/skip. */
        preservePlayQueue?: boolean;
      },
    ): Promise<boolean> => {
      setHomeAwaitingUserResume(false);
      const queueAdvanceSeamless = options?.seamless === true;
      const loadOptions: {
        autoPlay: boolean;
        seamless?: boolean;
      } = {
        autoPlay: options?.autoPlay !== false,
        seamless: queueAdvanceSeamless || undefined,
      };
      if (loadOptions.autoPlay) {
        audio.primePlaybackGesture(env);
        if (showMobileShell) {
          setMobilePlayerPending(true);
        }
      }

      if (import.meta.env.DEV) {
        showAppToast(`Play tapped: ${env.title || 'Unknown'}`, 1000);
      }

      const playTapStartedAt = performance.now();
      const logPlayTiming = (phase: string, extra?: Record<string, unknown>) => {
        console.log(
          `[handlePlayEnvelope] timing ${JSON.stringify({
            phase,
            elapsedMs: Math.round(performance.now() - playTapStartedAt),
            title: env.title,
            ...extra,
          })}`,
        );
      };

      console.warn(
        `[handlePlayEnvelope] tap ${JSON.stringify({
          title: env.title,
          artist: env.artist,
          envelopeId: env.envelopeId,
          hasUrl: Boolean(env.url?.trim()),
          mobileActive: hasActiveMobileResolvers(),
          serverReachable: isTier34ReachableCached(),
          connectRole: connectRolePref,
          networkSync: networkSyncEnabled,
        })}`,
      );

      const generation = beginPlayIntent(env.envelopeId);
      playGenerationRef.current = generation;
      trackReachedPlayingRef.current = false;
      if (options?.seedSearchQueue) {
        autoSimilarRadioSeedRef.current = null;
      }
      const queueSeed = options?.seedSearchQueue
        ? seedSearchPlayQueue(options.seedSearchEnvelope ?? env)
        : null;
      if (options?.seedSearchQueue && (queueSeed?.queue.length ?? 1) <= 1) {
        setRepeatMode('none');
        setMixRadioSession(null);
      }
      const refQueue = playQueueRef.current;
      const stateQueue = playQueue;
      const queueResolution = resolveActivePlayQueue({
        envEnvelopeId: env.envelopeId,
        refQueue,
        stateQueue,
        queueSeed,
        preservePlayQueue: options?.preservePlayQueue,
      });
      let activePlayQueue: MediaEnvelope[];
      if (queueResolution.collapsed) {
        activePlayQueue = [env];
        playQueueRef.current = [env];
        queueIndexRef.current = 0;
        setPlayQueue([env]);
        setQueueIndex(0);
        setMixRadioSession(null);
        autoSimilarRadioSeedRef.current = null;
      } else {
        activePlayQueue = queueResolution.queue as MediaEnvelope[];
        if (activePlayQueue.length > 1) {
          const idx = Math.max(
            0,
            activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId),
          );
          const stateOutOfSync =
            stateQueue.length !== activePlayQueue.length ||
            !activePlayQueue.every(
              (track, i) => stateQueue[i]?.envelopeId === track.envelopeId,
            );
          if (stateOutOfSync) {
            setPlayQueue(activePlayQueue);
            setQueueIndex(idx);
            queueIndexRef.current = idx;
          }
        }
      }
      const activeQueueIndex =
        queueSeed?.index ??
        Math.max(0, activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId));
      const isStale = () => !isPlayIntentCurrent(generation, env.envelopeId);
      const envelopeLoadOpts = (extra?: { autoPlay?: boolean; seamless?: boolean; instant?: boolean }) => ({
        autoPlay: extra?.autoPlay ?? loadOptions.autoPlay,
        seamless: extra?.seamless ?? queueAdvanceSeamless,
        instant: extra?.instant,
        playToken: generation,
        playEnvelopeId: env.envelopeId,
      });

      const lockerSeedArt =
        env.provider === 'local-vault' ? resolveLockerEntryAlbumArt(env) : undefined;
      const seedArtwork = coalesceArtworkUrl(
        lockerSeedArt,
        env.artworkUrl,
        candidates?.find((s) => s.metadata?.artworkUrl)?.metadata?.artworkUrl,
        albumDrillAlbum?.artworkUrl,
      );
      const seedDisplayArt =
        proxiedArtworkUrl(seedArtwork) ?? seedArtwork ?? '';
      const seedEnvelope =
        seedArtwork && !env.artworkUrl ? { ...env, artworkUrl: seedArtwork } : env;
      applyPlaybackDisplaySeed(seedEnvelope, seedDisplayArt);

      if (isPodcastEnvelopeId(env.envelopeId)) {
        queueMicrotask(() => syncThumbsFromFeedback(env.envelopeId));
        const seed =
          seedArtwork && !env.artworkUrl ? { ...env, artworkUrl: seedArtwork } : env;
        if (
          playbackSwitchRequiresHardPreempt(
            audio.envelope?.envelopeId,
            seed.envelopeId,
          )
        ) {
          audio.stop();
        }
        markActivePlaybackSession();
        const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
        if (idx >= 0) setQueueIndex(idx);

        if (!hasPlayablePodcastStreamUrl(seed)) {
          if (!isStale()) {
            audio.failResolve();
            showAppToast(
              t('player.podcastMissingAudio', {
                defaultValue:
                  'No audio URL for this episode — open the show and pull to refresh the feed',
              }),
              6000,
            );
          }
          setMobilePlayerPending(false);
          return false;
        }

        try {
          void audio.beginResolve(seed, loadOptions);
          await yieldToMain();
          const playable = await resolvePodcastEnvelopeForPlayback(seed, {
            skipCacheEviction: true,
          });
          if (isStale()) return false;
          const loaded = await audio.loadEnvelope(
            playable,
            envelopeLoadOpts({ seamless: true, instant: true }),
          );
          setMobilePlayerPending(false);
          if (!loaded) return false;
        } catch (err) {
          if (!isStale()) {
            console.warn('[handlePlayEnvelope] podcast playback failed:', err);
            audio.failResolve();
            showAppToast(
              err instanceof Error
                ? err.message
                : 'Podcast playback failed — refresh the feed and try again',
              6000,
            );
          }
          setMobilePlayerPending(false);
          return false;
        }
        return true;
      }

      if (isAudiobookCatalogEnvelopeId(env.envelopeId)) {
        queueMicrotask(() => syncThumbsFromFeedback(env.envelopeId));
        const seed =
          seedArtwork && !env.artworkUrl ? { ...env, artworkUrl: seedArtwork } : env;
        if (
          playbackSwitchRequiresHardPreempt(
            audio.envelope?.envelopeId,
            seed.envelopeId,
          )
        ) {
          audio.stop();
        }
        markActivePlaybackSession();
        const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
        if (idx >= 0) setQueueIndex(idx);

        if (!hasPlayableAudiobookCatalogStreamUrl(seed)) {
          if (!isStale()) {
            audio.failResolve();
            showAppToast(t('audiobooks.missingAudio'), 6000);
          }
          setMobilePlayerPending(false);
          return false;
        }

        try {
          void audio.beginResolve(seed, loadOptions);
          await yieldToMain();
          const playable = await resolveAudiobookCatalogEnvelopeForPlayback(seed, {
            skipCacheEviction: true,
          });
          if (isStale()) return false;
          const loaded = await audio.loadEnvelope(
            playable,
            envelopeLoadOpts({ seamless: true, instant: true }),
          );
          setMobilePlayerPending(false);
          if (!loaded) return false;
        } catch (err) {
          if (!isStale()) {
            console.warn('[handlePlayEnvelope] audiobook catalog playback failed:', err);
            audio.failResolve();
            showAppToast(
              err instanceof Error ? err.message : t('audiobooks.playbackFailed'),
              6000,
            );
          }
          setMobilePlayerPending(false);
          return false;
        }
        return true;
      }

      syncThumbsFromFeedback(env.envelopeId);

      const catalogTrackEarly = catalogTrackIdFromEnvelope(seedEnvelope);
      const needsMobileResolveEarly = needsMobileResolveEarlyPath(seedEnvelope, candidates);

      const currentUrl = audio.envelope?.url?.trim() ?? '';
      const targetQueueIdx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
      if (!isPodcastEnvelopeId(env.envelopeId)) {
        const inPlaceSeek = tryQueueInPlaceSeek({
          playQueue: activePlayQueue,
          queueIndex: activeQueueIndex,
          targetQueueIdx,
          currentUrl,
          streamDurationSeconds: audio.streamDurationSeconds,
          envelopeDurationSeconds: audio.envelope?.durationSeconds ?? 0,
        });
        if (
          currentUrl &&
          targetQueueIdx >= 0 &&
          env.envelopeId !== audio.envelope?.envelopeId &&
          inPlaceSeek != null
        ) {
          syncThumbsFromFeedback(env.envelopeId);
          setQueueIndex(targetQueueIdx);
          adoptInPlaceQueueTrack(seedEnvelope, inPlaceSeek);
          setMobilePlayerPending(false);
          return true;
        }
      }

      const failResolve = (showToast = true): boolean => {
        if (isStale()) return false;
        if (showToast) {
          const base = getTier34BaseUrl().trim();
          const mobileActive = hasActiveMobileResolvers();
          const mobileErr = getLastMobileResolveError();
          const hasAttachedStream = candidates?.some(
            (c) => c.uri?.trim() && !isCatalogPreviewUrl(c.uri),
          );
          const catalogTrack = catalogTrackIdFromEnvelope(env);
          const needsServer =
            env.provider !== 'local-vault' &&
            env.provider !== 'stream-cache' &&
            env.provider !== 'indexeddb' &&
            env.provider !== 'blob';
          const sandboxNeeded =
            catalogTrack &&
            needsServer &&
            !hasAttachedStream &&
            !mobileActive &&
            (!base || !isTier34ReachableCached());
          if (mobileActive && mobileErr) {
            showAppToast(
              `Playback failed: ${formatMobilePlaybackError(mobileErr)}`,
              3800,
            );
          } else if (mobileActive) {
            showAppToast(t('artist.playbackHybridUnavailable'), 3800);
          } else if (sandboxNeeded || (!base && needsServer && !hasAttachedStream)) {
            const detail = getLastTier34StartError();
            showAppToast(
              detail
                ? `${t('artist.playbackSandboxRequired')} — ${detail}`
                : t('artist.playbackSandboxRequired'),
              3800,
            );
          } else if (base && needsServer && !isTier34ReachableCached() && !hasAttachedStream) {
            showAppToast(t('artist.playbackSandboxUnreachable'), 3800);
          } else {
            showAppToast(t('artist.playbackHybridUnavailable'), 3800);
          }
        }
        setMobilePlayerPending(false);
        audio.stop();
        return false;
      };

      try {
        if (!shouldSkipLockerPlaybackGate(env.envelopeId)) {
          const lockerEarly = await ensureLockerPlayable(seedEnvelope);
        if (lockerEarly.kind === 'missing-audio' && !isStale()) {
          if (
            await attemptDeadLockerReacquire(
              seedEnvelope.title,
              seedEnvelope.artist,
              seedEnvelope.album,
            )
          ) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                defaultValue: `Re-downloading "${seedEnvelope.title}"…`,
              }),
              5000,
            );
            setMobilePlayerPending(false);
            return false;
          }
          const offlineOnly =
            env.provider === 'local-vault' &&
            !hasActiveMobileResolvers() &&
            !getTier34BaseUrl().trim();
          if (offlineOnly) {
            showAppToast(
              t('player.lockerAudioMissing', {
                defaultValue:
                  'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
              }),
              6000,
            );
            setMobilePlayerPending(false);
            return false;
          }
        } else if (lockerEarly.kind === 'playable' && !isStale()) {
          let playable = lockerEarly.envelope;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = preserveTappedEnvelopeIdentity(seedEnvelope, playable);
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          if (targetQueueIdx >= 0) setQueueIndex(targetQueueIdx);
          setMobilePlayerPending(false);
          scheduleAutoSimilarRadioRef.current(syncedPlayable, {
            seedSearchQueue: options?.seedSearchQueue,
            seamless: queueAdvanceSeamless,
            playQueueOverride: activePlayQueue,
          });
          return true;
        }
      }

      if (!shouldSkipLockerPlaybackGate(env.envelopeId)) {
        const syncCached = readSyncCachedFastPath(seedEnvelope);
        if (syncCached?.url?.trim() && !isStale()) {
          const lockerGate = await ensureLockerPlayable(syncCached);
          if (lockerGate.kind === 'playable') {
          markActivePlaybackSession();
          let playable = lockerGate.envelope;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = preserveTappedEnvelopeIdentity(seedEnvelope, playable);
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          if (targetQueueIdx >= 0) setQueueIndex(targetQueueIdx);
          setMobilePlayerPending(false);
          scheduleAutoSimilarRadioRef.current(syncedPlayable, {
            seedSearchQueue: options?.seedSearchQueue,
            seamless: queueAdvanceSeamless,
            playQueueOverride: activePlayQueue,
          });
          return true;
          }
        }
      }

      if (
        isAndroid() &&
        hasActiveMobileResolvers() &&
        (needsMobileResolveEarly || preferFreshMobileResolve() || Boolean(catalogTrackEarly))
      ) {
        ensureYtDlpMobileReady();
      }

      if (queueAdvanceSeamless && !shouldSkipLockerPlaybackGate(env.envelopeId)) {
        let seamlessInstant = await tryInstantPlayable(seedEnvelope, { forPrefetch: true });
        if (seedEnvelope.provider === 'local-vault' || seamlessInstant?.provider === 'local-vault') {
          seamlessInstant = await resolveLockerEnvelopeForPlayback(seamlessInstant ?? seedEnvelope);
        }
        if (
          seamlessInstant?.url?.trim() &&
          !(isAndroid() && seamlessInstant.url.startsWith('blob:')) &&
          !isStale()
        ) {
          let playable = seamlessInstant;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = preserveTappedEnvelopeIdentity(seedEnvelope, playable);
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          if (targetQueueIdx >= 0) setQueueIndex(targetQueueIdx);
          setMobilePlayerPending(false);
          scheduleAutoSimilarRadioRef.current(syncedPlayable, {
            seedSearchQueue: options?.seedSearchQueue,
            seamless: queueAdvanceSeamless,
            playQueueOverride: activePlayQueue,
          });
          return true;
        }
      }

      await audio.beginResolve(seedEnvelope, loadOptions);
      markActivePlaybackSession();

      if (
        connectRolePref === 'remote' &&
        networkSyncEnabled &&
        isConnectRemoteRef.current &&
        remoteMirror
      ) {
        sendConnectCommand({ cmd: 'PLAY', envelopeId: env.envelopeId });
        showAppToast(`Connect remote: ${env.title || 'track'}`, 3200);
        return true;
      }

      if (!shouldSkipLockerPlaybackGate(env.envelopeId)) {
        let instant = await tryInstantPlayable(
          seedEnvelope,
          queueAdvanceSeamless ? { forPrefetch: true } : undefined,
        );
        if (seedEnvelope.provider === 'local-vault' || instant?.provider === 'local-vault') {
          instant = await resolveLockerEnvelopeForPlayback(instant ?? seedEnvelope);
        }
        if (
          !instant?.url?.trim() &&
          seedEnvelope.provider === 'local-vault' &&
          !isStale()
        ) {
          if (
            await attemptDeadLockerReacquire(
              seedEnvelope.title,
              seedEnvelope.artist,
              seedEnvelope.album,
            )
          ) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                defaultValue: `Re-downloading "${seedEnvelope.title}"…`,
              }),
              5000,
            );
            setMobilePlayerPending(false);
            return false;
          }
          showAppToast(
            t('player.lockerAudioMissing', {
              defaultValue:
                'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
            }),
            6000,
          );
          setMobilePlayerPending(false);
          return false;
        }
        if (
          instant?.url?.trim() &&
          !(isAndroid() && instant.url.startsWith('blob:')) &&
          !isStale()
        ) {
          let playable = instant;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata
              ?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = preserveTappedEnvelopeIdentity(seedEnvelope, playable);
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
          if (idx >= 0) setQueueIndex(idx);
          setMobilePlayerPending(false);
          return true;
        }
      }

        let playable = env;
        if (!playable.album?.trim()) {
          const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
          const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
          if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
        }

        const lockerResolved = await resolveLockerEnvelopeForPlayback(playable);
        if (lockerResolved) {
          playable = lockerResolved;
          if (playable.sourceId) {
            const lockerRg = await lookupLockerReplayGainDb(playable.sourceId);
            if (lockerRg != null) playable = { ...playable, replayGainDb: lockerRg };
          }
        } else if (playable.provider === 'local-vault' || findLockerEntryForTrack(
          playable.title,
          playable.artist,
          playable.album,
          getLockerEntriesSnapshot(),
        )) {
          const playableEntry = await findPlayableLockerEntryForTrack(
            playable.title,
            playable.artist,
            playable.album,
          );
          if (playableEntry) {
            const healed = await resolveLockerEnvelopeForPlayback({
              ...playable,
              provider: 'local-vault',
              sourceId: playableEntry.id,
              url: '',
            });
            if (healed?.url?.trim()) {
              playable = healed;
            } else {
              if (
                await attemptDeadLockerReacquire(
                  playable.title,
                  playable.artist,
                  playable.album,
                )
              ) {
                showAppToast(
                  t('player.lockerAudioReacquiring', {
                    defaultValue: `Re-downloading "${playable.title}"…`,
                  }),
                  5000,
                );
                return failResolve(false);
              }
              showAppToast(
                t('player.lockerAudioMissing', {
                  defaultValue:
                    'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
                }),
                6000,
              );
              return failResolve(false);
            }
          } else {
            if (
              await attemptDeadLockerReacquire(
                playable.title,
                playable.artist,
                playable.album,
              )
            ) {
              showAppToast(
                t('player.lockerAudioReacquiring', {
                  defaultValue: `Re-downloading "${playable.title}"…`,
                }),
                5000,
              );
              return failResolve(false);
            }
            showAppToast(
              t('player.lockerAudioMissing', {
                defaultValue:
                  'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
              }),
              6000,
            );
            return failResolve(false);
          }
        }

        if (!playable.url || playable.provider === 'dht-swarm') {
          if (!preferFreshMobileResolve()) {
            const resolved = await tier34DhtResolve(
              playable.title,
              playable.artist,
              playable.sourceId,
            );
            if (resolved?.url) {
              playable = {
                ...resolved,
                envelopeId: playable.envelopeId,
                title: playable.title || resolved.title,
                artist: playable.artist || resolved.artist,
                album: playable.album ?? resolved.album,
                artworkUrl: coalesceArtworkUrl(
                  playable.artworkUrl,
                  seedArtwork,
                  resolved.artworkUrl,
                ),
                durationSeconds: playable.durationSeconds || resolved.durationSeconds,
              };
            }
          }
        }

        const hadAttachedTier =
          Boolean(
            candidates?.some(
              (c) =>
                (c.provider === 'proxy' ||
                  c.provider === 'stream-proxy' ||
                  c.provider === 'debrid') &&
                c.uri?.trim() &&
                !c.uri.includes('audio-ssl'),
            ),
          );

        const catalogTrack = catalogTrackIdFromEnvelope(playable);
        const needsTier34ForCatalog =
          catalogTrack &&
          playable.provider !== 'local-vault' &&
          playable.provider !== 'stream-cache' &&
          playable.provider !== 'indexeddb' &&
          playable.provider !== 'blob';

        if (
          needsTier34ForCatalog &&
          !getTier34BaseUrl().trim()
        ) {
          ensureYtDlpMobileReady();
        }

        const needsMobileResolve =
          playable.provider !== 'local-vault' &&
          playable.provider !== 'stream-cache' &&
          playable.provider !== 'indexeddb' &&
          playable.provider !== 'blob' &&
          (!playable.url?.trim() ||
            isCatalogPreviewUrl(playable.url ?? '') ||
            isOfflineUnplayableStreamUrl(playable.url ?? ''));

        if (
          (needsMobileResolve || preferFreshMobileResolve()) &&
          isAndroid()
        ) {
          ensureYtDlpMobileReady();
        }

        if (
          needsTier34ForCatalog &&
          (!getTier34BaseUrl().trim() || !isTier34ReachableCached())
        ) {
          if (isSandboxServerDesktop()) {
            showAppToast(t('artist.playbackSandboxStarting'), 8000);
            await ensureTier34ForPlayback({
              onPhase: (phase) => {
                if (phase === 'waiting') {
                  showAppToast(t('artist.playbackSandboxStarting'), 8000);
                }
              },
            });
            await refreshTier34Reachability();
            if (isStale()) return false;
          } else if (getTier34BaseUrl().trim() && !isTier34ReachableCached()) {
            showAppToast(t('artist.playbackSandboxUnreachable'), 5200);
          }
        }

        const executePayload =
          seedArtwork && !playable.artworkUrl
            ? { ...playable, artworkUrl: seedArtwork }
            : playable;
        const needsMobileExecuteTimeout =
          isAndroid() &&
          hasActiveMobileResolvers() &&
          playable.provider !== 'local-vault' &&
          playable.provider !== 'stream-cache' &&
          playable.provider !== 'indexeddb' &&
          playable.provider !== 'blob';
        if (needsMobileExecuteTimeout) {
          if (
            isCellularNetwork() &&
            (needsMobileResolveEarly ||
              needsUncachedRemoteResolve(playable) ||
              needsUncachedRemoteResolve(seedEnvelope))
          ) {
            const mb = estimateStreamDownloadMb(
              playable.durationSeconds ? playable : seedEnvelope,
            );
            showAppToast(formatCellularDownloadNotice(mb), 4500);
          }
          playable = await Promise.race([
            executeTrack(executePayload, candidates),
            new Promise<MediaEnvelope>((_, reject) => {
              window.setTimeout(
                () => reject(new Error('mobile resolve timeout')),
                MOBILE_EXECUTE_TRACK_TIMEOUT_MS,
              );
            }),
          ]);
        } else {
          playable = await executeTrack(executePayload, candidates);
        }
        if (isStale()) return false;
        logPlayTiming('resolved', {
          hasUrl: Boolean(playable.url?.trim()),
          source: playable.resolutionSource,
          provider: playable.provider,
        });
        console.warn(
          `[handlePlayEnvelope] resolved ${JSON.stringify({
            title: playable.title,
            hasUrl: Boolean(playable.url?.trim()),
            source: playable.resolutionSource,
            provider: playable.provider,
          })}`,
        );
        playable = await ensureCatalogPlaybackIdentity(seedEnvelope, playable, candidates);
        if (isStale()) return false;

        if (
          !playable.artworkUrl &&
          playable.provider === 'local-vault' &&
          playable.sourceId
        ) {
          const lockerArt =
            resolveLockerEntryAlbumArt(playable) ??
            (await resolveLockerArtworkUrl(playable.sourceId));
          if (lockerArt) playable = { ...playable, artworkUrl: lockerArt };
        }

        const resolvedArtwork =
          playable.provider === 'local-vault' || lockerResolved
            ? coalesceArtworkUrl(playable.artworkUrl, seedEnvelope.artworkUrl, env.artworkUrl)
            : coalesceArtworkUrl(
                playable.artworkUrl,
                seedArtwork,
                env.artworkUrl,
                albumDrillAlbum?.artworkUrl,
              );
        if (resolvedArtwork) {
          playable = { ...playable, artworkUrl: resolvedArtwork };
        }

        const activeEnvelope = audioEnvelopeRef.current;
        if (isPlaybackDowngrade(activeEnvelope, playable)) {
          return failResolve(false);
        }

        if (!playable.url?.trim()) {
          return failResolve(true);
        }

        console.warn(
          `[handlePlayEnvelope] load ${JSON.stringify({
            title: playable.title,
            urlLen: playable.url?.trim().length ?? 0,
            source: playable.resolutionSource,
            autoPlay: loadOptions.autoPlay,
          })}`,
        );
        logPlayTiming('load', {
          urlLen: playable.url?.trim().length ?? 0,
          source: playable.resolutionSource,
        });
        const syncedPlayable = preserveTappedEnvelopeIdentity(seedEnvelope, playable);
        persistLockerPlayRepair(seedEnvelope, syncedPlayable);
        audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
        logPlayTiming('loadEnvelope-called', { autoPlay: loadOptions.autoPlay });
        void runDeferredPlaySideEffects({
          seedEnvelope,
          playable: syncedPlayable,
          candidates,
          hadAttachedTier,
          preferFreshMobile: preferFreshMobileResolve(),
          mobileActive: hasActiveMobileResolvers(),
          loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
          notifyPrefetchProgress,
          dismissPrefetchProgress,
          seedArtwork,
        });
        const displayArt =
          proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
        if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
        if (!resolvedArtwork) {
          void fetchTrackMetadata(playable.artist, playable.title).then((meta) => {
            if (isStale()) return;
            const fetched = coalesceArtworkUrl(meta.albumArt, seedArtwork);
            if (fetched) {
              setArtworkUrl((prev) => proxiedArtworkUrl(fetched) ?? fetched ?? prev);
            }
          });
        }
        const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
        if (idx >= 0) setQueueIndex(idx);
        setMobilePlayerPending(false);
        scheduleAutoSimilarRadioRef.current(syncedPlayable, {
          seedSearchQueue: options?.seedSearchQueue,
          seamless: queueAdvanceSeamless,
          playQueueOverride: activePlayQueue,
        });
        return true;
      } catch (err) {
        if (isStale()) return false;
        console.warn('[handlePlayEnvelope] playback failed:', err);
        return failResolve(true);
      }
    },
    [audio, playQueue, queueIndex, albumDrillAlbum, connectRolePref, networkSyncEnabled, sendConnectCommand, syncThumbsFromFeedback, showAppToast, t, openSettings, seedSearchPlayQueue, remoteMirror, showMobileShell, applyPlaybackDisplaySeed, syncPlaybackArtwork, adoptInPlaceQueueTrack],
  );

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

  const handleSelectTrack = useCallback(
    (track: CatalogTrack) => {
      recordSearchTrack(track);
      setSearchHistoryTick((n) => n + 1);
      finishMobileSearchNavigation();
      if (!track.envelope) return;
      if (showMobileShell) handleMobileTrackTitleTap(track.envelope);
      else void handlePlayEnvelope(track.envelope, undefined, { seedSearchQueue: true });
    },
    [handlePlayEnvelope, handleMobileTrackTitleTap, showMobileShell, finishMobileSearchNavigation],
  );

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

  const goToDiscover = useCallback((tab: DiscoverTabId = 'feed') => {
    setDiscoverTab(tab);
    setStation('discover');
    setNavOpen(false);
  }, []);

  const handleSelectPlaylist = useCallback(
    (playlist: UnifiedPlaylistResult) => {
      finishMobileSearchNavigation();
      setFocusPlaylistId(playlist.id);
      setLockerSection('playlists');
      setStation('locker');
      setNavOpen(false);
    },
    [finishMobileSearchNavigation],
  );

  const handleActivateRecentSearch = useCallback(
    (entry: SearchHistoryEntry) => {
      switch (entry.kind) {
        case 'query':
          handleSelectSuggestion(entry.query);
          break;
        case 'artist':
          handleSelectArtist(historyEntryToArtist(entry));
          break;
        case 'album':
          handleSelectAlbum(historyEntryToAlbum(entry));
          break;
        case 'track':
          handleSelectTrack(historyEntryToTrack(entry));
          break;
        default:
          break;
      }
    },
    [handleSelectSuggestion, handleSelectArtist, handleSelectAlbum, handleSelectTrack],
  );

  const searchDropdownItems = useMemo(
    () =>
      buildSearchDropdownItems({
        query: searchInput,
        recentSearches: recentSearchMatches,
        catalog: searchCatalog,
        playlists: unifiedSearchResult.playlists,
        includeViewAll: searchInput.trim().length >= 2,
      }),
    [searchInput, recentSearchMatches, searchCatalog, unifiedSearchResult.playlists],
  );

  const activateSearchDropdownItem = useCallback(
    (item: SearchDropdownItem) => {
      switch (item.kind) {
        case 'recent':
          handleActivateRecentSearch(item.entry);
          break;
        case 'suggestion':
          handleSelectSuggestion(item.query);
          break;
        case 'artist':
          handleSelectArtist(item.artist);
          break;
        case 'album':
          handleSelectAlbum(item.album);
          break;
        case 'track':
          handleSelectTrack(item.track);
          break;
        case 'playlist':
          handleSelectPlaylist(item.playlist);
          break;
        case 'view-all':
          navigateSearchQuery(searchInput.trim());
          break;
        default:
          break;
      }
    },
    [
      handleActivateRecentSearch,
      handleSelectSuggestion,
      handleSelectArtist,
      handleSelectAlbum,
      handleSelectTrack,
      handleSelectPlaylist,
      navigateSearchQuery,
      searchInput,
    ],
  );

  const submitSearch = useCallback(() => {
    const q = (searchInputRef.current?.value ?? searchInput).trim();
    if (!q) return;
    if (searchActiveIndex >= 0 && searchDropdownItems[searchActiveIndex]) {
      activateSearchDropdownItem(searchDropdownItems[searchActiveIndex]!);
      return;
    }
    navigateSearchQuery(q);
  }, [
    searchInput,
    searchActiveIndex,
    searchDropdownItems,
    activateSearchDropdownItem,
    navigateSearchQuery,
  ]);

  const handleRemoveRecentSearch = useCallback((entry: SearchHistoryEntry) => {
    removeSearchHistoryEntry(entry);
    setSearchHistoryTick((n) => n + 1);
  }, []);

  const handleClearSearchHistory = useCallback(() => {
    clearSearchHistory();
    setSearchHistoryTick((n) => n + 1);
  }, []);

  const handleClearSearchInput = useCallback(() => {
    setSearchInput('');
    setSearchCatalog(EMPTY_CATALOG);
    setUnifiedSearchResult(EMPTY_UNIFIED);
    setSearchActiveIndex(-1);
    searchInputRef.current?.focus();
  }, []);

  const playEnvelopeRef = useRef(handlePlayEnvelope);
  playEnvelopeRef.current = handlePlayEnvelope;

  useEffect(() => {
    const matchTrackTitle = (tracks: CatalogTrack[], title: string) =>
      tracks.find((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase());

    const playViaMobileFallback = async (
      artistName: string,
      trackTitle: string,
      albumTitle?: string,
    ): Promise<boolean> => {
      ensureYtDlpMobileReady();
      const ready = await waitForYtDlpInit(90_000);
      if (!ready) return false;
      const env: MediaEnvelope = {
        envelopeId: `e2e-mobile-${Date.now()}`,
        title: trackTitle,
        artist: artistName,
        album: albumTitle,
        url: '',
        durationSeconds: 0,
        provider: 'https',
        transport: 'element-src',
        sourceId: `e2e-${trackTitle}`,
      };
      console.warn(
        `[E2E mobile-fallback] play ${JSON.stringify({
          artist: artistName,
          album: albumTitle ?? '',
          track: trackTitle,
        })}`,
      );
      return playEnvelopeRef.current(env, undefined, { autoPlay: true });
    };

    const resolveAlbumTracksForE2e = async (
      artistName: string,
      albumTitle: string,
      album: CatalogAlbum,
    ): Promise<CatalogTrack[]> => {
      const intent = await resolveAlbumIntent(`${artistName} ${albumTitle}`);
      const hinted = intent?.album ?? album;
      const canonical = await canonicalizeAlbumHint(hinted);
      setAlbumDrillAlbum(canonical);
      setAlbumDrillQuery(`${artistName} ${albumTitle}`);

      await runSearch(`${artistName} ${albumTitle}`, {
        albumHint: canonical,
        preserveArtist: true,
        albumDrill: true,
      });
      const searchDeadline = Date.now() + 120_000;
      while (Date.now() < searchDeadline) {
        if (!searchLoadingRef.current) {
          const fromDrill = albumDrillTracksRef.current;
          if (fromDrill.length > 0) {
            setAlbumDrillTracks(fromDrill);
            return fromDrill;
          }
          const fromUnified = unifiedSearchResultRef.current.tracks.filter(
            (t) =>
              t.album &&
              (t.album.trim().toLowerCase() === albumTitle.trim().toLowerCase() ||
                t.album.trim().toLowerCase().includes(albumTitle.trim().toLowerCase())),
          );
          if (fromUnified.length > 0) {
            setAlbumDrillTracks(fromUnified);
            return fromUnified;
          }
        }
        await new Promise((r) => window.setTimeout(r, 500));
      }

      for (let attempt = 0; attempt < 3; attempt += 1) {
        const fetched = await fetchAlbumTracks(canonical);
        if (fetched.length > 0) {
          setAlbumDrillTracks(fetched);
          return fetched;
        }
        if (attempt < 2) {
          await new Promise((r) => window.setTimeout(r, 2000 * (attempt + 1)));
        }
      }
      return albumDrillTracksRef.current;
    };

    const playAlbumTrackImpl = async (
      artistName: string,
      albumTitle: string,
      trackTitle: string,
    ): Promise<boolean> => {
      setHomeAwaitingUserResume(false);
      const album: CatalogAlbum = {
        kind: 'album',
        id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: albumTitle,
        artist: artistName,
      };
      setSelectedArtist(null);
      setAlbumDrillAlbum(album);
      setStation('search');
      setNavOpen(false);
      const canonical = await canonicalizeAlbumHint(album);
      setAlbumDrillAlbum(canonical);
      let tracks = await fetchAlbumTracks(canonical);
      if (tracks.length === 0) {
        tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, canonical);
      } else {
        setAlbumDrillTracks(tracks);
      }
      let hit = matchTrackTitle(tracks, trackTitle);
      if (!hit?.envelope) {
        const top = await fetchArtistTopTracks(artistName, undefined, 80);
        const albumKey = albumTitle.trim().toLowerCase();
        hit = top.find(
          (t) =>
            t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase() &&
            (t.album?.trim().toLowerCase().includes(albumKey) ?? false),
        );
      }
      if (!hit?.envelope) {
        const searchResult = await runUnifiedSearch(`${artistName} ${albumTitle} ${trackTitle}`, {
          limit: 16,
        });
        hit = searchResult.tracks.find(
          (t) => t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase(),
        );
      }
      if (hit?.envelope) {
        if (isAndroid() && hasActiveMobileResolvers()) {
          ensureYtDlpMobileReady();
          await waitForYtDlpInit();
        }
        const tapped: MediaEnvelope = {
          ...hit.envelope,
          title: hit.title,
          artist: artistName,
          album: albumTitle,
        };
        return playEnvelopeRef.current(tapped, undefined, {
          autoPlay: true,
          seedSearchQueue: true,
        });
      }
      return playViaMobileFallback(artistName, trackTitle, albumTitle);
    };

    installE2eLiveHandlers({
      playArtistTrack: async (artistName, trackTitle) => {
        setHomeAwaitingUserResume(false);
        const artist = await resolveCatalogArtistByName(artistName);
        setSelectedArtist(artist);
        setStation('search');
        setNavOpen(false);
        const topTracks = await fetchArtistTopTracks(artist.name, artist.id, 50);
        let hit = matchTrackTitle(topTracks, trackTitle);
        if (!hit?.envelope) {
          const searchResult = await runUnifiedSearch(`${artistName} ${trackTitle}`, { limit: 16 });
          hit = searchResult.tracks.find(
            (t) => t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase(),
          );
        }
        if (hit?.envelope) {
          if (isAndroid() && hasActiveMobileResolvers()) {
            ensureYtDlpMobileReady();
            const ytdlp = await getYtDlpMobileStatus();
            if (!ytdlp.initialized) await waitForYtDlpInit();
          }
          const tapped: MediaEnvelope = {
            ...hit.envelope,
            title: hit.title,
            artist: artistName,
          };
          return playEnvelopeRef.current(tapped, undefined, {
            autoPlay: true,
            seedSearchQueue: true,
          });
        }
        return playViaMobileFallback(artistName, trackTitle);
      },
      playAlbumTrack: playAlbumTrackImpl,
      playAlbumSequence: async (artistName, albumTitle, count) => {
        await prepareCleanPlaybackStop(() => audio.stop());

        const album: CatalogAlbum = {
          kind: 'album',
          id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: albumTitle,
          artist: artistName,
        };
        const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
        const slice = tracks.slice(0, count);
        if (slice.length < count) {
          console.warn(
            `[album-sequence] insufficient tracks want=${count} got=${slice.length}`,
            slice.map((t) => t.title),
          );
          return false;
        }

        if (isAndroid() && hasActiveMobileResolvers()) {
          ensureYtDlpMobileReady();
          await waitForYtDlpInit(90_000);
        }

        const queueEnvelopes: MediaEnvelope[] = slice.map((t, i) => {
          if (t.envelope) {
            return preserveTappedEnvelopeIdentity(
              {
                ...t.envelope,
                title: t.title,
                artist: artistName,
                album: albumTitle,
              },
              t.envelope,
            );
          }
          return {
            envelopeId: `seq-${albumTitle}-${i}-${t.id ?? t.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            title: t.title,
            artist: artistName,
            album: albumTitle,
            url: '',
            durationSeconds: t.durationSeconds ?? 0,
            provider: 'https',
            transport: 'element-src',
            sourceId: t.id ?? t.title,
          };
        });
        setPlayQueue(queueEnvelopes);

        for (let i = 0; i < slice.length; i += 1) {
          const expectedTitle = slice[i]!.title;
          const queueEnv = queueEnvelopes[i]!;
          if (i > 0) {
            await prepareCleanPlaybackStop(() => audio.stop());
          }
          setQueueIndex(i);
          setHomeAwaitingUserResume(false);
          const started = await playEnvelopeRef.current(queueEnv, undefined, { autoPlay: true });
          if (!started) {
            console.warn(`[album-sequence] play failed index=${i} title=${expectedTitle}`);
            return false;
          }
          const nudgePlayback = async () => {
            audio.primePlaybackGesture();
            await audio.play();
          };
          const playing = await waitForPlaybackStarted({
            expectedTitle,
            getProbeTitle: () => audioEnvelopeRef.current?.title,
            getProbePosition: () => audioCurrentTimeRef.current,
            getProbeDuration: () => audioDurationRef.current,
            getProbeState: () => audioStateRef.current,
            timeoutMs: 240_000,
            onStuck: nudgePlayback,
          });
          if (!playing) {
            console.warn(`[album-sequence] start failed index=${i} title=${expectedTitle}`);
            return false;
          }
          const stable = await waitForStablePlayback({
            expectedTitle,
            getProbeTitle: () => audioEnvelopeRef.current?.title,
            getUiPosition: () => audioCurrentTimeRef.current,
            getUiState: () => audioStateRef.current,
            minAdvanceSecs: 1.5,
            timeoutMs: 120_000,
            onStuck: nudgePlayback,
          });
          if (!stable) {
            console.warn(`[album-sequence] unstable index=${i} title=${expectedTitle}`);
            return false;
          }
        }
        return true;
      },
      openAlbum: async (artistName, albumTitle) => {
        setHomeAwaitingUserResume(false);
        const album: CatalogAlbum = {
          kind: 'album',
          id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: albumTitle,
          artist: artistName,
        };
        setSelectedArtist(null);
        setAlbumDrillQuery(`${artistName} ${albumTitle}`);
        setAlbumDrillAlbum(album);
        setStation('search');
        setNavOpen(false);
        const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
        return tracks.length > 0;
      },
      openSearchArtist: (name) => {
        navigateSearchQuery(name);
        return true;
      },
      listAlbumTracks: () =>
        albumDrillTracksRef.current.map((t) => ({ title: t.title, id: t.id })),
      getPlaybackProbe: () => {
        const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
        return {
          title: env?.title?.trim() ?? audio.title?.trim() ?? '',
          artist: env?.artist?.trim() ?? audio.artist?.trim() ?? '',
          album: env?.album,
          envelopeId: env?.envelopeId,
          state: audioStateRef.current,
          positionSecs: audioCurrentTimeRef.current,
          durationSecs: audioDurationRef.current,
          artworkUrl: env?.artworkUrl,
          nativeState:
            audio.nativeExoActive && audio.nativeExoEffectivePlaying
              ? 'playing'
              : audio.nativeExoActive
                ? 'active'
                : undefined,
        };
      },
      thumbUpCurrent: () => {
        const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
        if (!env?.envelopeId?.trim()) return false;
        handleThumbUp();
        return true;
      },
      thumbDownCurrent: () => {
        const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
        if (!env?.envelopeId?.trim()) return false;
        handleThumbDown();
        return true;
      },
      toggleVinylMode: () => {
        const next = toggleHeroDisplayMode();
        setHeroDisplayMode(next);
        return next;
      },
      setHeroDisplayMode: (mode) => {
        saveHeroDisplayMode(mode);
        setHeroDisplayMode(mode);
      },
      getHeroDisplayMode: () => loadHeroDisplayMode(),
      getHeroVisualProbe: () => probeHeroVisualFromDom(),
      clickHomeVinylToggle: () => clickHomeVinylToggleButton(),
      pausePlayback: () => audio.pause(),
      resumePlayback: async () => {
        audio.primePlaybackGesture();
        await audio.play({ userGesture: true });
      },
      shellBack: () => handleShellBackRef.current(),
      openMobileNowPlaying: () => setMobileNowPlayingOpen(true),
      closeMobileNowPlaying: () => setMobileNowPlayingOpen(false),
      openVinylSettingsSheet: () => {
        const btn = document.querySelector('[data-testid="home-vinyl-settings-btn"]');
        if (!btn) return false;
        btn.dispatchEvent(
          new MouseEvent('contextmenu', { bubbles: true, cancelable: true }),
        );
        return true;
      },
      downloadTrack: async (artistName, trackTitle, mode = 'tracks', albumTitle) => {
        let track: CatalogTrack | undefined;
        const matchTrackTitle = (tracks: CatalogTrack[], title: string) =>
          tracks.find((t) => trackTitleKeysMatch(t.title, title));

        if (albumTitle) {
          const album: CatalogAlbum = {
            kind: 'album',
            id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
            title: albumTitle,
            artist: artistName,
          };
          const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
          track = matchTrackTitle(tracks, trackTitle);
        }
        if (!track) {
          const artist = await resolveCatalogArtistByName(artistName);
          const topTracks = await fetchArtistTopTracks(artist.name, artist.id, 80);
          track = matchTrackTitle(topTracks, trackTitle);
        }
        if (!track) {
          const searchResult = await runUnifiedSearch(`${artistName} ${trackTitle}`, { limit: 12 });
          track = searchResult.tracks.find((t) => trackTitleKeysMatch(t.title, trackTitle));
        }
        if (!track) return false;
        const downloadMode: DownloadMode = mode === 'album' && albumTitle ? 'album' : 'tracks';
        const job = enqueueDownloadJob({
          label: track.title,
          artist: track.artist,
          albumTitle: downloadMode === 'album' ? albumTitle : undefined,
          mode: downloadMode,
          tier: downloadTierPreference,
          totalTracks: downloadMode === 'album' ? 0 : 1,
        });
        initJobTracks(job.id, [{ id: track.id, title: track.title }]);
        if (downloadMode === 'album' && albumTitle) {
          const pseudoAlbum: CatalogAlbum = {
            kind: 'album',
            id: track.id,
            title: albumTitle,
            artist: track.artist,
            artworkUrl: track.artworkUrl,
            releaseYear: track.releaseYear,
          };
          scheduleCatalogTrackDownload(track, downloadTierPreference, job.id, {
            album: pseudoAlbum,
            mode: 'album',
          });
        } else {
          scheduleCatalogTrackDownload(track, downloadTierPreference, job.id);
        }
        return true;
      },
      downloadAlbum: async (artistName, albumTitle) => {
        const album: CatalogAlbum = {
          kind: 'album',
          id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: albumTitle,
          artist: artistName,
        };
        const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
        if (tracks.length === 0) return false;
        const precheck = await filterTracksNeedingDownload(tracks, album.title);
        if (precheck.needing.length === 0) {
          console.log(
            `[SandboxE2E] AREA=download-album RESULT=PASS artist=${artistName} album=${albumTitle} skipped=all-in-locker tracks=${precheck.total}`,
          );
          return true;
        }
        const job = enqueueDownloadJob({
          label: album.title,
          artist: album.artist,
          albumTitle: album.title,
          albumId: album.id,
          mode: 'album',
          tier: downloadTierPreference,
          totalTracks: precheck.needing.length,
        });
        initJobTracks(
          job.id,
          precheck.needing.map((t) => ({ id: t.id, title: t.title })),
        );
        scheduleCatalogAlbumDownload(album, 'album', downloadTierPreference, job.id);
        return true;
      },
      playLockerTrack: async (artistName, trackTitle, albumTitle) => {
        setHomeAwaitingUserResume(false);
        const snapshot = getLockerEntriesSnapshot() ?? [];
        let entry =
          (albumTitle?.trim()
            ? findLockerEntryForTrack(trackTitle, artistName, albumTitle, snapshot)
            : undefined) ?? null;
        if (!entry) {
          entry = await findPlayableLockerEntryForTrack(
            trackTitle,
            artistName,
            albumTitle,
            snapshot,
          );
        }
        if (!entry) {
          entry =
            findLockerEntryForTrackIncludingHollow(
              trackTitle,
              artistName,
              albumTitle,
              snapshot,
            ) ?? null;
        }
        const seed = {
          envelopeId: entry ? `local-${entry.id}` : '',
          title: trackTitle,
          artist: artistName,
          album: albumTitle ?? entry?.albumName,
          durationSeconds: entry?.durationSeconds ?? 0,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: entry?.id ?? '',
          url: entry?.url ?? '',
        };
        const locker = await ensureLockerPlayable(seed);
        if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) {
          await attemptDeadLockerReacquire(trackTitle, artistName, albumTitle);
          return false;
        }
        const playable = preserveTappedEnvelopeIdentity(
          {
            ...seed,
            url: locker.envelope.url,
            artworkUrl: locker.envelope.artworkUrl,
          },
          locker.envelope,
        );
        return playEnvelopeRef.current(playable, undefined, {
          autoPlay: true,
          seedSearchQueue: true,
        });
      },
      playPlaylistTrack: async (playlistName, trackTitle) => {
        setHomeAwaitingUserResume(false);
        const pl = loadPlaylists().find((p) =>
          p.name.toLowerCase().includes(playlistName.toLowerCase()),
        );
        if (!pl) return false;
        const track = pl.tracks.find((t) => lockerTitleMatches(t.title, trackTitle));
        if (!track) return false;
        const entry = await findPlayableLockerEntryForTrack(
          track.title,
          track.artist,
          track.album,
          getLockerEntriesSnapshot(),
        );
        const resolved = await resolveLockerEnvelopeForPlayback({
          ...track,
          provider: 'local-vault',
          url: '',
          sourceId: entry?.id ?? track.sourceId,
        });
        if (!resolved?.url?.trim()) return false;
        const playable = preserveTappedEnvelopeIdentity(track, resolved);
        persistLockerPlayRepair(track, playable);
        return playEnvelopeRef.current(playable, undefined, {
          autoPlay: true,
          seedSearchQueue: true,
        });
      },
      probePlaylistTrack: async (playlistName, trackTitle) => {
        const pl = loadPlaylists().find((p) =>
          p.name.toLowerCase().includes(playlistName.toLowerCase()),
        );
        if (!pl) return { found: false };
        const track = pl.tracks.find((t) => lockerTitleMatches(t.title, trackTitle));
        if (!track) return { found: false };
        const locker = findLockerEntryForTrack(
          track.title,
          track.artist,
          track.album,
          getLockerEntriesSnapshot(),
        );
        const resolved = await resolveLockerEnvelopeForPlayback({
          ...track,
          provider: 'local-vault',
          sourceId: locker?.id ?? track.sourceId,
        });
        const lockerPlayable = Boolean(resolved?.url?.trim());
        return {
          found: true,
          provider: track.provider,
          sourceId: track.sourceId,
          lockerEntryId: resolved?.sourceId ?? locker?.id,
          lockerPlayable,
          envelopeId: track.envelopeId,
        };
      },
      playLockerSequence: async (artistName, trackTitles, albumTitle) => {
        setHomeAwaitingUserResume(false);
        const snapshot = getLockerEntriesSnapshot();

        if (albumTitle?.trim() && trackTitles.length >= 2) {
          const envs: MediaEnvelope[] = [];
          for (const title of trackTitles) {
            const entry = findLockerEntryForTrack(
              title,
              artistName,
              albumTitle,
              snapshot ?? undefined,
            );
            if (!entry) return false;
            const resolved = await resolveLockerEnvelopeForPlayback({
              envelopeId: `local-${entry.id}`,
              title: entry.title,
              artist: artistName,
              album: albumTitle,
              durationSeconds: entry.durationSeconds || 210,
              provider: 'local-vault',
              transport: 'element-src',
              sourceId: entry.id,
              artworkUrl: entry.albumArt,
            });
            if (!resolved?.url?.trim()) return false;
            envs.push(
              preserveTappedEnvelopeIdentity(
                {
                  envelopeId: `local-${entry.id}`,
                  title: entry.title,
                  artist: artistName,
                  album: albumTitle,
                  url: resolved.url,
                  durationSeconds: entry.durationSeconds || 210,
                  provider: 'local-vault',
                  transport: 'element-src',
                  sourceId: entry.id,
                  artworkUrl: entry.albumArt,
                },
                resolved,
              ),
            );
          }
          await prepareCleanPlaybackStop(() => audio.stop());
          setPlayQueue(envs);
          setQueueIndex(0);
          playQueueRef.current = envs;
          queueIndexRef.current = 0;
          setShuffleOn(false);
          setRepeatMode('none');
          setMixRadioSession(null);
          autoSimilarRadioSeedRef.current = null;
          logLockerQueueInstrumentation('sequence-start', envs[0]?.sourceId, 0, envs);
          const started = await playEnvelopeRef.current(envs[0]!, undefined, {
            autoPlay: true,
            preservePlayQueue: true,
          });
          if (!started) return false;
          await primeLockerNativeQueueFrom(envs, 0);
          await audio.flushNativeExoEnqueueChain();
          const firstStable = await waitForStablePlayback({
            expectedTitle: trackTitles[0]!,
            getProbeTitle: () => audioEnvelopeRef.current?.title,
            getUiPosition: () => audioCurrentTimeRef.current,
            minAdvanceSecs: 2,
            timeoutMs: 90_000,
          });
          if (!firstStable) return false;
          for (let i = 1; i < trackTitles.length; i += 1) {
            const expected = trackTitles[i]!;
            const previous = trackTitles[i - 1]!;
            const transitioned = await waitForTrackTransition({
              expectedTitle: expected,
              previousTitle: previous,
              getProbeTitle: () => audioEnvelopeRef.current?.title,
              timeoutMs: 420_000,
            });
            if (!transitioned) return false;
            const stable = await waitForStablePlayback({
              expectedTitle: expected,
              getProbeTitle: () => audioEnvelopeRef.current?.title,
              getUiPosition: () => audioCurrentTimeRef.current,
              minAdvanceSecs: 2,
              timeoutMs: 120_000,
            });
            if (!stable) return false;
          }
          return true;
        }

        await prepareCleanPlaybackStop(() => audio.stop());
        let playedOk = 0;
        for (let i = 0; i < trackTitles.length; i += 1) {
          const expected = trackTitles[i]!;
          if (i > 0) {
            await prepareCleanPlaybackStop(() => audio.stop());
          }
          const entry = findLockerEntryForTrack(
            expected,
            artistName,
            albumTitle,
            snapshot ?? undefined,
          );
          const env = await resolveLockerEnvelopeForPlayback({
            envelopeId: entry ? `local-${entry.id}` : '',
            title: expected,
            artist: artistName,
            album: albumTitle,
            durationSeconds: entry?.durationSeconds ?? 0,
            sourceId: entry?.id,
          });
          if (!env?.url?.trim()) return false;
          const started = await playEnvelopeRef.current(env, undefined, { autoPlay: true });
          if (!started) return false;
          const stable = await waitForStablePlayback({
            expectedTitle: expected,
            getProbeTitle: () => audioEnvelopeRef.current?.title,
            getUiPosition: () => audioCurrentTimeRef.current,
            minAdvanceSecs: 3,
            timeoutMs: 90_000,
          });
          if (!stable) return false;
          playedOk += 1;
        }
        return playedOk >= trackTitles.length;
      },
      probeLockerArt: async (artistName, trackTitle, albumTitle) => {
        const entry = findLockerEntryForTrack(
          trackTitle,
          artistName,
          albumTitle,
          getLockerEntriesSnapshot() ?? undefined,
        );
        if (!entry) return false;
        const blob = await getLockerArtBlob(entry.id);
        return Boolean(blob && blob.size > 0);
      },
      reconcileFromNativePlayback: () => audio.reconcileFromNativeExo(),
      resetPlaybackState: async () => {
        autoSimilarRadioSeedRef.current = null;
        setMixRadioSession(null);
        setPlayQueue([]);
        setQueueIndex(0);
        setRepeatMode('none');
        setShuffleOn(false);
        clearLastPlayIntent();
        await prepareCleanPlaybackStop(() => audio.stop());
      },
    });
    markE2ePlaybackHandlersLive();
  }, [audio.title, audio.artist, runSearch, downloadTierPreference, navigateSearchQuery, handleThumbUp, handleThumbDown]);

  const podcastResumeAppliedRef = useRef<string | null>(null);
  const podcastAdSkipLastAtRef = useRef(0);
  const podcastSmartSpeedRef = useRef<PodcastSmartSpeedController | null>(null);
  const [podcastPlaybackSpeed, setPodcastPlaybackSpeed] = useState(loadPodcastPlaybackSpeed);
  const [podcastSmartSpeedEnabled, setPodcastSmartSpeedEnabled] = useState(
    loadPodcastSmartSpeedEnabled,
  );
  const [podcastVoiceBoostEnabled, setPodcastVoiceBoostEnabled] = useState(
    loadPodcastVoiceBoostEnabled,
  );
  const [podcastSkipAdChaptersEnabled, setPodcastSkipAdChaptersEnabled] = useState(
    loadPodcastSkipAdChaptersEnabled,
  );
  const [podcastChapters, setPodcastChapters] = useState<PodcastChapter[]>([]);
  const [episodeVolumeBoostDb, setEpisodeVolumeBoostDb] = useState(0);

  useEffect(() => {
    const onSettings = () => {
      setPodcastPlaybackSpeed(loadPodcastPlaybackSpeed());
      setPodcastSmartSpeedEnabled(loadPodcastSmartSpeedEnabled());
      setPodcastVoiceBoostEnabled(loadPodcastVoiceBoostEnabled());
      setPodcastSkipAdChaptersEnabled(loadPodcastSkipAdChaptersEnabled());
    };
    window.addEventListener(PODCAST_SETTINGS_CHANGE_EVENT, onSettings);
    return () => window.removeEventListener(PODCAST_SETTINGS_CHANGE_EVENT, onSettings);
  }, []);

  useEffect(() => {
    podcastSmartSpeedRef.current?.stop();
    podcastSmartSpeedRef.current = null;

    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId) || !podcastSmartSpeedEnabled) {
      return;
    }
    // Native Exo on Android has no Web Audio analyser — Smart Speed rate wobble fights setPlaybackSpeed.
    if (isAndroid() && (audio.nativeExoActive || !audio.getPlaybackLevelAnalyser())) {
      return;
    }
    const playing = audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
    if (!playing) return;

    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;

    podcastSmartSpeedRef.current = startPodcastSmartSpeed({
      episodeId,
      audioUrl: env.url?.trim() ?? '',
      analyser: audio.getPlaybackLevelAnalyser(),
      getUserPlaybackRate: () => loadPodcastPlaybackSpeed(),
      setPlaybackRate: (rate) => audio.setPlaybackRate(rate),
      getCurrentTimeSeconds: () => audio.currentTimeSeconds,
      seek: (seconds) => audio.seek(seconds),
      isPlaying: () => audio.state === 'Playing' || audio.nativeExoEffectivePlaying,
    });

    return () => {
      podcastSmartSpeedRef.current?.stop();
      podcastSmartSpeedRef.current = null;
    };
  }, [
    audio,
    audio.envelope?.envelopeId,
    audio.state,
    audio.nativeExoEffectivePlaying,
    audio.nativeExoActive,
    podcastSmartSpeedEnabled,
  ]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const rate = loadPodcastPlaybackSpeed();
    setPodcastPlaybackSpeed(rate);
    audio.setPlaybackRate(rate);
  }, [audio, audio.envelope?.envelopeId]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) {
      setPodcastChapters([]);
      return;
    }
    const feedId = parsePodcastFeedId(env.envelopeId);
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!feedId || !episodeId) return;
    const ep = findEpisode(feedId, episodeId);
    if (!ep) {
      setPodcastChapters([]);
      return;
    }
    if (ep.chapters?.length) {
      setPodcastChapters(ep.chapters);
      return;
    }
    const feedUrl = findSubscription(feedId)?.feedUrl ?? '';
    let cancelled = false;
    void resolvePodcastChapters(ep, feedUrl).then((chapters) => {
      if (cancelled) return;
      setPodcastChapters(chapters);
      if (chapters.length > 0) updateEpisodeChapters(feedId, episodeId, chapters);
    });
    return () => {
      cancelled = true;
    };
  }, [audio.envelope?.envelopeId]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) {
      setEpisodeVolumeBoostDb(0);
      return;
    }
    const feedId = parsePodcastFeedId(env.envelopeId);
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    setPodcastVoiceBoostEnabled(resolveVoiceBoostEnabled(feedId));
    setEpisodeVolumeBoostDb(episodeId ? loadEpisodeVolumeBoostDb(episodeId) : 0);
    audio.refreshPodcastPlaybackChain();
  }, [audio, audio.envelope?.envelopeId]);

  useEffect(() => {
    const onPodcasts = () => {
      const env = audio.envelope;
      if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
      const feedId = parsePodcastFeedId(env.envelopeId);
      setPodcastVoiceBoostEnabled(resolveVoiceBoostEnabled(feedId));
      audio.refreshPodcastPlaybackChain();
    };
    window.addEventListener(PODCASTS_CHANGE_EVENT, onPodcasts);
    return () => window.removeEventListener(PODCASTS_CHANGE_EVENT, onPodcasts);
  }, [audio]);

  const handleCyclePodcastSpeed = useCallback(() => {
    const next = cyclePodcastPlaybackSpeed(podcastPlaybackSpeed);
    setPodcastPlaybackSpeed(next);
    audio.setPlaybackRate(next);
  }, [audio, podcastPlaybackSpeed]);

  const handleTogglePodcastSmartSpeed = useCallback(() => {
    const next = !loadPodcastSmartSpeedEnabled();
    savePodcastSmartSpeedEnabled(next);
    setPodcastSmartSpeedEnabled(next);
  }, []);

  const handleTogglePodcastSkipAdChapters = useCallback(() => {
    const next = !loadPodcastSkipAdChaptersEnabled();
    savePodcastSkipAdChaptersEnabled(next);
    setPodcastSkipAdChaptersEnabled(next);
  }, []);

  const handleTogglePodcastVoiceBoost = useCallback(() => {
    const env = audio.envelope;
    const feedId = env ? parsePodcastFeedId(env.envelopeId) : null;
    const current = feedId
      ? resolveVoiceBoostEnabled(feedId)
      : loadPodcastVoiceBoostEnabled();
    const next = !current;
    if (feedId && findSubscription(feedId)?.voiceBoostDefault !== undefined) {
      updateSubscriptionMeta(feedId, { voiceBoostDefault: next });
      void syncPodcastRulesToTier34();
    } else {
      savePodcastVoiceBoostEnabled(next);
    }
    setPodcastVoiceBoostEnabled(next);
    audio.refreshPodcastPlaybackChain();
  }, [audio]);

  const handleCycleEpisodeVolumeBoost = useCallback(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;
    const next = cycleEpisodeVolumeBoostDb(episodeId);
    setEpisodeVolumeBoostDb(next);
    audio.applyPodcastEpisodeVolumeBoostDb(next);
  }, [audio]);

  const handlePodcastPrevChapter = useCallback(() => {
    audio.seek(seekSecondsForPreviousChapter(podcastChapters, audio.currentTimeSeconds));
  }, [audio, podcastChapters]);

  const handlePodcastNextChapter = useCallback(() => {
    const sec = seekSecondsForNextChapter(podcastChapters, audio.currentTimeSeconds);
    if (sec != null) audio.seek(sec);
  }, [audio, podcastChapters]);

  const handleSkipPodcastAd = useCallback(() => {
    const duration =
      audio.streamDurationSeconds ||
      audio.durationSeconds ||
      audio.envelope?.durationSeconds ||
      0;
    const target = seekTargetForManualAdSkip(
      podcastChapters,
      audio.currentTimeSeconds,
      duration > 0 ? duration : undefined,
    );
    audio.seek(target);
  }, [audio, podcastChapters]);

  const podcastSkipAdHint = useMemo(
    () => manualAdSkipHint(podcastChapters, audio.currentTimeSeconds),
    [podcastChapters, audio.currentTimeSeconds],
  );

  useEffect(() => {
    if (!podcastSkipAdChaptersEnabled || podcastChapters.length === 0) return;
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const playing = audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
    if (!playing) return;

    const target = seekTargetAfterAdChapter(podcastChapters, audio.currentTimeSeconds);
    if (target == null) return;

    const now = performance.now();
    if (now - podcastAdSkipLastAtRef.current < 800) return;
    podcastAdSkipLastAtRef.current = now;
    audio.seek(target);
  }, [
    audio,
    audio.currentTimeSeconds,
    audio.envelope?.envelopeId,
    audio.state,
    audio.nativeExoEffectivePlaying,
    podcastChapters,
    podcastSkipAdChaptersEnabled,
  ]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) {
      podcastResumeAppliedRef.current = null;
      return;
    }
    if (audio.state !== 'Ready' && audio.state !== 'Playing') return;
    if (podcastResumeAppliedRef.current === env.envelopeId) return;
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;
    const pos = getEpisodeResumePosition(episodeId);
    if (pos > 3) audio.seek(pos);
    podcastResumeAppliedRef.current = env.envelopeId;
  }, [audio, audio.state, audio.envelope?.envelopeId]);

  useEffect(() => {
    const env = audio.envelope;
    if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
    const episodeId = parsePodcastEpisodeId(env.envelopeId);
    if (!episodeId) return;
    const save = () => {
      const episodeIdInner = parsePodcastEpisodeId(audio.envelope?.envelopeId ?? '');
      if (!episodeIdInner) return;
      if (audio.state === 'Playing' || audio.state === 'Ready') {
        const pos = audioCurrentTimeRef.current;
        const dur =
          audio.streamDurationSeconds ||
          audio.durationSeconds ||
          audio.envelope?.durationSeconds ||
          0;
        if (maybeAutoCompleteEpisode(episodeIdInner, pos, dur)) return;
        saveEpisodeResumePosition(episodeIdInner, pos);
      }
    };
    const interval = window.setInterval(save, 5000);
    return () => {
      clearInterval(interval);
      save();
    };
  }, [audio.envelope?.envelopeId, audio.state, audio]);

  useEffect(() => {
    return audio.subscribeEnded(() => {
      const env = audioEnvelopeRef.current;
      if (!env || !isPodcastEnvelopeId(env.envelopeId)) return;
      const episodeId = parsePodcastEpisodeId(env.envelopeId);
      if (episodeId) markEpisodeCompleted(episodeId);
    });
  }, [audio]);

  useEffect(() => subscribeCastSession(setCastMode), []);

  useEffect(() => subscribeCastState(setSpeakerCast), []);

  const wasCastingRef = useRef(false);
  useEffect(() => {
    if (wasCastingRef.current && !speakerCast.isActive && audio.envelope) {
      void audio.play();
    }
    wasCastingRef.current = speakerCast.isActive;
  }, [speakerCast.isActive, audio]);

  useEffect(() => {
    if (!loadAutoCastEnabled()) return;
    const device = loadDefaultCastDevice();
    if (!device || isSpeakerCastActive()) return;
    const env = audio.envelope;
    if (!env) return;
    void startCastToDevice(device, env, {
      title: audio.title,
      artist: audio.artist,
      artworkUrl: artworkUrl || env.artworkUrl,
      isPlaying: audio.state === 'Playing',
      currentTimeSeconds: audio.currentTimeSeconds,
      durationSeconds: audio.durationSeconds,
    });
  }, []);

  useEffect(() => {
    if (!speakerCast.isActive || !audio.envelope) return;
    if (speakerCast.deviceType !== 'remote_cast') {
      if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) audio.pause();
    }
    void syncCastEnvelope(
      audio.envelope,
      {
        title: audio.title,
        artist: audio.artist,
        artworkUrl: artworkUrl || audio.envelope.artworkUrl,
        isPlaying: audio.state === 'Playing',
        currentTimeSeconds: audioCurrentTimeRef.current,
        durationSeconds: audio.durationSeconds,
      },
      speakerCast.deviceType === 'remote_cast' && playQueue.length > 0
        ? { queue: playQueue, index: queueIndex }
        : undefined,
    );
  }, [
    speakerCast.isActive,
    speakerCast.deviceType,
    audio.envelope,
    audio.envelope?.envelopeId,
    audio.envelope?.url,
    audio.envelope?.sourceId,
    audio.title,
    audio.artist,
    audio.state,
    audio.durationSeconds,
    artworkUrl,
    playQueue,
    queueIndex,
  ]);

  useEffect(() => {
    if (!speakerCast.isActive || audio.state !== 'Playing') return;
    const id = window.setInterval(() => {
      if (!audio.envelope) return;
      void syncCastEnvelope(
        audio.envelope,
        {
          title: audio.title,
          artist: audio.artist,
          artworkUrl: artworkUrl || audio.envelope.artworkUrl,
          isPlaying: true,
          currentTimeSeconds: audioCurrentTimeRef.current,
          durationSeconds: audio.durationSeconds,
        },
        speakerCast.deviceType === 'remote_cast' && playQueue.length > 0
          ? { queue: playQueue, index: queueIndex }
          : undefined,
      );
    }, 1500);
    return () => window.clearInterval(id);
  }, [
    speakerCast.isActive,
    speakerCast.deviceType,
    audio.state,
    audio.envelope?.envelopeId,
    audio.title,
    audio.artist,
    audio.durationSeconds,
    artworkUrl,
    playQueue,
    queueIndex,
  ]);

  useEffect(() => {
    let cancelled = false;
    const publish = () => {
      void (async () => {
        const resolvedUrl = await resolveCastStreamUrl(audio.envelope ?? null);
        if (cancelled) return;
        publishCinemaCast({
          title: audio.title || 'Sovereign Music Console',
          artist: audio.artist || 'Ready to cast',
          albumArt: artworkUrl || audio.envelope?.artworkUrl,
          isPlaying: audio.state === 'Playing',
          currentTimeSeconds: audioCurrentTimeRef.current,
          durationSeconds: audio.durationSeconds,
          fidelity: loadFidelityPolicy(),
          streamUrl: resolvedUrl ?? undefined,
        });
      })();
    };
    publish();
    const intervalId =
      audio.state === 'Playing' ? window.setInterval(publish, 1500) : undefined;
    return () => {
      cancelled = true;
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, [
    audio.title,
    audio.artist,
    audio.state,
    audio.durationSeconds,
    audio.envelope,
    audio.envelope?.url,
    audio.envelope?.artworkUrl,
    audio.envelope?.provider,
    audio.envelope?.sourceId,
    audio.envelope?.envelopeId,
    artworkUrl,
  ]);

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
    // Prefetch upcoming tracks while loading or playing — don't wait for Playing only
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
        const idx = await findQueueIndexForExoUrl(queue, detail.url);
        if (idx < 0) return;
        const track = queue[idx];
        if (!track) return;
        if (track.envelopeId === audioEnvelopeRef.current?.envelopeId) return;
        exoGaplessTransitionAtRef.current = Date.now();
        setQueueIndex(idx);
        syncThumbsFromFeedback(track.envelopeId);
        adoptInPlaceQueueTrack(track, 0);
        trackReachedPlayingRef.current = true;
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

  const queueRestoredRef = useRef(false);
  const queueRestorePendingRef = useRef<{ seekTo: number } | null>(null);
  const [queuePersistReady, setQueuePersistReady] = useState(false);

  useEffect(() => {
    if (queueRestoredRef.current) return;
    if (resolveConnectRole(loadConnectRolePref()) === 'remote' && loadNetworkSyncEnabled()) {
      queueRestoredRef.current = true;
      setQueuePersistReady(true);
      return;
    }

    let cancelled = false;

    const lockerEnvelopesFromSnapshot = (): MediaEnvelope[] => {
      const entries = getLockerEntriesSnapshot();
      if (!entries?.length) return [];
      return entries.map((e) => ({
        envelopeId: `local-${e.id}`,
        title: e.title,
        artist: e.artist,
        album: e.albumName,
        url: e.url,
        durationSeconds: e.durationSeconds || 210,
        provider: 'local-vault' as const,
        transport: 'element-src' as const,
        sourceId: e.id,
        artworkUrl: e.albumArt,
        releaseYear: e.releaseYear,
      }));
    };

    const attemptRestore = async () => {
      try {
        await warmLockerCache();
        if (cancelled || queueRestoredRef.current) return;

        const raw = loadQueueState();
        if (!raw) {
          if (shouldRestoreLastPlayIntentOnLoad()) {
            const intent = loadLastPlayIntent();
            if (intent) {
              queueRestoredRef.current = true;
              const env = lastPlayIntentToEnvelope(intent);
              queueRestorePendingRef.current = { seekTo: 0 };
              setHomeAwaitingUserResume(false);
              void playEnvelopeRef.current(env, findHitCandidates(env), { autoPlay: false });
              return;
            }
          }
          queueRestoredRef.current = true;
          return;
        }

        const restored = rehydrateQueueState(raw, {
          lockerEnvelopes: lockerEnvelopesFromSnapshot(),
          playHistory: getAllPlayHistory(),
        });
        if (!restored || cancelled) {
          queueRestoredRef.current = true;
          return;
        }

        queueRestoredRef.current = true;
        setPlayQueue(restored.playQueue);
        setQueueIndex(restored.queueIndex);
        setShuffleOn(restored.shuffleOn);
        setRepeatMode(restored.repeatMode);

        if (!shouldAutoRestorePlayerOnLoad(raw)) {
          if (
            shouldSkipPlayerRestoreOnLoad() &&
            audioStateRef.current === 'Idle' &&
            !audioEnvelopeRef.current
          ) {
            let nativeStillPlaying = false;
            try {
              const status = await nativeExoPlaybackStatus();
              nativeStillPlaying = isNativeExoAudible(status);
            } catch {
              /* optional */
            }
            if (!nativeStillPlaying) {
              bumpPlayGeneration();
              playGenerationRef.current = currentPlayGeneration();
              audio.stop();
            }
          }
          return;
        }

        const track = restored.currentTrackId
          ? restored.playQueue.find((e) => e.envelopeId === restored.currentTrackId) ??
            restored.playQueue[restored.queueIndex]
          : restored.playQueue[restored.queueIndex];
        if (!track) return;

        queueRestorePendingRef.current = {
          seekTo: restored.currentTimeSeconds,
        };
        setHomeAwaitingUserResume(false);
        void playEnvelopeRef.current(track, findHitCandidates(track), { autoPlay: false });
      } catch (err) {
        console.warn('[Sandbox] queue restore failed:', err);
        queueRestoredRef.current = true;
      } finally {
        if (!cancelled) setQueuePersistReady(true);
      }
    };

    void attemptRestore();
    return () => {
      cancelled = true;
    };
  }, [findHitCandidates]);

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

  // Stable callbacks via refs — must NOT depend on audio.play (recreated on
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


  const failedPlaybackToastGenRef = useRef<number | null>(null);

  useEffect(() => {
    const onPlaybackError = (event: Event) => {
      const detail = (event as CustomEvent<{ envelopeId?: string }>).detail;
      const envId = detail?.envelopeId ?? audioEnvelopeRef.current?.envelopeId;
      if (envId && isPodcastEnvelopeId(envId)) return;
      const gen = currentPlayGeneration();
      if (failedPlaybackToastGenRef.current === gen) return;
      failedPlaybackToastGenRef.current = gen;
      showAppToast(t('artist.playbackExoFailed'), 3800);
    };
    window.addEventListener('sandbox-playback-error', onPlaybackError);
    return () => window.removeEventListener('sandbox-playback-error', onPlaybackError);
  }, [showAppToast, t]);

  useEffect(() => {
    if (audio.state !== 'Failed' || !audio.envelope) return;
    const gen = currentPlayGeneration();
    const env = audio.envelope;
    const savedPos = audioCurrentTimeRef.current;
    let cancelled = false;

    const showFailedToastOnce = () => {
      if (failedPlaybackToastGenRef.current === gen) return;
      failedPlaybackToastGenRef.current = gen;
      if (isPodcastEnvelopeId(env.envelopeId)) {
        showAppToast(
          t('player.podcastMissingAudio', {
            defaultValue:
              'Podcast playback failed — open the show and pull to refresh the feed',
          }),
          3800,
        );
        setMobilePlayerPending(false);
        return;
      }
      const base = getTier34BaseUrl().trim();
      const mobileActive = hasActiveMobileResolvers();
      const catalogTrack = catalogTrackIdFromEnvelope(env);
      const needsServer =
        env.provider !== 'local-vault' &&
        env.provider !== 'stream-cache' &&
        env.provider !== 'indexeddb' &&
        env.provider !== 'blob';
      if (mobileActive) {
        const mobileErr = getLastMobileResolveError();
        showAppToast(
          mobileErr
            ? `Playback failed: ${formatMobilePlaybackError(mobileErr)}`
            : t('artist.playbackExoFailed'),
          3800,
        );
      } else if (catalogTrack && needsServer) {
        showAppToast(t('artist.playbackSandboxRequired'), 3800);
      } else if (!base && needsServer) {
        showAppToast(t('artist.playbackSandboxRequired'), 3800);
      } else if (!isTier34ReachableCached()) {
        showAppToast(t('artist.playbackSandboxRequired'), 3800);
      } else {
        showAppToast(t('artist.playbackUnavailable'), 3800);
      }
      setMobilePlayerPending(false);
    };

    const seekAfterHealIfNeeded = () => {
      if (savedPos <= 1.5) return;
      window.setTimeout(() => {
        if (cancelled) return;
        if (audioStateRef.current === 'Failed' || audioStateRef.current === 'Idle') return;
        audio.seek(savedPos);
      }, 1200);
    };

    void (async () => {
      try {
        audio.primePlaybackGesture();
        await audio.play();
        if (cancelled || audioStateRef.current !== 'Failed') return;

        const healAction = resolveHealAction(env, healAttemptRef.current, {
          mobileResolverActive: hasActiveMobileResolvers(),
        });
        if (healAction.kind === 'fail') {
          showFailedToastOnce();
          audio.stop();
          return;
        }
        healAttemptRef.current = buildHealAttemptKey(env);
        if (healAction.kind === 'mobile-re-resolve') {
          ensureYtDlpMobileReady();
          const retryEnv: MediaEnvelope = { ...env, url: '' };
          await handlePlayEnvelope(retryEnv, findHitCandidates(env));
          seekAfterHealIfNeeded();
          if (cancelled || audioStateRef.current !== 'Failed') return;
          showFailedToastOnce();
          audio.stop();
          return;
        }
        if (healAction.kind === 'local-refresh') {
          const freshUrl = await refreshLockerEntryPlayUrl(healAction.sourceId);
          if (cancelled) return;
          if (freshUrl) {
            await handlePlayEnvelope({ ...env, url: freshUrl });
            seekAfterHealIfNeeded();
          } else if (await attemptDeadLockerReacquire(env.title, env.artist, env.album)) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                defaultValue: `Re-downloading "${env.title}"…`,
              }),
              5000,
            );
          } else {
            showFailedToastOnce();
            audio.stop();
          }
          return;
        }
        if (healAction.kind === 'podcast-retry') {
          healAttemptRef.current = buildHealAttemptKey(env);
          try {
            const playable = await resolvePodcastEnvelopeForPlayback(env);
            if (cancelled) return;
            await handlePlayEnvelope(playable);
            seekAfterHealIfNeeded();
            if (cancelled || audioStateRef.current !== 'Failed') return;
          } catch (err) {
            console.warn('[sandboxLayer3] podcast heal failed:', err);
          }
          showFailedToastOnce();
          audio.stop();
          return;
        }
        if (healAction.kind === 'tier34-heal') {
          const healed = await tier34HealDeadSource(env);
          if (cancelled) return;
          if (healed?.url) {
            await handlePlayEnvelope(healed, findHitCandidates(healed));
            seekAfterHealIfNeeded();
          } else {
            showFailedToastOnce();
            audio.stop();
          }
          return;
        }
        showFailedToastOnce();
        audio.stop();
      } catch (err) {
        console.warn('[sandboxLayer3] playback heal failed:', err);
        if (!cancelled) {
          showFailedToastOnce();
          audio.stop();
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [audio.state, audio.envelope, handlePlayEnvelope, findHitCandidates, showAppToast, t, audio]);

  /** Re-resolve when Exo hits end-of-stream but catalog duration says the track continues. */
  useEffect(() => {
    let cancelled = false;
    const onTruncated = (event: Event) => {
      const detail = (event as CustomEvent<{ positionSecs: number; streamDurSecs: number; catalogDurSecs: number }>).detail;
      const env = audioEnvelopeRef.current;
      if (!env || env.provider === 'local-vault') return;
      const healKey = `truncated:${env.envelopeId}`;
      if (healAttemptRef.current === healKey) return;
      healAttemptRef.current = healKey;
      const savedPos = Math.max(0, detail?.positionSecs ?? audioCurrentTimeRef.current);
      void (async () => {
        const healed = await tier34HealDeadSource(env);
        if (cancelled) return;
        const playable = healed?.url ? healed : env;
        await handlePlayEnvelope(playable, findHitCandidates(playable));
        if (savedPos > 1.5) {
          window.setTimeout(() => {
            if (cancelled) return;
            audio.seek(savedPos);
          }, 800);
        }
      })();
    };
    window.addEventListener('sandbox-playback-truncated', onTruncated);
    return () => {
      cancelled = true;
      window.removeEventListener('sandbox-playback-truncated', onTruncated);
    };
  }, [audio, handlePlayEnvelope, findHitCandidates]);

  useEffect(() => {
    if (audio.state !== 'Resolving' && audio.state !== 'Connecting') return;
    const envelopeId = audio.envelope?.envelopeId ?? '';
    const stuckState = audio.state;
    const timeoutMs =
      stuckState === 'Resolving'
        ? PLAYBACK_RESOLVE_STUCK_TIMEOUT_MS
        : PLAYBACK_CONNECT_STUCK_TIMEOUT_MS;
    const generation = currentPlayGeneration();
    const timer = window.setTimeout(() => {
      if (currentPlayGeneration() !== generation) return;
      if (audioStateRef.current !== stuckState) return;
      console.warn('[playback] playback stuck timed out for', envelopeId, stuckState);
      bumpPlayGeneration();
      playGenerationRef.current = currentPlayGeneration();
      audio.failResolve();
      setMobilePlayerPending(false);
      showAppToast(t('player.resolveTimedOut'), 3800);
    }, timeoutMs);
    return () => window.clearTimeout(timer);
  }, [audio.state, audio.envelope?.envelopeId, audio, showAppToast, t]);

  const handleDismissStuckPlayback = useCallback(() => {
    bumpPlayGeneration();
    playGenerationRef.current = currentPlayGeneration();
    setMobilePlayerPending(false);
    audio.failResolve();
  }, [audio]);

  useEffect(() => {
    const pending = queueRestorePendingRef.current;
    if (!pending) return;
    if (audio.state === 'Failed') {
      queueRestorePendingRef.current = null;
      return;
    }
    if (audio.state !== 'Ready' && audio.state !== 'Playing') return;

    const { seekTo } = pending;
    queueRestorePendingRef.current = null;

    if (seekTo > 0) audio.seek(seekTo);
    if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) audio.pause();
  }, [audio.state, audio.envelope?.envelopeId, audio]);

  useEffect(() => {
    return initQueuePersistenceLifecycle(() => {
      if (isConnectRemoteRef.current) return null;
      return {
        playQueue: playQueueRef.current,
        queueIndex: queueIndexRef.current,
        shuffleOn: shuffleOnRef.current,
        repeatMode: repeatModeRef.current,
        currentTrackId: persistableCurrentTrackId(
          audioEnvelopeRef.current?.envelopeId,
          audioStateRef.current,
        ),
        currentTimeSeconds: audioCurrentTimeRef.current,
        wasPlaying: audioStateRef.current === 'Playing',
      };
    });
  }, []);

  useEffect(() => {
    if (!queuePersistReady || isConnectRemoteRef.current) return;
    saveQueueState({
      playQueue,
      queueIndex,
      shuffleOn,
      repeatMode,
      currentTrackId: persistableCurrentTrackId(audio.envelope?.envelopeId, audio.state),
      currentTimeSeconds: audio.currentTimeSeconds,
      wasPlaying: audio.state === 'Playing',
    });
  }, [
    queuePersistReady,
    playQueue,
    queueIndex,
    shuffleOn,
    repeatMode,
    audio.envelope?.envelopeId,
    audio.currentTimeSeconds,
    audio.state,
  ]);

  useEffect(() => {
    if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) {
      trackReachedPlayingRef.current = true;
    }
  }, [audio.state, audio.nativeExoEffectivePlaying]);

  useEffect(() => {
    return audio.subscribeEnded(() => {
      const handled = handleSleepTimerTrackEnd({
        queueLength: playQueueRef.current.length,
        queueIndex: queueIndexRef.current,
        repeatMode: repeatModeRef.current,
      });
      if (handled) return;

      if (
        !trackPlaybackMatureForAdvance({
          reachedPlaying: trackReachedPlayingRef.current,
          peakSeconds: sessionPeakSecondsRef.current,
          currentSeconds: audioCurrentTimeRef.current,
        })
      ) {
        return;
      }
      trackReachedPlayingRef.current = false;
      const seamless = resolveNativeExoTransitionPrefs().gapless;
      const endedEnvForSuppress = audioEnvelopeRef.current;
      if (
        shouldSuppressJsAdvanceAfterNativeGapless({
          seamless,
          gaplessTransitionAtMs: exoGaplessTransitionAtRef.current,
          endedEnvelopeId: endedEnvForSuppress?.envelopeId,
          queueIndex: queueIndexRef.current,
          playQueue: playQueueRef.current,
        })
      ) {
        return;
      }
      const env = audioEnvelopeRef.current;
      if (repeatModeRef.current === 'one' && env) {
        void playEnvelopeRef.current(env, findHitCandidates(env));
        return;
      }
      const q = playQueueRef.current;
      const upNextSettings = loadSovereignUpNextSettings();
      const endedEnv = audioEnvelopeRef.current;
      if (
        upNextSettings.enabled &&
        endedEnv &&
        isPodcastEnvelopeId(endedEnv.envelopeId)
      ) {
        sovereignUpNextPodcastCountRef.current += 1;
        if (
          shouldStopUpNextAfterPodcast(
            upNextSettings,
            sovereignUpNextPodcastCountRef.current,
            endedEnv,
          )
        ) {
          showAppToast(
            t('player.sovereignUpNext.stoppedAfterN', {
              count: upNextSettings.stopAfterEpisodes,
            }),
          );
          return;
        }
      }
      const advance = computeNextQueueIndexWithUpNext({
        queueIndex: queueIndexRef.current,
        queueLength: q.length,
        repeatMode: repeatModeRef.current,
        shuffleOn: shuffleOnRef.current,
        queue: q,
        settings: upNextSettings,
      });
      if (advance.action === 'none') {
        const mixExtend = tryExtendMixRadioQueue({
          mixSession: mixRadioSessionRef.current,
          current: audioEnvelopeRef.current,
          queue: q,
          buildContinuation: (seed, exclude, count) =>
            buildDiscoveryMixContinuation(
              mixRadioSessionRef.current ?? { kind: 'radio', seedTitle: '', seedArtist: '' },
              seed,
              exclude,
              count,
            ),
        });
        if (mixExtend.action === 'extend') {
          const base = playQueueRef.current;
          setPlayQueue([...base, ...mixExtend.tracks]);
          setQueueIndex(mixExtend.startIndex);
          void playEnvelopeRef.current(
            mixExtend.tracks[0]!,
            findHitCandidates(mixExtend.tracks[0]!),
            { seamless },
          );
          return;
        }
        // Lone single dead-end: build Track radio playlist + continue into next song.
        const ended = audioEnvelopeRef.current;
        if (ended && !isPodcastEnvelopeId(ended.envelopeId)) {
          void startAutoSimilarRadioIfNeeded(
            {
              envelope: ended,
              playQueue: playQueueRef.current,
              searchHits: searchHitsRef.current,
              seedSearchQueue: true,
              hasMixRadioSession: false,
            },
            {
              setPlayQueue,
              setQueueIndex,
              setMixRadioSession,
              setRepeatMode,
              setShuffleOn,
              isStillCurrent: () => audioEnvelopeRef.current?.envelopeId === ended.envelopeId,
              labelFor: (key) =>
                key === 'unknownTitle' ? t('player.unknownTitle') : t('player.unknownArtist'),
              persistRadioPlaylist: true,
            },
          ).then((result) => {
            if (!result.started) return;
            autoSimilarRadioSeedRef.current = ended.envelopeId;
            const q2 = result.queue;
            const nextIdx = q2.findIndex((tr) => tr.envelopeId === ended.envelopeId);
            const playIdx = nextIdx >= 0 && nextIdx + 1 < q2.length ? nextIdx + 1 : 1;
            const nextTrack = q2[playIdx];
            if (nextTrack && nextTrack.envelopeId !== ended.envelopeId) {
              setQueueIndex(playIdx);
              void playEnvelopeRef.current(nextTrack, findHitCandidates(nextTrack), {
                seamless,
              }).then((started) => {
                if (started) void primeLockerNativeQueueFrom(q2, playIdx);
              });
            }
          });
        }
        return;
      }
      if (advance.action === 'repeat-one' && env) {
        void playEnvelopeRef.current(env, findHitCandidates(env));
        return;
      }
      const next =
        advance.action === 'wrap' || advance.action === 'advance' ? advance.index : 0;
      setQueueIndex(next);
      const track = q[next];
      if (track && !isPodcastEnvelopeId(track.envelopeId)) {
        sovereignUpNextPodcastCountRef.current = 0;
      }
      if (track) {
        const currentUrl = audioEnvelopeRef.current?.url?.trim() ?? '';
        const inPlaceSeek = tryQueueInPlaceSeek({
          playQueue: q,
          queueIndex: queueIndexRef.current,
          targetQueueIdx: next,
          currentUrl,
          streamDurationSeconds: audioStreamDurationRef.current,
          envelopeDurationSeconds: audioDurationRef.current,
        });
        if (currentUrl && inPlaceSeek != null && !(inPlaceSeek < 0.25 && next > 0)) {
          setQueueIndex(next);
          syncThumbsFromFeedback(track.envelopeId);
          adoptInPlaceQueueTrack(track, inPlaceSeek);
          trackReachedPlayingRef.current = true;
          void primeLockerNativeQueueFrom(q, next);
          return;
        }
        void playEnvelopeRef.current(track, findHitCandidates(track), {
          seamless,
          preservePlayQueue: true,
        }).then((started) => {
          if (started) void primeLockerNativeQueueFrom(q, next);
        });
      }
    });
  }, [audio, findHitCandidates, showAppToast, t, adoptInPlaceQueueTrack, primeLockerNativeQueueFrom]);

  const handleAddToQueue = useCallback((tracks: MediaEnvelope[]) => {
    if (tracks.length === 0) return;
    if (isConnectRemoteRef.current) {
      for (const env of tracks) {
        sendConnectCommand({ cmd: 'ADD_TO_QUEUE', envelopeId: env.envelopeId });
      }
      return;
    }
    setPlayQueue((q) =>
      mergeIntoUpNextQueue(q, queueIndex, tracks, loadSovereignUpNextSettings()),
    );
  }, [sendConnectCommand, queueIndex]);

  const handleRemoveFromQueue = useCallback(
    (index: number) => {
      if (isConnectRemoteRef.current) {
        sendConnectCommand({ cmd: 'REMOVE_QUEUE_ITEM', index });
        return;
      }
      setPlayQueue((q) => {
        if (index < 0 || index >= q.length) return q;
        const filtered = q.filter((_, i) => i !== index);
        if (index === queueIndex) {
          if (filtered.length === 0) {
            setQueueIndex(0);
          } else {
            const nextIdx = Math.min(index, filtered.length - 1);
            setQueueIndex(nextIdx);
            const track = filtered[nextIdx];
            void handlePlayEnvelope(track, findHitCandidates(track));
          }
        } else if (index < queueIndex) {
          setQueueIndex((i) => Math.max(0, i - 1));
        }
        return filtered;
      });
    },
    [queueIndex, handlePlayEnvelope, findHitCandidates, sendConnectCommand],
  );

  const handleReorderUpNext = useCallback((fromRel: number, toRel: number) => {
    if (fromRel === toRel) return;
    if (isConnectRemoteRef.current) {
      const fromIndex = queueIndex + 1 + fromRel;
      const toIndex = queueIndex + 1 + toRel;
      sendConnectCommand({ cmd: 'REORDER_QUEUE', fromIndex, toIndex });
      return;
    }
    setPlayQueue((q) => {
      const start = queueIndex + 1;
      const tail = q.slice(start);
      if (fromRel < 0 || fromRel >= tail.length || toRel < 0 || toRel >= tail.length) {
        return q;
      }
      const reordered = [...tail];
      const [moved] = reordered.splice(fromRel, 1);
      reordered.splice(toRel, 0, moved);
      return [...q.slice(0, start), ...reordered];
    });
  }, [queueIndex, sendConnectCommand]);

  const handleReorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'REORDER_QUEUE', fromIndex, toIndex });
      return;
    }
    setPlayQueue((q) => {
      if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length) return q;
      const next = [...q];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setQueueIndex((qi) => {
      if (qi === fromIndex) return toIndex;
      if (fromIndex < qi && toIndex >= qi) return qi - 1;
      if (fromIndex > qi && toIndex <= qi) return qi + 1;
      return qi;
    });
  }, [sendConnectCommand]);

  const handleClearQueue = useCallback(() => {
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'CLEAR_QUEUE' });
      return;
    }
    setPlayQueue([]);
    setQueueIndex(0);
    setMixRadioSession(null);
    autoSimilarRadioSeedRef.current = null;
    sovereignUpNextPodcastCountRef.current = 0;
    clearPersistedQueue();
  }, [sendConnectCommand]);

  const handleSaveQueueAsPlaylist = useCallback(
    (name: string) => {
      if (playQueue.length === 0) return;
      createPlaylistWithTracks(name, playQueue, 'Saved from play queue');
    },
    [playQueue],
  );

  const recentPlayHistory = useMemo(
    () => getRecentlyPlayed(5),
    [audio.envelope?.envelopeId, audio.state, playQueue.length],
  );

  const handlePlayNext = useCallback(
    (tracks: MediaEnvelope[]) => {
      if (tracks.length === 0) return;
      if (isConnectRemoteRef.current) {
        for (const env of tracks) {
          sendConnectCommand({ cmd: 'ADD_TO_QUEUE', envelopeId: env.envelopeId });
        }
        return;
      }
      setPlayQueue((q) =>
        mergeIntoUpNextQueue(
          q,
          queueIndex,
          tracks,
          loadSovereignUpNextSettings(),
          'play-next',
        ),
      );
    },
    [queueIndex, sendConnectCommand],
  );

  const handleQueueShowUnplayed = useCallback(
    (feedId: string) => {
      const settings = loadSovereignUpNextSettings();
      const tracks = buildPodcastQueueForFeed(feedId, {
        unplayedOnly: true,
        newestFirst: settings.insertNewestAtTop,
      });
      if (tracks.length === 0) {
        showAppToast('No unplayed episodes in this show.');
        return;
      }
      handleAddToQueue(tracks);
      showAppToast(t('player.sovereignUpNext.queuedUnplayed', { count: tracks.length }));
    },
    [handleAddToQueue, showAppToast, t],
  );

  const handlePlayAlbum = useCallback(
    async (
      tracks: MediaEnvelope[],
      shuffle?: boolean,
      options?: { fromMixRadio?: MixRadioSession },
    ) => {
      if (tracks.length === 0) return;
      if (!options?.fromMixRadio) {
        setMixRadioSession(null);
        autoSimilarRadioSeedRef.current = null;
      }
      if (isConnectRemoteRef.current) {
        const ordered = shuffle
          ? [...tracks].sort(() => Math.random() - 0.5)
          : [...tracks];
        const first = ordered[0];
        if (first) sendConnectCommand({ cmd: 'PLAY', envelopeId: first.envelopeId });
        for (let i = 1; i < ordered.length; i++) {
          sendConnectCommand({ cmd: 'ADD_TO_QUEUE', envelopeId: ordered[i].envelopeId });
        }
        if (options?.fromMixRadio) setMixRadioSession(options.fromMixRadio);
        return;
      }
      const ordered = shuffle
        ? [...tracks].sort(() => Math.random() - 0.5)
        : [...tracks];
      setPlayQueue(ordered);
      setQueueIndex(0);
      playQueueRef.current = ordered;
      queueIndexRef.current = 0;
      if (ordered.length > 1) {
        setRepeatMode((mode) => (mode === 'one' ? 'none' : mode));
      }
      if (options?.fromMixRadio) setMixRadioSession(options.fromMixRadio);
      const first = ordered[0];
      const primePromise = primeLockerNativeQueueFrom(ordered, 0);
      const started = await handlePlayEnvelope(first, findHitCandidates(first));
      await primePromise;
      if (started && ordered.length > 1) {
        await primeLockerNativeQueueFrom(ordered, 0);
      }
    },
    [handlePlayEnvelope, findHitCandidates, sendConnectCommand, primeLockerNativeQueueFrom],
  );

  const handleExploreInstantMix = useCallback(
    (tracks: MediaEnvelope[], label: string) => {
      if (tracks.length === 0) return;
      handlePlayAlbum(tracks, false, {
        fromMixRadio: {
          kind: 'radio',
          seedTitle: label,
          seedArtist: 'Explore mix',
        },
      });
    },
    [handlePlayAlbum],
  );

  const handlePlayDiscoveryMix = useCallback(
    (tracks: MediaEnvelope[], mix: DiscoveryMix) => {
      if (tracks.length === 0) return;
      const ordered = prepareDiscoveryMixQueue(mix, tracks);
      setRepeatMode('all');
      setShuffleOn(false);
      handlePlayAlbum(ordered, false, { fromMixRadio: discoveryMixRadioSession(mix) });
    },
    [handlePlayAlbum],
  );

  const handleSaveInstantPlaylist = useCallback(
    (tracks: MediaEnvelope[], name: string) => {
      if (tracks.length === 0) return;
      createPlaylistWithTracks(name.trim() || 'Explore mix', tracks, 'Instant explore mix');
      showAppToast(`Saved "${name.trim() || 'Explore mix'}"`);
      goToDiscover('playlists');
    },
    [goToDiscover, showAppToast],
  );

  const handlePrepareForTravel = useCallback(
    async (tracks: MediaEnvelope[]) => {
      if (tracks.length === 0) return;
      const result = await prepareTracksForTravel(tracks, {
        findCandidates: findHitCandidates,
      });
      if (result.blockedReason === 'cellular') {
        showAppToast(t('travel.wifiRequired'), 4500);
        return;
      }
      if (result.blockedReason === 'offline') {
        showAppToast(t('travel.offlineBlocked'), 4500);
        return;
      }
      if (result.blockedReason === 'empty') return;
      const remoteCount = tracks.filter(
        (tr) =>
          tr.provider !== 'local-vault' &&
          tr.provider !== 'stream-cache' &&
          tr.provider !== 'indexeddb' &&
          tr.provider !== 'blob',
      ).length;
      if (remoteCount > 0) {
        showAppToast(t('travel.started', { count: remoteCount }), 3200);
      }
      const syncPart =
        result.syncPulled > 0
          ? t('travel.syncPart', { syncPulled: result.syncPulled })
          : '';
      if (result.prefetched === 0 && result.failed === 0 && remoteCount === 0) {
        showAppToast(t('travel.nothingToDo'), 4000);
        return;
      }
      if (result.failed > 0) {
        showAppToast(
          t('travel.donePartial', { prefetched: result.prefetched, failed: result.failed }),
          5200,
        );
        return;
      }
      showAppToast(
        t('travel.done', {
          prefetched: result.prefetched,
          skippedLocal: result.skippedLocal,
          syncPart,
        }),
        5200,
      );
    },
    [findHitCandidates, showAppToast, t],
  );

  const suggestedQueueTracks = useMemo(
    () =>
      queueDrawerOpen
        ? buildSuggestedQueueTracks(audio.envelope, playQueue)
        : [],
    [queueDrawerOpen, audio.envelope, playQueue],
  );

  const handleArtistMix = useCallback(async () => {
    const seed = audio.envelope;
    if (!seed || audio.state === 'Idle') return;
    const tracks = await buildArtistMix(seed);
    if (tracks.length === 0) return;
    const session: MixRadioSession = {
      kind: 'mix',
      seedTitle: seed.title?.trim() || t('player.unknownTitle'),
      seedArtist: seed.artist?.trim() || t('player.unknownArtist'),
    };
    setShuffleOn(true);
    handlePlayAlbum(tracks, false, { fromMixRadio: session });
  }, [audio.envelope, audio.state, handlePlayAlbum, t]);

  const handleTrackRadio = useCallback(async () => {
    const seed = audio.envelope;
    if (!seed || audio.state === 'Idle') return;
    const tracks = await buildTrackRadio(seed);
    if (tracks.length === 0) return;
    const session: MixRadioSession = {
      kind: 'radio',
      seedTitle: seed.title?.trim() || t('player.unknownTitle'),
      seedArtist: seed.artist?.trim() || t('player.unknownArtist'),
    };
    setRepeatMode('all');
    setShuffleOn(false);
    handlePlayAlbum(tracks, false, { fromMixRadio: session });
  }, [audio.envelope, audio.state, handlePlayAlbum, t]);

  const handleSaveMixRadio = useCallback(
    (name: string, mode: MixRadioSaveMode) => {
      if (!mixRadioSession || playQueue.length === 0) return;
      if (mode === 'playlist') {
        const description =
          mixRadioSession.kind === 'mix'
            ? t('player.mixRadioSave.descriptionMix')
            : t('player.mixRadioSave.descriptionRadio');
        createPlaylistWithTracks(name, playQueue, description);
        setMixRadioSaveOpen(false);
        setLockerSection('playlists');
        setAppToast(t('player.mixRadioSave.toast'));
        return;
      }

      setMixRadioSaveBusy(true);
      void saveMixRadioToLocker(playQueue, downloadTierPreference, name)
        .then((result) => {
          setMixRadioSaveOpen(false);
          if (result.downloaded > 0 && result.failed > 0) {
            setAppToast(
              t('player.mixRadioSave.toastLockerPartial', {
                downloaded: result.downloaded,
                failed: result.failed,
              }),
            );
          } else if (result.downloaded > 0) {
            setAppToast(t('player.mixRadioSave.toastLocker'));
          } else if (result.skipped === playQueue.length) {
            setAppToast(t('player.mixRadioSave.toastLockerAlready'));
          } else {
            setAppToast(t('player.mixRadioSave.toastLockerFailed'));
          }
          if (result.downloaded > 0) {
            setLockerSection('artists');
          }
        })
        .catch(() => {
          setAppToast(t('player.mixRadioSave.toastLockerFailed'));
        })
        .finally(() => {
          setMixRadioSaveBusy(false);
        });
    },
    [mixRadioSession, playQueue, t, downloadTierPreference],
  );

  const handlePlaySource = useCallback(
    (source: CandidateSource, hit: ResolvedSearchHit) => {
      syncThumbsFromFeedback(source.id);
      void handlePlayEnvelope(
        {
          envelopeId: source.id,
          title: source.metadata?.title ?? hit.title,
          artist: source.metadata?.artist ?? hit.artist,
          url: source.uri ?? '',
          durationSeconds: source.metadata?.durationSeconds ?? 0,
          provider: source.provider,
          transport: source.transport,
          sourceId: source.id,
          mimeType: source.mimeType,
          artworkUrl: source.metadata?.artworkUrl ?? hit.artworkUrl,
        },
        hit.sources,
        { seedSearchQueue: true, seedSearchEnvelope: hit.primaryEnvelope },
      );
      if (hit.artworkUrl) setArtworkUrl(hit.artworkUrl);
    },
    [handlePlayEnvelope, syncThumbsFromFeedback],
  );

  const cycleRepeat = useCallback(() => {
    setRepeatMode((m) => (m === 'none' ? 'one' : m === 'one' ? 'all' : 'none'));
  }, []);

  const skipBack = useCallback(() => {
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'SKIP_PREV' });
      return;
    }
    if (audio.envelope && isPodcastEnvelopeId(audio.envelope.envelopeId)) {
      const interval = loadPodcastSeekIntervalSeconds();
      const dur =
        audio.streamDurationSeconds ||
        audio.durationSeconds ||
        audio.envelope.durationSeconds ||
        0;
      const next = Math.max(0, audio.currentTimeSeconds - interval);
      audio.seek(dur > 0 ? Math.min(next, dur) : next);
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
      adoptInPlaceQueueTrack(track, inPlaceSeek);
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

  const skipForward = useCallback(() => {
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'SKIP_NEXT' });
      return;
    }
    if (audio.envelope && isPodcastEnvelopeId(audio.envelope.envelopeId)) {
      const interval = loadPodcastSeekIntervalSeconds();
      const dur =
        audio.streamDurationSeconds ||
        audio.durationSeconds ||
        audio.envelope.durationSeconds ||
        0;
      const next = audio.currentTimeSeconds + interval;
      audio.seek(dur > 0 ? Math.min(next, dur) : next);
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
    if (advance.action === 'none') return;
    const next =
      advance.action === 'repeat-one'
        ? queueIndex
        : advance.action === 'wrap' || advance.action === 'advance'
          ? advance.index
          : queueIndex;
    const track = playQueue[next];
    if (!track) return;
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
      adoptInPlaceQueueTrack(track, inPlaceSeek);
      return;
    }
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

  const homeLastQueue = playQueue.length > 0 ? playQueue : loadLastQueue();

  const tvRecentlyAdded = useMemo(() => {
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return [];
    return [...entries]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 12)
      .map((e) => ({
        id: `local-${e.id}`,
        title: e.title,
        subtitle: e.artist || 'Unknown artist',
        artworkUrl: e.albumArt,
      }));
  }, [lockerEnvelopes]);

  const tvContinueListening = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      subtitle: string;
      artworkUrl?: string;
      badge?: string;
    }> = [];
    if (homeLastQueue.length > 0) {
      items.push({
        id: '__resume_queue__',
        title: 'Resume Queue',
        subtitle: `${homeLastQueue.length} track${homeLastQueue.length === 1 ? '' : 's'}`,
        artworkUrl: homeLastQueue[0]?.artworkUrl,
        badge: 'Queue',
      });
    }
    getRecentlyPlayed(10).forEach((h: StoredPlayHit) => {
      items.push({
        id: h.envelopeId,
        title: h.title,
        subtitle: h.artist,
        artworkUrl: h.artworkUrl,
      });
    });
    return items;
  }, [homeLastQueue, audio.state, audio.title]);

  const tvPlaylistCards = useMemo(
    () =>
      tvPlaylists.slice(0, 12).map((pl) => ({
        id: pl.id,
        title: pl.name,
        subtitle: `${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`,
        artworkUrl: pl.importCoverUrl || pl.tracks[0]?.artworkUrl,
      })),
    [tvPlaylists],
  );

  const tvCollectionCards = useMemo(() => {
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return [];
    const albums = new Map<
      string,
      { id: string; title: string; subtitle: string; artworkUrl?: string }
    >();
    for (const e of entries) {
      const albumName = e.albumName?.trim() || 'Unknown Album';
      const artist = e.artist?.trim() || 'Unknown artist';
      const key = `${albumName}::${artist}`;
      if (!albums.has(key)) {
        albums.set(key, {
          id: `album-${key}`,
          title: albumName,
          subtitle: artist,
          artworkUrl: e.albumArt,
        });
      }
    }
    return [...albums.values()].slice(0, 12);
  }, [lockerEnvelopes]);

  const homeMostPlayed = useMemo(
    () =>
      getMostPlayed(4).map((h) => ({
        id: h.envelopeId,
        title: h.title,
        subtitle: `${h.artist} · ${h.playCount} play${h.playCount === 1 ? '' : 's'}`,
      })),
    [audio.state, audio.title],
  );

  const resolveEnvelopeById = useCallback(
    (envelopeId: string): MediaEnvelope | null => {
      const locker = lockerEnvelopes.find((e) => e.envelopeId === envelopeId);
      if (locker) return locker;
      const inQueue = playQueue.find((e) => e.envelopeId === envelopeId);
      if (inQueue) return inQueue;
      const searchHit = searchHits.find((h) => h.primaryEnvelope.envelopeId === envelopeId);
      if (searchHit) return searchHit.primaryEnvelope;
      const hit = getMostPlayed(32).find((h) => h.envelopeId === envelopeId);
      if (hit) return sanitizeRestoredEnvelope(storedHitToEnvelope(hit));
      const queued = homeLastQueue.find((e) => e.envelopeId === envelopeId);
      return queued ?? null;
    },
    [lockerEnvelopes, playQueue, searchHits, homeLastQueue],
  );

  const handleHomePlayById = useCallback(
    (envelopeId: string) => {
      const env = resolveEnvelopeById(envelopeId);
      if (env) void handlePlayEnvelope(env, findHitCandidates(env));
    },
    [resolveEnvelopeById, handlePlayEnvelope, findHitCandidates],
  );

  const resolveEnvelopeByIdRef = useRef(resolveEnvelopeById);
  resolveEnvelopeByIdRef.current = resolveEnvelopeById;

  const applyRemoteSyncState = useCallback((payload: SyncStatePayload) => {
    setRemoteMirror(payload);
    setPlayQueue(payload.playQueue.map(queueSummaryToEnvelope));
    setQueueIndex(payload.queueIndex);
    const track = payload.playQueue[payload.queueIndex];
    if (track?.artworkUrl) setArtworkUrl(proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl);
  }, []);

  const handleConnectCommand = useCallback((command: ConnectCommand) => {
    switch (command.cmd) {
      case 'PLAY': {
        const env = resolveEnvelopeByIdRef.current(command.envelopeId);
        if (env) void playEnvelopeRef.current(env, findHitCandidates(env));
        break;
      }
      case 'PAUSE':
        audio.pause();
        break;
      case 'SKIP_NEXT':
        skipForward();
        break;
      case 'SKIP_PREV':
        skipBack();
        break;
      case 'SEEK_TO':
        audio.seek(command.seconds);
        break;
      case 'SET_VOLUME':
        audio.setVolume(command.volume);
        break;
      case 'ADD_TO_QUEUE': {
        const env = resolveEnvelopeByIdRef.current(command.envelopeId);
        if (env) handleAddToQueue([env]);
        break;
      }
      case 'REMOVE_QUEUE_ITEM':
        handleRemoveFromQueue(command.index);
        break;
      case 'REORDER_QUEUE':
        handleReorderQueue(command.fromIndex, command.toIndex);
        break;
      case 'CLEAR_QUEUE':
        handleClearQueue();
        break;
      default:
        break;
    }
  }, [audio, skipForward, skipBack, handleAddToQueue, handleRemoveFromQueue, handleReorderQueue, handleClearQueue, findHitCandidates]);

  const handleConnectCommandRef = useRef(handleConnectCommand);
  handleConnectCommandRef.current = handleConnectCommand;

  const publishHostSyncState = useCallback(() => {
    if (effectiveConnectRole !== 'host') return;
    connectClientRef.current?.publishState(
      buildSyncState({
        envelope: audio.envelope,
        currentTimeSeconds: audio.currentTimeSeconds,
        durationSeconds: audio.durationSeconds,
        isPlaying: audio.state === 'Playing',
        volume: audio.volume,
        playQueue,
        queueIndex,
      }),
    );
  }, [
    effectiveConnectRole,
    audio.envelope,
    audio.currentTimeSeconds,
    audio.durationSeconds,
    audio.state,
    audio.volume,
    playQueue,
    queueIndex,
  ]);

  useEffect(() => {
    if (!networkSyncEnabled || !effectiveConnectRole) {
      connectClientRef.current?.disconnect();
      connectClientRef.current = null;
      setRemoteMirror(null);
      return;
    }
    const client = new ConnectClient({
      room: 'sandbox-room',
      role: effectiveConnectRole,
      deviceId: getOrCreateConnectDeviceId(),
      deviceName: loadConnectDeviceName(),
    });
    connectClientRef.current = client;
    client.connect();

    let unsubState: (() => void) | undefined;
    let unsubCommand: (() => void) | undefined;

    if (effectiveConnectRole === 'remote') {
      unsubState = client.subscribeState((payload) => applyRemoteSyncState(payload));
    } else {
      unsubCommand = client.subscribeCommand((cmd) => handleConnectCommandRef.current(cmd));
      client.startHeartbeat(() =>
        buildSyncState({
          envelope: audioEnvelopeRef.current,
          currentTimeSeconds: audioCurrentTimeRef.current,
          durationSeconds: audioDurationRef.current,
          isPlaying: audioStateRef.current === 'Playing',
          volume: audioVolumeRef.current,
          playQueue: playQueueRef.current,
          queueIndex: queueIndexRef.current,
        }),
      );
    }

    return () => {
      unsubState?.();
      unsubCommand?.();
      client.disconnect();
      if (connectClientRef.current === client) connectClientRef.current = null;
    };
  }, [networkSyncEnabled, effectiveConnectRole, applyRemoteSyncState]);

  useEffect(() => {
    if (effectiveConnectRole !== 'host') return;
    publishHostSyncState();
  }, [effectiveConnectRole, publishHostSyncState]);

  const handleResumeLastQueue = useCallback(() => {
    if (homeLastQueue.length === 0) return;
    setHomeAwaitingUserResume(false);
    handlePlayAlbum(homeLastQueue);
  }, [homeLastQueue, handlePlayAlbum]);

  const handleTVHomeSelect = useCallback(
    (id: string, row: TVRowId) => {
      if (row === 'continue') {
        if (id === '__resume_queue__') {
          handleResumeLastQueue();
        } else {
          handleHomePlayById(id);
        }
        setTvScreen('playback');
        return;
      }
      if (row === 'recent') {
        handleHomePlayById(id);
        setTvScreen('playback');
        return;
      }
      if (row === 'playlists') {
        const pl = tvPlaylists.find((p) => p.id === id);
        if (pl?.tracks.length) {
          handlePlayAlbum(pl.tracks);
          setTvScreen('playback');
        } else {
          goToDiscover('playlists');
        }
        return;
      }
      if (row === 'collections') {
        const key = id.startsWith('album-') ? id.slice(6) : id;
        const sep = key.indexOf('::');
        if (sep < 0) return;
        const albumName = key.slice(0, sep);
        const artist = key.slice(sep + 2);
        const entries = getLockerEntriesSnapshot() ?? [];
        const albumTracks = tracksForAlbumGroup(entries, albumName, artist);
        const envs: MediaEnvelope[] = albumTracks.map((e) => ({
          envelopeId: `local-${e.id}`,
          title: e.title,
          artist: e.artist,
          album: e.albumName,
          url: e.url,
          durationSeconds: e.durationSeconds,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: e.id,
          artworkUrl: e.albumArt,
        }));
        if (envs.length) {
          handlePlayAlbum(envs);
          setTvScreen('playback');
        } else {
          setStation('locker');
        }
      }
    },
    [
      handleResumeLastQueue,
      handleHomePlayById,
      tvPlaylists,
      handlePlayAlbum,
      goToDiscover,
    ],
  );

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
      let raw = env.artworkUrl?.trim();
      if (!raw && env.provider === 'local-vault') {
        raw = resolveLockerEntryAlbumArt(env)?.trim() ?? '';
      }
      if (!raw && env.provider === 'local-vault' && env.sourceId) {
        raw = (await resolveLockerArtworkUrl(env.sourceId)) ?? '';
      }
      if (!raw) return;
      const next = proxiedArtworkUrl(raw) ?? raw;
      setArtworkUrl((prev) => stabilizePlaybackArtSrc(prev, next, env.envelopeId) || next);
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

  const lyricsEnvelope = useMemo(() => {
    if (isConnectRemote && remoteMirror) {
      const id = remoteMirror.currentTrackId;
      if (!id) return null;
      return resolveEnvelopeById(id);
    }
    return audio.envelope;
  }, [isConnectRemote, remoteMirror, audio.envelope, resolveEnvelopeById]);

  const lyricsTitle = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.title ?? ''
    : audio.title;
  const lyricsArtist = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.artist ?? ''
    : audio.artist;
  const lyricsTrackKey = isConnectRemote && remoteMirror
    ? remoteMirror.currentTrackId ?? ''
    : audio.envelope?.envelopeId ?? '';
  const lyricsDuration = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.durationSeconds ?? 0
    : audio.envelope?.durationSeconds ?? audio.durationSeconds ?? 0;
  const lyricsAlbum = isConnectRemote && remoteMirror
    ? remoteMirror.playQueue[remoteMirror.queueIndex]?.album ?? ''
    : audio.envelope?.album ?? '';

  const lyricsCurrentTimeSeconds = isConnectRemote && remoteMirror
    ? remoteMirror.currentTimeSeconds
    : audio.currentTimeSeconds;
  const lyricsIsPlaying = isConnectRemote && remoteMirror
    ? remoteMirror.isPlaying
    : audio.state === 'Playing';

  const handleLyricsSeek = useCallback(
    (seconds: number) => {
      if (effectiveConnectRole === 'remote') {
        sendConnectCommand({ cmd: 'SEEK_TO', seconds });
      } else if (serverStemMix.stemMixActive) {
        serverStemMix.seekStemPlayback(seconds);
      } else {
        audio.seek(seconds);
      }
    },
    [effectiveConnectRole, sendConnectCommand, audio, serverStemMix],
  );

  const lyricsResolveTokenRef = useRef(0);

  const resolveActiveLyrics = useCallback(() => {
    const token = ++lyricsResolveTokenRef.current;
    if (!lyricsTrackKey && !lyricsTitle.trim() && !lyricsArtist.trim()) {
      setActiveLyrics(EMPTY_LYRICS);
      return;
    }
    setActiveLyrics({ ...EMPTY_LYRICS, loading: true });
    void resolveTrackLyrics({
      title: lyricsTitle,
      artist: lyricsArtist,
      album: lyricsAlbum,
      durationSeconds: lyricsDuration,
      envelope: lyricsEnvelope,
    }).then((resolved) => {
      if (lyricsResolveTokenRef.current === token) setActiveLyrics(resolved);
    });
  }, [lyricsTrackKey, lyricsTitle, lyricsArtist, lyricsAlbum, lyricsDuration, lyricsEnvelope]);

  useEffect(() => {
    if (!lyricsDrawerOpen && !mobileNowPlayingOpen) return;
    resolveActiveLyrics();
  }, [lyricsDrawerOpen, mobileNowPlayingOpen, lyricsTrackKey, resolveActiveLyrics]);

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
  const nowPlayingDisplay = useMemo(
    () =>
      resolveNowPlayingDisplay({
        audioEnvelope: audio.envelope,
        audioTitle: audio.title,
        audioArtist: audio.artist,
        audioState: audio.state,
        displaySeed: playbackDisplaySeed,
        parallelArtworkUrl: artworkUrl,
        lockerFeatured,
        currentTimeSeconds: audio.currentTimeSeconds,
        hasActivePlayback,
      }),
    [
      audio.envelope,
      audio.envelope?.envelopeId,
      audio.envelope?.artworkUrl,
      audio.title,
      audio.artist,
      audio.state,
      audio.currentTimeSeconds,
      playbackDisplaySeed,
      artworkUrl,
      lockerFeatured,
      hasActivePlayback,
    ],
  );
  const homeTitle = nowPlayingDisplay.title;
  const homeArtist = nowPlayingDisplay.artist;
  const homeAlbum = nowPlayingDisplay.album;
  const homeArtRaw = useMemo(() => {
    const parallel = nowPlayingDisplay.artworkUrl?.trim() || artworkUrl?.trim() || '';
    return resolvePlaybackCoverArt(parallel, audio.envelope);
  }, [
    nowPlayingDisplay.artworkUrl,
    artworkUrl,
    audio.envelope,
    audio.envelope?.envelopeId,
    audio.envelope?.provider,
    audio.envelope?.sourceId,
    lockerEnvelopes,
  ]);
  const homeArt = proxiedArtworkUrl(homeArtRaw) ?? homeArtRaw;
  const homeDisplayState: typeof audio.state =
    audio.envelope || audio.state !== 'Idle'
      ? audio.state
      : lockerFeatured
        ? 'Ready'
        : 'Idle';

  const playerDownloadEnabled =
    homeHasLoadedTrack &&
    Boolean(
      audio.envelope?.envelopeId ||
        audio.envelope?.title?.trim() ||
        audio.title?.trim() ||
        homeTitle.trim(),
    );

  const downloadCurrentTrack = useCallback(() => {
    const env = audio.envelope;
    const title = env?.title?.trim() || audio.title?.trim() || homeTitle.trim();
    if (!title) return;
    const envelopeId = env?.envelopeId || env?.sourceId || `track-${title}`;
    handleDownloadTrack(
      {
        kind: 'track',
        id: env?.sourceId || env?.envelopeId || envelopeId,
        title,
        artist: env?.artist || audio.artist || homeArtist,
        album: env?.album || homeAlbum,
        artworkUrl: env?.artworkUrl,
        durationSeconds: env?.durationSeconds,
        envelope:
          env ??
          ({
            envelopeId,
            title,
            artist: audio.artist || homeArtist,
            album: homeAlbum,
            url: '',
            provider: 'unknown',
            transport: 'element-src',
            sourceId: envelopeId,
            durationSeconds: 0,
          } as const),
      },
      'tracks',
    );
  }, [
    audio.envelope,
    audio.title,
    audio.artist,
    homeTitle,
    homeArtist,
    homeAlbum,
    handleDownloadTrack,
  ]);

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

  const npCurrentTimeSeconds = serverStemMix.stemMixActive
    ? serverStemMix.stemTimeSeconds
    : isConnectRemote && remoteMirror
      ? remoteMirror.currentTimeSeconds
      : audio.currentTimeSeconds;
  const npDurationSeconds =
    isConnectRemote && remoteMirror && remoteMirror.durationSeconds > 0
      ? remoteMirror.durationSeconds
      : (() => {
          const catalog =
            audio.envelope?.durationSeconds ??
            lockerFeatured?.durationSeconds ??
            0;
          const stream = audio.streamDurationSeconds;
          if (stream > 0) {
            return (
              resolveCatalogAwareDuration(stream, catalog || audio.durationSeconds) ||
              stream
            );
          }
          return (
            audio.durationSeconds ||
            catalog ||
            0
          );
        })();
  const npIsPlaying = serverStemMix.stemMixActive
    ? serverStemMix.stemPlaying
    : isConnectRemote && remoteMirror
      ? remoteMirror.isPlaying
      : audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
  const npEnvelope = isConnectRemote ? lyricsEnvelope : audio.envelope;
  const npIsPodcast = Boolean(
    npEnvelope?.envelopeId && isPodcastEnvelopeId(npEnvelope.envelopeId),
  );
  const npIsBusy =
    !isConnectRemote &&
    !npIsPodcast &&
    (audio.state === 'Resolving' || audio.state === 'Connecting');
  const activePodcastChapter = useMemo(
    () =>
      npIsPodcast ? getActiveChapter(podcastChapters, npCurrentTimeSeconds) : null,
    [npIsPodcast, podcastChapters, npCurrentTimeSeconds],
  );
  const canPodcastPrevChapter =
    npIsPodcast && podcastChapters.length > 0 && npCurrentTimeSeconds > 1;
  const canPodcastNextChapter =
    npIsPodcast &&
    seekSecondsForNextChapter(podcastChapters, npCurrentTimeSeconds) != null;

  const displayArt = homeArt;
  const showTopSearchBase = !isTV && !isCarMode && station !== 'settings' && station !== 'dj';
  const showHomeIdleChrome =
    showTopSearchBase && !showMobileShell && station === 'home' && !homeHasLoadedTrack;
  const showTopSearch =
    showTopSearchBase && (!showMobileShell || mobileSearchOpen || station === 'search');
  /** Album drill is full-page — never stack the typeahead panel over it. */
  const blockSearchDropdown = Boolean(albumDrillAlbum);
  const searchDropdownEffectiveOpen = searchDropdownOpen && !blockSearchDropdown;
  /** Mobile shell header (downloads btn + optional search) — hidden on home/discover except search overlay. */
  const showMobileShellHeader =
    showMobileShell && (mobileSearchOpen || station === 'search' || station === 'locker');
  const showShellHeaderOffset = showTopSearch || (showMobileShell && station === 'locker');

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

  const togglePlay = useCallback(() => {
    if (serverStemMix.stemMixActive) {
      serverStemMix.toggleStemPlayback();
      return;
    }
    if (isConnectRemoteRef.current) {
      if (remoteMirror?.isPlaying) sendConnectCommand({ cmd: 'PAUSE' });
      else if (remoteMirror?.currentTrackId) {
        sendConnectCommand({ cmd: 'PLAY', envelopeId: remoteMirror.currentTrackId });
      }
      return;
    }
    if (audio.state === 'Playing' || audio.nativeExoEffectivePlaying) {
      audio.pause();
      return;
    }
    void (async () => {
      const env = audio.envelope;
      if (env && shouldRunLockerPlaybackGate(env)) {
        const locker = await ensureLockerPlayable(env);
        if (locker.kind === 'missing-audio') {
          if (
            env &&
            (await attemptDeadLockerReacquire(env.title, env.artist, env.album))
          ) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                defaultValue: `Re-downloading "${env.title}"…`,
              }),
              5000,
            );
            return;
          }
          showAppToast(
            t('player.lockerAudioMissing', {
              defaultValue:
                'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
            }),
            6000,
          );
          return;
        }
        if (locker.kind === 'playable') {
          const playable = preserveTappedEnvelopeIdentity(env, locker.envelope);
          persistLockerPlayRepair(env, playable);
          if (
            playable.url !== env.url?.trim() ||
            playable.sourceId !== env.sourceId
          ) {
            audio.primePlaybackGesture();
            audio.loadEnvelope(playable, { autoPlay: true, instant: true });
            return;
          }
        }
      }
      audio.primePlaybackGesture();
      await audio.play({ userGesture: true });
    })();
  }, [audio, remoteMirror, sendConnectCommand, serverStemMix, showAppToast, t]);

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

  const shortcutCtxRef = useRef({
    togglePlay,
    skipBack,
    skipForward,
    focusSearch: () => {},
    isIdle: () => true,
    getVolume: () => 1,
    setVolume: (_level: number) => {},
    toggleMute: () => {},
    seek: (_seconds: number) => {},
    currentTimeSeconds: () => 0,
    durationSeconds: () => 0,
    play: () => {},
    pause: () => {},
    getMetadata: () => null as MediaSessionTrackMetadata | null,
  });

  shortcutCtxRef.current = {
    togglePlay,
    skipBack,
    skipForward,
    focusSearch: () => {
      if (showMobileShell) {
        openMobileSearch();
        return;
      }
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
      setSearchDropdownOpen(true);
    },
    isIdle: () => audio.state === 'Idle',
    getVolume: () => audio.volume,
    setVolume: audio.setVolume,
    toggleMute: audio.toggleMute,
    seek: audio.seek,
    currentTimeSeconds: () => audio.currentTimeSeconds,
    durationSeconds: () => audio.durationSeconds,
    play: () => {
      void audio.play({ userGesture: true });
    },
    pause: audio.pause,
    getMetadata: () => {
      const title = nowPlayingDisplay.title?.trim();
      const artist = nowPlayingDisplay.artist?.trim();
      if (!title && !artist && audio.state === 'Idle') return null;
      const art =
        (proxiedArtworkUrl(homeArt) ?? homeArt) ||
        (proxiedArtworkUrl(nowPlayingDisplay.artworkUrl) ?? nowPlayingDisplay.artworkUrl);
      return {
        title: title || t('player.unknownTitle'),
        artist: artist || t('player.unknownArtist'),
        album: nowPlayingDisplay.album ?? audio.envelope?.album,
        artworkUrl: art || undefined,
        envelopeId: nowPlayingDisplay.envelopeId || audio.envelope?.envelopeId,
      };
    },
  };

  useEffect(() => {
    return registerKeyboardShortcuts(
      {
        togglePlay: () => shortcutCtxRef.current.togglePlay(),
        toggleMute: () => shortcutCtxRef.current.toggleMute(),
        skipBack: () => shortcutCtxRef.current.skipBack(),
        skipForward: () => shortcutCtxRef.current.skipForward(),
        seekRelative: (delta) => {
          const ctx = shortcutCtxRef.current;
          const max = ctx.durationSeconds() || Infinity;
          ctx.seek(Math.max(0, Math.min(ctx.currentTimeSeconds() + delta, max)));
        },
        getVolume: () => shortcutCtxRef.current.getVolume(),
        setVolume: (level) => shortcutCtxRef.current.setVolume(level),
        focusSearch: () => shortcutCtxRef.current.focusSearch(),
        isIdle: () => shortcutCtxRef.current.isIdle(),
      },
      { tvMode: isTV, carMode: isCarMode },
    );
  }, [isTV, isCarMode]);

  useEffect(() => {
    return registerMediaSession({
      play: () => shortcutCtxRef.current.play(),
      pause: () => shortcutCtxRef.current.pause(),
      skipBack: () => shortcutCtxRef.current.skipBack(),
      skipForward: () => shortcutCtxRef.current.skipForward(),
      seekRelative: (delta) => {
        const ctx = shortcutCtxRef.current;
        const max = ctx.durationSeconds() || Infinity;
        ctx.seek(Math.max(0, Math.min(ctx.currentTimeSeconds() + delta, max)));
      },
      getMetadata: () => shortcutCtxRef.current.getMetadata(),
    });
  }, []);

  useAndroidShellBridges({
    playQueue,
    playQueueRef,
    playEnvelopeRef,
    shortcutCtxRef,
    sendConnectCommand,
  });

  useEffect(() => {
    const metadata = shortcutCtxRef.current.getMetadata();
    const isPlaying = audio.state === 'Playing' || audio.nativeExoEffectivePlaying;
    const positionSeconds = audio.currentTimeSeconds;
    const durationSeconds = audio.durationSeconds;

    syncMediaSessionState(metadata, isPlaying, positionSeconds, durationSeconds);
    void syncAndroidBackgroundMedia(
      metadata,
      isPlaying,
      positionSeconds * 1000,
      durationSeconds * 1000,
      {
        nativeExoActive:
          audio.nativeExoEffectivePlaying ||
          audio.state === 'Playing' ||
          audio.state === 'Connecting',
      },
    );
  }, [
    audio.state,
    audio.nativeExoEffectivePlaying,
    audio.title,
    audio.artist,
    audio.envelope,
    audio.envelope?.envelopeId,
    audio.envelope?.album,
    audio.envelope?.artworkUrl,
    audio.currentTimeSeconds,
    audio.durationSeconds,
    artworkUrl,
  ]);

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

  const resumeQueueCandidate =
    playQueue.length > 0 ? playQueue : loadLastQueue();
  const showResumeQueuePrompt =
    resumeQueueCandidate.length > 0 && audio.state === 'Idle';

  const showBottomPlayer =
    !isTV &&
    !(showMobileShell && station === 'home') &&
    (hasActivePlayback ||
      (showMobileShell && mobilePlayerPending) ||
      queueDrawerOpen ||
      (!showMobileShell && (lyricsDrawerOpen || sleepTimerPanelOpen)));

  const mobilePlaybackShellActive = showMobileShell
    ? hasMobilePlaybackShell(hasActivePlayback, mobilePlayerPending)
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

  const shellSearchForm = (
    <form
      ref={searchFormRef}
      id="shell-search-form"
      className={`shell-search-form${showHomeIdleChrome ? ' shell-search-form--home-idle' : ''}`}
      onSubmit={(e) => {
        e.preventDefault();
        submitSearch();
      }}
    >
      <div className="shell-search-field">
        <Search className="shell-search-icon absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" />
        <input
          ref={shellSearchField.setInputRef}
          type="text"
          {...imeSearchInputProps}
          name="search"
          enterKeyHint="search"
          value={shellSearchField.value}
          onChange={(e) => {
            shellSearchField.onChange(e);
            if (!blockSearchDropdown) setSearchDropdownOpen(true);
          }}
          onInput={(e) => {
            shellSearchField.onInput(e);
            if (!blockSearchDropdown) setSearchDropdownOpen(true);
          }}
          onCompositionStart={shellSearchField.onCompositionStart}
          onCompositionEnd={(e) => {
            shellSearchField.onCompositionEnd(e);
            if (!blockSearchDropdown) setSearchDropdownOpen(true);
          }}
          onFocus={() => {
            if (!blockSearchDropdown) setSearchDropdownOpen(true);
          }}
          onBlur={() => {
            window.setTimeout(() => {
              const active = document.activeElement;
              if (searchFormRef.current?.contains(active)) return;
              if (searchDropdownRef.current?.contains(active)) return;
              setSearchDropdownOpen(false);
            }, 180);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (searchDropdownItems.length > 0) {
                setSearchActiveIndex((idx) => nextSearchActiveIndex(idx, searchDropdownItems.length));
              }
              return;
            }
            if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSearchActiveIndex((idx) => prevSearchActiveIndex(idx, searchDropdownItems.length));
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              if (searchActiveIndex >= 0 && searchDropdownItems[searchActiveIndex]) {
                activateSearchDropdownItem(searchDropdownItems[searchActiveIndex]!);
                return;
              }
              submitSearch();
              return;
            }
            if (e.key === 'Escape') {
              if (showMobileShell && mobileSearchOpen) {
                closeMobileSearch();
              } else {
                setSearchDropdownOpen(false);
                searchInputRef.current?.blur();
              }
            }
          }}
          placeholder={searchBarPlaceholder(offlineStatus, lang, narrowShell, showMobileShell)}
          aria-label={t('shell.searchAriaLabel')}
          aria-expanded={searchDropdownEffectiveOpen}
          aria-haspopup="listbox"
          aria-activedescendant={
            searchActiveIndex >= 0 ? `search-dropdown-item-${searchActiveIndex}` : undefined
          }
          className={`shell-search${showHomeIdleChrome ? ' shell-search--home-idle' : ''}${searchInput ? ' shell-search--has-value' : ''}`}
        />
        {searchInput.trim() ? (
          <button
            type="button"
            className="shell-search-clear touch-manipulation"
            aria-label={t('shell.clearSearch')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={handleClearSearchInput}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        ) : null}
        <SearchDropdown
          query={searchInput}
          dropdownRef={searchDropdownRef}
          open={searchDropdownEffectiveOpen}
          loading={catalogLoading}
          catalog={searchCatalog}
          playlists={unifiedSearchResult.playlists}
          podcastsEnabled={podcastsEnabled}
          activeIndex={searchActiveIndex}
          connectivityHint={
            searchDropdownEffectiveOpen ? searchConnectivityHint(offlineStatus, lang) : null
          }
          onSelectSuggestion={handleSelectSuggestion}
          onSelectArtist={handleSelectArtist}
          onSelectAlbum={handleSelectAlbum}
          onSelectTrack={handleSelectTrack}
          onSelectPlaylist={handleSelectPlaylist}
          onViewAllResults={submitSearch}
          onBrowsePick={handleBrowsePick}
          onQuickFilter={handleQuickFilter}
          recentSearches={recentSearchMatches}
          onSelectRecent={handleActivateRecentSearch}
          onRemoveRecent={handleRemoveRecentSearch}
          onClearHistory={handleClearSearchHistory}
        />
      </div>
    </form>
  );

  return (
    <LockerVaultProvider>
    <div
      className={`shell-root h-dvh w-full min-w-0 flex flex-col bg-[var(--bg-void)] text-[var(--text)] relative z-[1] ${isTV ? 'shell-root--tv' : ''}${!showMobileShell && !isTV ? ' shell-root--desktop' : ''}${tabletShell && !showMobileShell && !isTV ? ' shell-root--tablet' : ''}${showMobileShell ? ' shell-root--mobile-nav shell-root--combined-dock' : ''}${showMobileShell && station === 'search' ? ' shell-root--on-search-station' : ''}${blockSearchDropdown ? ' shell-root--search-album-drill' : ''}${showMobileShell && station === 'locker' ? ' shell-root--on-locker-station' : ''}${showMobileDockBar ? ' shell-root--mobile-dock-mini' : ''}${showMobileShell && shouldUseAndroidInlinePlayerDock(isAndroid()) ? ' shell-root--android-inline-dock' : ''}${mobileSearchOpen && showMobileShell ? ' shell-root--search-open' : ''}${mobileNowPlayingOpen ? ' shell-root--now-playing-open' : ''}${lyricsDrawerOpen && showMobileShell ? ' shell-root--lyrics-open' : ''}${showMusicUniverse ? ' shell-root--music-universe' : ''}${showHomeActiveWash ? ' shell-root--home-active-wash' : ''}${showHomeIdleChrome ? ' shell-root--home-idle' : ''}${batterySaver ? ' shell-root--battery-saver' : ''}${vinylPsycheClass ? ` ${vinylPsycheClass}` : ''}`}
      style={vinylCssVars}
    >
      <DownloadErrorToast hidden={showMobileShell} />
      <AcquireProgressToast />
      <DownloadActivitySheet
        open={showMobileShell && mobileDownloadSheetOpen}
        onClose={() => setMobileDownloadSheetOpen(false)}
        onOpenJob={handleOpenDownloadJob}
      />
      <ConfirmDialog
        open={lockerRemoveConfirm !== null}
        onClose={() => {
          if (lockerRemoveBusy) return;
          setLockerRemoveConfirm(null);
        }}
        onConfirm={() => {
          if (!lockerRemoveConfirm || lockerRemoveBusy) return;
          const { id } = lockerRemoveConfirm;
          setLockerRemoveBusy(true);
          void removeLockerEntry(id, { userConfirmed: LOCKER_USER_DELETE_CONFIRMED })
            .then(() => showAppToast(t('locker.confirm.trackRemoved')))
            .finally(() => {
              setLockerRemoveBusy(false);
              setLockerRemoveConfirm(null);
            });
        }}
        title={t('locker.confirm.removeTrackTitle')}
        message={
          lockerRemoveConfirm
            ? t('locker.confirm.removeTrackMessage', { title: lockerRemoveConfirm.title })
            : ''
        }
        confirmLabel={t('locker.confirm.remove')}
        danger
        confirming={lockerRemoveBusy}
      />
      {showMusicUniverse && !hideHomePlaybackChrome ? (
        <MusicUniverseBackdrop
          active
          playing={audio.state === 'Playing'}
          showShades={homeShowShades}
          variant={isTV ? 'tv' : 'default'}
          psycheClass={`${vinylPsycheClass}${homeArtUniverseClass}`.trim()}
          style={musicUniverseStyle}
        />
      ) : null}
      {showHomeActiveWash && !hideHomePlaybackChrome ? (
        <HomeActiveWash
          albumArt={homeArt}
          showShades={homeShowShades}
          gradientSeed={homeGradientSeed}
          genreBucket={homeGenreBucket}
          style={musicUniverseStyle}
        />
      ) : null}
      {!isTV && !isCarMode && (!showMobileShell || showMobileShellHeader) ? (
        showHomeIdleChrome && !showMobileShell ? (
          <div
            className="shell-home-idle-search"
            aria-label={t('shell.searchAriaLabel')}
          >
            <div className="shell-search-desktop-wrap">
              {shellSearchForm}
              <button
                type="submit"
                form="shell-search-form"
                disabled={searchLoading || !searchInput.trim()}
                className="shell-search-submit flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg touch-manipulation disabled:opacity-40"
                aria-label={t('shell.runSearch')}
              >
                {searchLoading ? (
                  <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                ) : (
                  <Search className="w-5 h-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>
        ) : (
          <header
            className={`shell-header${showMobileShell ? ' shell-header--mobile' : ''}${mobileSearchOpen && showMobileShell ? ' shell-header--mobile-search' : ''}`}
          >
            {showMobileShell ? (
              <div className="flex items-center gap-2 shrink-0 min-w-0">
                {mobileSearchOpen ? (
                  <button
                    type="button"
                    onClick={closeMobileSearch}
                    className="shell-search-close flex-shrink-0 w-12 h-12 flex items-center justify-center rounded-lg touch-manipulation opacity-80 hover:opacity-100"
                    aria-label={t('shell.closeSearch')}
                  >
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="shell-downloads-btn touch-manipulation"
                    onClick={() => setMobileDownloadSheetOpen(true)}
                    aria-label={
                      mobileDownloadBadge > 0
                        ? t('download.activity.openWithCount', { count: mobileDownloadBadge })
                        : t('download.activity.open')
                    }
                  >
                    <Download className="w-5 h-5" strokeWidth={2} />
                    {mobileDownloadBadge > 0 ? (
                      <span className="shell-downloads-btn-badge" aria-hidden>
                        {mobileDownloadBadge > 9 ? '9+' : mobileDownloadBadge}
                      </span>
                    ) : null}
                  </button>
                )}
              </div>
            ) : null}

            {showTopSearch ? (
              <div className="shell-header-search-slot">
                {!showMobileShell ? (
                  <div className="shell-search-desktop-wrap">{shellSearchForm}</div>
                ) : (
                  shellSearchForm
                )}
              </div>
            ) : (
              <div className="shell-header-spacer flex-1 min-w-0" aria-hidden />
            )}

            <div className="shell-header-actions flex items-center space-x-4 shrink-0">
              {showTopSearch && !showMobileShell ? (
                <button
                  type="submit"
                  form="shell-search-form"
                  disabled={searchLoading || !searchInput.trim()}
                  className="shell-search-submit flex-shrink-0 w-10 h-10 flex items-center justify-center rounded-lg touch-manipulation disabled:opacity-40"
                  aria-label={t('shell.runSearch')}
                >
                  {searchLoading ? (
                    <Loader2 className="w-5 h-5 text-gray-400 animate-spin" />
                  ) : (
                    <Search className="w-5 h-5 text-gray-400" />
                  )}
                </button>
              ) : null}
            </div>
          </header>
        )
      ) : null}

      {mobileSearchOpen && showMobileShell ? (
        <button
          type="button"
          className="shell-search-backdrop"
          aria-label={t('shell.closeSearch')}
          onPointerDown={(e) => {
            if (Date.now() < mobileSearchCommitGuardUntilRef.current) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
          onClick={() => {
            if (Date.now() < mobileSearchCommitGuardUntilRef.current) return;
            closeMobileSearch();
          }}
        />
      ) : null}

      {isTV ? (
        <TVNavigation
          activeStation={tvActiveStation}
          isOpen={navOpen}
          discoverEnabled={discoverStationEnabled}
          onSelectStation={(id) => {
            setStation(id);
            setNavOpen(false);
            if (id === 'home') setTvScreen('home');
          }}
          onToggleOpen={setNavOpen}
        />
      ) : (
        !showMobileShell ? (
          <CollapsibleStationNav<NavItemId>
            items={navItems}
            activeId={navActiveId}
            primaryDockIds={navPinTabIdSet(navPinTabs)}
            alwaysVisible={tabletShell}
            onNavigate={(id) => {
              if (id === 'search') {
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
                setSearchDropdownOpen(true);
                return;
              }
              if (id === 'settings' || id === 'profile') {
                openSettings();
                return;
              }
              if (id === 'locker') {
                goToLockerHome();
                return;
              }
              setStation(id);
              setNavOpen(false);
            }}
            open={navOpen}
            onOpenChange={setNavOpen}
            resumeQueueCount={showResumeQueuePrompt ? resumeQueueCandidate.length : 0}
            onResumeQueue={showResumeQueuePrompt ? handleResumeLastQueue : undefined}
          />
        ) : null
      )}

      <main
        ref={shellMainRef}
        className={`shell-main relative z-[10] flex-1 min-h-0 w-full min-w-0 music-scrollbar ${
          station === 'home' || (isTV && tvScreen === 'playback')
            ? 'shell-main--home overflow-hidden flex flex-col'
            : 'overflow-y-auto'
        }${station === 'podcasts' ? ' shell-main--podcasts' : ''} ${
          showMobileShell
            ? shouldUseAndroidInlinePlayerDock(isAndroid())
              ? 'pb-0'
              : mobileUsesPlayerPadding
                ? 'pb-[var(--shell-mobile-bottom-with-player)]'
                : 'pb-[var(--shell-mobile-bottom-tabs-only)]'
            : showBottomPlayer
              ? 'pb-[var(--player-bar-offset)]'
              : isTV
                ? 'pb-0'
                : 'pb-6'
        } ${
          isTV || isCarMode
            ? 'mt-0'
            : showShellHeaderOffset
              ? 'mt-[var(--shell-search-offset)]'
              : showMobileShell
                ? 'mt-0'
                : 'mt-16'
        }`}
      >
        {showAndroidServerBanner && station === 'home' ? (
          <div
            role="status"
            className="android-server-banner mx-4 mb-3 shrink-0 flex items-start gap-3 rounded-xl border border-[var(--warn)]/50 bg-[var(--warn)]/10 px-4 py-3"
          >
            <p className="flex-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text)] leading-relaxed">
              {t('shell.androidServerBanner')}
            </p>
            <button
              type="button"
              onClick={openSettings}
              className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-accent touch-manipulation px-2 py-1 border border-accent/40 rounded"
            >
              {t('shell.androidServerBannerOpen')}
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem(ANDROID_SERVER_BANNER_KEY, 'true');
                } catch {
                  /* ignore */
                }
                setAndroidServerBannerDismissed(true);
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center touch-manipulation text-[var(--text-dim)] hover:text-accent"
              aria-label={t('shell.androidServerBannerDismiss')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {showMobileResolverBanner ? (
          <div
            role="status"
            className="android-server-banner mx-4 mb-3 shrink-0 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3"
          >
            <p className="flex-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text)] leading-relaxed">
              {t('shell.mobileResolverBanner')}
            </p>
            <button
              type="button"
              onClick={openSettings}
              className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-amber-500 touch-manipulation px-2 py-1 border border-amber-500/40 rounded"
            >
              {t('shell.mobileResolverBannerOpen')}
            </button>
            <button
              type="button"
              onClick={() => {
                try {
                  localStorage.setItem(MOBILE_RESOLVER_BANNER_KEY, 'true');
                } catch {
                  /* ignore */
                }
                setMobileResolverBannerDismissed(true);
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center touch-manipulation text-[var(--text-dim)] hover:text-amber-500"
              aria-label={t('shell.mobileResolverBannerDismiss')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {showTvCoverageBanner ? (
          <div
            role="status"
            className="android-server-banner mx-4 mb-3 shrink-0 flex items-start gap-3 rounded-xl border border-[var(--warn)]/50 bg-[var(--warn)]/10 px-4 py-3"
          >
            <p className="flex-1 font-mono text-[10px] uppercase tracking-wide text-[var(--text)] leading-relaxed">
              {t('shell.tvCoverageBanner')}
            </p>
            <button
              type="button"
              onClick={() => {
                saveTvCoverageBannerDismissed(true);
                setTvCoverageBannerDismissed(true);
              }}
              className="shrink-0 w-8 h-8 flex items-center justify-center touch-manipulation text-[var(--text-dim)] hover:text-accent"
              aria-label={t('shell.tvCoverageBannerDismiss')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : null}

        {isTV && station === 'home' && tvScreen === 'playback' ? (
          <TVPlaybackView
            title={homeTitle}
            artist={homeArtist}
            album={homeAlbum}
            albumArt={homeArt}
            envelope={audio.envelope}
            state={homeDisplayState}
            isPlaying={audio.state === 'Playing' || audio.nativeExoEffectivePlaying}
            currentTimeSeconds={audio.currentTimeSeconds}
            durationSeconds={audio.durationSeconds || lockerFeatured?.durationSeconds || 0}
            shuffleOn={shuffleOn}
            repeatMode={repeatMode}
            queueCount={playQueue.length}
            castActive={speakerCast.isActive}
            onTogglePlay={togglePlay}
            onSkipBack={skipBack}
            onSkipForward={skipForward}
            onShuffleToggle={() => setShuffleOn((s) => !s)}
            onRepeatCycle={cycleRepeat}
            onSeek={(t) => audio.seek(t)}
            onOpenQueue={() => {
              setCastPickerOpen(false);
              setTvQueueOpen(true);
            }}
            onOpenCast={openCastPicker}
            onBack={() => setTvScreen('home')}
          />
        ) : null}
        {isTV && station === 'home' && tvScreen === 'home' ? (
          <TVHomeView
            continueListening={tvContinueListening}
            recentlyAdded={tvRecentlyAdded}
            playlists={tvPlaylistCards}
            collections={tvCollectionCards}
            onSelect={handleTVHomeSelect}
            onOpenPlayback={() => setTvScreen('playback')}
            nowPlaying={tvNowPlaying}
            isPlaying={audio.state === 'Playing' || audio.nativeExoEffectivePlaying}
          />
        ) : null}
        {!isTV && station === 'home' && !hideHomePlaybackChrome && (
          <HomeView
            title={homeTitle}
            artist={homeArtist}
            album={homeAlbum}
            albumArt={homeHasLoadedTrack ? homeArt : ''}
            state={homeDisplayState}
            isPlaying={npIsPlaying}
            hasLoadedTrack={homeHasLoadedTrack}
            currentTimeSeconds={npCurrentTimeSeconds}
            durationSeconds={npDurationSeconds}
            onTogglePlay={togglePlay}
            onRestart={() => {
              if (serverStemMix.stemMixActive) serverStemMix.seekStemPlayback(0);
              else audio.seek(0);
            }}
            onSeek={(t) => {
              if (serverStemMix.stemMixActive) serverStemMix.seekStemPlayback(t);
              else audio.seek(t);
            }}
            onScrubStart={() => {
              if (!serverStemMix.stemMixActive) audio.beginScrub();
            }}
            onScrubEnd={() => {
              if (!serverStemMix.stemMixActive) audio.endScrub();
            }}
            onPlayFeatured={() => {
              if (audio.envelope?.envelopeId) {
                void (async () => {
                  const env = audio.envelope!;
                  if (shouldRunLockerPlaybackGate(env)) {
                    const locker = await ensureLockerPlayable(env);
                    if (locker.kind === 'playable') {
                      const playable = preserveTappedEnvelopeIdentity(env, locker.envelope);
                      persistLockerPlayRepair(env, playable);
                      if (
                        playable.url !== env.url?.trim() ||
                        playable.sourceId !== env.sourceId
                      ) {
                        audio.primePlaybackGesture();
                        audio.loadEnvelope(playable, { autoPlay: true, instant: true });
                        return;
                      }
                    }
                    if (locker.kind === 'missing-audio') {
                      if (
                        await attemptDeadLockerReacquire(env.title, env.artist, env.album)
                      ) {
                        showAppToast(
                          t('player.lockerAudioReacquiring', {
                            defaultValue: `Re-downloading "${env.title}"…`,
                          }),
                          5000,
                        );
                        return;
                      }
                      showAppToast(
                        t('player.lockerAudioMissing', {
                          defaultValue:
                            'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
                        }),
                        6000,
                      );
                      return;
                    }
                  }
                  audio.primePlaybackGesture();
                  void audio.play({ userGesture: true });
                })();
                return;
              }
              if (lockerFeatured) {
                const env = lockerEnvelopes.find(
                  (e) => e.envelopeId === lockerFeatured.envelopeId,
                );
                if (env) void handlePlayEnvelope(env);
              }
            }}
            compact={showMobileShell && homeHasLoadedTrack}
            onOpenNowPlaying={
              showMobileShell && homeHasLoadedTrack ? openMobileNowPlaying : undefined
            }
            expanded={false}
            showMobileShell={showMobileShell}
            onGoToArtist={(name) => void handleOpenArtistByName(name)}
            onGoToAlbum={handleOpenAlbumByName}
            envelope={homeAwaitingUserResume ? null : audio.envelope}
            onSkipBack={showMobileShell ? skipBack : undefined}
            onSkipForward={showMobileShell ? skipForward : undefined}
            shuffleOn={shuffleOn}
            onShuffleToggle={() => setShuffleOn((s) => !s)}
            repeatMode={repeatMode}
            onRepeatCycle={cycleRepeat}
            fidelityLabel={playbackFidelityLabel ?? undefined}
            resolveElapsedSeconds={playbackResolveElapsed}
            onCancelResolve={handleDismissStuckPlayback}
            idleDiscovery={
              !showMobileShell
                ? {
                    recentItems: homeRecentlyAdded,
                    queueCount: homeLastQueue.length,
                    listening: homeListeningPreview,
                    onOpenInsights: () => setStation('insights'),
                    onOpenPlaylistsPrompt: handleOpenPlaylistsPrompt,
                    onPlayRecent: handleHomePlayById,
                    onResumeQueue:
                      homeLastQueue.length > 0 ? handleResumeLastQueue : undefined,
                  }
                : undefined
            }
            stemSliders={homeHasLoadedTrack ? stemSlidersPanelProps : undefined}
            moreMenu={
              showMobileShell
                ? {
                    sleepTimerOpen: sleepTimerPanelOpen,
                    sleepTimerLabel,
                    onToggleSleepTimer: () => {
                      setQueueDrawerOpen(false);
                      setLyricsDrawerOpen(false);
                      setSleepTimerPanelOpen((o) => !o);
                    },
                    castActive: speakerCast.isActive,
                    onOpenCastPicker: openCastPicker,
                    onEnterCarMode: handleEnterCarMode,
                    mixRadioEnabled: audio.state !== 'Idle' && Boolean(audio.envelope),
                    onArtistMix: () => void handleArtistMix(),
                    onTrackRadio: () => void handleTrackRadio(),
                    mixRadioSession,
                    saveMixRadioEnabled: Boolean(mixRadioSession) && playQueue.length > 0,
                    onSaveMixRadioToPlaylist: () => setMixRadioSaveOpen(true),
                    resumeQueueCount: showResumeQueuePrompt ? resumeQueueCandidate.length : 0,
                    onResumeQueue: showResumeQueuePrompt ? handleResumeLastQueue : undefined,
                    downloadEnabled: playerDownloadEnabled,
                    onDownloadTrack: downloadCurrentTrack,
                  }
                : undefined
            }
          />
        )}
        {station === 'insights' &&
          withStationSuspense(
            <LazyListeningStatsView onBack={() => setStation('home')} />,
          )}
        {station === 'sonic-locker' && sonicLockerEnabled &&
          withStationSuspense(
            <LazySonicLockerStationView
              lockerTracks={lockerEnvelopes}
              activeEnvelopeId={audio.envelope?.envelopeId ?? null}
              playing={audio.state === 'Playing'}
              onPlayQueue={handleSonicLockerPlayQueue}
              onPlayTrack={(env) => handlePlayEnvelope(env, findHitCandidates(env))}
              onSaveMix={handleSonicLockerSaveMix}
              onStartDiscoveryStation={handleSonicLockerDiscoveryStation}
            />,
          )}
        {station === 'discover' && discoverStationEnabled &&
          withStationSuspense(
            <LazyDiscoverStationView
            activeTab={discoverTab}
            onTabChange={setDiscoverTab}
            discoverDrillFromTab={discoverDrillFromTab}
            onDiscoverDrillFromTab={setDiscoverDrillFromTab}
            playlistsDrillBackRef={playlistsDrillBackRef}
            exploreDrillBackRef={exploreDrillBackRef}
            meshResults={searchResults}
            lockerTracks={lockerEnvelopes}
            activeEnvelopeId={audio.envelope?.envelopeId ?? null}
            initialOpenPlaylistId={focusPlaylistId}
            onOpenPlaylistHandled={() => setFocusPlaylistId(null)}
            initialShareImport={pendingShareImport}
            onShareImportHandled={() => setPendingShareImport(null)}
            initialExternalImport={pendingExternalImport}
            onExternalImportHandled={() => setPendingExternalImport(null)}
            onPlay={(env) => void handlePlayEnvelope(env)}
            onPlayAlbum={handlePlayAlbum}
            onPlayDiscoveryMix={handlePlayDiscoveryMix}
            onPlayNext={handlePlayNext}
            onPrepareForTravel={(tracks) => void handlePrepareForTravel(tracks)}
            onRunSearch={(q) => void runSearch(q)}
            onGoToLocker={(section) => {
              setLockerSection(section ?? 'playlists');
              setStation('locker');
            }}
            onGoToLockerSection={(section) => {
              setLockerSection(section);
              setStation('locker');
            }}
            onGoToSearch={() => setStation('search')}
            onDownloadImportedPlaylist={(pl) => handleDownloadImportedPlaylist(pl)}
            onPickExploreCategory={(label, group) => void runExploreSearch(label, group ?? 'quick')}
            onExploreInstantMix={handleExploreInstantMix}
            onSaveInstantPlaylist={handleSaveInstantPlaylist}
            onOpenVideoFeed={handleOpenVideoFeed}
            />,
          )}
        {station === 'search' && selectedArtist && !albumDrillQuery &&
          (showMobileShell ? (
            <AppErrorBoundary label="artist">
              <ArtistDetailView
            artist={selectedArtist}
            onBack={handleArtistBack}
            onPlayTrack={(env) => void handlePlayEnvelope(env)}
            onPlayTracks={handlePlayAlbum}
            onTrackTitleTap={
              showMobileShell ? handleMobileTrackTitleTap : undefined
            }
            onOpenNowPlaying={showMobileShell ? openMobileNowPlaying : undefined}
            onPlayError={showAppToast}
            onAddToQueue={(env) => {
              handleAddToQueue([env]);
              showAppToast('Added to queue');
            }}
            activeEnvelopeId={audio.envelope?.envelopeId ?? null}
            playingEnvelope={audio.envelope}
            onSearchAlbum={handleSelectAlbum}
            onDownloadAlbum={handleDownloadAlbum}
            onDownloadTrack={handleDownloadTrack}
            onCacheTrack={handleCacheTrack}
            />
            </AppErrorBoundary>
          ) : withStationSuspense(
            <LazyArtistDetailView
            artist={selectedArtist}
            onBack={handleArtistBack}
            onPlayTrack={(env) => void handlePlayEnvelope(env)}
            onPlayTracks={handlePlayAlbum}
            onTrackTitleTap={
              showMobileShell ? handleMobileTrackTitleTap : undefined
            }
            onOpenNowPlaying={showMobileShell ? openMobileNowPlaying : undefined}
            onPlayError={showAppToast}
            onAddToQueue={(env) => {
              handleAddToQueue([env]);
              showAppToast('Added to queue');
            }}
            activeEnvelopeId={audio.envelope?.envelopeId ?? null}
            playingEnvelope={audio.envelope}
            onSearchAlbum={handleSelectAlbum}
            onDownloadAlbum={handleDownloadAlbum}
            onDownloadTrack={handleDownloadTrack}
            onCacheTrack={handleCacheTrack}
            />,
          ))}
        {station === 'search' && (!selectedArtist || albumDrillQuery) &&
          withStationSuspense(
            <LazySearchResultsView
            query={searchQuery}
            loading={searchLoading}
            fromCache={searchFromCache}
            hits={searchHits}
            unified={unifiedSearchResult}
            unifiedLoading={unifiedSearchLoading}
            webSupplementLoading={webSupplementLoading}
            webSupplementError={webSupplementError}
            activeSection={searchSection}
            onSectionChange={setSearchSection}
            albumContext={albumDrillAlbum}
            albumTracks={albumDrillTracks}
            activeEnvelopeId={audio.envelope?.envelopeId ?? null}
            playingEnvelope={audio.envelope}
            onBack={albumDrillQuery && selectedArtist ? handleAlbumBack : handleSearchBack}
            onPlay={(env, candidates) => void handleSearchPlay(env, candidates)}
            onTrackTitleTap={
              showMobileShell ? handleMobileTrackTitleTap : undefined
            }
            onPlaySource={handlePlaySource}
            onAddToQueue={(env) => {
              setPlayQueue((q) => (q.some((e) => e.envelopeId === env.envelopeId) ? q : [...q, env]));
            }}
            onDownloadHit={handleDownloadSearchHit}
            onAcquireAndPlay={handleAcquireAndPlayHit}
            onDownloadAlbum={handleDownloadAlbum}
            onStreamHit={handleStreamSearchHit}
            onCacheHit={handleCacheSearchHit}
            onSelectArtist={handleSelectArtist}
            onSelectAlbum={handleSelectAlbum}
            onSelectPlaylist={handleSelectPlaylist}
            onPlayCatalogTrack={handleSelectTrack}
            onRetryTrack={(jobId, trackId) => {
              void retryTrackInDownloadJob(jobId, trackId);
            }}
            onPlayAlbum={handlePlayAlbum}
            onGoToArtistByName={(name) => void handleOpenArtistByName(name)}
            onGoToAlbumByName={handleOpenAlbumByName}
            onAnalyzeStems={showMobileShell ? handleAnalyzeStems : undefined}
            onRemoveLockerEntry={(entry) => setLockerRemoveConfirm(entry)}
            podcastHits={podcastSearchHits}
            podcastCatalogHits={podcastCatalogHits}
            onPlayPodcast={(env) => void handlePlayEnvelope(env)}
            />,
          )}
        <div
          className={station === 'locker' ? 'flex flex-col min-h-0 flex-1' : 'hidden'}
          aria-hidden={station !== 'locker'}
        >
          {withStationSuspense(
            <LazyCollectionView
            section={lockerSection}
            onSectionChange={setLockerSection}
            homeResetKey={lockerHomeResetKey}
            lockerDrillBackRef={lockerDrillBackRef}
            vm={{
              url: audio.url,
              title: audio.title,
              state: audio.state,
            }}
            activeEnvelopeId={audio.envelope?.envelopeId ?? null}
            meshResults={searchResults}
            lockerTracks={lockerEnvelopes}
            onPlay={(env) => void handleLockerTrackPlay(env)}
            onPlayAlbum={handlePlayAlbum}
            onPlayNext={handlePlayNext}
            onPrepareForTravel={(tracks) => void handlePrepareForTravel(tracks)}
            onAddToQueue={handleAddToQueue}
            onRunSearch={(q) => void runSearch(q)}
            onGoToPlaylists={() => {
              setLockerSection('playlists');
              setStation('locker');
            }}
            initialOpenPlaylistId={focusPlaylistId}
            onOpenPlaylistHandled={() => setFocusPlaylistId(null)}
            onDownloadImportedPlaylist={(pl) => handleDownloadImportedPlaylist(pl)}
            onSelectArtist={(name) => void handleOpenArtistByName(name)}
            onGoToAlbum={handleOpenAlbumByName}
            onOpenListening={() => setStation('insights')}
            onSendToDj={proAudio && !showMobileShell ? handleSendToDj : undefined}
            onAnalyzeStems={showMobileShell ? handleAnalyzeStems : undefined}
            releaseNotifCount={discoverStationEnabled ? discoverReleaseBadge : 0}
            onOpenReleaseFeed={
              discoverStationEnabled
                ? () => handleMobileMenuSelect('discover-feed')
                : undefined
            }
            />,
          )}
        </div>
        {station === 'podcasts' && podcastsEnabled &&
          withStationSuspense(
            <LazyPodcastsView
            activeEnvelopeId={podcastsActiveEnvelopeId}
            onPlay={(env) => void handlePlayEnvelope(env)}
            onPrimePlay={primePlayEnvelope}
            onAddToQueue={(env) => handleAddToQueue([env])}
            onQueueShowUnplayed={handleQueueShowUnplayed}
            drillBackRef={podcastsDrillBackRef}
            episodeNotifCount={podcastEpisodeBadge}
          />,
          )}
        {station === 'audiobooks' && audiobooksEnabled &&
          withStationSuspense(
            <LazyAudiobooksView
              onPlay={(env) => void handlePlayEnvelope(env)}
              onPlayAlbum={(tracks, shuffle) => void handlePlayAlbum(tracks, shuffle)}
              onPrimePlay={(env) => audio.primePlaybackGesture(env)}
              activeEnvelopeId={audio.envelope?.envelopeId}
              onError={(msg) => showAppToast(msg, 5000)}
              drillBackRef={audiobooksDrillBackRef}
            />,
            'audiobooks',
          )}
        {station === 'library' && libraryStationEnabled &&
          withStationSuspense(
            <LazyLibraryStationView
              onPlay={(env) => void handlePlayEnvelope(env, undefined, { seedSearchQueue: true })}
              onPlayAlbum={(tracks, shuffle) => void handlePlayAlbum(tracks, shuffle)}
            />,
            'library',
          )}
        {station === 'dj' && proAudio &&
          withStationSuspense(
            <LazyDJStationView
            lockerTracks={lockerTracks}
            pendingDeckLoad={pendingDjDeckLoad}
            onPendingDeckLoadConsumed={() => setPendingDjDeckLoad(null)}
          />,
          )}
        {station === 'settings' &&
          withStationSuspense(
            <LazySettingsView
            profileName={profileName}
            initialTab={settingsInitialTab}
            onSignOut={profile.signOut}
            onProAudioChange={(enabled) => {
              setProAudio(enabled);
              if (!enabled && station === 'dj') setStation('home');
            }}
            onPodcastsChange={(enabled) => {
              setPodcastsEnabled(enabled);
              if (!enabled) {
                setPodcastSearchHits([]);
                if (station === 'podcasts') setStation('home');
              }
            }}
            onAudiobooksChange={(enabled) => {
              setAudiobooksEnabled(enabled);
              if (!enabled && station === 'audiobooks') setStation('home');
            }}
            onDiscoverChange={(enabled) => {
              setDiscoverStationEnabled(enabled);
              if (!enabled && station === 'discover') setStation('home');
            }}
            onLibraryChange={(enabled) => {
              setLibraryStationEnabled(enabled);
              if (!enabled && station === 'library') setStation('home');
            }}
            onSonicLockerChange={(enabled) => {
              setSonicLockerEnabled(enabled);
              if (!enabled && station === 'sonic-locker') setStation('home');
            }}
            onOpenListening={() => setStation('insights')}
            downloadTierPreference={downloadTierPreference}
            onDownloadTierChange={handleDownloadTierChange}
            onMobileDrillChange={setSettingsMobileDrill}
            settingsDrillBackRef={settingsDrillBackRef}
          />,
          )}
      </main>

      {castMode === 'overlay' ? <CinemaCastOverlay /> : null}
      {videoFeedOpen ? (
        <VerticalVideoFeed open onClose={() => setVideoFeedOpen(false)} />
      ) : null}

      <CastPicker
        open={castPickerOpen}
        onClose={() => setCastPickerOpen(false)}
        envelope={audio.envelope}
        title={homeTitle}
        artist={homeArtist}
        artworkUrl={nowPlayingDisplay.artworkUrl || audio.envelope?.artworkUrl}
        isPlaying={audio.state === 'Playing' || audio.nativeExoEffectivePlaying}
        currentTimeSeconds={audio.currentTimeSeconds}
        durationSeconds={audio.durationSeconds}
      />

      {isTV ? (
        <TVQueuePanel
          open={tvQueueOpen}
          onClose={() => setTvQueueOpen(false)}
          playQueue={playQueue}
          queueIndex={queueIndex}
          activeEnvelope={audio.envelope}
          hasActivePlayback={hasActivePlayback}
          onRemove={handleRemoveFromQueue}
          onClear={handleClearQueue}
          onGoToArtist={(name) => void handleOpenArtistByName(name)}
          onGoToAlbum={handleOpenAlbumByName}
        />
      ) : (
        <QueueDrawer
          open={queueDrawerOpen}
          onClose={() => setQueueDrawerOpen(false)}
          playQueue={playQueue}
          queueIndex={queueIndex}
          activeEnvelope={audio.envelope}
          hasActivePlayback={hasActivePlayback}
          recentHistory={recentPlayHistory}
          suggestedTracks={suggestedQueueTracks}
          mobile={showMobileShell}
          showPlayerBarOffset={showMobileShell ? mobileUsesPlayerPadding : showBottomPlayer}
          onRemove={handleRemoveFromQueue}
          onReorderUpNext={handleReorderUpNext}
          onClear={handleClearQueue}
          onSaveAsPlaylist={handleSaveQueueAsPlaylist}
          onAddSuggested={(env) => {
            handleAddToQueue([env]);
            showAppToast('Added to queue');
          }}
          onPlaySuggested={(env) => void handlePlayEnvelope(env, findHitCandidates(env))}
          onGoToArtist={(name) => void handleOpenArtistByName(name)}
          onGoToAlbum={handleOpenAlbumByName}
        />
      )}

      <SleepTimerPanel
        open={sleepTimerPanelOpen}
        onClose={() => setSleepTimerPanelOpen(false)}
      />

      <MixRadioSaveDialog
        open={mixRadioSaveOpen}
        onClose={() => setMixRadioSaveOpen(false)}
        session={mixRadioSession}
        tracks={playQueue}
        onSave={handleSaveMixRadio}
        saving={mixRadioSaveBusy}
      />

      {appToast ? (
        <div
          role="status"
          className={`app-toast fixed left-1/2 -translate-x-1/2 z-[80] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl border shadow-2xl font-mono text-xs font-semibold bg-accent-soft border-accent/30 text-accent${
            showMobileShell ? ' app-toast--mobile-shell' : ' bottom-24'
          }`}
        >
          {appToast}
        </div>
      ) : null}

      <LyricsDrawer
        open={lyricsDrawerOpen}
        onClose={() => setLyricsDrawerOpen(false)}
        title={lyricsTitle}
        artist={lyricsArtist}
        lyrics={activeLyrics}
        currentTimeSeconds={lyricsCurrentTimeSeconds}
        isPlaying={lyricsIsPlaying}
        onSeek={handleLyricsSeek}
        onRetry={resolveActiveLyrics}
        showPlayerBarOffset={showMobileShell ? mobileUsesPlayerPadding : showBottomPlayer}
        isMobile={showMobileShell}
      />

      {showCarModeOffer ? (
        <div className="car-mode-offer" role="dialog" aria-label="Car mode suggestion">
          <p className="car-mode-offer-title">Driving?</p>
          <p className="ui-hint text-xs">
            Switch to Car Mode for large controls and locked navigation while you drive.
          </p>
          <div className="car-mode-offer-actions">
            <button
              type="button"
              className="car-mode-offer-btn car-mode-offer-btn--primary touch-manipulation"
              onClick={handleEnterCarMode}
            >
              Enter Car Mode
            </button>
            <button
              type="button"
              className="car-mode-offer-btn car-mode-offer-btn--ghost touch-manipulation"
              onClick={() => {
                saveCarModeOfferDismissed(true);
                setCarOfferDismissed(true);
              }}
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}

      {showMobileShell ? (
        <>
          <MobileNavMoreSheet
            open={mobileMenuOpen}
            onClose={() => setMobileMenuOpen(false)}
            items={mobileMenuItems}
            activeId={mobileMenuActiveId}
            onSelect={handleMobileMenuSelect}
          />
          <MobileDockWithShell
          showMiniPlayer={showMobileDockBar}
          navItems={mobileTabItems}
          navActiveId={mobileTabActiveId}
          onNavigate={handleMobileTabNavigate}
          navBadges={mobileNavBadges}
          shell={{
            active: mobilePlaybackShellActive,
            station,
            mobileSearchOpen,
            nowPlayingOpen: mobileNowPlayingOpen,
            onNowPlayingOpenChange: setMobileNowPlayingOpen,
            onNavigateHome: openHomePlayer,
            playerBar: {
                  audio,
                  artworkUrl: displayArt,
                  shuffleOn,
                  repeatMode,
                  thumbUp,
                  thumbDown,
                  castState: speakerCast,
                  onOpenCastPicker: openCastPicker,
                  onShuffleToggle: () => setShuffleOn((s) => !s),
                  onRepeatCycle: cycleRepeat,
                  onSkipBack: skipBack,
                  onSkipForward: skipForward,
                  onThumbUp: handleThumbUp,
                  onThumbDown: handleThumbDown,
                  queueOpen: queueDrawerOpen,
                  queueCount: playQueue.length,
                  onToggleQueue: () => {
                    setLyricsDrawerOpen(false);
                    setQueueDrawerOpen((o) => !o);
                  },
                  lyricsOpen: lyricsDrawerOpen,
                  onToggleLyrics: () => {
                    setQueueDrawerOpen(false);
                    setSleepTimerPanelOpen(false);
                    setLyricsDrawerOpen((o) => !o);
                  },
                  sleepTimerOpen: sleepTimerPanelOpen,
                  onToggleSleepTimer: () => {
                    setQueueDrawerOpen(false);
                    setLyricsDrawerOpen(false);
                    setSleepTimerPanelOpen((o) => !o);
                  },
                  sleepTimerLabel,
                  connectRemote: effectiveConnectRole === 'remote',
                  remoteMirror,
                  onRemoteTogglePlay: togglePlay,
                  onRemoteSeek: (seconds) => sendConnectCommand({ cmd: 'SEEK_TO', seconds }),
                  onRemoteSetVolume: (volume) => sendConnectCommand({ cmd: 'SET_VOLUME', volume }),
                  onRemoteToggleMute: () => {
                    const v = remoteMirror?.volume ?? 0;
                    sendConnectCommand({ cmd: 'SET_VOLUME', volume: v > 0 ? 0 : 1 });
                  },
                  onEnterCarMode: handleEnterCarMode,
                  mixRadioEnabled: audio.state !== 'Idle' && Boolean(audio.envelope),
                  onArtistMix: () => void handleArtistMix(),
                  onTrackRadio: () => void handleTrackRadio(),
                  mixRadioSession,
                  saveMixRadioEnabled: Boolean(mixRadioSession) && playQueue.length > 0,
                  onSaveMixRadioToPlaylist: () => setMixRadioSaveOpen(true),
                  onGoToArtist: (name) => void handleOpenArtistByName(name),
                  onGoToAlbum: handleOpenAlbumByName,
                  onDismissStuck: handleDismissStuckPlayback,
                  resumeQueueCount: showResumeQueuePrompt ? resumeQueueCandidate.length : 0,
                  onResumeQueue: showResumeQueuePrompt ? handleResumeLastQueue : undefined,
                  downloadEnabled: playerDownloadEnabled,
                  onDownloadTrack: downloadCurrentTrack,
                  resolvePending:
                    mobilePlayerPending ||
                    (effectiveConnectRole !== 'remote' &&
                      (audio.state === 'Resolving' || audio.state === 'Connecting')),
                  isPodcast: npIsPodcast,
                  podcastChapterTitle: activePodcastChapter?.title ?? null,
                  hasPodcastChapters: podcastChapters.length > 0,
                  onPodcastPrevChapter: handlePodcastPrevChapter,
                  onPodcastNextChapter: handlePodcastNextChapter,
                  onOpenPodcastChapters: () => setPodcastChaptersOpen(true),
                  canPodcastPrevChapter,
                  canPodcastNextChapter,
                  onSkipPodcastAd: handleSkipPodcastAd,
                  podcastSkipAdHint,
                  podcastPlaybackSpeed,
                  onCyclePodcastSpeed: handleCyclePodcastSpeed,
                  podcastSmartSpeedEnabled,
                  onTogglePodcastSmartSpeed: handleTogglePodcastSmartSpeed,
                  podcastVoiceBoostEnabled,
                  onTogglePodcastVoiceBoost: handleTogglePodcastVoiceBoost,
                  episodeVolumeBoostDb,
                  onCycleEpisodeVolumeBoost: handleCycleEpisodeVolumeBoost,
                  podcastSkipAdChaptersEnabled,
                  onTogglePodcastSkipAdChapters: handleTogglePodcastSkipAdChapters,
            },
            nowPlaying: {
                  open: mobileNowPlayingOpen,
                  onClose: () => setMobileNowPlayingOpen(false),
                  profileName,
                  onOpenProfile: openSettings,
                  title: homeTitle,
                  artist: homeArtist,
                  album: homeAlbum,
                  albumArt: displayArt,
                  envelope: npEnvelope,
                  onGoToArtist: (name) => void handleOpenArtistByName(name),
                  onGoToAlbum: handleOpenAlbumByName,
                  currentTimeSeconds: npCurrentTimeSeconds,
                  durationSeconds: npDurationSeconds,
                  isPlaying: npIsPlaying,
                  isBusy: npIsBusy,
                  shuffleOn,
                  repeatMode,
                  onShuffleToggle: () => setShuffleOn((s) => !s),
                  onRepeatCycle: cycleRepeat,
                  onSkipBack: skipBack,
                  onSkipForward: skipForward,
                  onTogglePlay: togglePlay,
                  onSeek: (seconds) => {
                    if (serverStemMix.stemMixActive) {
                      serverStemMix.seekStemPlayback(seconds);
                      return;
                    }
                    if (isConnectRemote) sendConnectCommand({ cmd: 'SEEK_TO', seconds });
                    else audio.seek(seconds);
                  },
                  onScrubStart: () => {
                    if (!serverStemMix.stemMixActive && !isConnectRemote) audio.beginScrub();
                  },
                  onScrubEnd: () => {
                    if (!serverStemMix.stemMixActive && !isConnectRemote) audio.endScrub();
                  },
                  onRestart: () => {
                    if (serverStemMix.stemMixActive) serverStemMix.seekStemPlayback(0);
                    else audio.seek(0);
                  },
                  onOpenLyrics: () => {
                    setQueueDrawerOpen(false);
                    setSleepTimerPanelOpen(false);
                    setLyricsDrawerOpen(true);
                  },
                  onOpenCast: openCastPicker,
                  onOpenQueue: () => {
                    setLyricsDrawerOpen(false);
                    setMobileNowPlayingOpen(false);
                    setQueueDrawerOpen(true);
                  },
                  castState: speakerCast,
                  playingFromLabel: mobilePlayingFromLabel,
                  onGoToVinyl: () => {
                    saveHeroDisplayMode('vinyl-shades');
                    setHeroDisplayMode('vinyl-shades');
                    setMobileNowPlayingOpen(false);
                    setStation('home');
                  },
                  mixRadioEnabled: audio.state !== 'Idle' && Boolean(audio.envelope),
                  onArtistMix: () => void handleArtistMix(),
                  onTrackRadio: () => void handleTrackRadio(),
                  mixRadioSession,
                  saveMixRadioEnabled: Boolean(mixRadioSession) && playQueue.length > 0,
                  onSaveMixRadioToPlaylist: () => setMixRadioSaveOpen(true),
                  onToggleSleepTimer: () => {
                    setQueueDrawerOpen(false);
                    setLyricsDrawerOpen(false);
                    setSleepTimerPanelOpen((o) => !o);
                  },
                  sleepTimerOpen: sleepTimerPanelOpen,
                  sleepTimerLabel,
                  onEnterCarMode: handleEnterCarMode,
                  resumeQueueCount: showResumeQueuePrompt ? resumeQueueCandidate.length : 0,
                  onResumeQueue: showResumeQueuePrompt ? handleResumeLastQueue : undefined,
                  downloadEnabled: playerDownloadEnabled,
                  onDownloadTrack: downloadCurrentTrack,
                  showMobileShell,
                  audioState: audio.state,
                  onCancelResolve: handleDismissStuckPlayback,
                  stemSliders: stemSlidersPanelProps,
                  isPodcast: npIsPodcast,
                  podcastPlaybackSpeed,
                  onCyclePodcastSpeed: handleCyclePodcastSpeed,
                  podcastSmartSpeedEnabled,
                  onTogglePodcastSmartSpeed: handleTogglePodcastSmartSpeed,
                  podcastVoiceBoostEnabled,
                  onTogglePodcastVoiceBoost: handleTogglePodcastVoiceBoost,
                  episodeVolumeBoostDb,
                  onCycleEpisodeVolumeBoost: handleCycleEpisodeVolumeBoost,
                  onOpenPodcastChapters: () => setPodcastChaptersOpen(true),
                  hasPodcastChapters: podcastChapters.length > 0,
                  podcastSkipAdChaptersEnabled,
                  onTogglePodcastSkipAdChapters: handleTogglePodcastSkipAdChapters,
                  onSkipPodcastAd: handleSkipPodcastAd,
                  podcastSkipAdHint,
                  thumbUp,
                  thumbDown,
                  onThumbUp: handleThumbUp,
                  onThumbDown: handleThumbDown,
            },
          }}
        />
        </>
      ) : null}

      {npIsPodcast ? (
        <PodcastChapterSheet
          open={podcastChaptersOpen}
          onClose={() => setPodcastChaptersOpen(false)}
          title={homeTitle}
          feedTitle={homeArtist}
          chapters={podcastChapters}
          currentTimeSeconds={npCurrentTimeSeconds}
          onSeek={(seconds) => audio.seek(seconds)}
        />
      ) : null}

      {showBottomPlayer && !showMobileShell && (
        <PlayerBar
          audio={audio}
          artworkUrl={displayArt}
          shuffleOn={shuffleOn}
          repeatMode={repeatMode}
          thumbUp={thumbUp}
          thumbDown={thumbDown}
          castState={speakerCast}
          onOpenCastPicker={openCastPicker}
          onShuffleToggle={() => setShuffleOn((s) => !s)}
          onRepeatCycle={cycleRepeat}
          onSkipBack={skipBack}
          onSkipForward={skipForward}
          onThumbUp={handleThumbUp}
          onThumbDown={handleThumbDown}
          queueOpen={queueDrawerOpen}
          queueCount={playQueue.length}
          onToggleQueue={() => {
            setLyricsDrawerOpen(false);
            setQueueDrawerOpen((o) => !o);
          }}
          lyricsOpen={lyricsDrawerOpen}
          onToggleLyrics={() => {
            setQueueDrawerOpen(false);
            setSleepTimerPanelOpen(false);
            setLyricsDrawerOpen((o) => !o);
          }}
          sleepTimerOpen={sleepTimerPanelOpen}
          onToggleSleepTimer={() => {
            setQueueDrawerOpen(false);
            setLyricsDrawerOpen(false);
            setSleepTimerPanelOpen((o) => !o);
          }}
          sleepTimerLabel={sleepTimerLabel}
          connectRemote={effectiveConnectRole === 'remote'}
          remoteMirror={remoteMirror}
          onRemoteTogglePlay={togglePlay}
          onRemoteSeek={(seconds) => sendConnectCommand({ cmd: 'SEEK_TO', seconds })}
          localPlaybackOverride={
            serverStemMix.stemMixActive
              ? {
                  currentTimeSeconds: serverStemMix.stemTimeSeconds,
                  isPlaying: serverStemMix.stemPlaying,
                  onTogglePlay: () => serverStemMix.toggleStemPlayback(),
                  onSeek: serverStemMix.seekStemPlayback,
                }
              : undefined
          }
          onRemoteSetVolume={(volume) => sendConnectCommand({ cmd: 'SET_VOLUME', volume })}
          onRemoteToggleMute={() => {
            const v = remoteMirror?.volume ?? 0;
            sendConnectCommand({ cmd: 'SET_VOLUME', volume: v > 0 ? 0 : 1 });
          }}
          onEnterCarMode={handleEnterCarMode}
          onOpenHero={
            miniPlayerNavigatesHome ? openHomePlayer : undefined
          }
          mixRadioEnabled={audio.state !== 'Idle' && Boolean(audio.envelope)}
          onArtistMix={() => void handleArtistMix()}
          onTrackRadio={() => void handleTrackRadio()}
          mixRadioSession={mixRadioSession}
          discoverySkipOnly={mixRadioSession?.skipOnly === true}
          saveMixRadioEnabled={Boolean(mixRadioSession) && playQueue.length > 0}
          onSaveMixRadioToPlaylist={() => setMixRadioSaveOpen(true)}
          onGoToArtist={(name) => void handleOpenArtistByName(name)}
          onGoToAlbum={handleOpenAlbumByName}
          onDismissStuck={handleDismissStuckPlayback}
          resumeQueueCount={showResumeQueuePrompt ? resumeQueueCandidate.length : 0}
          onResumeQueue={showResumeQueuePrompt ? handleResumeLastQueue : undefined}
          isPodcast={npIsPodcast}
          podcastChapterTitle={activePodcastChapter?.title ?? null}
          hasPodcastChapters={podcastChapters.length > 0}
          onPodcastPrevChapter={handlePodcastPrevChapter}
          onPodcastNextChapter={handlePodcastNextChapter}
          onOpenPodcastChapters={() => setPodcastChaptersOpen(true)}
          canPodcastPrevChapter={canPodcastPrevChapter}
          canPodcastNextChapter={canPodcastNextChapter}
          onSkipPodcastAd={handleSkipPodcastAd}
          podcastSkipAdHint={podcastSkipAdHint}
          podcastPlaybackSpeed={podcastPlaybackSpeed}
          onCyclePodcastSpeed={handleCyclePodcastSpeed}
          podcastSmartSpeedEnabled={podcastSmartSpeedEnabled}
          onTogglePodcastSmartSpeed={handleTogglePodcastSmartSpeed}
          podcastVoiceBoostEnabled={podcastVoiceBoostEnabled}
          onTogglePodcastVoiceBoost={handleTogglePodcastVoiceBoost}
          episodeVolumeBoostDb={episodeVolumeBoostDb}
          onCycleEpisodeVolumeBoost={handleCycleEpisodeVolumeBoost}
          podcastSkipAdChaptersEnabled={podcastSkipAdChaptersEnabled}
          onTogglePodcastSkipAdChapters={handleTogglePodcastSkipAdChapters}
          resolvePending={
            mobilePlayerPending ||
            (effectiveConnectRole !== 'remote' &&
              (audio.state === 'Resolving' || audio.state === 'Connecting'))
          }
        />
      )}
    </div>
    </LockerVaultProvider>
  );
}
