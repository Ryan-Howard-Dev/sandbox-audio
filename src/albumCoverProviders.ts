/**
 * Supplemental album-cover providers — Last.fm, Deezer, Discogs, YouTube,
 * DatPiff, and untitled.stream (via page scrape).
 */

import { catalogSearchUrl } from './catalogApi';
import { fetchCatalogApiResults, type CatalogProviderItem } from './catalogFetch';
import { fetchWithTimeout, raceTimeout } from './fetchWithTimeout';
import {
  fetchAlbumMetadata,
  fetchCoverByMusicBrainzReleaseId,
} from './sandboxLayer2';
import { isUsableArtistName } from './lockerStorage';
import { loadScrobbleSettings } from './scrobbleSettings';
import { loadPlaybackEngineSettings } from './playbackEngineSettings';
import { searchViaPipedMobile } from './pipedMobile';
import { fetchCoverScrapeHtml } from './coverPageProxy';
import { isLastFmBrandingCoverUrl, sanitizeCoverArtUrl } from './displaySanitize';
import {
  catalogArtistNamesEquivalent,
  normalizeAlbumTitleForMatch,
} from './searchCatalog';

export { isLastFmBrandingCoverUrl };

export type CoverArtSource =
  | 'musicbrainz'
  | 'catalog'
  | 'audiodb'
  | 'lastfm'
  | 'deezer'
  | 'discogs'
  | 'youtube'
  | 'datpiff'
  | 'untitled';

export interface CoverLookupResult {
  url: string;
  year?: string;
  source: CoverArtSource;
}

const PLACEHOLDER_ARTIST = /^(local upload|unknown artist|various artists?)$/i;
const PROVIDER_TIMEOUT_MS = 10_000;

