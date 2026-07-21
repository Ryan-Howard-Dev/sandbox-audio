import type { PlaylistImportMetadata } from './playlistImportTypes';
import {
  extractAppleMusicPlaylistFromUrl,
  fetchAllAppleMusicPlaylistTracks,
  fetchAppleMusicWebToken,
} from './appleMusicPlaylistImport';

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim() || /^apple\s*music$/i.test(title.trim())) return undefined;
  return title.trim();
}

export async function fetchAppleMusicPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const parts = extractAppleMusicPlaylistFromUrl(pageUrl);
  if (!parts) return { validated: false };

  const token = await fetchAppleMusicWebToken();
  if (!token) return { validated: false, tracksUnavailable: true };

  const { tracks, title, creator, coverUrl } = await fetchAllAppleMusicPlaylistTracks(parts, token);
  const resolvedTitle = sanitizeTitle(title);
  if (resolvedTitle || tracks.length > 0) {
    return {
      validated: true,
      title: resolvedTitle,
      creator,
      coverUrl,
      trackStubs: tracks,
      trackCount: tracks.length || undefined,
      tracksUnavailable: tracks.length === 0,
    };
  }

  return { validated: true, tracksUnavailable: true };
}
