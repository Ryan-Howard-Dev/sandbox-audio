import React, { lazy } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ExploreGroup } from '../exploreCatalog';
import type { DiscoveryMix } from '../discoveryMixes';
import { useMobileShell } from '../hooks/useMobileShell';
import { isNativeCapacitorNonTv } from '../hooks/mobileShellLayout';
import { useTranslation } from '../i18n';
import type { LockerSectionId } from './CollectionView';
import {
  DiscoverTabSuspense,
  LazyDiscoverExploreView,
  LazyDiscoverFeedView,
  LazyDiscoverPlaylistsView,
} from './discoverLazyViews';

const LazyMobileDiscoverView = lazy(() => import('./MobileDiscoverView'));

export type DiscoverTabId = 'feed' | 'explore' | 'playlists';

const TABS: DiscoverTabId[] = ['feed', 'explore', 'playlists'];

export interface DiscoverStationViewProps {
  activeTab: DiscoverTabId;
  onTabChange: (tab: DiscoverTabId) => void;
  discoverDrillFromTab?: DiscoverTabId | null;
  onDiscoverDrillFromTab?: (tab: DiscoverTabId | null) => void;
  exploreDrillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  playlistsDrillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  meshResults: MediaEnvelope[];
  lockerTracks: MediaEnvelope[];
  activeEnvelopeId: string | null;
  initialOpenPlaylistId?: string | null;
  onOpenPlaylistHandled?: () => void;
  initialShareImport?: { shareId: string; editToken?: string } | null;
  onShareImportHandled?: () => void;
  initialExternalImport?: import('../playlistImportShare').ExternalPlaylistImportSeed | null;
  onExternalImportHandled?: () => void;
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayDiscoveryMix?: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onPlayNext: (tracks: MediaEnvelope[]) => void;
  onPrepareForTravel?: (tracks: MediaEnvelope[]) => void;
  onRunSearch: (query: string) => void;
  onGoToLocker: () => void;
  onGoToLockerSection?: (section: LockerSectionId) => void;
  onGoToSearch: () => void;
  onDownloadImportedPlaylist?: (playlist: import('../playlistStorage').StoredPlaylist) => void | Promise<void>;
  onPickExploreCategory: (label: string, group: ExploreGroup) => void;
  onExploreInstantMix?: (tracks: MediaEnvelope[], label: string) => void;
  onSaveInstantPlaylist?: (tracks: MediaEnvelope[], name: string) => void;
  onOpenVideoFeed?: () => void;
}

