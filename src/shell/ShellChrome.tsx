/**
 * Shell chrome — the main SandboxShell render tree: search chrome, station nav, station router,
 * home/TV views, drawers (queue/lyrics/sleep timer), overlays (cast, mix-radio save, add-to-
 * playlist, podcast chapters), mobile dock/now-playing, and the desktop PlayerBar. Extracted from
 * sandboxLayer3 with no behaviour change.
 *
 * Call this at the shell's original return position, after SandboxShell has computed
 * showBottomPlayer / playbackChromeActive / narrationForPlayer / handleClearPlayer and the other
 * values right above the old return. The car-mode, onboarding, server-setup and SystemLogin early
 * returns stay in the shell since they replace this tree rather than sit inside it.
 *
 * Props are threaded through as a loose bag (Record<string, any>), matching ShellStationRouter's
 * pragmatic style: this tree reads well over a hundred values out of SandboxShell's closure, and a
 * fully named prop type would balloon this diff without adding real safety, since almost every
 * value here is already typed at its point of origin in the shell.
 */

import React from 'react';
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

import CollapsibleStationNav from '../components/CollapsibleStationNav';

import MobileNavMoreSheet, { type MobileNavMoreItem } from '../components/MobileNavMoreSheet';

import UniversalSearchPanel from '../components/UniversalSearchPanel';

import PodcastChapterSheet from '../components/podcasts/PodcastChapterSheet';

import MobileDockWithShell from '../mobile/MobileDockWithShell';

import PlayerBar from '../components/PlayerBar';

import {
  hasMobilePlaybackShell,
  mobileShellUsesPlayerPadding,
  shouldShowMobileInfoStrip,
  shouldShowMobileMiniBar,
  shouldUseAndroidInlinePlayerDock,
} from '../mobile/mobilePlayerShellLogic';

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
} from './shellNav';

import {
  ensureNavPinTabsLayout,
  loadNavPinTabs,
  NAV_PINS_CHANGE_EVENT,
  navPinTabIdSet,
  type NavPinTabId,
} from '../navPinTabs';

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
} from '../lockerStorage';

import { LOCKER_USER_DELETE_CONFIRMED } from '../lockerDeleteGuard';

import { ensureLockerPlayable, envelopeClaimsLocker, shouldRunLockerPlaybackGate } from '../play/ensureLockerPlayable';

import { attemptDeadLockerReacquire } from '../lockerDeadTrackReacquire';

import { loadHeroDisplayMode, saveHeroDisplayMode, resolveHeroShowShades, applyHeroDisplayFromSettingsEvent, toggleHeroDisplayMode } from '../heroDisplaySettings';

import MixRadioSaveDialog from '../components/MixRadioSaveDialog';

import AddToPlaylistPicker from '../components/AddToPlaylistPicker';

import MusicUniverseBackdrop from '../components/MusicUniverseBackdrop';

import HomeActiveWash from '../components/HomeActiveWash';

import HomeView from '../stations/HomeView';

import SearchDropdown from '../components/SearchDropdown';

import { ShellStationRouter } from './ShellStationRouter';

import { LockerVaultProvider } from '../LockerVaultContext';

import {
  buildSearchDropdownItems,
  nextSearchActiveIndex,
  prevSearchActiveIndex,
  type SearchDropdownItem,
} from '../searchDropdownModel';

import { imeSearchInputProps } from '../imeInputProps';

import {
  preserveTappedEnvelopeIdentity,
} from '../playbackPipeline';

import {
  retryTrackInDownloadJob,
  scheduleCatalogAlbumDownload,
  scheduleCatalogTrackDownload,
} from '../acquisitionPipeline';

import DownloadErrorToast from '../components/DownloadErrorToast';

import DownloadActivitySheet, {
  countDownloadSheetBadge,
} from '../components/DownloadActivitySheet';

import AcquireProgressToast from '../components/AcquireProgressToast';

import ConfirmDialog from '../components/ConfirmDialog';

import CastPicker from '../components/CastPicker';

import QueueDrawer from '../components/QueueDrawer';

import TVNavigation, { type TVStationId } from '../components/TVNavigation';

import TVQueuePanel from '../components/TVQueuePanel';

import LyricsDrawer from '../components/LyricsDrawer';

import SleepTimerPanel from '../components/SleepTimerPanel';

