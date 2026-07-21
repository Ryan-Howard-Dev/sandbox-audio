import { fetchWithTimeout } from './fetchWithTimeout';
import {
  PLAYLIST_FETCH_HEADERS,
  PLAYLIST_METADATA_TIMEOUT_MS,
  stripHtmlText,
  type PlaylistImportMetadata,
  type PlaylistImportTrackStub,
} from './playlistImportTypes';

function extractOgMeta(html: string, property: string): string | undefined {
  const match =
    html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'));
  return match?.[1]?.trim();
}

function sanitizeTitle(title: string | undefined): string | undefined {
  if (!title?.trim()) return undefined;
  const trimmed = title.trim();
  if (/^(bandcamp|amazon music|pandora)$/i.test(trimmed)) return undefined;
  return trimmed;
}

async function fetchPageHtml(pageUrl: string): Promise<string | undefined> {
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

function parseBandcampTracks(html: string): PlaylistImportTrackStub[] {
  const tracks: PlaylistImportTrackStub[] = [];
  const rowPattern =
    /<tr[^>]*class=["'][^"']*track_list_track[^"']*["'][^>]*>[\s\S]*?<span class=["']track-title["'][^>]*>([^<]+)<\/span>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowPattern.exec(html)) !== null) {
    const title = stripHtmlText(match[1] ?? '');
    if (title) tracks.push({ title });
  }
  if (tracks.length) return tracks;

  const jsonLdMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/i);
  if (jsonLdMatch) {
    try {
      const data = JSON.parse(jsonLdMatch[1]) as {
        track?: { itemListElement?: Array<{ name?: string }> };
        '@graph'?: Array<{ track?: { itemListElement?: Array<{ name?: string }> } }>;
      };
      const lists = [
        data.track?.itemListElement,
        ...(data['@graph']?.map((g) => g.track?.itemListElement) ?? []),
      ].filter(Boolean) as Array<Array<{ name?: string }>>;
      for (const list of lists) {
        for (const item of list) {
          const title = item.name?.trim();
          if (title) tracks.push({ title });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return tracks;
}

export async function fetchBandcampPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const html = await fetchPageHtml(pageUrl);
  if (!html) return { validated: false };

  const title = sanitizeTitle(extractOgMeta(html, 'og:title'));
  const coverUrl = extractOgMeta(html, 'og:image');
  const tracks = parseBandcampTracks(html);

  if (title || tracks.length > 0) {
    return {
      validated: true,
      title,
      coverUrl,
      trackStubs: tracks,
      trackCount: tracks.length || undefined,
      tracksUnavailable: tracks.length === 0,
    };
  }

  return { validated: false, tracksUnavailable: true };
}

export async function fetchAmazonMusicPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const html = await fetchPageHtml(pageUrl);
  const title = sanitizeTitle(html ? extractOgMeta(html, 'og:title') : undefined);
  const coverUrl = html ? extractOgMeta(html, 'og:image') : undefined;
  if (!title && !coverUrl) return { validated: false, tracksUnavailable: true };
  return {
    validated: Boolean(title || coverUrl),
    title,
    coverUrl,
    tracksUnavailable: true,
    blockedReason:
      'This service does not expose public playlist track lists without signing in. Import the playlist name, then add tracks from Locker.',
  };
}

export async function fetchPandoraPlaylistMetadataClient(
  pageUrl: string,
): Promise<PlaylistImportMetadata> {
  const html = await fetchPageHtml(pageUrl);
  const title = sanitizeTitle(html ? extractOgMeta(html, 'og:title') : undefined);
  const coverUrl = html ? extractOgMeta(html, 'og:image') : undefined;
  if (!title && !coverUrl) return { validated: false, tracksUnavailable: true };
  return {
    validated: Boolean(title || coverUrl),
    title,
    coverUrl,
    tracksUnavailable: true,
    blockedReason:
      'This service does not expose public playlist track lists. Import the playlist name, then add tracks from Locker.',
  };
}
