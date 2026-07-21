import React, { useEffect, useState } from 'react';
import { Clapperboard } from 'lucide-react';
import type { ExploreGroup } from '../exploreCatalog';
import {
  EXPLORE_DECADES,
  EXPLORE_GENRES,
  EXPLORE_MOODS,
} from '../exploreBrowseData';
import type { MediaEnvelope } from '../sandboxLayer1';
import type { FollowedFeedRelease } from '../followedArtistFeed';
import ExploreInstantPanel from '../components/discovery/ExploreInstantPanel';
import ExploreHubShelves from '../components/discovery/ExploreHubShelves';
import { useTranslation } from '../i18n';

export interface ExploreViewProps {
  onPickCategory: (label: string, group: ExploreGroup) => void;
  onPlay?: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayDiscoveryMix?: (tracks: MediaEnvelope[], mix: import('../discoveryMixes').DiscoveryMix) => void;
  onPlayInstantMix?: (tracks: MediaEnvelope[], label: string) => void;
  onSaveInstantPlaylist?: (tracks: MediaEnvelope[], name: string) => void;
  releases?: FollowedFeedRelease[];
  /** Open vertical video discovery feed (TikTok-style). */
  onOpenVideoFeed?: () => void;
  /** Inside Playlists → Explore tab (no duplicate page title). */
  embedded?: boolean;
  mobile?: boolean;
  exploreDrillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  /** Hide MFY shelf — Feed tab owns personal mixes. */
  showMadeForYou?: boolean;
}

function PillRow({
  title,
  items,
  onPick,
  group,
}: {
  title: string;
  items: readonly string[];
  group: ExploreGroup;
  onPick: (label: string, group: ExploreGroup) => void;
}) {
  return (
    <section className="explore-section">
      <div className="explore-section-head">
        <h2 className="ui-section-title explore-section-title">{title}</h2>
      </div>
      <div className="explore-pill-row hide-scrollbar">
        {items.map((label) => (
          <button
            key={label}
            type="button"
            className="explore-pill touch-manipulation"
            onClick={() => onPick(label, group)}
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}

export default function ExploreView({
  onPickCategory,
  onPlay,
  onPlayAlbum,
  onPlayDiscoveryMix,
  onPlayInstantMix,
  onSaveInstantPlaylist,
  releases = [],
  onOpenVideoFeed,
  embedded = false,
  mobile = false,
  exploreDrillBackRef,
  showMadeForYou = false,
}: ExploreViewProps) {
  const { t } = useTranslation();
  const [instantPick, setInstantPick] = useState<{ label: string; group: ExploreGroup } | null>(
    null,
  );

  useEffect(() => {
    if (!mobile || !exploreDrillBackRef) return;
    exploreDrillBackRef.current = () => {
      if (!instantPick) return false;
      setInstantPick(null);
      return true;
    };
    return () => {
      exploreDrillBackRef.current = null;
    };
  }, [mobile, instantPick, exploreDrillBackRef]);

  const handlePill = (label: string, group: ExploreGroup) => {
    if (onPlayInstantMix && onSaveInstantPlaylist) {
      setInstantPick({ label, group });
      return;
    }
    onPickCategory(label, group);
  };

  const handleSeeAll = (label: string, group: ExploreGroup) => {
    if (onPlayInstantMix && onSaveInstantPlaylist) {
      setInstantPick({ label, group });
      return;
    }
    onPickCategory(label, group);
  };

  const handlePlay = (env: MediaEnvelope) => {
    if (onPlay) onPlay(env);
    else onPlayAlbum?.([env], false);
  };

  return (
    <div className={embedded ? 'explore-embedded' : 'explore-page'}>
      {!embedded && (
        <header className="explore-header">
          <h1 className="font-display text-[1.75rem] font-bold tracking-tight text-[var(--text)]">
            Browse
          </h1>
          <p className="text-sm text-[var(--text-mid)] mt-1">Genres, charts & catalog discovery</p>
        </header>
      )}

      {instantPick && onPlayInstantMix && onSaveInstantPlaylist ? (
        <ExploreInstantPanel
          label={instantPick.label}
          group={instantPick.group}
          onPlay={onPlayInstantMix}
          onSavePlaylist={onSaveInstantPlaylist}
          onSearchAll={onPickCategory}
          onClose={() => setInstantPick(null)}
        />
      ) : (
        <>
          {onOpenVideoFeed ? (
            <section className="explore-section explore-video-entry">
              <div className="explore-section-head">
                <h2 className="ui-section-title explore-section-title">{t('discover.videoFeed.sectionTitle')}</h2>
              </div>
              <button
                type="button"
                className="explore-video-hero touch-manipulation"
                onClick={onOpenVideoFeed}
              >
                <span className="explore-video-hero-icon" aria-hidden>
                  <Clapperboard />
                </span>
                <span className="explore-video-hero-copy">
                  <span className="explore-video-hero-title">{t('discover.videoFeed.heroTitle')}</span>
                  <span className="explore-video-hero-lead">{t('discover.videoFeed.heroLead')}</span>
                </span>
              </button>
            </section>
          ) : null}

          <ExploreHubShelves
            onPlay={handlePlay}
            onPlayAlbum={onPlayAlbum}
            onPlayDiscoveryMix={onPlayDiscoveryMix}
            onPlayInstantMix={onPlayInstantMix}
            onSaveInstantPlaylist={onSaveInstantPlaylist}
            onSeeAll={handleSeeAll}
            releases={releases}
            mobile={mobile}
            showMadeForYou={showMadeForYou}
          />

          <div className="explore-browse-more">
            <h2 className="explore-browse-more-title">All categories</h2>
            <PillRow title="GENRES" items={EXPLORE_GENRES} group="genre" onPick={handlePill} />
            <PillRow title="MOODS & ACTIVITIES" items={EXPLORE_MOODS} group="mood" onPick={handlePill} />
            <PillRow title="DECADES" items={EXPLORE_DECADES} group="decade" onPick={handlePill} />
          </div>
        </>
      )}
    </div>
  );
}
