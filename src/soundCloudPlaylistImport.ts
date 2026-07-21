import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MAX_IMPORTED_PLAYLIST_TRACKS,
  PLAYLIST_FETCH_HEADERS,
  PLAYLIST_METADATA_TIMEOUT_MS,
  type PlaylistImportTrackStub,
} from './playlistImportTypes';

const SOUNDCLOUD_API_BASE = 'https://api-v2.soundcloud.com';
const SOUNDCLOUD_CLIENT_IDS = [
  'iZIs9mazKQK2Qu428d0eILP8qbk2PYSO',
  'LBCcHmRB8XSStWL6wKH2P8kgctZ4bfWR',
  '2t9loeuHnktjbYrCFR3iM9S1ZQMOARjE',
] as const;

export function isSoundCloudSetUrl(pageUrl: string): boolean {
  try {
    return new URL(pageUrl).pathname.toLowerCase().includes('/sets/');
  } catch {
    return /\/sets\//i.test(pageUrl);
  }
}

async function resolveWithClientId(
  pageUrl: string,
  clientId: string,
): Promise<{
  id?: number;
  title?: string;
  track_count?: number;
  artwork_url?: string;
  user?: { username?: string };
} | null> {
  const resolveUrl = `${SOUNDCLOUD_API_BASE}/resolve?url=${encodeURIComponent(pageUrl)}&client_id=${clientId}`;
  try {
    const res = await fetchWithTimeout(
      resolveUrl,
      { headers: { Accept: 'application/json' } },
      PLAYLIST_METADATA_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      id?: number;
      title?: string;
      track_count?: number;
      artwork_url?: string;
      user?: { username?: string };
      kind?: string;
    };
    if (!data.id || data.kind !== 'playlist') return null;
    return data;
  } catch {
    return null;
  }
}

export async function resolveSoundCloudPlaylist(
  pageUrl: string,
): Promise<{ clientId: string; playlist: NonNullable<Awaited<ReturnType<typeof resolveWithClientId>>> } | null> {
  for (const clientId of SOUNDCLOUD_CLIENT_IDS) {
    const playlist = await resolveWithClientId(pageUrl, clientId);
    if (playlist?.id) return { clientId, playlist };
  }
  return null;
}

export async function fetchAllSoundCloudPlaylistTracks(
  playlistId: number,
  clientId: string,
  totalHint?: number,
  maxTracks = MAX_IMPORTED_PLAYLIST_TRACKS,
): Promise<PlaylistImportTrackStub[]> {
  const tracks: PlaylistImportTrackStub[] = [];
  let offset = 0;
  const limit = 50;

  while (tracks.length < maxTracks) {
    const url = `${SOUNDCLOUD_API_BASE}/playlists/${playlistId}/tracks?client_id=${clientId}&limit=${limit}&offset=${offset}&linked=0`;
    try {
      const res = await fetchWithTimeout(
        url,
        { headers: { Accept: 'application/json' } },
        PLAYLIST_METADATA_TIMEOUT_MS,
      );
      if (!res.ok) break;
      const page = (await res.json()) as
        | Array<{ title?: string; user?: { username?: string }; duration?: number }>
        | { collection?: Array<{ title?: string; user?: { username?: string }; duration?: number }> };
      const batch = Array.isArray(page) ? page : (page.collection ?? []);
      if (!batch.length) break;
      for (const track of batch) {
        tracks.push({
          title: track.title?.trim() || 'Unknown track',
          artist: track.user?.username?.trim() || undefined,
          duration: track.duration ? Math.round(track.duration / 1000) : undefined,
        });
      }
      offset += batch.length;
      if (batch.length < limit) break;
      if (totalHint && tracks.length >= totalHint) break;
    } catch {
      break;
    }
  }

  return tracks;
}

export async function fetchSoundCloudPageHtml(pageUrl: string): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(
      pageUrl,
      { headers: PLAYLIST_FETCH_HEADERS },
      PLAYLIST_METADATA_TIMEOUT_MS,
    );
    if (!res.ok) return undefined;
    return await res.text();
  } catch {
    return undefined;
  }
}

export function extractOgMeta(html: string, property: string): string | undefined {
  const match =
    html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'));
  return match?.[1]?.trim();
}
