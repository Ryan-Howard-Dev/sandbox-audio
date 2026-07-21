import { fetchWithTimeout } from './fetchWithTimeout';
import {
  extractTidalCountryCodeFromEmbedHtml,
  extractTidalPlaylistUuidFromEmbedHtml,
  fetchAllTidalPlaylistItems,
  isTidalFullPlaylistUuid,
} from './tidalApiClient';

const PLAYLIST_FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,application/json',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
};

const TIDAL_METADATA_TIMEOUT_MS = 12_000;

export interface TidalTrackStub {
  title: string;
  artist?: string;
  duration?: number;
}

export interface TidalPlaylistMetadata {
  title?: string;
  trackCount?: number;
  trackStubs?: TidalTrackStub[];
  validated: boolean;
  tracksUnavailable?: boolean;
  blocked?: boolean;
  blockedReason?: string;
  coverUrl?: string;
  creator?: string;
}

const GENERIC_SITE_TITLE_PATTERNS = [
  /^tidal\s*[-–—|]?\s*high fidelity music streaming$/i,
  /^tidal$/i,
];

function sanitizePlaylistTitle(title: string | undefined): string | undefined {
  if (!title?.trim()) return undefined;
  const trimmed = title.trim();
  if (GENERIC_SITE_TITLE_PATTERNS.some((re) => re.test(trimmed))) return undefined;
  return trimmed;
}

const GENERIC_CREATOR_LABELS = new Set(['user', 'spotify', 'tidal', 'deezer', 'soundcloud']);

function sanitizePlaylistCreator(creator: string | undefined): string | undefined {
  if (!creator?.trim()) return undefined;
  const trimmed = creator.trim();
  if (GENERIC_CREATOR_LABELS.has(trimmed.toLowerCase())) return undefined;
  return trimmed;
}

export function extractTidalPlaylistIdFromUrl(pageUrl: string): string | null {
  try {
    const path = new URL(pageUrl).pathname;
    const segments = path.split('/').filter(Boolean);
    const playlistIdx = segments.findIndex((s) => s.toLowerCase() === 'playlist');
    if (playlistIdx < 0 || playlistIdx >= segments.length - 1) return null;
    const id = segments[playlistIdx + 1]?.trim();
    return id && /^[0-9a-f-]+$/i.test(id) ? id : null;
  } catch {
    const match = pageUrl.match(/playlist\/([0-9a-f-]+)/i);
    return match?.[1] ?? null;
  }
}

function parseDurationLabel(label: string | undefined): number | undefined {
  if (!label?.trim()) return undefined;
  const parts = label.trim().split(':').map((p) => Number.parseInt(p, 10));
  if (parts.some((n) => Number.isNaN(n))) return undefined;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return undefined;
}