export function normalizeCoverTitle(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function coverTitlesMatch(a: string, b: string): boolean {
  const na = normalizeCoverTitle(a);
  const nb = normalizeCoverTitle(b);
  if (!na || !nb) return false;
  const coreA = normalizeAlbumTitleForMatch(a);
  const coreB = normalizeAlbumTitleForMatch(b);
  if (coreA && coreB && (coreA === coreB || coreA.includes(coreB) || coreB.includes(coreA))) {
    return true;
  }
  return na === nb || na.includes(nb) || nb.includes(na);
}

const COVER_ARTIST_MATCH_MIN_SCORE = 500;

/** Score how well a provider artist name matches the requested artist (0 = no match). */
export function coverArtistRelevanceScore(artistName: string, targetArtist: string): number {
  const target = targetArtist.trim();
  if (!target) return 0;
  const name = artistName.trim();
  if (!name) return 0;
  if (catalogArtistNamesEquivalent(name, target)) return 1000;
  const n = normalizeCoverTitle(name);
  const q = normalizeCoverTitle(target);
  if (n === q) return 1000;
  if (n.includes(q) || q.includes(n)) return 700;
  const qWords = q.split(' ').filter(Boolean);
  if (qWords.length > 1 && qWords.every((w) => n.includes(w))) return 700;
  if (qWords.some((w) => w.length >= 4 && n.includes(w))) return 300;
  return 0;
}

export function coverArtistMatches(artistName: string, targetArtist: string): boolean {
  return coverArtistRelevanceScore(artistName, targetArtist) >= COVER_ARTIST_MATCH_MIN_SCORE;
}

/** Prefer album+artist matches; reject cross-artist title collisions (e.g. Anne Wilson "REBEL"). */
export function pickCatalogCoverItem(
  results: CatalogProviderItem[],
  album: string,
  artist: string,
): CatalogProviderItem | null {
  if (results.length === 0) return null;
  const cleanArtist = artist.trim();

  const ranked = results
    .map((item) => {
      if (!item.collectionName?.trim()) return null;
      if (!coverTitlesMatch(item.collectionName, album)) return null;
      let score = 400;
      if (item.artistName && cleanArtist) {
        const artistScore = coverArtistRelevanceScore(item.artistName, cleanArtist);
        if (artistScore < COVER_ARTIST_MATCH_MIN_SCORE) return null;
        score += artistScore;
      } else if (cleanArtist) {
        return null;
      }
      if (item.trackCount && item.trackCount > 1) score += 40;
      return { item, score };
    })
    .filter((row): row is { item: CatalogProviderItem; score: number } => row !== null)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.item ?? null;
}

/** Providers that can return a popular wrong-artist album when searched by title alone. */
const DISAMBIGUATION_REQUIRED_SOURCES: ReadonlySet<CoverArtSource> = new Set([
  'catalog',
  'audiodb',
  'lastfm',
  'discogs',
  'datpiff',
  'youtube',
]);

export function youtubeThumbUrl(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

export function extractUntitledStreamUrl(...parts: (string | undefined)[]): string | null {
  for (const part of parts) {
    const match = part?.match(
      /https?:\/\/(?:www\.)?untitled\.stream\/[^\s"'<>]+/i,
    );
    if (match?.[0]) return match[0].replace(/[),.;]+$/, '');
  }
  return null;
}

function pickLargestLastFmImage(
  images: Array<{ '#text'?: string; size?: string }> | undefined,
): string | undefined {
  if (!images?.length) return undefined;
  const order = ['mega', 'extralarge', 'large', 'medium', 'small'];
  for (const size of order) {
    const hit = images.find((img) => img.size === size && img['#text']?.trim());
    if (hit?.['#text']?.trim()) return hit['#text'].trim();
  }
  return images.find((img) => img['#text']?.trim())?.['#text']?.trim();
}

function walkForCoverUrl(node: unknown, depth = 0): string | undefined {
  if (depth > 12 || node == null) return undefined;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (
      /^https:\/\//i.test(trimmed) &&
      /\.(jpg|jpeg|png|webp)(\?|$)/i.test(trimmed)
    ) {
      return trimmed;
    }
    return undefined;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = walkForCoverUrl(item, depth + 1);
      if (found) return found;
    }
    return undefined;
  }
  if (typeof node === 'object') {
    const record = node as Record<string, unknown>;
    for (const key of [
      'cover_art_url',
      'coverArtUrl',
      'cover_url',
      'coverUrl',
      'cover_image',
      'coverImage',
      'artwork_url',
      'artworkUrl',
      'image_url',
      'imageUrl',
      'thumbnail',
      'thumb',
    ]) {
      const val = record[key];
      if (typeof val === 'string' && val.trim().startsWith('https://')) {
        return val.trim();
      }
    }
    for (const val of Object.values(record)) {
      const found = walkForCoverUrl(val, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

function parseUntitledRemixCover(html: string): string | undefined {
  const match = html.replace(/\n/g, '').match(/window\.__remixContext\s*=\s*(\{.*)\s*;\s*<\/script>/);
  if (!match?.[1]) return undefined;
  try {
    const payload = JSON.parse(match[1].replace(/,\s*"errors":null\}\}$/, ''));
    return walkForCoverUrl(payload);
  } catch {
    return undefined;
  }
}

function parseOgImage(html: string): string | undefined {
  const match =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  const url = match?.[1]?.trim();
  return url?.startsWith('http') ? url : undefined;
}

function isUsableCoverUrl(url: string | undefined, blocklist: RegExp[]): boolean {
  const trimmed = url?.trim();
  if (!trimmed?.startsWith('http')) return false;
  if (isLastFmBrandingCoverUrl(trimmed)) return false;
  return !blocklist.some((re) => re.test(trimmed));
}

/** Kept for scrape-path blocklists — branding also gated by isLastFmBrandingCoverUrl. */
const LASTFM_PLACEHOLDER_RE = [
  /lastfm\.com\/images\/default/i,
  /2a96cbd8/i,
  /player_\d+\.png/i,
];

const DISCOGS_PLACEHOLDER_RE = [/spacer\.gif/i, /discogs\.com\/images\/spacer/i];

export function lastFmPathSegment(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('+');
}

export function lastFmAlbumPageUrl(artist: string, album: string): string {
  return `https://www.last.fm/music/${lastFmPathSegment(artist)}/${lastFmPathSegment(album)}`;
}

export function discogsSearchPageUrl(album: string, artist: string): string {
  const q = [artist, album].filter(Boolean).join(' ').trim();
  return `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=release`;
}

function parseLastFmAlbumCover(html: string): string | undefined {
  const og = parseOgImage(html);
  if (isUsableCoverUrl(og, LASTFM_PLACEHOLDER_RE)) return og;
  const coverArt = html.match(
    /<img[^>]+(?:data-src|src)=["'](https?:\/\/[^"']+lastfm[^"']+)["'][^>]*>/i,
  )?.[1];
  if (isUsableCoverUrl(coverArt, LASTFM_PLACEHOLDER_RE)) return coverArt;
  const searchCard = html.match(
    /<a[^>]+href=["']\/music\/[^"']+\/[^"']+["'][^>]*>[\s\S]{0,1600}?<\/a>/i,
  )?.[0];
  if (searchCard) {
    const inner = searchCard.match(/(?:data-src|src)=["'](https?:\/\/[^"']+)["']/i)?.[1];
    if (isUsableCoverUrl(inner, LASTFM_PLACEHOLDER_RE)) return inner;
  }
  return undefined;
}

function parseDiscogsSearchCover(html: string, album: string): string | undefined {
  const og = parseOgImage(html);
  if (isUsableCoverUrl(og, DISCOGS_PLACEHOLDER_RE) && /discogs|i\.discogs|img\.discogs/i.test(og ?? '')) {
    return og;
  }
  const titleNeedle = normalizeCoverTitle(album);
  const cardRe =
    /<a[^>]+href=["']\/release\/\d+[^"']*["'][^>]*>[\s\S]{0,2000}?<\/a>/gi;
  for (const block of html.match(cardRe) ?? []) {
    if (titleNeedle && !normalizeCoverTitle(block).includes(titleNeedle)) continue;
    const inner = block.match(
      /(?:data-src|src)=["'](https?:\/\/[^"']+(?:discogs|dzcdn)[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
    )?.[1];
    if (isUsableCoverUrl(inner, DISCOGS_PLACEHOLDER_RE)) return inner;
  }
  const anyImg = html.match(
    /(?:data-src|src)=["'](https?:\/\/(?:i|img)\.discogs\.com\/[^"']+)["']/i,
  )?.[1];
  if (isUsableCoverUrl(anyImg, DISCOGS_PLACEHOLDER_RE)) return anyImg;
  return undefined;
}

function parseDatPiffSearchCover(html: string, album: string): string | undefined {
  const og = parseOgImage(html);
  if (og && !/datpiff\.com\/images\/default/i.test(og)) return og;
  const imgMatch = html.match(
    /<img[^>]+(?:data-src|src)=["'](https?:\/\/[^"']+datpiff[^"']+\.(?:jpg|jpeg|png|webp)[^"']*)["']/i,
  );
  if (imgMatch?.[1]) return imgMatch[1];
  const titleNeedle = normalizeCoverTitle(album);
  const blockRe = /<a[^>]+href=["']\/[^"']+["'][^>]*>[\s\S]{0,1200}?<\/a>/gi;
  for (const block of html.match(blockRe) ?? []) {
    if (!normalizeCoverTitle(block).includes(titleNeedle)) continue;
    const inner = block.match(/src=["'](https?:\/\/[^"']+)["']/i);
    if (inner?.[1]) return inner[1];
  }
  return undefined;
}

export async function fromMusicBrainz(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const meta = await fetchAlbumMetadata(album, artist);
  if (meta.albumArt) {
    return { url: meta.albumArt, year: meta.releaseYear || undefined, source: 'musicbrainz' };
  }
  return null;
}

export async function fromCatalogProvider(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const cleanArtist = artist.trim();
  const term = [cleanArtist, album].filter(Boolean).join(' ').trim();
  if (!term) return null;
  const results = await fetchCatalogApiResults(
    catalogSearchUrl({ term, entity: 'album', limit: 12 }),
  );
  if (results.length === 0) return null;
  const match = pickCatalogCoverItem(results, album, cleanArtist);
  if (!match) return null;
  const art = match.artworkUrl100 ?? match.artworkUrl60;
  if (!art) return null;
  const url = art.replace(/\/\d+x\d+bb\.(jpg|png)/i, '/600x600bb.$1');
  return {
    url,
    year: match.releaseDate?.slice(0, 4),
    source: 'catalog',
  };
}

interface AudioDbAlbum {
  strAlbum?: string;
  strArtist?: string;
  strAlbumThumb?: string;
  intYearReleased?: string;
}

export async function fromAudioDb(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  if (!artist || PLACEHOLDER_ARTIST.test(artist)) return null;
  const res = await fetchWithTimeout(
    `https://www.theaudiodb.com/api/v1/json/2/searchalbum.php?s=${encodeURIComponent(
      artist,
    )}&a=${encodeURIComponent(album)}`,
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { album?: AudioDbAlbum[] | null };
  const albums = data.album ?? [];
  if (albums.length === 0) return null;
  const cleanArtist = artist.trim();
  const ranked = albums
    .filter((a) => a.strAlbum && coverTitlesMatch(a.strAlbum, album))
    .map((a) => ({
      album: a,
      score: cleanArtist
        ? coverArtistRelevanceScore(a.strArtist ?? artist, cleanArtist)
        : 400,
    }))
    .filter((row) => !cleanArtist || row.score >= COVER_ARTIST_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  const match = ranked[0]?.album;
  if (!match?.strAlbumThumb) return null;
  return {
    url: match.strAlbumThumb,
    year: match.intYearReleased || undefined,
    source: 'audiodb',
  };
}

async function fromLastFmApi(
  album: string,
  artist: string,
  apiKey: string,
): Promise<CoverLookupResult | null> {
  const url = new URL('https://ws.audioscrobbler.com/2.0/');
  url.searchParams.set('method', 'album.getinfo');
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('artist', artist);
  url.searchParams.set('album', album);
  url.searchParams.set('format', 'json');
  const res = await fetchWithTimeout(url.toString(), {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    album?: {
      name?: string;
      image?: Array<{ '#text'?: string; size?: string }>;
      wiki?: { published?: string };
    };
    error?: number;
  };
  if (data.error || !data.album) return null;
  const imageUrl = pickLargestLastFmImage(data.album.image);
  if (!isUsableCoverUrl(imageUrl, LASTFM_PLACEHOLDER_RE)) return null;
  const year = data.album.wiki?.published?.match(/\d{4}/)?.[0];
  return { url: imageUrl!, year, source: 'lastfm' };
}

async function fromLastFmPageScrape(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const albumHtml = await fetchCoverScrapeHtml(lastFmAlbumPageUrl(artist, album));
  const directCover = albumHtml ? parseLastFmAlbumCover(albumHtml) : undefined;
  if (directCover) return { url: directCover, source: 'lastfm' };

  const searchHtml = await fetchCoverScrapeHtml(
    `https://www.last.fm/search/albums?q=${encodeURIComponent([artist, album].join(' '))}`,
  );
  const searchCover = searchHtml ? parseLastFmAlbumCover(searchHtml) : undefined;
  if (!searchCover) return null;
  return { url: searchCover, source: 'lastfm' };
}

export async function fromLastFm(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  if (!artist || PLACEHOLDER_ARTIST.test(artist)) return null;

  const scraped = await fromLastFmPageScrape(album, artist);
  if (scraped) return scraped;

  const apiKey = loadScrobbleSettings().lastfmApiKey.trim();
  if (!apiKey) return null;
  return fromLastFmApi(album, artist, apiKey);
}

export async function fromDeezer(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const term = [artist, album].filter(Boolean).join(' ').trim();
  if (!term) return null;
  const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(term)}&limit=8`;
  const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    data?: Array<{
      title?: string;
      cover_xl?: string;
      cover_big?: string;
      cover_medium?: string;
      release_date?: string;
      artist?: { name?: string };
    }>;
  };
  const rows = data.data ?? [];
  if (!rows.length) return null;
  const cleanArtist = artist.trim();
  const ranked = rows
    .filter((row) => row.title && coverTitlesMatch(row.title, album))
    .map((row) => ({
      row,
      score: cleanArtist
        ? coverArtistRelevanceScore(row.artist?.name ?? '', cleanArtist)
        : 400,
    }))
    .filter((entry) => !cleanArtist || entry.score >= COVER_ARTIST_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  const match = ranked[0]?.row;
  const cover =
    match?.cover_xl?.trim() || match?.cover_big?.trim() || match?.cover_medium?.trim();
  if (!cover) return null;
  return {
    url: cover,
    year: match.release_date?.slice(0, 4),
    source: 'deezer',
  };
}

async function fromDiscogsApi(
  album: string,
  artist: string,
  token: string,
): Promise<CoverLookupResult | null> {
  const q = [artist, album].filter(Boolean).join(' ').trim();
  if (!q) return null;
  const url = new URL('https://api.discogs.com/database/search');
  url.searchParams.set('q', q);
  url.searchParams.set('type', 'release');
  url.searchParams.set('per_page', '8');
  url.searchParams.set('token', token);
  const res = await fetchWithTimeout(url.toString(), {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SovereignMusicConsole/1.0 +https://github.com/sovereign-music-console',
    },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: Array<{ title?: string; cover_image?: string; year?: string }>;
  };
  const rows = data.results ?? [];
  if (!rows.length) return null;
  const cleanArtist = artist.trim();
  const ranked = rows
    .filter((row) => row.title && coverTitlesMatch(row.title, album))
    .map((row) => ({
      row,
      score: cleanArtist
        ? coverArtistRelevanceScore(row.title?.split(' - ')[0] ?? '', cleanArtist)
        : 0,
    }))
    .filter((entry) => !cleanArtist || entry.score >= COVER_ARTIST_MATCH_MIN_SCORE)
    .sort((a, b) => b.score - a.score);
  const match = ranked[0]?.row;
  const cover = match?.cover_image?.trim();
  if (!isUsableCoverUrl(cover, DISCOGS_PLACEHOLDER_RE)) return null;
  return { url: cover!, year: match.year, source: 'discogs' };
}

async function fromDiscogsPageScrape(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const html = await fetchCoverScrapeHtml(discogsSearchPageUrl(album, artist));
  if (!html) return null;
  const url = parseDiscogsSearchCover(html, album);
  if (!url) return null;
  const year = html.match(/<time[^>]+datetime=["'](\d{4})/i)?.[1];
  return { url, year, source: 'discogs' };
}

export async function fromDiscogs(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const q = [artist, album].filter(Boolean).join(' ').trim();
  if (!q) return null;

  const scraped = await fromDiscogsPageScrape(album, artist);
  if (scraped) return scraped;

  const token = loadPlaybackEngineSettings().discogsApiToken.trim();
  if (!token) return null;
  return fromDiscogsApi(album, artist, token);
}

export async function fromYoutubeSearch(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const term = [artist, album, 'album'].filter(Boolean).join(' ').trim();
  if (term.length < 4) return null;
  const hits = await searchViaPipedMobile(term, 5);
  if (!hits.length) return null;
  const ranked = [...hits].sort((a, b) => {
    const score = (hit: (typeof hits)[number]) => {
      let s = 0;
      const blob = `${hit.title} ${hit.artist}`.toLowerCase();
      if (coverTitlesMatch(hit.title, album)) s += 4;
      if (artist && blob.includes(artist.toLowerCase().split(/\s+/)[0] ?? '')) s += 2;
      if (/official|album|mixtape/i.test(hit.title)) s += 1;
      return s;
    };
    return score(b) - score(a);
  });
  const best = ranked[0]!;
  const thumb =
    best.thumbnail?.trim() ||
    (best.id ? youtubeThumbUrl(best.id) : undefined);
  if (!thumb) return null;
  return { url: thumb, source: 'youtube' };
}

export async function fromDatPiff(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const q = [artist, album].filter(Boolean).join(' ').trim();
  if (q.length < 3) return null;
  const html = await fetchCoverScrapeHtml(
    `https://www.datpiff.com/browse/search?q=${encodeURIComponent(q)}`,
  );
  if (!html) return null;
  const url = parseDatPiffSearchCover(html, album);
  if (!url) return null;
  return { url, source: 'datpiff' };
}

export async function fromUntitledStream(
  album: string,
  artist: string,
): Promise<CoverLookupResult | null> {
  const directUrl = extractUntitledStreamUrl(album, artist);
  if (!directUrl) return null;
  const html = await fetchCoverScrapeHtml(directUrl);
  if (!html) return null;
  const cover = parseUntitledRemixCover(html) ?? parseOgImage(html);
  if (!cover) return null;
  return { url: cover, source: 'untitled' };
}

export async function fromMusicBrainzReleaseId(
  releaseId: string,
): Promise<CoverLookupResult | null> {
  const id = releaseId.trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const url = await fetchCoverByMusicBrainzReleaseId(id);
  if (!url?.trim()) return null;
  return { url: url.trim(), source: 'musicbrainz' };
}

export type CoverProviderFn = (
  album: string,
  artist: string,
) => Promise<CoverLookupResult | null>;

export function buildCoverProviderChain(): CoverProviderFn[] {
  return [
    fromMusicBrainz,
    fromDeezer,
    fromDiscogs,
    fromAudioDb,
    fromCatalogProvider,
    // Last.fm intentionally omitted — default tiles are branded logos (legal/UX risk).
    fromUntitledStream,
    fromDatPiff,
    fromYoutubeSearch,
  ];
}

export async function runCoverProviders(
  album: string,
  artist: string,
  providers: CoverProviderFn[] = buildCoverProviderChain(),
  options?: { musicbrainzReleaseId?: string },
): Promise<CoverLookupResult | null> {
  const releaseId = options?.musicbrainzReleaseId?.trim();
  if (releaseId) {
    try {
      const pinned = await raceTimeout(fromMusicBrainzReleaseId(releaseId), PROVIDER_TIMEOUT_MS);
      if (pinned?.url) return pinned;
    } catch {
      /* fall through to search providers */
    }
  }

  const cleanArtist =
    artist && !PLACEHOLDER_ARTIST.test(artist) && isUsableArtistName(artist)
      ? artist.trim()
      : '';

  const attempts: Array<{ album: string; artist: string }> = [];
  if (cleanArtist) attempts.push({ album, artist: cleanArtist });
  if (!cleanArtist) attempts.push({ album, artist: '' });

  for (const attempt of attempts) {
    for (const provider of providers) {
      try {
        const result = await raceTimeout(
          provider(attempt.album, attempt.artist),
          PROVIDER_TIMEOUT_MS,
        );
        if (!result?.url) continue;
        if (
          !attempt.artist.trim() &&
          DISAMBIGUATION_REQUIRED_SOURCES.has(result.source)
        ) {
          continue;
        }
        const safeUrl = sanitizeCoverArtUrl(result.url);
        if (!safeUrl) continue;
        return { ...result, url: safeUrl };
      } catch {
        /* next provider */
      }
    }
  }
  return null;
}
