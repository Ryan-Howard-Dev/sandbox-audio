import { fetchWithTimeout } from './fetchWithTimeout';
import {
  MAX_IMPORTED_PLAYLIST_TRACKS,
  PLAYLIST_FETCH_HEADERS,
  PLAYLIST_METADATA_TIMEOUT_MS,
  type PlaylistImportTrackStub,
} from './playlistImportTypes';

const YTM_BROWSE_URL = 'https://music.youtube.com/youtubei/v1/browse';
const YTM_FETCH_TIMEOUT_MS = 14_000;

export function extractYoutubePlaylistIdFromUrl(pageUrl: string): string | null {
  try {
    const list = new URL(pageUrl).searchParams.get('list');
    return list?.trim() || null;
  } catch {
    const match = pageUrl.match(/[?&]list=([^&]+)/i);
    return match?.[1] ?? null;
  }
}

interface InnertubeConfig {
  apiKey: string;
  clientVersion: string;
}

export async function fetchYoutubeMusicPageHtml(pageUrl: string): Promise<string | undefined> {
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

export function extractInnertubeConfigFromHtml(html: string): InnertubeConfig | null {
  const apiKey = html.match(/INNERTUBE_API_KEY":"([^"]+)"/)?.[1];
  const clientVersion = html.match(/INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1];
  if (!apiKey || !clientVersion) return null;
  return { apiKey, clientVersion };
}

function extractTracksFromInnertubePayload(payload: unknown): PlaylistImportTrackStub[] {
  const tracks: PlaylistImportTrackStub[] = [];
  const walk = (obj: unknown, depth = 0) => {
    if (!obj || depth > 14) return;
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      const record = obj as Record<string, unknown>;
      const item = record.musicResponsiveListItemRenderer as
        | {
            flexColumns?: Array<{
              musicResponsiveListItemFlexColumnRenderer?: {
                text?: { runs?: Array<{ text?: string }> };
              };
            }>;
          }
        | undefined;
      if (item?.flexColumns?.length) {
        const title =
          item.flexColumns[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim();
        const artist =
          item.flexColumns[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs?.[0]?.text?.trim();
        if (title) tracks.push({ title, artist: artist || undefined });
      }
      for (const value of Object.values(record)) walk(value, depth + 1);
    } else if (Array.isArray(obj)) {
      for (const value of obj) walk(value, depth + 1);
    }
  };
  walk(payload);
  return tracks;
}

function extractPlaylistTitle(payload: unknown): string | undefined {
  const data = payload as {
    header?: { musicDetailHeaderRenderer?: { title?: { runs?: Array<{ text?: string }> } } };
    metadata?: {
      musicPlaylistShelfHeaderRenderer?: { title?: { runs?: Array<{ text?: string }> } };
    };
  };
  return (
    data?.header?.musicDetailHeaderRenderer?.title?.runs?.[0]?.text?.trim() ??
    data?.metadata?.musicPlaylistShelfHeaderRenderer?.title?.runs?.[0]?.text?.trim()
  );
}

function extractContinuation(payload: unknown): string | undefined {
  const walk = (obj: unknown, depth = 0): string | undefined => {
    if (!obj || depth > 14) return undefined;
    if (typeof obj === 'object' && !Array.isArray(obj)) {
      const record = obj as Record<string, unknown>;
      const next = record.nextContinuationData as { continuation?: string } | undefined;
      if (next?.continuation) return next.continuation;
      for (const value of Object.values(record)) {
        const found = walk(value, depth + 1);
        if (found) return found;
      }
    } else if (Array.isArray(obj)) {
      for (const value of obj) {
        const found = walk(value, depth + 1);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(payload);
}

async function postInnertube(
  config: InnertubeConfig,
  body: Record<string, unknown>,
): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(
      `${YTM_BROWSE_URL}?key=${encodeURIComponent(config.apiKey)}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...PLAYLIST_FETCH_HEADERS,
        },
        body: JSON.stringify(body),
      },
      YTM_FETCH_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function innertubeContext(config: InnertubeConfig) {
  return {
    client: {
      clientName: 'WEB_REMIX',
      clientVersion: config.clientVersion,
      hl: 'en',
      gl: 'US',
    },
  };
}

export async function fetchAllYoutubeMusicPlaylistTracks(
  listId: string,
  config: InnertubeConfig,
  maxTracks = MAX_IMPORTED_PLAYLIST_TRACKS,
): Promise<{ tracks: PlaylistImportTrackStub[]; title?: string }> {
  const tracks: PlaylistImportTrackStub[] = [];
  const seen = new Set<string>();
  let title: string | undefined;

  let payload = await postInnertube(config, {
    context: innertubeContext(config),
    browseId: `VL${listId}`,
  });
  if (!payload) return { tracks };

  title = extractPlaylistTitle(payload);
  for (const track of extractTracksFromInnertubePayload(payload)) {
    const key = `${track.title}::${track.artist ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tracks.push(track);
  }

  let continuation = extractContinuation(payload);
  while (continuation && tracks.length < maxTracks) {
    payload = await postInnertube(config, {
      context: innertubeContext(config),
      continuation,
    });
    if (!payload) break;
    const batch = extractTracksFromInnertubePayload(payload);
    if (!batch.length) break;
    for (const track of batch) {
      const key = `${track.title}::${track.artist ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      tracks.push(track);
      if (tracks.length >= maxTracks) break;
    }
    const next = extractContinuation(payload);
    if (!next || next === continuation) break;
    continuation = next;
  }

  return { tracks, title };
}