function stripHtmlText(raw: string): string {
  return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function isGenericTidalCover(url: string | undefined): boolean {
  if (!url?.trim()) return true;
  return /\/img\/FB_1200x627\.png/i.test(url) || /tidal\.com\/img\//i.test(url);
}

function isTidalEmbedError(html: string | undefined): boolean {
  if (!html) return true;
  return (
    html.includes('embed-player--showing-error') ||
    html.includes('dialog--error') ||
    html.length < 1500
  );
}

function extractOgMeta(html: string, property: string): string | undefined {
  const match =
    html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i')) ??
    html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`, 'i'));
  return match?.[1]?.trim();
}

function extractOgTitle(html: string): string | undefined {
  return sanitizePlaylistTitle(extractOgMeta(html, 'og:title'));
}

function extractOgImage(html: string): string | undefined {
  return extractOgMeta(html, 'og:image');
}

function extractTidalBrowseCreator(html: string): string | undefined {
  const match = html.match(/Created by\s*<a[^>]*>([^<]+)<\/a>/i);
  return sanitizePlaylistCreator(match?.[1]?.trim());
}

async function fetchPageHtml(pageUrl: string): Promise<string | undefined> {
  try {
    const upstream = await fetchWithTimeout(
      pageUrl,
      { headers: PLAYLIST_FETCH_HEADERS },
      TIDAL_METADATA_TIMEOUT_MS,
    );
    if (!upstream.ok) return undefined;
    return await upstream.text();
  } catch {
    return undefined;
  }
}

function parseTidalEmbedHtml(html: string): {
  title?: string;
  creator?: string;
  coverUrl?: string;
  tracks: TidalTrackStub[];
} {
  const albumTitleMatch =
    html.match(/<h1[^>]*class=["']media-album["'][^>]*title=["']Album:\s*([^"']+)["']/i) ??
    html.match(/<h1[^>]*class=["']media-album["'][^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
  const title = sanitizePlaylistTitle(albumTitleMatch?.[1]?.trim());

  const creatorMatch =
    html.match(/<span[^>]*class=["']media-artist["'][^>]*title=["']Artist:\s*([^"']+)["']/i) ??
    html.match(/<span[^>]*class=["']media-artist["'][^>]*>([^<]+)</i);
  const creator = sanitizePlaylistCreator(creatorMatch?.[1]?.trim());

  const coverMatch = html.match(/<img[^>]*class=["']cover-art["'][^>]*src=["']([^"']+)["']/i);
  const coverUrl = coverMatch?.[1];

  const tracks: TidalTrackStub[] = [];
  const listItemPattern =
    /<list-item[\s\S]*?<span slot=["']title["']>([^<]+)<\/span>[\s\S]*?<span slot=["']artist["']>([\s\S]*?)<\/span>[\s\S]*?(?:<time slot=["']duration["']>([^<]*)<\/time>)?/gi;
  let match: RegExpExecArray | null;
  while ((match = listItemPattern.exec(html)) !== null) {
    const trackTitle = match[1]?.trim();
    if (!trackTitle) continue;
    tracks.push({
      title: trackTitle,
      artist: stripHtmlText(match[2] ?? '') || undefined,
      duration: parseDurationLabel(match[3]),
    });
  }

  return { title, creator, coverUrl, tracks };
}

function buildTidalMetadataResult(input: {
  title?: string;
  creator?: string;
  coverUrl?: string;
  tracks?: TidalTrackStub[];
  trackCount?: number;
  tracksUnavailable?: boolean;
  blocked?: boolean;
  blockedReason?: string;
}): TidalPlaylistMetadata {
  const tracks = input.tracks ?? [];
  const title = sanitizePlaylistTitle(input.title);
  const coverUrl = isGenericTidalCover(input.coverUrl) ? undefined : input.coverUrl;
  const hasData = Boolean(title || tracks.length > 0 || coverUrl || input.creator);
  return {
    validated: hasData,
    title,
    creator: sanitizePlaylistCreator(input.creator),
    coverUrl,
    trackStubs: tracks,
    trackCount: input.trackCount ?? (tracks.length > 0 ? tracks.length : undefined),
    tracksUnavailable: input.tracksUnavailable ?? tracks.length === 0,
    blocked: input.blocked,
    blockedReason: input.blockedReason,
  };
}

/** Fetch Tidal playlist metadata directly from the device (no Sandbox Server). */
export async function fetchTidalPlaylistMetadataClient(
  pageUrl: string,
): Promise<TidalPlaylistMetadata> {
  const playlistId = extractTidalPlaylistIdFromUrl(pageUrl);
  if (!playlistId) return { validated: false };

  const browseUrl = `https://tidal.com/browse/playlist/${playlistId}`;
  const listenUrl = `https://listen.tidal.com/playlist/${playlistId}`;
  const embedUrl = `https://embed.tidal.com/playlists/${playlistId}`;

  const [browseHtml, listenHtml, embedHtml] = await Promise.all([
    fetchPageHtml(browseUrl),
    fetchPageHtml(listenUrl),
    fetchPageHtml(embedUrl),
  ]);

  const browseTitle = browseHtml ? extractOgTitle(browseHtml) : undefined;
  const listenTitle = listenHtml ? extractOgTitle(listenHtml) : undefined;
  const browseCover = browseHtml ? extractOgImage(browseHtml) : undefined;
  const listenCover = listenHtml ? extractOgImage(listenHtml) : undefined;
  const browseCreator = browseHtml ? extractTidalBrowseCreator(browseHtml) : undefined;

  const embedBlocked = isTidalEmbedError(embedHtml);
  const parsedEmbed = embedHtml && !embedBlocked ? parseTidalEmbedHtml(embedHtml) : null;

  const title = parsedEmbed?.title ?? browseTitle ?? listenTitle;
  const creator = parsedEmbed?.creator ?? browseCreator;
  const coverUrl = parsedEmbed?.coverUrl ?? browseCover ?? listenCover;
  const embedTracks = parsedEmbed?.tracks ?? [];

  const apiPlaylistId =
    (embedHtml ? extractTidalPlaylistUuidFromEmbedHtml(embedHtml) : null) ??
    (isTidalFullPlaylistUuid(playlistId) ? playlistId : null);

  let tracks = embedTracks;
  let trackCount: number | undefined = embedTracks.length || undefined;

  if (apiPlaylistId) {
    const preferredCountry = embedHtml
      ? extractTidalCountryCodeFromEmbedHtml(embedHtml)
      : undefined;
    const fromApi = await fetchAllTidalPlaylistItems(apiPlaylistId, {
      preferredCountryCode: preferredCountry,
    });
    if (fromApi.tracks.length > tracks.length) {
      tracks = fromApi.tracks;
      trackCount = fromApi.total ?? fromApi.tracks.length;
    }
  }

  if (title || tracks.length > 0) {
    return buildTidalMetadataResult({
      title,
      creator,
      coverUrl,
      tracks,
      trackCount,
    });
  }

  const genericBrowse =
    !browseTitle &&
    !listenTitle &&
    (isGenericTidalCover(browseCover) || isGenericTidalCover(listenCover));

  if (embedBlocked && genericBrowse) {
    return buildTidalMetadataResult({
      blocked: true,
      blockedReason:
        'This service did not expose this playlist publicly. It may be private or region-locked. Try another public playlist link, or enter the playlist name manually.',
    });
  }

  return buildTidalMetadataResult({
    title,
    creator,
    coverUrl,
    tracks,
    tracksUnavailable: true,
  });
}
