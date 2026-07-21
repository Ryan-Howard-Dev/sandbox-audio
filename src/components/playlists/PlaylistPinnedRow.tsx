import React from 'react';
import type { StoredPlaylist } from '../../playlistStorage';
import { displayPlaylistName } from '../../importPlatforms';
import { playlistCoverUrl } from '../../playlistStorage';
import { seedGradient } from '../../seedGradient';

export interface PlaylistPinnedRowProps {
  playlists: StoredPlaylist[];
  onOpen: (playlist: StoredPlaylist) => void;
  onUnpin: (id: string) => void;
  title: string;
}

/** Up to six pinned playlists at top of library. */
export default function PlaylistPinnedRow({
  playlists,
  onOpen,
  onUnpin,
  title,
}: PlaylistPinnedRowProps) {
  if (playlists.length === 0) return null;

  return (
    <section className="playlist-pinned-row locker-pinned-row" aria-label={title}>
      <p className="locker-pinned-row-title">{title}</p>
      <div className="locker-pinned-scroll">
        {playlists.map((pl) => {
          const name = displayPlaylistName(pl);
          const cover = playlistCoverUrl(pl);
          return (
            <div key={pl.id} className="locker-pinned-card-wrap">
              <button
                type="button"
                className="locker-pinned-card touch-manipulation"
                onClick={() => onOpen(pl)}
              >
                <span className="locker-pinned-art" aria-hidden>
                  {cover ? (
                    <img src={cover} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span
                      className="locker-pinned-art-fallback"
                      style={{ background: seedGradient(name) }}
                    />
                  )}
                </span>
                <span className="locker-pinned-meta min-w-0">
                  <span className="locker-pinned-name truncate">{name}</span>
                  <span className="locker-pinned-artist truncate">
                    {pl.tracks.length} track{pl.tracks.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="locker-pinned-unpin touch-manipulation"
                onClick={() => onUnpin(pl.id)}
                aria-label={`Unpin ${name}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
