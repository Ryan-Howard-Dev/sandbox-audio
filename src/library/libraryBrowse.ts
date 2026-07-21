/**
 * Browse models + MediaEnvelope mapping for Jellyfin / Navidrome libraries.
 */

import type { MediaEnvelope } from '../sandboxLayer1';
import type { LibraryServerConfig } from './libraryServerSettings';
import { jellyfinApi, resolveLibraryStreamUrl, subsonicApi } from './libraryApi';

export type LibraryAlbum = {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  coverArtId?: string;
  songCount?: number;
  year?: number;
};

export type LibraryArtist = {
  id: string;
  name: string;
  albumCount?: number;
  coverArtId?: string;
};

export type LibraryTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string;
  albumId?: string;
  durationSeconds: number;
  trackNumber?: number;
  coverArtId?: string;
};

export type LibraryPlaylist = {
  id: string;
  name: string;
  songCount?: number;
};

type SubsonicAlbum = {
  id?: string;
  name?: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  year?: number;
};

type SubsonicSong = {
  id?: string;
  title?: string;
  artist?: string;
  album?: string;
  albumId?: string;
  duration?: number;
  track?: number;
  coverArt?: string;
};

function coverUrl(server: LibraryServerConfig, coverArtId?: string): string | undefined {
  if (!coverArtId) return undefined;
  if (server.type === 'jellyfin') {
    const token = server.accessToken ? `&api_key=${encodeURIComponent(server.accessToken)}` : '';
    return `${server.baseUrl.replace(/\/$/, '')}/Items/${encodeURIComponent(coverArtId)}/Images/Primary?maxWidth=400${token}`;
  }
  return undefined;
}

export async function fetchLibraryAlbums(
  server: LibraryServerConfig,
  size = 48,
): Promise<LibraryAlbum[]> {
  if (server.type === 'jellyfin') {
    const userId = server.userId;
    if (!userId) return [];
    const data = await jellyfinApi<{
      Items?: Array<{
        Id?: string;
        Name?: string;
        AlbumArtist?: string;
        ProductionYear?: number;
        ImageTags?: { Primary?: string };
        ChildCount?: number;
      }>;
    }>(server, `/Users/${userId}/Items`, {
      IncludeItemTypes: 'MusicAlbum',
      Recursive: 'true',
      SortBy: 'DateCreated',
      SortOrder: 'Descending',
      Limit: size,
      Fields: 'PrimaryImageAspectRatio,BasicSyncInfo',
    });
    return (data.Items ?? []).map((item) => ({
      id: item.Id ?? '',
      title: item.Name ?? 'Unknown Album',
      artist: item.AlbumArtist ?? 'Unknown Artist',
      coverArtId: item.Id,
      songCount: item.ChildCount,
      year: item.ProductionYear,
    })).filter((a) => a.id);
  }

  const data = await subsonicApi<{ albumList2?: { album?: SubsonicAlbum[] } }>(
    server,
    'getAlbumList2',
    { type: 'newest', size },
  );
  return (data.albumList2?.album ?? []).map((album) => ({
    id: album.id ?? '',
    title: album.name ?? 'Unknown Album',
    artist: album.artist ?? 'Unknown Artist',
    artistId: album.artistId,
    coverArtId: album.coverArt ?? album.id,
    songCount: album.songCount,
    year: album.year,
  })).filter((a) => a.id);
}

export async function fetchLibraryAlbumTracks(
  server: LibraryServerConfig,
  albumId: string,
): Promise<LibraryTrack[]> {
  if (server.type === 'jellyfin') {
    const data = await jellyfinApi<{
      Items?: Array<{
        Id?: string;
        Name?: string;
        Album?: string;
        AlbumId?: string;
        RunTimeTicks?: number;
        IndexNumber?: number;
      }>;
    }>(server, `/Users/${server.userId}/Items`, {
      ParentId: albumId,
      IncludeItemTypes: 'Audio',
      Fields: 'BasicSyncInfo',
    });
    return (data.Items ?? []).map((item) => ({
      id: item.Id ?? '',
      title: item.Name ?? 'Unknown Track',
      artist: 'Unknown Artist',
      album: item.Album,
      albumId: item.AlbumId ?? albumId,
      durationSeconds: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : 0,
      trackNumber: item.IndexNumber,
      coverArtId: albumId,
    })).filter((t) => t.id);
  }

  const data = await subsonicApi<{ album?: { song?: SubsonicSong[]; name?: string; artist?: string } }>(
    server,
    'getAlbum2',
    { id: albumId },
  );
  const albumName = data.album?.name;
  const albumArtist = data.album?.artist;
  return (data.album?.song ?? []).map((song) => ({
    id: song.id ?? '',
    title: song.title ?? 'Unknown Track',
    artist: song.artist ?? albumArtist ?? 'Unknown Artist',
    album: song.album ?? albumName,
    albumId: song.albumId ?? albumId,
    durationSeconds: song.duration ?? 0,
    trackNumber: song.track,
    coverArtId: song.coverArt ?? albumId,
  })).filter((t) => t.id);
}

