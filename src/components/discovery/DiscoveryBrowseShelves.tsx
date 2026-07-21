import React from 'react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import type { ExploreGroup } from '../../exploreCatalog';
import { FEED_BROWSE_SHELVES } from '../../exploreHubShelves';
import DiscoveryTrackShelf from './DiscoveryTrackShelf';

export interface DiscoveryBrowseShelvesProps {
  onPlay: (env: MediaEnvelope) => void;
  onPlayAll?: (tracks: MediaEnvelope[], label: string) => void;
  onSeeAll: (label: string, group: ExploreGroup) => void;
  onGoToExplore?: () => void;
  mobile?: boolean;
}

export default function DiscoveryBrowseShelves({
  onPlay,
  onPlayAll,
  onSeeAll,
  onGoToExplore,
  mobile = false,
}: DiscoveryBrowseShelvesProps) {
  return (
    <section className={`feed-browse-hub${mobile ? ' feed-browse-hub--mobile' : ''}`} aria-label="Browse">
      <div className="feed-browse-hub-head">
        <div>
          <h2 className="feed-browse-hub-title">Browse</h2>
          <p className="feed-browse-hub-lead">Genre & mood picks from catalog</p>
        </div>
        {onGoToExplore ? (
          <button type="button" className="feed-browse-hub-more touch-manipulation" onClick={onGoToExplore}>
            Explore all
          </button>
        ) : null}
      </div>
      {FEED_BROWSE_SHELVES.map((shelf) => (
        <React.Fragment key={shelf.id}>
          <DiscoveryTrackShelf
            shelf={shelf}
            onPlay={onPlay}
            onPlayAll={onPlayAll}
            onSeeAll={onSeeAll}
            limit={10}
            compact
          />
        </React.Fragment>
      ))}
    </section>
  );
}
