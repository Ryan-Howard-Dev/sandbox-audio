/**
 * TV home rows (continue/recent/playlists/collections) and the envelope-by-id lookup that both
 * the home mini-player and Connect remote-control resolve through. Extracted from sandboxLayer3
 * with no JSX.
 *
 * Call at the original position of tvRecentlyAdded — after useShellQueueResume (homeLastQueue,
 * handleResumeLastQueue) and useShellPlayActions (handlePlayAlbum) exist, and before
 * useShellConnectRuntime, which takes this hook's resolveEnvelopeById as an argument.
 * handleTVHomeSelect is included even though it originally sat textually after
 * useShellConnectRuntime: it has no dependency on that hook's outputs (only on
 * handleResumeLastQueue, handleHomePlayById, tvPlaylists, handlePlayAlbum, goToDiscover, all of
 * which are already available here), so hoisting its plain useCallback earlier changes nothing
 * observable — it is not an effect and schedules nothing.
 */
import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { StationId } from './shellNav';
import type { TVRowId } from '../stations/TVHomeView';
import type { StoredPlaylist } from '../playlistStorage';
import {
  getLockerEntriesSnapshot,
  tracksForAlbumGroup,
} from '../lockerStorage';
import {
  getMostPlayed,
  getRecentlyPlayed,
  storedHitToEnvelope,
  type StoredPlayHit,
} from '../playHistory';
import { sanitizeRestoredEnvelope } from '../queuePersistence';

export type ShellTvHomeArgs = {
  lockerEnvelopes: MediaEnvelope[];
  playQueue: MediaEnvelope[];
  searchHits: ResolvedSearchHit[];
  homeLastQueue: MediaEnvelope[];
  audio: Pick<UseAudioFSMResult, 'state' | 'title'>;
  tvPlaylists: StoredPlaylist[];
  handlePlayEnvelope: (
    env: MediaEnvelope,
    candidates?: CandidateSource[],
  ) => Promise<boolean> | void;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  handleResumeLastQueue: () => void;
  handlePlayAlbum: (tracks: MediaEnvelope[]) => unknown;
  goToDiscover: (tab?: 'feed' | 'playlists' | 'explore' | 'mfy') => void;
  setTvScreen: Dispatch<SetStateAction<'home' | 'playback'>>;
  setStation: Dispatch<SetStateAction<StationId>>;
};

