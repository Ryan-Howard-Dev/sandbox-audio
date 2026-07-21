import React from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ExploreGroup } from '../exploreCatalog';
import type { LockerSectionId } from './CollectionView';
import MobileShellBackButton from '../components/MobileShellBackButton';
import { useTranslation } from '../i18n';
import {
  DiscoverTabSuspense,
  LazyDiscoverExploreView,
  LazyDiscoverFeedView,
  LazyDiscoverPlaylistsView,
} from './discoverLazyViews';
import type { DiscoverTabId } from './DiscoverStationView';

export interface MobileDiscoverViewProps {
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
  onPlayDiscoveryMix?: (tracks: MediaEnvelope[], mix: import('../discoveryMixes').DiscoveryMix) => void;
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

const TABS: DiscoverTabId[] = ['feed', 'explore'];

function MobileDiscoverTab({
  active,
  label,
  tabId,
  onClick,
}: {
  active: boolean;
  label: string;
  tabId: DiscoverTabId;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`discover-tab-${tabId}`}
      className={`discover-mobile-tab touch-manipulation ${active ? 'discover-mobile-tab--active' : ''}`}
      aria-current={active ? 'page' : undefined}
    >
      {label}
    </button>
  );
}

export default function MobileDiscoverView({
  activeTab,
  onTabChange,
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
  onGoToSearch,
  onDownloadImportedPlaylist,
  onPickExploreCategory,
  onExploreInstantMix,
  onSaveInstantPlaylist,
  onOpenVideoFeed,
}: MobileDiscoverViewProps) {
  const { t } = useTranslation();
  const isPlaylistsView = activeTab === 'playlists';
  const isDedicatedView = isPlaylistsView;

  const handleDrillBack = () => {
    onTabChange('feed');
    onDiscoverDrillFromTab?.(null);
  };

  const handleTabChange = (tab: DiscoverTabId) => {
    onDiscoverDrillFromTab?.(null);
    onTabChange(tab);
  };

  return (
    <div className="discover-mobile discover-page">
      <header className="discover-mobile-header">
        {isDedicatedView ? (
          <div className="discover-mobile-toolbar">
            <MobileShellBackButton onClick={handleDrillBack} />
            <h1 className="discover-mobile-toolbar-title">{t(`discover.tabs.${activeTab}`)}</h1>
          </div>
        ) : (
          <h1 className="discover-mobile-title">{t('discover.title')}</h1>
        )}
        {!isDedicatedView ? (
          <nav className="discover-mobile-tabs" aria-label={t('discover.tabsAria')}>
            {TABS.map((tab) => (
              <div key={tab} className="discover-mobile-tab-wrap">
                <MobileDiscoverTab
                  active={activeTab === tab}
                  tabId={tab}
                  label={t(`discover.tabs.${tab}`)}
                  onClick={() => handleTabChange(tab)}
                />
              </div>
            ))}
          </nav>
        ) : null}
      </header>

      <div className="discover-mobile-panel min-h-0">
        {activeTab === 'feed' ? (
          <DiscoverTabSuspense>
            <LazyDiscoverFeedView
              embedded
              mobile
              onPlay={onPlay}
              onPlayAlbum={onPlayAlbum}
              onPlayDiscoveryMix={onPlayDiscoveryMix}
              onGoToExplore={() => handleTabChange('explore')}
              onPickExploreCategory={onPickExploreCategory}
              onSaveInstantPlaylist={onSaveInstantPlaylist}
            />
          </DiscoverTabSuspense>
        ) : null}
        {activeTab === 'explore' ? (
          <DiscoverTabSuspense>
            <LazyDiscoverExploreView
              embedded
              mobile
              exploreDrillBackRef={exploreDrillBackRef}
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
              mobile
              meshResults={meshResults}
              lockerTracks={lockerTracks}
              activeEnvelopeId={activeEnvelopeId}
              initialOpenPlaylistId={initialOpenPlaylistId}
              onOpenPlaylistHandled={onOpenPlaylistHandled}
              initialShareImport={initialShareImport}
              onShareImportHandled={onShareImportHandled}
              initialExternalImport={initialExternalImport}
              onExternalImportHandled={onExternalImportHandled}
              playlistsDrillBackRef={playlistsDrillBackRef}
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