export async function searchLibrary(
  server: LibraryServerConfig,
  query: string,
  size = 30,
): Promise<{ albums: LibraryAlbum[]; artists: LibraryArtist[]; tracks: LibraryTrack[] }> {
  const q = query.trim();
  if (!q) return { albums: [], artists: [], tracks: [] };

  if (server.type === 'jellyfin') {
    const data = await jellyfinApi<{
      Items?: Array<{
        Id?: string;
        Name?: string;
        Type?: string;
        AlbumArtist?: string;
        Album?: string;
        AlbumId?: string;
        RunTimeTicks?: number;
        ProductionYear?: number;
      }>;
    }>(server, `/Users/${server.userId}/Items`, {
      SearchTerm: q,
      IncludeItemTypes: 'MusicAlbum,Audio',
      Recursive: 'true',
      Limit: size,
      Fields: 'BasicSyncInfo',
    });
    const albums: LibraryAlbum[] = [];
    const tracks: LibraryTrack[] = [];
    for (const item of data.Items ?? []) {
      if (item.Type === 'MusicAlbum' && item.Id) {
        albums.push({
          id: item.Id,
          title: item.Name ?? 'Album',
          artist: item.AlbumArtist ?? 'Unknown Artist',
          coverArtId: item.Id,
          year: item.ProductionYear,
        });
      } else if (item.Id) {
        tracks.push({
          id: item.Id,
          title: item.Name ?? 'Track',
          artist: item.AlbumArtist ?? 'Unknown Artist',
          album: item.Album,
          albumId: item.AlbumId,
          durationSeconds: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : 0,
          coverArtId: item.AlbumId ?? item.Id,
        });
      }
    }
    return { albums, artists: [], tracks };
  }

  const data = await subsonicApi<{
    searchResult2?: {
      album?: SubsonicAlbum[];
      artist?: Array<{ id?: string; name?: string; albumCount?: number; coverArt?: string }>;
      song?: SubsonicSong[];
    };
  }>(server, 'search2', { query: q, albumCount: size, artistCount: size, songCount: size });

  return {
    albums: (data.searchResult2?.album ?? []).map((album) => ({
      id: album.id ?? '',
      title: album.name ?? 'Album',
      artist: album.artist ?? 'Unknown Artist',
      artistId: album.artistId,
      coverArtId: album.coverArt ?? album.id,
      songCount: album.songCount,
      year: album.year,
    })).filter((a) => a.id),
    artists: (data.searchResult2?.artist ?? []).map((artist) => ({
      id: artist.id ?? '',
      name: artist.name ?? 'Artist',
      albumCount: artist.albumCount,
      coverArtId: artist.coverArt ?? artist.id,
    })).filter((a) => a.id),
    tracks: (data.searchResult2?.song ?? []).map((song) => ({
      id: song.id ?? '',
      title: song.title ?? 'Track',
      artist: song.artist ?? 'Unknown Artist',
      album: song.album,
      albumId: song.albumId,
      durationSeconds: song.duration ?? 0,
      trackNumber: song.track,
      coverArtId: song.coverArt,
    })).filter((t) => t.id),
  };
}

export async function fetchLibraryPlaylists(server: LibraryServerConfig): Promise<LibraryPlaylist[]> {
  if (server.type === 'jellyfin') {
    const data = await jellyfinApi<{
      Items?: Array<{ Id?: string; Name?: string; ChildCount?: number }>;
    }>(server, `/Users/${server.userId}/Items`, {
      IncludeItemTypes: 'Playlist',
      Recursive: 'true',
      Fields: 'BasicSyncInfo',
    });
    return (data.Items ?? []).map((pl) => ({
      id: pl.Id ?? '',
      name: pl.Name ?? 'Playlist',
      songCount: pl.ChildCount,
    })).filter((p) => p.id);
  }

  const data = await subsonicApi<{
    playlists?: { playlist?: Array<{ id?: string; name?: string; songCount?: number }> };
  }>(server, 'getPlaylists');
  return (data.playlists?.playlist ?? []).map((pl) => ({
    id: pl.id ?? '',
    name: pl.name ?? 'Playlist',
    songCount: pl.songCount,
  })).filter((p) => p.id);
}

export async function fetchLibraryPlaylistTracks(
  server: LibraryServerConfig,
  playlistId: string,
): Promise<LibraryTrack[]> {
  if (server.type === 'jellyfin') {
    return fetchLibraryAlbumTracks(server, playlistId);
  }

  const data = await subsonicApi<{ playlist?: { entry?: SubsonicSong[] } }>(server, 'getPlaylist', {
    id: playlistId,
  });
  return (data.playlist?.entry ?? []).map((song) => ({
    id: song.id ?? '',
    title: song.title ?? 'Track',
    artist: song.artist ?? 'Unknown Artist',
    album: song.album,
    albumId: song.albumId,
    durationSeconds: song.duration ?? 0,
    trackNumber: song.track,
    coverArtId: song.coverArt,
  })).filter((t) => t.id);
}

export async function libraryTrackToEnvelope(
  server: LibraryServerConfig,
  track: LibraryTrack,
): Promise<MediaEnvelope> {
  const url = await resolveLibraryStreamUrl(server, track.id);
  return {
    envelopeId: `library-${server.id}-${track.id}`,
    title: track.title,
    artist: track.artist,
    album: track.album,
    url,
    durationSeconds: track.durationSeconds,
    provider: 'stream-proxy',
    transport: 'element-src',
    sourceId: `${server.id}:${track.id}`,
    artworkUrl: coverUrl(server, track.coverArtId),
  };
}

export async function libraryTracksToEnvelopes(
  server: LibraryServerConfig,
  tracks: LibraryTrack[],
): Promise<MediaEnvelope[]> {
  const out: MediaEnvelope[] = [];
  for (const track of tracks) {
    out.push(await libraryTrackToEnvelope(server, track));
  }
  return out;
}
