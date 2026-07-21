import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MAX_IMPORTED_PLAYLIST_TRACKS,
  PLAYLIST_IMPORT_PAGE_LIMIT,
  type PlaylistImportTrackStub,
} from './playlistImportTypes';

const SPOTIFY_EMBED_URL = 'https://open.spotify.com/embed/playlist';
const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';
const SPOTIFY_FETCH_TIMEOUT_MS = 12_000;

export function extractSpotifyPlaylistIdFromUrl(pageUrl: string): string | null {
  const match = pageUrl.match(/playlist\/([a-zA-Z0-9]+)/i);
  return match?.[1] ?? null;
}

export function extractSpotifyAccessTokenFromState(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const paths: string[][] = [
    ['settings', 'session', 'accessToken'],
    ['session', 'accessToken'],
  ];
  for (const path of paths) {
    let cur: unknown = state;
    for (const key of path) {
      if (!cur || typeof cur !== 'object') {
        cur = undefined;
        break;
      }
      cur = (cur as Record<string, unknown>)[key];
    }
    if (typeof cur === 'string' && cur.length > 20) return cur;
  }
  return findAccessTokenRecursive(state);
}

function findAccessTokenRecursive(value: unknown, depth = 0): string | null {
  if (!value || depth > 12) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    if (typeof obj.accessToken === 'string' && obj.accessToken.length > 20) {
      return obj.accessToken;
    }
    for (const child of Object.values(obj)) {
      const found = findAccessTokenRecursive(child, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export interface SpotifyEmbedParseResult {
  title?: string;
  creator?: string;
  coverUrl?: string;
  tracks: PlaylistImportTrackStub[];
  accessToken?: string;
}

export function parseSpotifyEmbedHtml(html: string): SpotifyEmbedParseResult | null {
  const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/);
  if (!nextMatch) return null;
  try {
    const data = JSON.parse(nextMatch[1]) as {
      props?: { pageProps?: { state?: unknown } };
    };
    const state = data?.props?.pageProps?.state;
    const entity = (state as { data?: { entity?: SpotifyEmbedEntity } })?.data?.entity;
    const tracks = (entity?.trackList ?? []).map((t) => ({
      title: t.title?.trim() || 'Unknown track',
      artist: t.subtitle?.trim() || undefined,
      duration: t.duration ? Math.round(t.duration / 1000) : undefined,
    }));
    return {
      title: entity?.name?.trim(),
      creator: entity?.subtitle?.trim(),
      coverUrl: entity?.coverArt?.sources?.[0]?.url,
      tracks,
      accessToken: extractSpotifyAccessTokenFromState(state) ?? undefined,
    };
  } catch {
    return null;
  }
}

interface SpotifyEmbedEntity {
  name?: string;
  subtitle?: string;
  coverArt?: { sources?: Array<{ url?: string }> };
  trackList?: Array<{ title?: string; subtitle?: string; duration?: number }>;
}

interface SpotifyApiTrackItem {
  track?: {
    name?: string;
    duration_ms?: number;
    artists?: Array<{ name?: string }>;
  } | null;
}

export async function fetchAllSpotifyPlaylistTracks(
  playlistId: string,
  accessToken: string,
  maxTracks = MAX_IMPORTED_PLAYLIST_TRACKS,
): Promise<PlaylistImportTrackStub[]> {
  const tracks: PlaylistImportTrackStub[] = [];
  let offset = 0;

  while (tracks.length < maxTracks) {
    const url = `${SPOTIFY_API_BASE}/playlists/${encodeURIComponent(playlistId)}/tracks?offset=${offset}&limit=${PLAYLIST_IMPORT_PAGE_LIMIT}`;
    const res = await fetchWithTimeout(
      url,
      { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } },
      SPOTIFY_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) break;
    const page = (await res.json()) as {
      items?: SpotifyApiTrackItem[];
      next?: string | null;
      total?: number;
    };
    const batch = (page.items ?? [])
      .map((item): PlaylistImportTrackStub | null => {
        const track = item.track;
        const title = track?.name?.trim();
        if (!title) return null;
        return {
          title,
          artist: track?.artists?.[0]?.name?.trim() || undefined,
          duration: track?.duration_ms ? Math.round(track.duration_ms / 1000) : undefined,
        };
      })
      .filter((t): t is PlaylistImportTrackStub => t !== null);
    if (!batch.length) break;
    tracks.push(...batch);
    offset += batch.length;
    if (!page.next) break;
    if (page.total !== undefined && offset >= page.total) break;
  }

  return tracks;
}

export async function fetchSpotifyEmbedHtml(playlistId: string): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(
      `${SPOTIFY_EMBED_URL}/${playlistId}`,
      { headers: { Accept: 'text/html' } },
      SPOTIFY_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return undefined;
    return await res.text();
  } catch {
    return undefined;
  }
}