function DiscoverTab({
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
      className={`discover-tab touch-manipulation ${active ? 'discover-tab-active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  );
}

export default function DiscoverStationView({
  activeTab,
  onTabChange,
  discoverDrillFromTab = null,
  onDiscoverDrillFromTab,
  exploreDrillBackRef,
  playlistsDrillBackRef,
  meshResults,
  lockerTracks,
  activeEnvelopeId,
  initialOpenPlaylistId,
  onOpenPlaylistHandled,
  initialShareImport,
  onShareImportHandled,
  initialExternalImport,
  onExternalImportHandled,
  onPlay,
  onPlayAlbum,
  onPlayDiscoveryMix,
  onPlayNext,
  onPrepareForTravel,
  onRunSearch,
  onGoToLocker,
  onGoToLockerSection,
  onGoToSearch,
  onDownloadImportedPlaylist,
  onPickExploreCategory,
  onExploreInstantMix,
  onSaveInstantPlaylist,
  onOpenVideoFeed,
}: DiscoverStationViewProps) {
  const { t } = useTranslation();
  const isMobileShell = useMobileShell();
  // Handheld Capacitor APKs always use 2-tab Discover (Playlists via Menu drill-in).
  const useMobileDiscoverLayout = isMobileShell || isNativeCapacitorNonTv();

  if (useMobileDiscoverLayout) {
    return (
      <DiscoverTabSuspense>
        <LazyMobileDiscoverView
          activeTab={activeTab}
          onTabChange={onTabChange}
          discoverDrillFromTab={discoverDrillFromTab}
          onDiscoverDrillFromTab={onDiscoverDrillFromTab}
          exploreDrillBackRef={exploreDrillBackRef}
          playlistsDrillBackRef={playlistsDrillBackRef}
          meshResults={meshResults}
          lockerTracks={lockerTracks}
          activeEnvelopeId={activeEnvelopeId}
          initialOpenPlaylistId={initialOpenPlaylistId}
          onOpenPlaylistHandled={onOpenPlaylistHandled}
          initialShareImport={initialShareImport}
          onShareImportHandled={onShareImportHandled}
          initialExternalImport={initialExternalImport}
          onExternalImportHandled={onExternalImportHandled}
          onPlay={onPlay}
          onPlayAlbum={onPlayAlbum}
          onPlayDiscoveryMix={onPlayDiscoveryMix}
          onPlayNext={onPlayNext}
          onPrepareForTravel={onPrepareForTravel}
          onRunSearch={onRunSearch}
          onGoToLocker={onGoToLocker}
          onGoToLockerSection={onGoToLockerSection}
          onGoToSearch={onGoToSearch}
          onDownloadImportedPlaylist={onDownloadImportedPlaylist}
          onPickExploreCategory={onPickExploreCategory}
          onExploreInstantMix={onExploreInstantMix}
          onSaveInstantPlaylist={onSaveInstantPlaylist}
          onOpenVideoFeed={onOpenVideoFeed}
        />
      </DiscoverTabSuspense>
    );
  }

  return (
    <div className="discover-page locker-page">
      <header className="page-header-row discover-header">
        <h1 className="font-display text-[1.75rem] font-bold tracking-tight leading-none text-[var(--text)]">
          {t('discover.title')}
        </h1>
        <nav className="discover-tabs" aria-label={t('discover.tabsAria')}>
          {TABS.map((tab) => (
            <React.Fragment key={tab}>
              <DiscoverTab
                active={activeTab === tab}
                label={t(`discover.tabs.${tab}`)}
                onClick={() => onTabChange(tab)}
              />
            </React.Fragment>
          ))}
        </nav>
      </header>

      <div className="discover-panel min-h-0">
        {activeTab === 'feed' ? (
          <DiscoverTabSuspense>
            <LazyDiscoverFeedView
              embedded
              onPlay={(env) => onPlay(env)}
              onPlayAlbum={onPlayAlbum}
              onPlayDiscoveryMix={onPlayDiscoveryMix}
              onGoToExplore={() => onTabChange('explore')}
              onPickExploreCategory={onPickExploreCategory}
              onSaveInstantPlaylist={onSaveInstantPlaylist}
            />
          </DiscoverTabSuspense>
        ) : null}
        {activeTab === 'explore' ? (
          <DiscoverTabSuspense>
            <LazyDiscoverExploreView
              embedded
              onPickCategory={onPickExploreCategory}
              onPlay={onPlay}
              onPlayAlbum={onPlayAlbum}
              onPlayDiscoveryMix={onPlayDiscoveryMix}
              onPlayInstantMix={onExploreInstantMix}
              onSaveInstantPlaylist={onSaveInstantPlaylist}
              onOpenVideoFeed={onOpenVideoFeed}
              showMadeForYou={false}
            />
          </DiscoverTabSuspense>
        ) : null}
        {activeTab === 'playlists' ? (
          <DiscoverTabSuspense>
            <LazyDiscoverPlaylistsView
              embedded
              meshResults={meshResults}
              lockerTracks={lockerTracks}
              activeEnvelopeId={activeEnvelopeId}
              initialOpenPlaylistId={initialOpenPlaylistId}
              onOpenPlaylistHandled={onOpenPlaylistHandled}
              initialShareImport={initialShareImport}
              onShareImportHandled={onShareImportHandled}
              initialExternalImport={initialExternalImport}
              onExternalImportHandled={onExternalImportHandled}
              onPlay={onPlay}
              onPlayAlbum={onPlayAlbum}
              onPlayNext={onPlayNext}
              onPrepareForTravel={onPrepareForTravel}
              onRunSearch={onRunSearch}
              onGoToLocker={onGoToLocker}
              onGoToSearch={onGoToSearch}
              onDownloadImportedPlaylist={onDownloadImportedPlaylist}
            />
          </DiscoverTabSuspense>
        ) : null}
      </div>
    </div>
  );
}
