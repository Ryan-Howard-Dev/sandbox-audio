/**
 * Auto-link imported playlist title stubs to locker audio after sync or import.
 */

import { isAndroid } from './platformEnv';
import { matchLockerTracksFromStubs } from './importPlatforms';
import type { MediaEnvelope } from './sandboxLayer1';
import type { StoredPlaylist } from './playlistStorage';
import { isImportedShellWithoutTracks } from './importPlatforms';
import {
  getLockerEntries,
  lockerEntryIsPlayable,
  resolveLockerEnvelopeForPlayback,
} from './lockerStorage';
import { envelopeClaimsLocker } from './play/ensureLockerPlayable';

function envelopeKey(env: MediaEnvelope): string {
  return env.envelopeId;
}

function mergeResolvedLockerTrack(
  track: MediaEnvelope,
  resolved: MediaEnvelope,
): MediaEnvelope {
  return {
    ...track,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: resolved.sourceId ?? track.sourceId,
    url: resolved.url,
    artworkUrl: resolved.artworkUrl ?? track.artworkUrl,
    durationSeconds: resolved.durationSeconds || track.durationSeconds,
    album: track.album?.trim() || resolved.album,
  };
}

function trackNeedsLockerRepair(track: MediaEnvelope): boolean {
  return envelopeClaimsLocker(track);
}

async function trackLockerRefIsStale(track: MediaEnvelope): Promise<boolean> {
  if (!trackNeedsLockerRepair(track)) return false;
  const sourceId = track.sourceId?.trim();
  if (sourceId && (await lockerEntryIsPlayable(sourceId))) {
    if (isAndroid()) {
      const url = track.url?.trim() ?? '';
      if (url && !url.startsWith('blob:')) return false;
      const resolved = await resolveLockerEnvelopeForPlayback(track);
      return !resolved?.url?.trim() || resolved.url.startsWith('blob:');
    }
    return !track.url?.trim();
  }
  return true;
}

/** Point playlist rows at the newest playable locker copy (fixes stale sourceId / revoked blob URLs). */
export async function rematchPlaylistTracksFromLocker(
  playlist: StoredPlaylist,
): Promise<{ playlist: StoredPlaylist; repaired: number }> {
  if (playlist.tracks.length === 0) return { playlist, repaired: 0 };

  let repaired = 0;
  const nextTracks: MediaEnvelope[] = [];

  for (const track of playlist.tracks) {
    if (!(await trackLockerRefIsStale(track))) {
      nextTracks.push(track);
      continue;
    }

    const resolved = await resolveLockerEnvelopeForPlayback(track);
    if (!resolved?.url?.trim() || (isAndroid() && resolved.url.startsWith('blob:'))) {
      nextTracks.push(track);
      continue;
    }

    const merged = mergeResolvedLockerTrack(track, resolved);
    if (
      merged.sourceId !== track.sourceId ||
      merged.url !== track.url ||
      merged.provider !== track.provider
    ) {
      repaired += 1;
      nextTracks.push(merged);
    } else {
      nextTracks.push(track);
    }
  }

  if (repaired === 0) return { playlist, repaired: 0 };

  return {
    playlist: { ...playlist, tracks: nextTracks, updatedAt: Date.now() },
    repaired,
  };
}

export async function rematchAllPlaylistTracksFromLocker(
  playlists: StoredPlaylist[],
): Promise<{ playlists: StoredPlaylist[]; totalRepaired: number }> {
  const entries = await getLockerEntries();
  if (entries.length === 0) return { playlists, totalRepaired: 0 };

  let totalRepaired = 0;
  let changed = false;
  const next: StoredPlaylist[] = [];

  for (const pl of playlists) {
    const { playlist, repaired } = await rematchPlaylistTracksFromLocker(pl);
    if (repaired > 0) {
      totalRepaired += repaired;
      changed = true;
    }
    next.push(playlist);
  }

  return { playlists: changed ? next : playlists, totalRepaired };
}

/** Merge matched locker tracks into playlist without duplicating envelope ids. */
export function rematchPlaylistStubsFromLocker(
  playlist: StoredPlaylist,
  lockerTracks: MediaEnvelope[],
): { playlist: StoredPlaylist; newlyMatched: number } {
  const stubs = playlist.importTrackStubs;
  if (!stubs?.length || lockerTracks.length === 0) {
    return { playlist, newlyMatched: 0 };
  }

  const matched = matchLockerTracksFromStubs(stubs, lockerTracks);
  if (matched.length === 0) return { playlist, newlyMatched: 0 };

  const existingIds = new Set(playlist.tracks.map(envelopeKey));
  const toAdd = matched.filter((t) => !existingIds.has(envelopeKey(t)));
  if (toAdd.length === 0) return { playlist, newlyMatched: 0 };

  const nextTracks = [...playlist.tracks, ...toAdd];
  const allStubsMatched =
    stubs.length > 0 &&
    matchLockerTracksFromStubs(stubs, lockerTracks).length >= stubs.length;

  return {
    playlist: {
      ...playlist,
      tracks: nextTracks,
      pendingImport: allStubsMatched ? false : playlist.pendingImport,
      updatedAt: Date.now(),
    },
    newlyMatched: toAdd.length,
  };
}

export function rematchAllPlaylistStubsFromLocker(
  playlists: StoredPlaylist[],
  lockerTracks: MediaEnvelope[],
): { playlists: StoredPlaylist[]; totalMatched: number } {
  if (lockerTracks.length === 0) return { playlists, totalMatched: 0 };

  let totalMatched = 0;
  let changed = false;
  const next = playlists.map((pl) => {
    if (!pl.importTrackStubs?.length && !isImportedShellWithoutTracks(pl)) {
      return pl;
    }
    const { playlist, newlyMatched } = rematchPlaylistStubsFromLocker(pl, lockerTracks);
    if (newlyMatched > 0) {
      totalMatched += newlyMatched;
      changed = true;
    }
    return playlist;
  });

  return { playlists: changed ? next : playlists, totalMatched };
}

/** Stubs + stale locker refs — run after vault sync or on playlist open. */
export async function repairAllPlaylistsFromLocker(
  playlists: StoredPlaylist[],
  lockerTracks: MediaEnvelope[],
): Promise<{ playlists: StoredPlaylist[]; stubsMatched: number; tracksRepaired: number }> {
  const stubPass = rematchAllPlaylistStubsFromLocker(playlists, lockerTracks);
  const trackPass = await rematchAllPlaylistTracksFromLocker(stubPass.playlists);
  return {
    playlists: trackPass.playlists,
    stubsMatched: stubPass.totalMatched,
    tracksRepaired: trackPass.totalRepaired,
  };
}
