import React, { useEffect, useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { seedGradient } from '../../seedGradient';
import { buildTasteDiscoverShelf, type TasteShelfKind } from '../../tasteDiscover';
import {
  readShelfCache,
  shelfCacheIsStale,
  shelfCacheKey,
  writeShelfCache,
} from '../../discoveryShelfCache';

export interface TasteDiscoverShelfProps {
  kind: TasteShelfKind;
  title: string;
  subtitle: string;
  limit?: number;
  onPlay: (env: MediaEnvelope) => void;
  onPlayAll?: (tracks: MediaEnvelope[], label: string) => void;
}

/**
 * Daily / Weekly Discover — recommendations derived from the local taste profile
 * (artists similar to what you play, filtered against what you already own).
 */
export default function TasteDiscoverShelf({
  kind,
  title,
  subtitle,
  limit = 12,
  onPlay,
  onPlayAll,
}: TasteDiscoverShelfProps) {
  const cacheKey = shelfCacheKey('taste', kind, limit);
  const [tracks, setTracks] = useState<MediaEnvelope[]>(
    () => readShelfCache(cacheKey)?.rows ?? [],
  );

  useEffect(() => {
    let cancelled = false;
    const cached = readShelfCache(cacheKey);
    if (cached) {
      setTracks(cached.rows);
      if (!shelfCacheIsStale(cached)) return;
    }
    void buildTasteDiscoverShelf(kind, limit)
      .then((rows) => {
        if (cancelled || rows.length === 0) return;
        setTracks(rows);
        writeShelfCache(cacheKey, rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [kind, limit, cacheKey]);

  // No taste signal yet (nothing played) — stay out of the way rather than show an
  // empty shelf with a spinner.
  if (tracks.length === 0) return null;

  return (
    <section className="hub-shelf hub-shelf--compact" aria-label={title}>
      <div className="hub-shelf-head">
        <div>
          <h2 className="hub-shelf-title inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-accent" aria-hidden />
            {title}
          </h2>
          <p className="hub-shelf-sub">{subtitle}</p>
        </div>
        {onPlayAll ? (
          <div className="hub-shelf-actions">
            <button
              type="button"
              className="hub-shelf-action touch-manipulation"
              onClick={() => onPlayAll(tracks, title)}
            >
              <Play className="w-3.5 h-3.5" aria-hidden />
              Play
            </button>
          </div>
        ) : null}
      </div>
      <div className="hub-shelf-scroll hide-scrollbar">
        {tracks.map((track) => (
          <div key={track.envelopeId} className="hub-shelf-card-wrap">
            <button
              type="button"
              className="hub-shelf-card touch-manipulation"
              onClick={() => onPlay(track)}
              aria-label={`Play ${track.title} by ${track.artist}`}
            >
              <span className="hub-shelf-art" aria-hidden>
                {track.artworkUrl ? (
                  <img src={track.artworkUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span
                    className="hub-shelf-art-fallback"
                    style={{ background: seedGradient(`${track.artist}-${track.title}`) }}
                  />
                )}
              </span>
              <span className="hub-shelf-meta">
                <span className="hub-shelf-track">{track.title}</span>
                <span className="hub-shelf-artist">
                  {track.releaseYear ? `${track.artist} · ${track.releaseYear}` : track.artist}
                </span>
              </span>
              <Play className="hub-shelf-play w-3.5 h-3.5" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
