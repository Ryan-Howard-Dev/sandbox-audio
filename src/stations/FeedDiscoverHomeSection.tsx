/**
 * Feed tab landing — MFY shelf + browse hub (Discover Home).
 * Mesh / followed-artist updates render below this in FeedView.
 */

import React from 'react';
import { Loader2, X } from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ExploreGroup } from '../exploreCatalog';
import type { DiscoveryMix } from '../discoveryMixes';
import type { FollowedFeedRelease } from '../followedArtistFeed';
import type { FollowedArtist } from '../followedArtists';
import DiscoverHomeView from './DiscoverHomeView';
import { useTranslation } from '../i18n';
import { formatCacheTimestamp } from '../responseCache';

function FollowingManagePanel({
  artists,
  onClose,
  onUnfollow,
}: {
  artists: FollowedArtist[];
  onClose: () => void;
  onUnfollow: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="feed-following-panel"
      role="dialog"
      aria-label={t('feed.follow.manageTitle')}
    >
      <div className="feed-following-panel-header">
        <h3 className="text-sm font-semibold text-[var(--text)]">{t('feed.follow.manageTitle')}</h3>
        <button
          type="button"
          className="p-1 text-[var(--text-dim)] hover:text-[var(--text)] touch-manipulation"
          aria-label={t('common.cancel')}
          onClick={onClose}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <ul className="feed-following-list">
        {artists.map((artist) => (
          <li key={artist.catalogArtistId ?? artist.name} className="feed-following-row">
            <span className="text-sm text-[var(--text)] truncate">{artist.name}</span>
            <button
              type="button"
              className="text-xs text-accent touch-manipulation shrink-0"
              onClick={() => onUnfollow(artist.name)}
            >
              {t('feed.follow.unfollow')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface FeedDiscoverHomeSectionProps {
  releases?: FollowedFeedRelease[];
  followedArtists: FollowedArtist[];
  showLibraryFollowHint?: boolean;
  followingPanelOpen: boolean;
  onFollowingPanelOpenChange: (open: boolean) => void;
  onUnfollow: (name: string) => void;
  lastUpdatedAt?: number | null;
  showLastUpdated?: boolean;
  showRefreshIndicator?: boolean;
  mfyReloadKey?: number;
  mobile?: boolean;
  lang: string;
  onPlayDiscoveryMix: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onSaveMix?: (mix: DiscoveryMix) => void;
  onPlayTrack?: (env: MediaEnvelope) => void;
  onGoToExplore?: () => void;
  onPickExploreCategory?: (label: string, group: ExploreGroup) => void;
}

export default function FeedDiscoverHomeSection({
  releases = [],
  followedArtists,
  showLibraryFollowHint,
  followingPanelOpen,
  onFollowingPanelOpenChange,
  onUnfollow,
  lastUpdatedAt,
  showLastUpdated,
  showRefreshIndicator,
  mfyReloadKey = 0,
  mobile,
  lang,
  onPlayDiscoveryMix,
  onSaveMix,
  onPlayTrack,
  onGoToExplore,
  onPickExploreCategory,
}: FeedDiscoverHomeSectionProps) {
  const { t } = useTranslation();

  const mfyLastUpdatedLabel =
    lastUpdatedAt != null
      ? t('feed.lastUpdated', { time: formatCacheTimestamp(lastUpdatedAt, lang) })
      : undefined;

  return (
    <>
      {followedArtists.length > 0 ? (
        <div className="feed-following-bar mb-4">
          <button
            type="button"
            className="text-sm text-accent touch-manipulation"
            onClick={() => onFollowingPanelOpenChange(!followingPanelOpen)}
          >
            {t('feed.follow.followingCount', { count: followedArtists.length })}
          </button>
          {showLibraryFollowHint ? (
            <span className="text-xs text-[var(--text-dim)]">{t('feed.follow.libraryHint')}</span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-[var(--text-mid)] mb-4">{t('feed.follow.emptyHint')}</p>
      )}

      {showLastUpdated && lastUpdatedAt != null ? (
        <p className="text-xs text-[var(--text-dim)] mb-3">
          {t('feed.lastUpdated', { time: formatCacheTimestamp(lastUpdatedAt, lang) })}
        </p>
      ) : null}

      {showRefreshIndicator ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-dim)] mb-3" aria-live="polite">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          {t('feed.refreshing')}
        </div>
      ) : null}

      {followingPanelOpen && followedArtists.length > 0 ? (
        <FollowingManagePanel
          artists={followedArtists}
          onClose={() => onFollowingPanelOpenChange(false)}
          onUnfollow={onUnfollow}
        />
      ) : null}

      <DiscoverHomeView
        releases={releases}
        onPlayDiscoveryMix={onPlayDiscoveryMix}
        onSaveMix={onSaveMix}
        onPlayTrack={onPlayTrack}
        onGoToExplore={onGoToExplore}
        onPickExploreCategory={onPickExploreCategory}
        lastUpdatedAt={lastUpdatedAt}
        lastUpdatedLabel={mfyLastUpdatedLabel}
        mobile={mobile}
        mfyReloadKey={mfyReloadKey}
      />
    </>
  );
}
