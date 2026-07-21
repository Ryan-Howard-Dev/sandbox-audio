import React, { useEffect, useState } from 'react';
import { Loader2, Play, Plus, Search } from 'lucide-react';
import type { ExploreGroup } from '../../exploreCatalog';
import { fetchExploreEnvelopes } from '../../exploreCatalog';
import type { MediaEnvelope } from '../../sandboxLayer1';
import { seedGradient } from '../../seedGradient';

export interface ExploreInstantPanelProps {
  label: string;
  group: ExploreGroup;
  onPlay: (tracks: MediaEnvelope[], label: string) => void;
  onSavePlaylist: (tracks: MediaEnvelope[], name: string) => void;
  onSearchAll: (label: string, group: ExploreGroup) => void;
  onClose: () => void;
}

export default function ExploreInstantPanel({
  label,
  group,
  onPlay,
  onSavePlaylist,
  onSearchAll,
  onClose,
}: ExploreInstantPanelProps) {
  const [tracks, setTracks] = useState<MediaEnvelope[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchExploreEnvelopes(group, label, 25).then((envs) => {
      if (cancelled) return;
      setTracks(envs);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [group, label]);

  const playlistName = `${label} mix`;

  return (
    <section className="explore-instant-panel">
      <div className="explore-instant-head">
        <div>
          <h3 className="explore-instant-title">{label}</h3>
          <p className="explore-instant-sub">Instant 25-track mix · no search jump</p>
        </div>
        <button type="button" className="explore-instant-close touch-manipulation" onClick={onClose}>
          ×
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-[var(--text-dim)] py-4">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          Building mix…
        </div>
      ) : tracks.length === 0 ? (
        <p className="text-sm text-[var(--text-dim)] py-4">No previews available offline.</p>
      ) : (
        <>
          <div className="explore-instant-actions">
            <button
              type="button"
              className="explore-instant-btn explore-instant-btn-primary touch-manipulation"
              onClick={() => onPlay(tracks, label)}
            >
              <Play className="w-4 h-4" />
              Play mix
            </button>
            <button
              type="button"
              className="explore-instant-btn touch-manipulation"
              onClick={() => onSavePlaylist(tracks, playlistName)}
            >
              <Plus className="w-4 h-4" />
              Save playlist
            </button>
            <button
              type="button"
              className="explore-instant-btn touch-manipulation"
              onClick={() => onSearchAll(label, group)}
            >
              <Search className="w-4 h-4" />
              Search all
            </button>
          </div>
          <div className="explore-instant-scroll hide-scrollbar">
            {tracks.map((t) => (
              <div key={t.envelopeId} className="explore-instant-track">
                <span
                  className="explore-instant-art"
                  style={{
                    background: t.artworkUrl
                      ? undefined
                      : seedGradient(`${t.title}|${t.artist}`),
                  }}
                >
                  {t.artworkUrl ? <img src={t.artworkUrl} alt="" className="w-full h-full object-cover" /> : null}
                </span>
                <span className="explore-instant-track-meta">
                  <span className="explore-instant-track-title">{t.title}</span>
                  <span className="explore-instant-track-artist">{t.artist}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
