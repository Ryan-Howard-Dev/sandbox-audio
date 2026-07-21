import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MAX_IMPORTED_PLAYLIST_TRACKS,
  PLAYLIST_FETCH_HEADERS,
  PLAYLIST_METADATA_TIMEOUT_MS,
  type PlaylistImportTrackStub,
} from './playlistImportTypes';

const APPLE_MUSIC_HOME = 'https://music.apple.com';
const AMP_API_BASE = 'https://amp-api.music.apple.com/v1';

export interface AppleMusicUrlParts {
  storefront: string;
  playlistId: string;
}

export function extractAppleMusicPlaylistFromUrl(pageUrl: string): AppleMusicUrlParts | null {
  try {
    const url = new URL(pageUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    const playlistIdx = parts.findIndex((p) => p === 'playlist');
    if (playlistIdx < 1 || playlistIdx >= parts.length - 1) return null;
    const storefront = parts[playlistIdx - 1];
    const playlistId = parts[parts.length - 1];
    if (!storefront || !playlistId?.startsWith('pl.')) return null;
    return { storefront, playlistId };
  } catch {
    return null;
  }
}

let cachedAppleToken: { token: string; expiresAtMs: number } | null = null;

export async function fetchAppleMusicWebToken(): Promise<string | null> {
  const now = Date.now();
  if (cachedAppleToken && cachedAppleToken.expiresAtMs > now + 60_000) {
    return cachedAppleToken.token;
  }

  try {
    const pageRes = await fetchWithTimeout(APPLE_MUSIC_HOME, { headers: PLAYLIST_FETCH_HEADERS }, PLAYLIST_METADATA_TIMEOUT_MS);
    if (!pageRes.ok) return null;
    const pageHtml = await pageRes.text();
    const jsMatch =
      pageHtml.match(/\/assets\/index-legacy-[^"']+\.js/) ??
      pageHtml.match(/\/assets\/index-[^"']+\.js/);
    if (!jsMatch) return null;
    const jsRes = await fetchWithTimeout(`${APPLE_MUSIC_HOME}${jsMatch[0]}`, { headers: PLAYLIST_FETCH_HEADERS }, PLAYLIST_METADATA_TIMEOUT_MS);
    if (!jsRes.ok) return null;
    const jsBody = await jsRes.text();
    const token = jsBody.match(/eyJh[^"'\\]+/)?.[0];
    if (!token) return null;
    cachedAppleToken = { token, expiresAtMs: now + 3_600_000 };
    return token;
  } catch {
    return null;
  }
}

interface AmpTrack {
  attributes?: { name?: string; artistName?: string; durationInMillis?: number };
}

export async function fetchAllAppleMusicPlaylistTracks(
  parts: AppleMusicUrlParts,
  token: string,
  maxTracks = MAX_IMPORTED_PLAYLIST_TRACKS,
): Promise<{ tracks: PlaylistImportTrackStub[]; title?: string; creator?: string; coverUrl?: string }> {
  const tracks: PlaylistImportTrackStub[] = [];
  let nextUrl: string | null =
    `${AMP_API_BASE}/catalog/${parts.storefront}/playlists/${parts.playlistId}/tracks?limit=100`;

  let title: string | undefined;
  let creator: string | undefined;
  let coverUrl: string | undefined;

  const headers = {
    Authorization: `Bearer ${token}`,
    Origin: 'https://music.apple.com',
    Referer: 'https://music.apple.com/',
    Accept: 'application/json',
    ...PLAYLIST_FETCH_HEADERS,
  };

  const metaUrl = `${AMP_API_BASE}/catalog/${parts.storefront}/playlists/${parts.playlistId}`;
  try {
    const metaRes = await fetchWithTimeout(metaUrl, { headers }, PLAYLIST_METADATA_TIMEOUT_MS);
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as {
        data?: Array<{
          attributes?: { name?: string; curatorName?: string; artwork?: { url?: string } };
        }>;
      };
      const attrs = meta.data?.[0]?.attributes;
      title = attrs?.name?.trim();
      creator = attrs?.curatorName?.trim();
      const art = attrs?.artwork?.url;
      coverUrl = art ? art.replace('{w}', '400').replace('{h}', '400') : undefined;
    }
  } catch {
    /* optional */
  }

  while (nextUrl && tracks.length < maxTracks) {
    try {
      const res = await fetchWithTimeout(nextUrl, { headers }, PLAYLIST_METADATA_TIMEOUT_MS);
      if (!res.ok) break;
      const page = (await res.json()) as { data?: AmpTrack[]; next?: string | null };
      for (const item of page.data ?? []) {
        const attrs = item.attributes;
        const trackTitle = attrs?.name?.trim();
        if (!trackTitle) continue;
        tracks.push({
          title: trackTitle,
          artist: attrs?.artistName?.trim() || undefined,
          duration: attrs?.durationInMillis ? Math.round(attrs.durationInMillis / 1000) : undefined,
        });
      }
      nextUrl = page.next ? `https://amp-api.music.apple.com${page.next}` : null;
    } catch {
      break;
    }
  }

  return { tracks, title, creator, coverUrl };
}

export function resetAppleMusicTokenCacheForTests(): void {
  cachedAppleToken = null;
}
