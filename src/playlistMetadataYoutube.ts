import { fetchWithTimeout } from './fetchWithTimeout';
import {
  PLAYLIST_FETCH_HEADERS,
  PLAYLIST_METADATA_TIMEOUT_MS,
  type PlaylistImportMetadata,
} from './playlistImportTypes';
import {
  extractInnertubeConfigFromHtml,
  extractYoutubePlaylistIdFromUrl,
  fetchAllYoutubeMusicPlaylistTracks,
  fetchYoutubeMusicPageHtml,
} from './youtubeMusicPlaylistImport';

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim()) return undefined;
  const trimmed = title.trim();
  if (/^youtube\s*music$/i.test(trimmed) || /^youtube$/i.test(trimmed)) return undefined;
  return trimmed;
}

function extractOgTitle(html: string): string | undefined {
  const match =
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  return sanitizeTitle(match?.[1]?.trim());
}

export async function fetchYoutubeMusicPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const listId = extractYoutubePlaylistIdFromUrl(pageUrl);
  if (!listId) return { validated: false };

  const canonical =
    pageUrl.includes('music.youtube.com') || pageUrl.includes('youtube.com')
      ? pageUrl
      : `https://music.youtube.com/playlist?list=${encodeURIComponent(listId)}`;

  const html = await fetchYoutubeMusicPageHtml(canonical);
  if (!html) return { validated: false, tracksUnavailable: true };

  const config = extractInnertubeConfigFromHtml(html);
  const ogTitle = extractOgTitle(html);

  if (config) {
    const { tracks, title } = await fetchAllYoutubeMusicPlaylistTracks(listId, config);
    const resolvedTitle = sanitizeTitle(title) ?? ogTitle;
    if (resolvedTitle || tracks.length > 0) {
      return {
        validated: true,
        title: resolvedTitle,
        trackStubs: tracks,
        trackCount: tracks.length || undefined,
        tracksUnavailable: tracks.length === 0,
      };
    }
  }

  if (ogTitle) {
    return { validated: true, title: ogTitle, tracksUnavailable: true };
  }

  return { validated: true, tracksUnavailable: true };
}
