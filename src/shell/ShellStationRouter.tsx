/**
 * Lazy station mounts for the shell — insights through settings.
 * Extracted from sandboxLayer3 so the route switch can live beside the other shell modules.
 * Home / TV home chrome stays in the shell (player surface, not a station chunk).
 */

import React from 'react';
import AppErrorBoundary from '../components/AppErrorBoundary';
import ArtistDetailView from '../stations/ArtistDetailView';
import {
  LazyArtistDetailView,
  LazyAudiobooksView,
  LazyCollectionView,
  LazyDiscoverStationView,
  LazyLibraryHealthView,
  LazyPhysicalCollectionView,
  LazyDJStationView,
  LazyLibraryStationView,
  LazyListeningStatsView,
  LazyPodcastsView,
  LazySearchResultsView,
  LazySettingsView,
  LazySonicLockerStationView,
  withStationSuspense,
} from './lazyStationViews';

/** Props match the former inline station JSX in sandboxLayer3 — plumbed as a bag. */
export function ShellStationRouter(p: Record<string, any>) {
  const {
    station,
    setStation,
    sonicLockerEnabled,
    lockerEnvelopes,
    audio,
    handleSonicLockerPlayQueue,
    handlePlayEnvelope,
    findHitCandidates,
    handleSonicLockerSaveMix,
    handleSonicLockerDiscoveryStation,
    discoverStationEnabled,
    discoverTab,
    setDiscoverTab,
    musicSegmentBar,
    discoverDrillFromTab,
    setDiscoverDrillFromTab,
    playlistsDrillBackRef,
    exploreDrillBackRef,
    searchResults,
    focusPlaylistId,
    setFocusPlaylistId,
    pendingShareImport,
    setPendingShareImport,
    pendingExternalImport,
    setPendingExternalImport,
    handlePlayAlbum,
    handlePlayDiscoveryMix,
    handlePlayNext,
    handlePrepareForTravel,
    runSearch,
    setLockerSection,
    handleDownloadImportedPlaylist,
    runExploreSearch,
    handleExploreInstantMix,
    handleSaveInstantPlaylist,
    handleDownloadMix,
    handleShareMix,
    mfyDrillBackRef,
    videosEnabled,
    handleOpenVideoFeed,
    selectedArtist,
    albumDrillQuery,
    showMobileShell,
    handleArtistBack,
    handleMobileTrackTitleTap,
    openMobileNowPlaying,
    showAppToast,
    handleAddToQueue,
    handleSelectAlbum,
    handleDownloadAlbum,
    handleDownloadTrack,
    handleCacheTrack,
    searchQuery,
    searchLoading,
    searchFromCache,
    searchHits,
    unifiedSearchResult,
    unifiedSearchLoading,
    webSupplementLoading,
    webSupplementError,
    searchSection,
    setSearchSection,
    albumDrillAlbum,
    albumDrillTracks,
    handleAlbumBack,
    handleSearchBack,
    handleSearchPlay,
    handlePlaySource,
    setPlayQueue,
    handleDownloadSearchHit,
    handleAcquireAndPlayHit,
    handleStreamSearchHit,
    handleCacheSearchHit,
    handleSelectArtist,
    handleSelectPlaylist,
    handleSelectTrack,
    retryTrackInDownloadJob,
    handleOpenArtistByName,
    handleOpenAlbumByName,
    handleAnalyzeStems,
    setLockerRemoveConfirm,
    podcastSearchHits,
    podcastCatalogHits,
    lockerSection,
    lockerHomeResetKey,
    lockerDrillBackRef,
    openStationDownloads,
    mobileDownloadBadge,
    handleLockerTrackPlay,
    proAudio,
    handleSendToDj,
    discoverReleaseBadge,
    handleMobileMenuSelect,
    podcastsMounted,
    podcastsEnabled,
    podcastsActiveEnvelopeId,
    primePlayEnvelope,
    handleQueueShowUnplayed,
    podcastsDrillBackRef,
    podcastEpisodeBadge,
    podcastDownloadBadge,
    audiobooksMounted,
    audiobooksEnabled,
    npCurrentTimeSeconds,
    setSettingsInitialTab,
    audiobooksDrillBackRef,
    audiobookDownloadBadge,
    libraryStationEnabled,
    lockerTracks,
    pendingDjDeckLoad,
    setPendingDjDeckLoad,
    profileName,
    settingsInitialTab,
    profile,
    setProAudio,
    setPodcastsEnabled,
    setPodcastSearchHits,
    setAudiobooksEnabled,
    setDiscoverStationEnabled,
    setLibraryStationEnabled,
    setSonicLockerEnabled,
    downloadTierPreference,
    handleDownloadTierChange,
    setSettingsMobileDrill,
    settingsDrillBackRef,
  } = p;

  return (
    <>
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
        {station === 'health' &&
          withStationSuspense(
            <div className="flex flex-col min-h-0 flex-1">
              <LazyLibraryHealthView />
            </div>,
          )}
        {station === 'collection' &&
          withStationSuspense(
            <div className="flex flex-col min-h-0 flex-1">
              <LazyPhysicalCollectionView />
            </div>,
          )}
        {station === 'discover' && discoverStationEnabled &&
          withStationSuspense(
            <LazyDiscoverStationView
            activeTab={discoverTab}
            onTabChange={setDiscoverTab}
            onExitToHome={() => setStation('home')}
            segmentBar={musicSegmentBar}
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
            onDownloadMix={handleDownloadMix}
            onShareMix={(mix) => void handleShareMix(mix)}
            mfyDrillBackRef={mfyDrillBackRef}
            onOpenVideoFeed={videosEnabled ? handleOpenVideoFeed : undefined}
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
        {/* Cross-format results (Music / Pods / Books) sit above the music-specific
            results, so one query answers across all three pillars. */}
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
            sectionBar={musicSegmentBar}
            homeResetKey={lockerHomeResetKey}
            lockerDrillBackRef={lockerDrillBackRef}
            onOpenDownloads={() => openStationDownloads('music')}
            downloadAttentionCount={mobileDownloadBadge}
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
        {podcastsMounted && podcastsEnabled && (
          <div
            className={station === 'podcasts' ? 'flex flex-col min-h-0 flex-1' : 'hidden'}
            aria-hidden={station !== 'podcasts'}
          >
            {withStationSuspense(
              <LazyPodcastsView
                activeEnvelopeId={podcastsActiveEnvelopeId}
                onPlay={(env) => void handlePlayEnvelope(env)}
                onPrimePlay={primePlayEnvelope}
                onAddToQueue={(env) => handleAddToQueue([env])}
                onQueueShowUnplayed={handleQueueShowUnplayed}
                drillBackRef={podcastsDrillBackRef}
                episodeNotifCount={podcastEpisodeBadge}
                onOpenDownloads={() => openStationDownloads('podcast')}
                downloadAttentionCount={podcastDownloadBadge}
              />,
            )}
          </div>
        )}
        {audiobooksMounted && audiobooksEnabled && (
          <div
            className={station === 'audiobooks' ? 'flex flex-col min-h-0 flex-1' : 'hidden'}
            aria-hidden={station !== 'audiobooks'}
          >
            {withStationSuspense(
              <LazyAudiobooksView
                onPlay={(env) => void handlePlayEnvelope(env)}
                onPlayAlbum={(tracks, shuffle, resume) =>
                  void handlePlayAlbum(tracks, shuffle, resume)
                }
                onPrimePlay={(env) => audio.primePlaybackGesture(env)}
                activeEnvelopeId={audio.envelope?.envelopeId}
                playheadSeconds={npCurrentTimeSeconds}
                onError={(msg) => showAppToast(msg, 5000)}
                onSuccess={(msg) => showAppToast(msg, 6000)}
                onOpenAcquireSettings={() => {
                  setSettingsInitialTab('addons');
                  setStation('settings');
                }}
                drillBackRef={audiobooksDrillBackRef}
                onOpenDownloads={() => openStationDownloads('audiobook')}
                downloadAttentionCount={audiobookDownloadBadge}
              />,
              'audiobooks',
            )}
          </div>
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
            }}
            onPodcastsChange={(enabled) => {
              setPodcastsEnabled(enabled);
              if (!enabled) {
                setPodcastSearchHits([]);
              }
            }}
            onAudiobooksChange={(enabled) => {
              setAudiobooksEnabled(enabled);
            }}
            onDiscoverChange={(enabled) => {
              setDiscoverStationEnabled(enabled);
            }}
            onLibraryChange={(enabled) => {
              setLibraryStationEnabled(enabled);
            }}
            onSonicLockerChange={(enabled) => {
              setSonicLockerEnabled(enabled);
            }}
            onOpenListening={() => setStation('insights')}
            downloadTierPreference={downloadTierPreference}
            onDownloadTierChange={handleDownloadTierChange}
            onMobileDrillChange={setSettingsMobileDrill}
            settingsDrillBackRef={settingsDrillBackRef}
          />,
          )}

    </>
  );
}
