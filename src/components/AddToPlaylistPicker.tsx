import React, { useState } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  addTracksToPlaylist,
  createPlaylistWithTracks,
  loadPlaylists,
  type StoredPlaylist,
} from '../playlistStorage';
import { formatPlaylistStatus } from '../importPlatforms';
import ModalOverlay from '../stations/ModalOverlay';

interface AddToPlaylistPickerProps {
  open: boolean;
  onClose: () => void;
  tracks: MediaEnvelope[];
  onDone?: (message: string) => void;
  onOpenPlaylists?: () => void;
}

export default function AddToPlaylistPicker({
  open,
  onClose,
  tracks,
  onDone,
  onOpenPlaylists,
}: AddToPlaylistPickerProps) {
  const [playlists, setPlaylists] = useState<StoredPlaylist[]>(() => loadPlaylists());
  const [newName, setNewName] = useState('');

  const refresh = () => setPlaylists(loadPlaylists());

  const addTo = (playlistId: string) => {
    addTracksToPlaylist(playlistId, tracks);
    const pl = loadPlaylists().find((p) => p.id === playlistId);
    onDone?.(`Added to ${pl?.name ?? 'playlist'}`);
    onClose();
  };

  const createNew = () => {
    const pl = createPlaylistWithTracks(newName, tracks);
    onDone?.(`Created "${pl.name}"`);
    setNewName('');
    onClose();
  };

  return (
    <ModalOverlay open={open} onClose={onClose} title="Add to playlist" maxWidth="max-w-sm">
      <div className="space-y-4">
        <p className="text-sm text-[var(--text-mid)]">
          {tracks.length === 1
            ? 'Add this track to a playlist'
            : `Add ${tracks.length} tracks to a playlist`}
        </p>

        {playlists.length > 0 ? (
          <ul className="max-h-48 overflow-y-auto music-scrollbar divide-y divide-[var(--border)] border border-[var(--border)] rounded-lg">
            {playlists.map((pl) => (
              <li key={pl.id}>
                <button
                  type="button"
                  onClick={() => addTo(pl.id)}
                  className="w-full px-3 py-2.5 text-left text-sm hover:bg-[var(--bg-hover)] touch-manipulation"
                >
                  <span className="font-medium">{pl.name}</span>
                  <span className="block text-xs text-[var(--text-dim)]">
                    {formatPlaylistStatus(pl)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[var(--text-dim)]">No playlists yet — create one below.</p>
        )}

        <div className="flex gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New playlist name"
            className="input-elevated flex-1 h-10 px-3 text-sm border border-[var(--border)] rounded-lg focus-accent"
          />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={createNew}
            className="px-4 h-10 rounded-lg btn-accent text-sm font-semibold disabled:opacity-40 touch-manipulation"
          >
            Create
          </button>
        </div>

        <div className="flex justify-between items-center">
          <button
            type="button"
            onClick={() => {
              refresh();
              onDone?.('Refreshed playlists');
            }}
            className="text-xs text-[var(--text-dim)] hover:text-accent touch-manipulation"
          >
            Refresh list
          </button>
          {onOpenPlaylists && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPlaylists();
              }}
              className="text-xs text-accent hover:underline touch-manipulation"
            >
              Open Playlists
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
