import type { PlaylistImportMetadata } from './playlistImportTypes';
import {
  extractOgMeta,
  fetchAllSoundCloudPlaylistTracks,
  fetchSoundCloudPageHtml,
  isSoundCloudSetUrl,
  resolveSoundCloudPlaylist,
} from './soundCloudPlaylistImport';

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim() || /^soundcloud$/i.test(title.trim())) return undefined;
  return title.trim();
}

export async function fetchSoundCloudPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  if (!isSoundCloudSetUrl(pageUrl)) return { validated: false };

  const resolved = await resolveSoundCloudPlaylist(pageUrl);
  if (resolved) {
    const { clientId, playlist } = resolved;
    const tracks = await fetchAllSoundCloudPlaylistTracks(
      playlist.id!,
      clientId,
      playlist.track_count,
    );
    return {
      validated: true,
      title: sanitizeTitle(playlist.title),
      creator: playlist.user?.username,
      coverUrl: playlist.artwork_url,
      trackStubs: tracks,
      trackCount: playlist.track_count ?? tracks.length,
      tracksUnavailable: tracks.length === 0,
    };
  }

  const html = await fetchSoundCloudPageHtml(pageUrl);
  const title = sanitizeTitle(html ? extractOgMeta(html, 'og:title') : undefined);
  if (title) {
    return { validated: true, title, tracksUnavailable: true };
  }

  return { validated: true, tracksUnavailable: true };
}
