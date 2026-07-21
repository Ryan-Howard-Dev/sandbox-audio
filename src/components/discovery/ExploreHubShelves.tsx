import React from 'react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import type { ExploreGroup } from '../../exploreCatalog';
import type { FollowedFeedRelease } from '../../followedArtistFeed';
import type { DiscoveryMix } from '../../discoveryMixes';
import {
  ALL_EXPLORE_HUB_SHELVES,
  FEATURED_GENRE_SHELVES,
  FEATURED_MOOD_SHELVES,
  QUICK_HUB_SHELVES,
} from '../../exploreHubShelves';
import { getPersonalizedExploreGenreLabels } from '../../personalizedGenres';
import DiscoveryTrackShelf from './DiscoveryTrackShelf';
import MadeForYouShelf from './MadeForYouShelf';

export interface ExploreHubShelvesProps {
  onPlay: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayDiscoveryMix?: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onPlayInstantMix?: (tracks: MediaEnvelope[], label: string) => void;
  onSaveInstantPlaylist?: (tracks: MediaEnvelope[], name: string) => void;
  onSeeAll: (label: string, group: ExploreGroup) => void;
  releases?: FollowedFeedRelease[];
  mobile?: boolean;
  /** Include personalized MFY strip above browse shelves. */
  showMadeForYou?: boolean;
}

export default function ExploreHubShelves({
  onPlay,
  onPlayAlbum,
  onPlayDiscoveryMix,
  onPlayInstantMix,
  onSaveInstantPlaylist,
  onSeeAll,
  releases = [],
  mobile = false,
  showMadeForYou = true,
}: ExploreHubShelvesProps) {
  const handlePlayMix = (tracks: MediaEnvelope[], mix: DiscoveryMix) => {
    if (tracks.length === 0) return;
    if (onPlayDiscoveryMix) {
      onPlayDiscoveryMix(tracks, mix);
      return;
    }
    if (onPlayInstantMix) onPlayInstantMix(tracks, mix.title);
    else if (onPlayAlbum) onPlayAlbum(tracks, false);
    else onPlay(tracks[0]!);
  };

  const handleSaveMix = (mix: DiscoveryMix) => {
    if (mix.tracks.length === 0) return;
    onSaveInstantPlaylist?.(mix.tracks, mix.title);
  };

  const handlePlayAll = (tracks: MediaEnvelope[], label: string) => {
    if (tracks.length === 0) return;
    if (onPlayInstantMix) onPlayInstantMix(tracks, label);
    else if (onPlayAlbum) onPlayAlbum(tracks, false);
    else onPlay(tracks[0]!);
  };

  const quickShelves = QUICK_HUB_SHELVES.map((shelf) => {
    if (shelf.id !== 'new-releases') return shelf;
    const tasteGenres = getPersonalizedExploreGenreLabels(3);
    if (tasteGenres.length === 0) return shelf;
    return {
      ...shelf,
      subtitle: `Based on your tastes · ${tasteGenres.join(' · ')}`,
    };
  });
  const genreShelves = FEATURED_GENRE_SHELVES;
  const moodShelves = FEATURED_MOOD_SHELVES;

  return (
    <div className={`explore-hub${mobile ? ' explore-hub--mobile' : ''}`}>
      {showMadeForYou && (onPlayDiscoveryMix || onPlayAlbum || onPlayInstantMix) ? (
        <MadeForYouShelf
          releases={releases}
          onPlayMix={handlePlayMix}
          onPlayAlbum={onPlayAlbum}
          onSaveMix={onSaveInstantPlaylist ? handleSaveMix : undefined}
          mobile={mobile}
          variant="compact"
        />
      ) : null}

      {quickShelves.map((shelf) => (
        <React.Fragment key={shelf.id}>
          <DiscoveryTrackShelf
            shelf={shelf}
            onPlay={onPlay}
            onPlayAll={handlePlayAll}
            onSeeAll={onSeeAll}
            compact={mobile}
          />
        </React.Fragment>
      ))}

      <div className="explore-hub-section-label">Genres</div>
      {genreShelves.map((shelf) => (
        <React.Fragment key={shelf.id}>
          <DiscoveryTrackShelf
            shelf={shelf}
            onPlay={onPlay}
            onPlayAll={handlePlayAll}
            onSeeAll={onSeeAll}
            compact={mobile}
          />
        </React.Fragment>
      ))}

      <div className="explore-hub-section-label">Moods & activities</div>
      {moodShelves.map((shelf) => (
        <React.Fragment key={shelf.id}>
          <DiscoveryTrackShelf
            shelf={shelf}
            onPlay={onPlay}
            onPlayAll={handlePlayAll}
            onSeeAll={onSeeAll}
            compact={mobile}
          />
        </React.Fragment>
      ))}

      {/* Keep full shelf list reachable for screen readers / future expansion */}
      <span className="sr-only">{ALL_EXPLORE_HUB_SHELVES.length} browse shelves</span>
    </div>
  );
}