import TVHomeView, { type TVRowId } from '../stations/TVHomeView';

import TVPlaybackView from '../stations/TVPlaybackView';

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
} from '../carMode';

import CinemaCastOverlay from '../stations/CinemaCastOverlay';

import VerticalVideoFeed from '../components/discovery/VerticalVideoFeed';

import { searchBarPlaceholder, searchConnectivityHint, useOfflineStatus } from '../offlineStatus';

import { isAndroid, isCapacitorNative } from '../platformEnv';

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
} from '../sandboxSettings';

/** Mirrors the shell's own copies (sandboxLayer3) — see there for the source of truth. */
const STATIONS_WITH_OWN_SEARCH = new Set(['audiobooks', 'podcasts']);
const ANDROID_SERVER_BANNER_KEY = 'sandbox_android_server_banner_dismissed';
const MOBILE_RESOLVER_BANNER_KEY = 'sandbox_mobile_resolver_banner_dismissed';

export function ShellChrome(p: Record<string, any>) {
  const {
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
  } = p;

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
          // Format chooser sits above everything; music browse only shows on Music.
          showMusicBrowse={searchFormat === 'music'}
          formatTabs={
            <UniversalSearchPanel
              tabsOnly
              query={searchInput}
              format={searchFormat}
              onFormatChange={setSearchFormat}
              onSelect={handleUniversalSearchSelect}
            />
          }
          formatResults={
            searchFormat !== 'music' ? (
              <UniversalSearchPanel
                resultsOnly
                query={searchInput}
                format={searchFormat}
                onSelect={handleUniversalSearchSelect}
                onOpenFormat={handleUniversalOpenFormat}
                bookAuthorSeeds={audiobookAuthorSeeds}
                bookOwnedTitles={audiobookOwnedTitles}
              />
            ) : null
          }
          catalog={searchCatalog}
          playlists={unifiedSearchResult.playlists}
          podcastsEnabled={podcastsEnabled}
          videosEnabled={videosEnabled}
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
        kind={mobileDownloadSheetKind}
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
                ) : null}
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

      {/* Search lives on the Home vinyl (see onIdleSearch), but that hit area only exists
          while Home is idle â€” once a track is loaded the vinyl belongs to the player. So
          keep the floating button everywhere EXCEPT idle Home, otherwise Home would have
          no way to reach search at all.

          Also except the stations that carry their own search field. Audiobooks and Podcasts
          each open with a full-width search input, so the floating button put a second search
          affordance on a screen that already had one â€” hovering over the content, no less. */}
      {showMobileShell &&
      !mobileSearchOpen &&
      station !== 'search' &&
      !STATIONS_WITH_OWN_SEARCH.has(station) &&
      !(station === 'home' && !homeHasLoadedTrack) ? (
        <button
          type="button"
          className="mobile-search-fab touch-manipulation"
          onClick={openMobileSearch}
          aria-label={t('nav.search')}
        >
          <Search className="w-5 h-5" strokeWidth={2} />
        </button>
      ) : null}

      {/* No floating download button. Progress belongs with the content it describes â€” a bar at
          the top of the collection and a chip on each track row (CollectionDownloadBar /
          TrackDownloadProgress). The activity sheet remains reachable from the Locker â‹® for the
          queue-wide view: retries, failures, and clearing finished jobs. */}

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
                ? 'shell-main--fab-clear'
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
              onClick={() => openSettings()}
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
              onClick={() => openSettings()}
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
            envelope={authoritativeEnvelope}
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
                            title: env.title,
                          }),
                          5000,
                        );
                        return;
                      }
                      showAppToast(
                        t('player.lockerAudioMissing', {
                          defaultValue:
                            'Offline audio is missing or corrupted on this device â€” open the track menu and download to Locker again',
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
            compact={showMobileShell && (homeHasLoadedTrack || mobilePlayerPending)}
            onOpenNowPlaying={
              // Allow opening the full player while a track is still resolving (yt-dlp can be
              // slow) â€” otherwise the mini bar looked "stuck" and unresponsive during loading.
              showMobileShell && (homeHasLoadedTrack || mobilePlayerPending)
                ? openMobileNowPlaying
                : undefined
            }
            // Idle home vinyl is the app's search gesture (replaces the top-bar magnifier).
            onIdleSearch={showMobileShell ? openMobileSearch : undefined}
            expanded={false}
            showMobileShell={showMobileShell}
            onGoToArtist={(name) => void handleOpenArtistByName(name)}
            onGoToAlbum={handleOpenAlbumByName}
            envelope={homeAwaitingUserResume ? null : authoritativeEnvelope}
            onSkipBack={showMobileShell ? skipBack : undefined}
            onSkipForward={showMobileShell ? skipForward : undefined}
            shuffleOn={shuffleOn}
            onShuffleToggle={() => setShuffleOn((s) => !s)}
            repeatMode={repeatMode}
            onRepeatCycle={cycleRepeat}
            fidelityLabel={playbackFidelityLabel ?? undefined}
            resolveElapsedSeconds={playbackResolveElapsed}
            resolvingNextTrack={nowPlayingAuthority.showResolvingAffordance}
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
                    onAddToPlaylist: npEnvelope
                      ? () => setPlayerAddToPlaylistOpen(true)
                      : undefined,
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
        <ShellStationRouter
          station={station}
          setStation={setStation}
          sonicLockerEnabled={sonicLockerEnabled}
          lockerEnvelopes={lockerEnvelopes}
          audio={audio}
          handleSonicLockerPlayQueue={handleSonicLockerPlayQueue}
          handlePlayEnvelope={handlePlayEnvelope}
          findHitCandidates={findHitCandidates}
          handleSonicLockerSaveMix={handleSonicLockerSaveMix}
          handleSonicLockerDiscoveryStation={handleSonicLockerDiscoveryStation}
          discoverStationEnabled={discoverStationEnabled}
          discoverTab={discoverTab}
          setDiscoverTab={setDiscoverTab}
          musicSegmentBar={musicSegmentBar}
          discoverDrillFromTab={discoverDrillFromTab}
          setDiscoverDrillFromTab={setDiscoverDrillFromTab}
          playlistsDrillBackRef={playlistsDrillBackRef}
          exploreDrillBackRef={exploreDrillBackRef}
          searchResults={searchResults}
          focusPlaylistId={focusPlaylistId}
          setFocusPlaylistId={setFocusPlaylistId}
          pendingShareImport={pendingShareImport}
          setPendingShareImport={setPendingShareImport}
          pendingExternalImport={pendingExternalImport}
          setPendingExternalImport={setPendingExternalImport}
          handlePlayAlbum={handlePlayAlbum}
          handlePlayDiscoveryMix={handlePlayDiscoveryMix}
          handlePlayNext={handlePlayNext}
          handlePrepareForTravel={handlePrepareForTravel}
          runSearch={runSearch}
          setLockerSection={setLockerSection}
          handleDownloadImportedPlaylist={handleDownloadImportedPlaylist}
          runExploreSearch={runExploreSearch}
          handleExploreInstantMix={handleExploreInstantMix}
          handleSaveInstantPlaylist={handleSaveInstantPlaylist}
          handleDownloadMix={handleDownloadMix}
          handleShareMix={handleShareMix}
          mfyDrillBackRef={mfyDrillBackRef}
          videosEnabled={videosEnabled}
          handleOpenVideoFeed={handleOpenVideoFeed}
          selectedArtist={selectedArtist}
          albumDrillQuery={albumDrillQuery}
          showMobileShell={showMobileShell}
          handleArtistBack={handleArtistBack}
          handleMobileTrackTitleTap={handleMobileTrackTitleTap}
          openMobileNowPlaying={openMobileNowPlaying}
          showAppToast={showAppToast}
          handleAddToQueue={handleAddToQueue}
          handleSelectAlbum={handleSelectAlbum}
          handleDownloadAlbum={handleDownloadAlbum}
          handleDownloadTrack={handleDownloadTrack}
          handleCacheTrack={handleCacheTrack}
          searchQuery={searchQuery}
          searchLoading={searchLoading}
          searchFromCache={searchFromCache}
          searchHits={searchHits}
          unifiedSearchResult={unifiedSearchResult}
          unifiedSearchLoading={unifiedSearchLoading}
          webSupplementLoading={webSupplementLoading}
          webSupplementError={webSupplementError}
          searchSection={searchSection}
          setSearchSection={setSearchSection}
          albumDrillAlbum={albumDrillAlbum}
          albumDrillTracks={albumDrillTracks}
          handleAlbumBack={handleAlbumBack}
          handleSearchBack={handleSearchBack}
          handleSearchPlay={handleSearchPlay}
          handlePlaySource={handlePlaySource}
          setPlayQueue={setPlayQueue}
          handleDownloadSearchHit={handleDownloadSearchHit}
          handleAcquireAndPlayHit={handleAcquireAndPlayHit}
          handleStreamSearchHit={handleStreamSearchHit}
          handleCacheSearchHit={handleCacheSearchHit}
          handleSelectArtist={handleSelectArtist}
          handleSelectPlaylist={handleSelectPlaylist}
          handleSelectTrack={handleSelectTrack}
          retryTrackInDownloadJob={retryTrackInDownloadJob}
          handleOpenArtistByName={handleOpenArtistByName}
          handleOpenAlbumByName={handleOpenAlbumByName}
          handleAnalyzeStems={handleAnalyzeStems}
          setLockerRemoveConfirm={setLockerRemoveConfirm}
          podcastSearchHits={podcastSearchHits}
          podcastCatalogHits={podcastCatalogHits}
          lockerSection={lockerSection}
          lockerHomeResetKey={lockerHomeResetKey}
          lockerDrillBackRef={lockerDrillBackRef}
          openStationDownloads={openStationDownloads}
          mobileDownloadBadge={mobileDownloadBadge}
          handleLockerTrackPlay={handleLockerTrackPlay}
          proAudio={proAudio}
          handleSendToDj={handleSendToDj}
          discoverReleaseBadge={discoverReleaseBadge}
          handleMobileMenuSelect={handleMobileMenuSelect}
          podcastsMounted={podcastsMounted}
          podcastsEnabled={podcastsEnabled}
          podcastsActiveEnvelopeId={podcastsActiveEnvelopeId}
          primePlayEnvelope={primePlayEnvelope}
          handleQueueShowUnplayed={handleQueueShowUnplayed}
          podcastsDrillBackRef={podcastsDrillBackRef}
          podcastEpisodeBadge={podcastEpisodeBadge}
          podcastDownloadBadge={podcastDownloadBadge}
          audiobooksMounted={audiobooksMounted}
          audiobooksEnabled={audiobooksEnabled}
          npCurrentTimeSeconds={npCurrentTimeSeconds}
          setSettingsInitialTab={setSettingsInitialTab}
          audiobooksDrillBackRef={audiobooksDrillBackRef}
          audiobookDownloadBadge={audiobookDownloadBadge}
          libraryStationEnabled={libraryStationEnabled}
          lockerTracks={lockerTracks}
          pendingDjDeckLoad={pendingDjDeckLoad}
          setPendingDjDeckLoad={setPendingDjDeckLoad}
          profileName={profileName}
          settingsInitialTab={settingsInitialTab}
          profile={profile}
          setProAudio={setProAudio}
          setPodcastsEnabled={setPodcastsEnabled}
          setPodcastSearchHits={setPodcastSearchHits}
          setAudiobooksEnabled={setAudiobooksEnabled}
          setDiscoverStationEnabled={setDiscoverStationEnabled}
          setLibraryStationEnabled={setLibraryStationEnabled}
          setSonicLockerEnabled={setSonicLockerEnabled}
          downloadTierPreference={downloadTierPreference}
          handleDownloadTierChange={handleDownloadTierChange}
          setSettingsMobileDrill={setSettingsMobileDrill}
          settingsDrillBackRef={settingsDrillBackRef}
        />
      </main>

      {castMode === 'overlay' ? <CinemaCastOverlay /> : null}
      {videoFeedOpen && videosEnabled ? (
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

      <AddToPlaylistPicker
        open={playerAddToPlaylistOpen && Boolean(npEnvelope)}
        onClose={() => setPlayerAddToPlaylistOpen(false)}
        tracks={npEnvelope ? [npEnvelope] : []}
        onDone={(message) => showAppToast(message)}
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
          /*
            The background is in index.css, not here. It used to be bg-accent-soft, which is the
            accent at twelve percent alpha — near enough transparent that genre chips and card
            titles read straight through the words on top of them.
          */
          className={`app-toast fixed left-1/2 -translate-x-1/2 z-[80] max-w-md w-[calc(100%-2rem)] px-4 py-3 rounded-xl border shadow-2xl font-mono text-xs font-semibold border-accent/30 text-accent${
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
        <div className="car-mode-offer" role="dialog" aria-label={t('carMode.suggestion')}>
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
                  artworkUrl: narrationForPlayer?.artworkUrl ?? displayArt,
                  // heldNowPlaying is the override PlayerBar already honours for title, artist and
                  // position, so narration needs no new path through the bar.
                  heldNowPlaying: narrationForPlayer
                    ? {
                        title: narrationForPlayer.title,
                        artist: narrationForPlayer.author?.trim() || 'Read aloud',
                        envelope: null,
                        positionSeconds: narrationForPlayer.elapsedSeconds,
                        durationSeconds: Math.max(1, narrationForPlayer.totalSeconds),
                      }
                    : playerBarHeldNowPlaying,
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
                  onThumbUp: nowPlayingControls.thumbs ? handleThumbUp : undefined,
                  onThumbDown: nowPlayingControls.thumbs ? handleThumbDown : undefined,
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
                  onAddToPlaylist: npEnvelope
                    ? () => setPlayerAddToPlaylistOpen(true)
                    : undefined,
                  mixRadioSession,
                  saveMixRadioEnabled: Boolean(mixRadioSession) && playQueue.length > 0,
                  onSaveMixRadioToPlaylist: () => setMixRadioSaveOpen(true),
                  onGoToArtist: (name) => void handleOpenArtistByName(name),
                  onGoToAlbum: handleOpenAlbumByName,
                  onDismissStuck: handleDismissStuckPlayback,
                  resumeQueueCount: showResumeQueuePrompt ? resumeQueueCandidate.length : 0,
                  onResumeQueue: showResumeQueuePrompt ? handleResumeLastQueue : undefined,
                  onClearPlayer: () => void handleClearPlayer(),
                  downloadEnabled: playerDownloadEnabled,
                  onDownloadTrack: downloadCurrentTrack,
                  resolvePending:
                    mobilePlayerPending ||
                    (effectiveConnectRole !== 'remote' &&
                      (audio.state === 'Resolving' || audio.state === 'Connecting')),
                  isPodcast: npIsPodcast,
                  podcastChapterTitle: activePodcastChapter?.title ?? null,
                  hasPodcastChapters: podcastChapters.length > 0 || bookChapterMarks.length > 1,
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
                  narration: narrationForPlayer,
                  /*
                   * Controls the player may show for what is actually playing. Passing undefined
                   * is how every one of these is hidden already, so forbidding a control is the
                   * same act as not having a handler for it.
                   */
                  pillarControls: nowPlayingControls,
                  chapterWindow: nowPlayingChapterWindow,
                  title: narrationForPlayer ? narrationForPlayer.title : homeTitle,
                  artist: narrationForPlayer
                    ? narrationForPlayer.author?.trim() || 'Read aloud'
                    : homeArtist,
                  album: narrationForPlayer ? undefined : homeAlbum,
                  albumArt: narrationForPlayer?.artworkUrl ?? displayArt,
                  envelope: narrationForPlayer ? null : npEnvelope,
                  onGoToArtist: (name) => void handleOpenArtistByName(name),
                  onGoToAlbum: handleOpenAlbumByName,
                  /*
                   * Position in passages, not seconds. The engine decides how long a passage takes
                   * as it speaks it, so a clock here would be invented; the progress bar still
                   * moves, and it moves for a reason the reader can see.
                   */
                  currentTimeSeconds: narrationForPlayer
                    ? narrationForPlayer.elapsedSeconds
                    : npCurrentTimeSeconds,
                  durationSeconds: narrationForPlayer
                    ? Math.max(1, narrationForPlayer.totalSeconds)
                    : npDurationSeconds,
                  isPlaying: narrationForPlayer
                    ? narrationForPlayer.state === 'speaking'
                    : npIsPlaying,
                  isBusy: npIsBusy,
                  shuffleOn,
                  repeatMode,
                  onShuffleToggle: nowPlayingControls.shuffle
                    ? () => setShuffleOn((s) => !s)
                    : undefined,
                  onRepeatCycle: nowPlayingControls.repeat ? cycleRepeat : undefined,
                  // Skip moves a passage at a time while reading, which is the only unit narration has.
                  onSkipBack: narrationForPlayer
                    ? () =>
                        narrationForPlayer.controls.seekToChunk(
                          Math.max(0, narrationForPlayer.chunkIndex - 1),
                        )
                    : skipBack,
                  onSkipForward: narrationForPlayer
                    ? () =>
                        narrationForPlayer.controls.seekToChunk(
                          Math.min(
                            narrationForPlayer.chunkCount - 1,
                            narrationForPlayer.chunkIndex + 1,
                          ),
                        )
                    : skipForward,
                  onTogglePlay: narrationForPlayer
                    ? () => {
                        if (narrationForPlayer.state === 'speaking') narrationForPlayer.controls.pause();
                        else narrationForPlayer.controls.play();
                      }
                    : togglePlay,
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
                  /*
                   * Supplying this is what makes the queue a sheet over the player instead of a
                   * drawer that replaces it. Without it MobileNowPlayingView falls back to
                   * onOpenQueue above, so the button keeps working either way â€” but the sheet can
                   * only ever open if this object is present, which is the difference between the
                   * component existing and the feature existing.
                   */
                  queueSheet: {
                    playQueue,
                    queueIndex,
                    onRemoveFromQueue: handleRemoveFromQueue,
                    onReorderQueue: handleReorderQueue,
                    // onPlayQueueIndex is deliberately absent: no jump-to-index handler exists in
                    // this file, because the old drawer never let you tap a row to play it either.
                    // The sheet treats it as optional and simply does not make rows tappable, which
                    // is honest â€” a row that looks tappable and silently does nothing is worse.
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
                  onAddToPlaylist: npEnvelope
                    ? () => setPlayerAddToPlaylistOpen(true)
                    : undefined,
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
                  onClearPlayer: () => void handleClearPlayer(),
                  downloadEnabled: playerDownloadEnabled,
                  onDownloadTrack: downloadCurrentTrack,
                  showMobileShell,
                  audioState: audio.state,
                  resolvingNextTrack: nowPlayingAuthority.showResolvingAffordance,
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
                  hasPodcastChapters: podcastChapters.length > 0 || bookChapterMarks.length > 1,
                  podcastSkipAdChaptersEnabled,
                  onTogglePodcastSkipAdChapters: handleTogglePodcastSkipAdChapters,
                  onSkipPodcastAd: handleSkipPodcastAd,
                  podcastSkipAdHint,
                  thumbUp,
                  thumbDown,
                  onThumbUp: nowPlayingControls.thumbs ? handleThumbUp : undefined,
                  onThumbDown: nowPlayingControls.thumbs ? handleThumbDown : undefined,
            },
          }}
        />
        </>
      ) : null}

      {/*
        The same sheet for a book's own chapters.

        Chapters are a table of contents, not a queue: an author's index of one continuous thing,
        with no reordering, no shuffling and nothing to delete. This sheet is already exactly that,
        so a book gets it rather than a second list that would only differ by accident. Seeking is
        the whole interaction, because a chapter in an M4B is an offset in the file that is already
        playing, not a track to switch to.
      */}
      {npIsPodcast || bookChapterMarks.length > 1 ? (
        <PodcastChapterSheet
          open={podcastChaptersOpen}
          onClose={() => setPodcastChaptersOpen(false)}
          title={homeTitle}
          feedTitle={homeArtist}
          chapters={
            npIsPodcast
              ? podcastChapters
              : bookChapterMarks.map((mark, index) => ({
                  startSeconds: mark.startSeconds,
                  // An untitled marker keeps its number rather than being renamed, which is the
                  // one thing the parser deliberately refuses to invent.
                  title: mark.title?.trim() || t('audiobooks.chapterFallback', { number: index + 1 }),
                }))
          }
          currentTimeSeconds={npCurrentTimeSeconds}
          onSeek={(seconds) => audio.seek(seconds)}
        />
      ) : null}

      {showBottomPlayer && !showMobileShell && (
        <PlayerBar
          audio={audio}
          artworkUrl={displayArt}
          heldNowPlaying={playerBarHeldNowPlaying}
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
          onAddToPlaylist={
            npEnvelope ? () => setPlayerAddToPlaylistOpen(true) : undefined
          }
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
          hasPodcastChapters={podcastChapters.length > 0 || bookChapterMarks.length > 1}
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
