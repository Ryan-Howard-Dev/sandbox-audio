import React, { useEffect, useState } from 'react';
import { ChevronRight, Loader2, Play } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { fetchExploreEnvelopes } from '../../exploreCatalog';
import type { ExploreGroup } from '../../exploreCatalog';
import { seedGradient } from '../../seedGradient';
import type { HubShelfPick } from '../../exploreHubShelves';

export interface DiscoveryTrackShelfProps {
  shelf: HubShelfPick;
  onPlay: (env: MediaEnvelope) => void;
  onPlayAll?: (tracks: MediaEnvelope[], label: string) => void;
  onSeeAll: (label: string, group: ExploreGroup) => void;
  limit?: number;
  compact?: boolean;
}

function TrackCard({
  track,
  onPlay,
}: {
  track: MediaEnvelope;
  onPlay: (env: MediaEnvelope) => void;
}) {
  const art = track.artworkUrl;
  const seed = `${track.artist}-${track.title}`;

  return (
    <button
      type="button"
      className="hub-shelf-card touch-manipulation"
        onClick={() => onPlay(track)}
        aria-label={`Play ${track.title} by ${track.artist}`}
      >
        <span className="hub-shelf-art" aria-hidden>
          {art ? (
            <img src={art} alt="" className="w-full h-full object-cover" />
          ) : (
            <span className="hub-shelf-art-fallback" style={{ background: seedGradient(seed) }} />
          )}
        </span>
        <span className="hub-shelf-meta">
          <span className="hub-shelf-track">{track.title}</span>
          <span className="hub-shelf-artist">{track.artist}</span>
        </span>
        <Play className="hub-shelf-play w-3.5 h-3.5" aria-hidden />
      </button>
  );
}

export default function DiscoveryTrackShelf({
  shelf,
  onPlay,
  onPlayAll,
  onSeeAll,
  limit = 12,
  compact = false,
}: DiscoveryTrackShelfProps) {
  const [tracks, setTracks] = useState<MediaEnvelope[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchExploreEnvelopes(shelf.group, shelf.label, limit)
      .then((rows) => {
        if (!cancelled) setTracks(rows);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shelf.group, shelf.label, limit]);

  if (!loading && tracks.length === 0) return null;

  return (
    <section className={`hub-shelf${compact ? ' hub-shelf--compact' : ''}`} aria-label={shelf.title}>
      <div className="hub-shelf-head">
        <div>
          <h2 className="hub-shelf-title">{shelf.title}</h2>
          {shelf.subtitle ? <p className="hub-shelf-sub">{shelf.subtitle}</p> : null}
        </div>
        <div className="hub-shelf-actions">
          {onPlayAll && tracks.length > 0 ? (
            <button
              type="button"
              className="hub-shelf-action touch-manipulation"
              onClick={() => onPlayAll(tracks, shelf.title)}
            >
              <Play className="w-3.5 h-3.5" aria-hidden />
              Play
            </button>
          ) : null}
          <button
            type="button"
            className="hub-shelf-action touch-manipulation"
            onClick={() => onSeeAll(shelf.label, shelf.group)}
          >
            See all
            <ChevronRight className="w-3.5 h-3.5" aria-hidden />
          </button>
        </div>
      </div>

      {loading ? (
        <div className="hub-shelf-loading">
          <Loader2 className="w-4 h-4 animate-spin text-accent" aria-hidden />
        </div>
      ) : (
        <div className="hub-shelf-scroll hide-scrollbar">
          {tracks.map((track) => (
            <div key={track.envelopeId} className="hub-shelf-card-wrap">
              <TrackCard track={track} onPlay={onPlay} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
