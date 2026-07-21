/**
 * Direct LRCLIB lyrics lookup — used on Capacitor native (no dev proxy).
 */

import { hasSameOriginCatalogProxy, preferDirectCatalog } from './catalogDirect';
import { fetchWithTimeout } from './fetchWithTimeout';
import { isTauri } from './platformEnv';

const LRCLIB_BASE = 'https://lrclib.net/api';
const LRCLIB_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': 'SovereignMusicConsole/1.0.0',
  'Lrclib-Client': 'sovereign-music-console/1.0.0',
};

type LrcLibTrack = {
  id?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
};

/** Strip remix/version parentheticals for a broader LRCLIB search. */
function simplifyLyricsSearchTitle(title: string): string {
  const stripped = title
    .replace(/\s*[\(\[][^)\]]*[\)\]]\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length >= 2 ? stripped : title.trim();
}

async function fetchLrcLibJson(path: string): Promise<LrcLibTrack | null> {
  try {
    const res = await fetchWithTimeout(`${LRCLIB_BASE}${path}`, { headers: LRCLIB_HEADERS });
    if (!res.ok) return null;
    return (await res.json()) as LrcLibTrack;
  } catch {
    return null;
  }
}

export function preferDirectLyrics(): boolean {
  if (preferDirectCatalog()) return true;
  if (isTauri() && !hasSameOriginCatalogProxy()) return true;
  return false;
}

export function hasSameOriginLyricsProxy(): boolean {
  return hasSameOriginCatalogProxy();
}

export async function fetchLyricsFromLrcLibDirect(
  title: string,
  artist: string,
  album = '',
  durationSeconds = 0,
): Promise<{ plainLyrics: string; syncedLyrics: string } | null> {
  const rawTitle = title.trim() || 'Unknown';
  const rawArtist = artist.trim() || 'Unknown';
  const rawAlbum = album.trim() || 'Unknown';
  const duration =
    Number.isFinite(durationSeconds) && durationSeconds > 0
      ? Math.round(durationSeconds)
      : 0;

  const getParams = new URLSearchParams();
  getParams.set('track_name', rawTitle);
  getParams.set('artist_name', rawArtist);
  getParams.set('album_name', rawAlbum);
  if (duration > 0) getParams.set('duration', String(duration));

  let data = await fetchLrcLibJson(`/get?${getParams.toString()}`);

  if (!data?.plainLyrics && !data?.syncedLyrics) {
    const searchParams = new URLSearchParams();
    if (rawTitle !== 'Unknown') searchParams.set('track_name', rawTitle);
    if (rawArtist !== 'Unknown') searchParams.set('artist_name', rawArtist);
    try {
      const searchRes = await fetchWithTimeout(`${LRCLIB_BASE}/search?${searchParams.toString()}`, {
        headers: LRCLIB_HEADERS,
      });
      if (searchRes.ok) {
        const results = (await searchRes.json()) as LrcLibTrack[];
        const best = Array.isArray(results) ? results[0] : null;
        if (best?.plainLyrics || best?.syncedLyrics) {
          data = best;
        } else if (best?.id) {
          data = await fetchLrcLibJson(`/get/${best.id}`);
        }
      }
    } catch {
      /* ignore */
    }
  }

  if (!data?.plainLyrics && !data?.syncedLyrics && rawTitle !== 'Unknown') {
    const simplified = simplifyLyricsSearchTitle(rawTitle);
    if (simplified && simplified !== rawTitle) {
      const retryParams = new URLSearchParams();
      retryParams.set('track_name', simplified);
      if (rawArtist !== 'Unknown') retryParams.set('artist_name', rawArtist);
      try {
        const searchRes = await fetchWithTimeout(`${LRCLIB_BASE}/search?${retryParams.toString()}`, {
          headers: LRCLIB_HEADERS,
        });
        if (searchRes.ok) {
          const results = (await searchRes.json()) as LrcLibTrack[];
          const best = Array.isArray(results) ? results[0] : null;
          if (best?.plainLyrics || best?.syncedLyrics) {
            data = best;
          } else if (best?.id) {
            data = await fetchLrcLibJson(`/get/${best.id}`);
          }
        }
      } catch {
        /* ignore */
      }
    }
  }

  const plainLyrics = data?.plainLyrics?.trim() ?? '';
  const syncedLyrics = data?.syncedLyrics?.trim() ?? '';
  const lyrics = syncedLyrics || plainLyrics;
  if (!lyrics) return null;
  return { plainLyrics, syncedLyrics };
}
