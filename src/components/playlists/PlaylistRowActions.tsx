import React from 'react';
import { Play, Shuffle } from 'lucide-react';
import PlaylistMoreMenu from '../PlaylistMoreMenu';
import type { PlaylistMoreMenuProps } from '../PlaylistMoreMenu';

export interface PlaylistRowActionsProps extends Omit<PlaylistMoreMenuProps, 'open' | 'onOpenChange'> {
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  showPlayShuffle?: boolean;
}

/** Play · Shuffle · ⋮ row actions for playlist library rows. */
export default function PlaylistRowActions({
  menuOpen,
  onMenuOpenChange,
  showPlayShuffle = true,
  playlist,
  onPlayNow,
  onShuffle,
  downloadLabel,
  ...menuProps
}: PlaylistRowActionsProps) {
  const hasTracks = playlist.tracks.length > 0;

  return (
    <div className="playlist-row-actions" onClick={(e) => e.stopPropagation()} role="presentation">
      {showPlayShuffle ? (
        <>
          <button
            type="button"
            className="playlist-row-action-btn touch-manipulation"
            aria-label="Play playlist"
            disabled={!hasTracks}
            onClick={(e) => {
              e.stopPropagation();
              onPlayNow();
            }}
          >
            <Play className="w-4 h-4" />
          </button>
          <button
            type="button"
            className="playlist-row-action-btn touch-manipulation"
            aria-label="Shuffle playlist"
            disabled={!hasTracks}
            onClick={(e) => {
              e.stopPropagation();
              onShuffle();
            }}
          >
            <Shuffle className="w-4 h-4" />
          </button>
        </>
      ) : null}
      <PlaylistMoreMenu
        playlist={playlist}
        open={menuOpen}
        onOpenChange={onMenuOpenChange}
        onPlayNow={onPlayNow}
        onShuffle={onShuffle}
        downloadLabel={downloadLabel}
        {...menuProps}
      />
    </div>
  );
}
