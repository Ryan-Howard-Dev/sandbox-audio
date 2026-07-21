import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import ModalOverlay from '../../stations/ModalOverlay';
import {
  buildWeeklyDiscover,
  loadMadeForYouBundle,
  saveWeeklyMixGenre,
  type DiscoveryMix,
  type MadeForYouBundle,
} from '../../discoveryMixes';
import type { FollowedFeedRelease } from '../../followedArtistFeed';
import DiscoveryMixCarousel, { DiscoveryMixFullPanel } from './DiscoveryMixCarousel';
import RecommendTrackControls from './RecommendTrackControls';

export interface MadeForYouShelfProps {
  releases?: FollowedFeedRelease[];
  onPlayMix: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onSaveMix?: (mix: DiscoveryMix) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  lastUpdatedAt?: number | null;
  lastUpdatedLabel?: string;
  mobile?: boolean;
  /** compact = Daily + My Mix only (Explore hub). */
  variant?: 'full' | 'compact';
}

export default function MadeForYouShelf({
  releases = [],
  onPlayMix,
  onSaveMix,
  onPlayAlbum,
  lastUpdatedAt,
  lastUpdatedLabel,
  mobile,
  variant = 'full',
}: MadeForYouShelfProps) {
  const [bundle, setBundle] = useState<MadeForYouBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [expandedMix, setExpandedMix] = useState<DiscoveryMix | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadMadeForYouBundle(releases);
      setBundle(next);
      setSelectedGenre((prev) => prev ?? next.genreChips[0] ?? null);
    } finally {
      setLoading(false);
    }
  }, [releases]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleGenreChip = async (genre: string) => {
    setSelectedGenre(genre);
    saveWeeklyMixGenre(genre);
    setWeeklyLoading(true);
    try {
      const weekly = await buildWeeklyDiscover(genre);
      setBundle((prev) => (prev ? { ...prev, weekly } : prev));
    } finally {
      setWeeklyLoading(false);
    }
  };

  const handleSeeAll = (mix: DiscoveryMix) => setExpandedMix(mix);

  const handleSave = (mix: DiscoveryMix) => {
    onSaveMix?.(mix);
  };

  if (loading && !bundle) {
    return (
      <section className="mfy-shelf">
        <div className="flex items-center gap-2 text-xs text-[var(--text-dim)]">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          Building your mixes…
        </div>
      </section>
    );
  }

  if (!bundle) return null;

  const compact = variant === 'compact';
  const myMixes = compact ? bundle.myMixes.slice(0, 3) : bundle.myMixes;

  const hasAny =
    bundle.daily.tracks.length > 0 ||
    (!compact && bundle.weekly.tracks.length > 0) ||
    (!compact && bundle.releaseRadar.tracks.length > 0) ||
    myMixes.some((m) => m.tracks.length > 0);
  if (!hasAny) return null;

  return (
    <>
      <section className={`mfy-shelf${mobile ? ' mfy-shelf--mobile' : ''}`} aria-label="Made for you">
        <div className="mfy-shelf-head">
          <div>
            <h2 className="mfy-shelf-title">Made for you</h2>
            <p className="mfy-shelf-lead">
              Daily 6am · Weekly Monday · My Mix refreshes gradually
            </p>
          </div>
          {lastUpdatedAt && lastUpdatedLabel ? (
            <p className="mfy-shelf-updated">{lastUpdatedLabel}</p>
          ) : null}
        </div>

        <DiscoveryMixCarousel
          title="Daily Discovery"
          subtitle="Fresh picks every morning"
          mixes={[bundle.daily]}
          layout="single"
          onPlayMix={onPlayMix}
          onSeeAll={handleSeeAll}
          onSaveMix={onSaveMix ? handleSave : undefined}
        />

        {!compact ? (
        <section className="mfy-carousel-section" aria-label="Weekly Discover">
          <div className="mfy-carousel-head">
            <div>
              <h3 className="mfy-carousel-title">Weekly Discover</h3>
              <p className="mfy-carousel-sub">Regenerate by genre</p>
            </div>
            {bundle.weekly.tracks.length > 0 ? (
              <button
                type="button"
                className="mfy-see-all touch-manipulation"
                onClick={() => handleSeeAll(bundle.weekly)}
              >
                See all
              </button>
            ) : null}
          </div>
          <div className="mfy-genre-chips hide-scrollbar">
            {bundle.genreChips.map((genre) => (
              <button
                key={genre}
                type="button"
                className={`mfy-genre-chip${selectedGenre === genre ? ' is-active' : ''}`}
                onClick={() => void handleGenreChip(genre)}
                disabled={weeklyLoading}
              >
                {genre}
              </button>
            ))}
            {weeklyLoading ? <Loader2 className="w-3 h-3 animate-spin text-accent" /> : null}
          </div>
          {bundle.weekly.tracks.length > 0 ? (
            <ul className="mfy-weekly-preview music-scrollbar">
              {bundle.weekly.tracks.slice(0, 8).map((track) => (
                <li key={track.envelopeId} className="mfy-weekly-preview-row">
                  <button
                    type="button"
                    className="mfy-weekly-preview-play touch-manipulation"
                    onClick={() => onPlayMix([track], bundle.weekly)}
                  >
                    {track.title}
                    <span className="text-[var(--text-dim)]"> — {track.artist}</span>
                  </button>
                  <RecommendTrackControls envelope={track} variant="inline" />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
        ) : null}

        {!compact ? (
        <DiscoveryMixCarousel
          title="Release Radar"
          subtitle="Recent from artists you follow"
          mixes={[bundle.releaseRadar]}
          layout="single"
          onPlayMix={onPlayMix}
          onSeeAll={handleSeeAll}
          onSaveMix={onSaveMix ? handleSave : undefined}
        />
        ) : null}

        <DiscoveryMixCarousel
          title="My Mix"
          subtitle={compact ? 'Personal blends' : 'Gradual refresh · up to 6 slots'}
          mixes={myMixes}
          layout="multi"
          onPlayMix={onPlayMix}
          onSaveMix={onSaveMix ? handleSave : undefined}
        />
      </section>

      <ModalOverlay
        open={Boolean(expandedMix)}
        onClose={() => setExpandedMix(null)}
        title={expandedMix?.title}
        maxWidth="max-w-lg"
      >
        {expandedMix ? (
          <DiscoveryMixFullPanel
            mix={expandedMix}
            onClose={() => setExpandedMix(null)}
            onPlay={() => {
              onPlayMix(expandedMix.tracks, expandedMix);
              setExpandedMix(null);
            }}
            onShuffle={() => {
              const shuffled = [...expandedMix.tracks].sort(() => Math.random() - 0.5);
              onPlayMix(shuffled, expandedMix);
              setExpandedMix(null);
            }}
            onSave={onSaveMix ? () => handleSave(expandedMix) : undefined}
          />
        ) : null}
      </ModalOverlay>
    </>
  );
}