export function useShellTvHome({
  lockerEnvelopes,
  playQueue,
  searchHits,
  homeLastQueue,
  audio,
  tvPlaylists,
  handlePlayEnvelope,
  findHitCandidates,
  handleResumeLastQueue,
  handlePlayAlbum,
  goToDiscover,
  setTvScreen,
  setStation,
}: ShellTvHomeArgs) {
  const tvRecentlyAdded = useMemo(() => {
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return [];
    return [...entries]
      .sort((a, b) => b.addedAt - a.addedAt)
      .slice(0, 12)
      .map((e) => ({
        id: `local-${e.id}`,
        title: e.title,
        subtitle: e.artist || 'Unknown artist',
        artworkUrl: e.albumArt,
      }));
  }, [lockerEnvelopes]);

  const tvContinueListening = useMemo(() => {
    const items: Array<{
      id: string;
      title: string;
      subtitle: string;
      artworkUrl?: string;
      badge?: string;
    }> = [];
    if (homeLastQueue.length > 0) {
      items.push({
        id: '__resume_queue__',
        title: 'Resume Queue',
        subtitle: `${homeLastQueue.length} track${homeLastQueue.length === 1 ? '' : 's'}`,
        artworkUrl: homeLastQueue[0]?.artworkUrl,
        badge: 'Queue',
      });
    }
    getRecentlyPlayed(10).forEach((h: StoredPlayHit) => {
      items.push({
        id: h.envelopeId,
        title: h.title,
        subtitle: h.artist,
        artworkUrl: h.artworkUrl,
      });
    });
    return items;
  }, [homeLastQueue, audio.state, audio.title]);

  const tvPlaylistCards = useMemo(
    () =>
      tvPlaylists.slice(0, 12).map((pl) => ({
        id: pl.id,
        title: pl.name,
        subtitle: `${pl.tracks.length} track${pl.tracks.length === 1 ? '' : 's'}`,
        artworkUrl: pl.importCoverUrl || pl.tracks[0]?.artworkUrl,
      })),
    [tvPlaylists],
  );

  const tvCollectionCards = useMemo(() => {
    const entries = getLockerEntriesSnapshot();
    if (!entries?.length) return [];
    const albums = new Map<
      string,
      { id: string; title: string; subtitle: string; artworkUrl?: string }
    >();
    for (const e of entries) {
      const albumName = e.albumName?.trim() || 'Unknown Album';
      const artist = e.artist?.trim() || 'Unknown artist';
      const key = `${albumName}::${artist}`;
      if (!albums.has(key)) {
        albums.set(key, {
          id: `album-${key}`,
          title: albumName,
          subtitle: artist,
          artworkUrl: e.albumArt,
        });
      }
    }
    return [...albums.values()].slice(0, 12);
  }, [lockerEnvelopes]);

  const resolveEnvelopeById = useCallback(
    (envelopeId: string): MediaEnvelope | null => {
      const locker = lockerEnvelopes.find((e) => e.envelopeId === envelopeId);
      if (locker) return locker;
      const inQueue = playQueue.find((e) => e.envelopeId === envelopeId);
      if (inQueue) return inQueue;
      const searchHit = searchHits.find((h) => h.primaryEnvelope.envelopeId === envelopeId);
      if (searchHit) return searchHit.primaryEnvelope;
      const hit = getMostPlayed(32).find((h) => h.envelopeId === envelopeId);
      if (hit) return sanitizeRestoredEnvelope(storedHitToEnvelope(hit));
      const queued = homeLastQueue.find((e) => e.envelopeId === envelopeId);
      return queued ?? null;
    },
    [lockerEnvelopes, playQueue, searchHits, homeLastQueue],
  );

  const handleHomePlayById = useCallback(
    (envelopeId: string) => {
      const env = resolveEnvelopeById(envelopeId);
      if (env) void handlePlayEnvelope(env, findHitCandidates(env));
    },
    [resolveEnvelopeById, handlePlayEnvelope, findHitCandidates],
  );

  const handleTVHomeSelect = useCallback(
    (id: string, row: TVRowId) => {
      if (row === 'continue') {
        if (id === '__resume_queue__') {
          handleResumeLastQueue();
        } else {
          handleHomePlayById(id);
        }
        setTvScreen('playback');
        return;
      }
      if (row === 'recent') {
        handleHomePlayById(id);
        setTvScreen('playback');
        return;
      }
      if (row === 'playlists') {
        const pl = tvPlaylists.find((p) => p.id === id);
        if (pl?.tracks.length) {
          handlePlayAlbum(pl.tracks);
          setTvScreen('playback');
        } else {
          goToDiscover('playlists');
        }
        return;
      }
      if (row === 'collections') {
        const key = id.startsWith('album-') ? id.slice(6) : id;
        const sep = key.indexOf('::');
        if (sep < 0) return;
        const albumName = key.slice(0, sep);
        const artist = key.slice(sep + 2);
        const entries = getLockerEntriesSnapshot() ?? [];
        const albumTracks = tracksForAlbumGroup(entries, albumName, artist);
        const envs: MediaEnvelope[] = albumTracks.map((e) => ({
          envelopeId: `local-${e.id}`,
          title: e.title,
          artist: e.artist,
          album: e.albumName,
          url: e.url,
          durationSeconds: e.durationSeconds,
          provider: 'local-vault' as const,
          transport: 'element-src' as const,
          sourceId: e.id,
          artworkUrl: e.albumArt,
        }));
        if (envs.length) {
          handlePlayAlbum(envs);
          setTvScreen('playback');
        } else {
          setStation('locker');
        }
      }
    },
    [handleResumeLastQueue, handleHomePlayById, tvPlaylists, handlePlayAlbum, goToDiscover],
  );

  return {
    tvRecentlyAdded,
    tvContinueListening,
    tvPlaylistCards,
    tvCollectionCards,
    resolveEnvelopeById,
    handleHomePlayById,
    handleTVHomeSelect,
  };
}
