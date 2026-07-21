/**
 * System "Liked" playlist — auto-managed from thumbs-up feedback.
 * Appears in Playlists tab; stores full envelopes (music + podcasts).
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { lockerEntryToEnvelope } from './smartPlaylistEngine';
import type { LockerEntry } from './lockerStorage';
import {
  getAllLikedEnvelopeEntries,
  removeLikedEnvelope,
  saveLikedEnvelope,
  touchLikedEnvelope,
} from './likedEnvelopes';
import {
  loadPlaylists,
  savePlaylists,
  type StoredPlaylist,
} from './playlistStorage';
import { getTasteProfile, type TasteFeedbackKind } from './tasteProfile';

export const LIKED_PLAYLIST_ID = 'system-liked';
export const LIKED_PLAYLIST_NAME = 'Liked';

export function isSystemLikedPlaylist(idOrPlaylist: string | StoredPlaylist): boolean {
  const id = typeof idOrPlaylist === 'string' ? idOrPlaylist : idOrPlaylist.id;
  return id === LIKED_PLAYLIST_ID;
}

function likedIdsFromProfile(): string[] {
  const profile = getTasteProfile();
  return Object.entries(profile.explicitFeedback)
    .filter(([, kind]) => kind === 'like')
    .map(([id]) => id);
}

function resolveLikedTracks(lockerEntries?: LockerEntry[]): MediaEnvelope[] {
  const lockerByEnvelopeId = new Map<string, MediaEnvelope>();
  if (lockerEntries) {
    for (const entry of lockerEntries) {
      if (!entry.url?.trim()) continue;
      const env = lockerEntryToEnvelope(entry);
      lockerByEnvelopeId.set(env.envelopeId, env);
    }
  }

  const entries = getAllLikedEnvelopeEntries();
  const byId = new Map(entries.map((e) => [e.envelope.envelopeId, e]));

  const tracks: MediaEnvelope[] = [];
  for (const id of likedIdsFromProfile()) {
    const locker = lockerByEnvelopeId.get(id);
    if (locker) {
      tracks.push(locker);
      continue;
    }
    const stored = byId.get(id);
    if (stored) tracks.push(stored.envelope);
  }

  tracks.sort((a, b) => {
    const aAt = byId.get(a.envelopeId)?.likedAt ?? 0;
    const bAt = byId.get(b.envelopeId)?.likedAt ?? 0;
    return bAt - aAt;
  });

  return tracks;
}

function tracksEqual(a: MediaEnvelope[], b: MediaEnvelope[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((t, i) => t.envelopeId === b[i]?.envelopeId);
}

/**
 * Rebuild the system Liked playlist from taste profile + stored envelopes.
 */
export function syncLikedPlaylist(lockerEntries?: LockerEntry[]): StoredPlaylist[] {
  const tracks = resolveLikedTracks(lockerEntries);
  const playlists = loadPlaylists();
  const idx = playlists.findIndex((pl) => pl.id === LIKED_PLAYLIST_ID);
  const now = Date.now();

  if (idx >= 0) {
    const prev = playlists[idx];
    if (tracksEqual(prev.tracks, tracks) && prev.name === LIKED_PLAYLIST_NAME) {
      return playlists;
    }
    const next = [...playlists];
    next[idx] = {
      ...prev,
      name: LIKED_PLAYLIST_NAME,
      description: 'Tracks and episodes you thumbs-upped',
      tracks,
      type: 'manual',
      updatedAt: now,
    };
    savePlaylists(next, { skipSync: true });
    return next;
  }

  const liked: StoredPlaylist = {
    id: LIKED_PLAYLIST_ID,
    name: LIKED_PLAYLIST_NAME,
    description: 'Tracks and episodes you thumbs-upped',
    tracks,
    type: 'manual',
    updatedAt: now,
  };
  const next = [liked, ...playlists];
  savePlaylists(next, { skipSync: true });
  return next;
}

export type LikedPlaylistMutation = {
  envelopeId: string;
  kind: TasteFeedbackKind | 'clear';
  envelope?: MediaEnvelope;
};

/** Apply a single like/dislike/clear and sync the Liked playlist. */
export function applyLikedPlaylistMutation(
  mutation: LikedPlaylistMutation,
  lockerEntries?: LockerEntry[],
): StoredPlaylist[] {
  const id = mutation.envelopeId?.trim();
  if (!id) return loadPlaylists();

  if (mutation.kind === 'like') {
    if (mutation.envelope?.envelopeId?.trim()) {
      saveLikedEnvelope(mutation.envelope);
    } else {
      touchLikedEnvelope(id);
    }
  } else {
    removeLikedEnvelope(id);
  }

  return syncLikedPlaylist(lockerEntries);
}
