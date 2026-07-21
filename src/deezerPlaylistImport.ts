import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MAX_IMPORTED_PLAYLIST_TRACKS,
  PLAYLIST_IMPORT_PAGE_LIMIT,
  type PlaylistImportTrackStub,
} from './playlistImportTypes';

const DEEZER_API_BASE = 'https://api.deezer.com';
const DEEZER_FETCH_TIMEOUT_MS = 12_000;

export function extractDeezerPlaylistIdFromUrl(pageUrl: string): string | null {
  const match = pageUrl.match(/\/playlist\/(\d+)/i);
  return match?.[1] ?? null;
}

export async function fetchAllDeezerPlaylistTracks(
  playlistId: string,
  totalHint?: number,
  maxTracks = MAX_IMPORTED_PLAYLIST_TRACKS,
): Promise<PlaylistImportTrackStub[]> {
  const tracks: PlaylistImportTrackStub[] = [];
  let nextUrl: string | null =
    `${DEEZER_API_BASE}/playlist/${playlistId}/tracks?limit=${PLAYLIST_IMPORT_PAGE_LIMIT}`;

  while (nextUrl && tracks.length < maxTracks) {
    const res = await fetchWithTimeout(
      nextUrl,
      { headers: { Accept: 'application/json' } },
      DEEZER_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) break;
    const page = (await res.json()) as {
      data?: Array<{ title?: string; artist?: { name?: string }; duration?: number }>;
      next?: string;
      error?: unknown;
    };
    if (page.error) break;
    for (const t of page.data ?? []) {
      tracks.push({
        title: t.title?.trim() || 'Unknown track',
        artist: t.artist?.name?.trim() || undefined,
        duration: t.duration ?? undefined,
      });
    }
    nextUrl = page.next ?? null;
    if (totalHint && tracks.length >= totalHint) break;
  }

  return tracks;
}

export async function fetchDeezerPlaylistInfo(playlistId: string): Promise<{
  title?: string;
  nb_tracks?: number;
  picture?: string;
  creator?: string;
} | null> {
  try {
    const res = await fetchWithTimeout(
      `${DEEZER_API_BASE}/playlist/${playlistId}`,
      { headers: { Accept: 'application/json' } },
      DEEZER_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      nb_tracks?: number;
      picture?: string;
      creator?: { name?: string };
      error?: unknown;
    };
    if (data.error || !data.title) return null;
    return {
      title: data.title.trim(),
      nb_tracks: data.nb_tracks,
      picture: data.picture,
      creator: data.creator?.name?.trim(),
    };
  } catch {
    return null;
  }
}
