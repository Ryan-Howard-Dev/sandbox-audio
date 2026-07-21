import { fetchWithTimeout } from './fetchWithTimeout';
import {
  PLAYLIST_METADATA_TIMEOUT_MS,
  type PlaylistImportMetadata,
} from './playlistImportTypes';
import {
  extractSpotifyPlaylistIdFromUrl,
  fetchAllSpotifyPlaylistTracks,
  fetchSpotifyEmbedHtml,
  parseSpotifyEmbedHtml,
} from './spotifyPlaylistImport';

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim() || /^spotify$/i.test(title.trim())) return undefined;
  return title.trim();
}

function sanitizeCreator(creator: string | undefined): string | undefined {
  if (!creator?.trim() || creator.trim().toLowerCase() === 'spotify') return undefined;
  return creator.trim();
}

export async function fetchSpotifyPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const playlistId = extractSpotifyPlaylistIdFromUrl(pageUrl);
  if (!playlistId) return { validated: false };

  const embedHtml = await fetchSpotifyEmbedHtml(playlistId);
  const parsed = embedHtml ? parseSpotifyEmbedHtml(embedHtml) : null;

  let tracks = parsed?.tracks ?? [];
  let trackCount = tracks.length || undefined;

  if (parsed?.accessToken) {
    const fromApi = await fetchAllSpotifyPlaylistTracks(playlistId, parsed.accessToken);
    if (fromApi.length > tracks.length) {
      tracks = fromApi;
      trackCount = fromApi.length;
    }
  }

  const title = sanitizeTitle(parsed?.title);
  if (title || tracks.length > 0) {
    return {
      validated: true,
      title,
      creator: sanitizeCreator(parsed?.creator),
      coverUrl: parsed?.coverUrl,
      trackStubs: tracks,
      trackCount,
    };
  }

  try {
    const oembed = await fetchWithTimeout(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(pageUrl)}`,
      { headers: { Accept: 'application/json' } },
      PLAYLIST_METADATA_TIMEOUT_MS,
    );
    if (oembed.ok) {
      const data = (await oembed.json()) as { title?: string };
      const oTitle = sanitizeTitle(data.title);
      if (oTitle) return { validated: true, title: oTitle, tracksUnavailable: true };
    }
  } catch {
    /* fall through */
  }

  return { validated: false, tracksUnavailable: true };
}
