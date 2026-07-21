/**
 * System "Track radio" playlist — auto-upserted when a single starts similar-radio.
 * Shows under Playlists so users see the queue that was created for continue-listening.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { loadPlaylists, savePlaylists, type StoredPlaylist } from './playlistStorage';

export const TRACK_RADIO_PLAYLIST_ID = 'system-track-radio';
export const TRACK_RADIO_PLAYLIST_NAME = 'Track radio';

export function isSystemTrackRadioPlaylist(idOrPlaylist: string | StoredPlaylist): boolean {
  const id = typeof idOrPlaylist === 'string' ? idOrPlaylist : idOrPlaylist.id;
  return id === TRACK_RADIO_PLAYLIST_ID;
}

/** Replace or create the Track radio playlist from the live similar-radio queue. */
export function upsertTrackRadioPlaylist(
  tracks: MediaEnvelope[],
  seed: { title: string; artist: string },
): StoredPlaylist | null {
  if (tracks.length <= 1) return null;

  const title = seed.title.trim() || 'Unknown';
  const artist = seed.artist.trim() || 'Unknown';
  const description = `Auto-built from “${title}” by ${artist} — continues into similar tracks`;
  const now = Date.now();
  const playlists = loadPlaylists();
  const idx = playlists.findIndex((pl) => pl.id === TRACK_RADIO_PLAYLIST_ID);

  const nextPl: StoredPlaylist = {
    id: TRACK_RADIO_PLAYLIST_ID,
    name: TRACK_RADIO_PLAYLIST_NAME,
    description,
    tracks: [...tracks],
    type: 'manual',
    updatedAt: now,
  };

  if (idx >= 0) {
    const next = [...playlists];
    next[idx] = { ...next[idx], ...nextPl, name: TRACK_RADIO_PLAYLIST_NAME };
    savePlaylists(next, { skipSync: true });
    return next[idx]!;
  }

  const next = [nextPl, ...playlists];
  savePlaylists(next, { skipSync: true });
  return nextPl;
}
