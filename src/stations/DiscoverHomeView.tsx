/**
 * Discover Home — unified MFY shelf + browse hub.
 * Primary landing on the Discover → Feed tab (see FeedDiscoverHomeSection).
 */

import React, { useCallback } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { ExploreGroup } from '../exploreCatalog';
import type { DiscoveryMix } from '../discoveryMixes';
import type { FollowedFeedRelease } from '../followedArtistFeed';
import MadeForYouShelf from '../components/discovery/MadeForYouShelf';
import { useTranslation } from '../i18n';

export interface DiscoverHomeViewProps {
  releases?: FollowedFeedRelease[];
  onPlayDiscoveryMix: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onSaveMix?: (mix: DiscoveryMix) => void;
  onPlayTrack?: (env: MediaEnvelope) => void;
  onGoToExplore?: () => void;
  onPickExploreCategory?: (label: string, group: ExploreGroup) => void;
  lastUpdatedAt?: number | null;
  lastUpdatedLabel?: string;
  mobile?: boolean;
  /** Force MFY shelf remount after taste feedback. */
  mfyReloadKey?: number;
  /** Hide section title when embedded in Feed. */
  showHeader?: boolean;
}

export default function DiscoverHomeView({
  releases = [],
  onPlayDiscoveryMix,
  onSaveMix,
  onPlayTrack,
  onGoToExplore,
  onPickExploreCategory,
  lastUpdatedAt,
  lastUpdatedLabel,
  mobile = false,
  mfyReloadKey = 0,
  showHeader = false,
}: DiscoverHomeViewProps) {
  const { t } = useTranslation();

  const handlePlayMix = useCallback(
    (tracks: MediaEnvelope[], mix: DiscoveryMix) => {
      onPlayDiscoveryMix(tracks, mix);
    },
    [onPlayDiscoveryMix],
  );

  const handleSaveMix = useCallback(
    (mix: DiscoveryMix) => {
      onSaveMix?.(mix);
    },
    [onSaveMix],
  );

  return (
    <div className={`discover-home${mobile ? ' discover-home--mobile' : ''}`}>
      {showHeader ? (
        <header className="discover-home-header">
          <h2 className="discover-home-title">{t('discover.home.title')}</h2>
          <p className="discover-home-lead">{t('discover.home.lead')}</p>
        </header>
      ) : null}

      <div key={mfyReloadKey}>
        <MadeForYouShelf
          releases={releases}
          onPlayMix={handlePlayMix}
          onSaveMix={onSaveMix ? handleSaveMix : undefined}
          lastUpdatedAt={lastUpdatedAt}
          lastUpdatedLabel={lastUpdatedLabel}
          mobile={mobile}
        />
      </div>

      {onGoToExplore ? (
        <section className="feed-explore-cta">
          <p className="feed-explore-cta-lead">{t('discover.home.browseLead')}</p>
          <button
            type="button"
            className="feed-explore-cta-btn touch-manipulation"
            onClick={onGoToExplore}
          >
            {t('discover.home.browseCta')}
          </button>
        </section>
      ) : null}
    </div>
  );
}
