import type { PlaylistImportMetadata } from './playlistImportTypes';
import {
  extractDeezerPlaylistIdFromUrl,
  fetchAllDeezerPlaylistTracks,
  fetchDeezerPlaylistInfo,
} from './deezerPlaylistImport';

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim() || /^deezer$/i.test(title.trim())) return undefined;
  return title.trim();
}

export async function fetchDeezerPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const playlistId = extractDeezerPlaylistIdFromUrl(pageUrl);
  if (!playlistId) return { validated: false };

  const info = await fetchDeezerPlaylistInfo(playlistId);
  if (!info?.title) return { validated: false };

  const tracks = await fetchAllDeezerPlaylistTracks(playlistId, info.nb_tracks);
  return {
    validated: true,
    title: sanitizeTitle(info.title),
    creator: info.creator,
    coverUrl: info.picture,
    trackStubs: tracks,
    trackCount: info.nb_tracks ?? tracks.length,
  };
}
