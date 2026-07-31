/**
 * Last.fm similarity lookups for cross-genre radio expansion.
 *
 * Last.fm's `artist.getSimilar` / `track.getSimilar` are the strongest free, cross-genre
 * "sounds like" signal (metal, EDM, reggae, classical — not just what's in the locker).
 * Requires the user's own free Last.fm API key (Settings → Scrobbling). With no key, every
 * function no-ops to an empty result so callers degrade gracefully to locker/catalog-only.
 */

import { fetchWithTimeout, isJsonLikeContentType } from './fetchWithTimeout';
import { splitGenreTags, type ResolvedGenre } from './genreSpecificity';
import { loadScrobbleSettings } from './scrobbleSettings';

const LASTFM_ENDPOINT = 'https://ws.audioscrobbler.com/2.0/';
const LOOKUP_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export type SimilarArtist = { name: string; match: number };
export type SimilarTrack = { artist: string; title: string; match: number };

type CacheEntry<T> = { at: number; value: T };
const artistCache = new Map<string, CacheEntry<SimilarArtist[]>>();
const trackCache = new Map<string, CacheEntry<SimilarTrack[]>>();

/** App-level key baked in at build time (SANDBOX_LASTFM_API_KEY), or '' when not provided. */
function appLevelLastFmKey(): string {
  try {
    return typeof __LASTFM_APP_API_KEY__ === 'string' ? __LASTFM_APP_API_KEY__.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Resolve the Last.fm API key: the user's own key (Settings → Scrobbling) takes precedence,
 * otherwise the app-level key baked into the build. With an app-level key, every user gets
 * similar-artist radio with zero setup — no per-user registration required.
 */
function resolveLastFmKey(): string {
  const userKey = loadScrobbleSettings().lastfmApiKey.trim();
  return userKey || appLevelLastFmKey();
}

export function isLastFmSimilarAvailable(): boolean {
  return Boolean(resolveLastFmKey());
}

function readCache<T>(map: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const hit = map.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    map.delete(key);
    return undefined;
  }
  return hit.value;
}

async function lastFmGet(params: Record<string, string>): Promise<unknown | null> {
  const apiKey = resolveLastFmKey();
  if (!apiKey) return null;
  const url = new URL(LASTFM_ENDPOINT);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('format', 'json');
  url.searchParams.set('autocorrect', '1');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  try {
    const res = await fetchWithTimeout(
      url.toString(),
      { headers: { Accept: 'application/json' } },
      LOOKUP_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    if (!isJsonLikeContentType(res.headers.get('content-type') ?? '')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Last.fm community tags are crowd-sourced, so they mix real sub-genres with
 * personal-collection noise ("seen live", "albums i own", decades, nationalities).
 * Anything matching this is never treated as a genre.
 */
const TAG_BLOCKLIST_RE =
  /^(seen live|favou?rites?|favou?rite (songs?|albums?|artists?)|albums? i own|i own it|my .+|best of.*|awesome|cool|love|loved|good|great|amazing|epic|music|check out|to listen|tolisten|todo|wishlist|owned|vinyl|cd|mp3|spotify|itunes|radio|playlist|banger|bangers|classic|classics|masterpiece|perfect|beautiful|chill|favorite songs|male vocalists?|female vocalists?|american|british|usa|uk|english|canadian|australian|german|french|swedish|\d{2,4}s?|\d+)$/i;

function isUsableGenreTag(tag: string, artist: string, album: string): boolean {
  const trimmed = tag.trim();
  if (!trimmed || trimmed.length > 30) return false;
  if (!/[a-z]/i.test(trimmed)) return false;
  if (TAG_BLOCKLIST_RE.test(trimmed)) return false;
  const lower = trimmed.toLowerCase();
  if (lower === artist.trim().toLowerCase()) return false;
  if (album && lower === album.trim().toLowerCase()) return false;
  return true;
}

type LastFmTag = { name?: string; count?: string | number };

async function fetchTopTags(params: Record<string, string>): Promise<LastFmTag[]> {
  const data = (await lastFmGet(params)) as
    | { toptags?: { tag?: LastFmTag | LastFmTag[] } }
    | null;
  const tag = data?.toptags?.tag;
  if (!tag) return [];
  return Array.isArray(tag) ? tag : [tag];
}

function splitUsableTags(
  tags: LastFmTag[],
  artist: string,
  album: string,
  minCount: number,
): ResolvedGenre | null {
  const usable: string[] = [];
  for (const tag of tags) {
    const name = typeof tag.name === 'string' ? tag.name : '';
    const count = Number(tag.count ?? 0);
    if (Number.isFinite(count) && count < minCount) continue;
    if (isUsableGenreTag(name, artist, album)) usable.push(name.trim());
  }
  return splitGenreTags(usable);
}

/**
 * Umbrella genre + specific sub-genre for a release from Last.fm tags — album
 * tags first (most specific), then the artist's. Returns null when Last.fm has
 * no key configured or only noise tags.
 */
export async function getLastFmGenre(
  artist: string,
  album?: string,
  options: { minCount?: number } = {},
): Promise<ResolvedGenre | null> {
  const name = artist.trim();
  if (!name || !isLastFmSimilarAvailable()) return null;
  const { minCount = 10 } = options;
  const albumName = album?.trim() ?? '';

  if (albumName) {
    const albumTags = await fetchTopTags({
      method: 'album.gettoptags',
      artist: name,
      album: albumName,
    });
    const fromAlbum = splitUsableTags(albumTags, name, albumName, minCount);
    if (fromAlbum) return fromAlbum;
  }

  const artistTags = await fetchTopTags({ method: 'artist.gettoptags', artist: name });
  return splitUsableTags(artistTags, name, albumName, minCount);
}

/** Artists Last.fm listeners consider similar — cross-genre "fans also like". */
export async function getLastFmSimilarArtists(
  artist: string,
  limit = 20,
): Promise<SimilarArtist[]> {
  const name = artist.trim();
  if (!name) return [];
  const cacheKey = name.toLowerCase();
  const cached = readCache(artistCache, cacheKey);
  if (cached) return cached.slice(0, limit);

  const data = (await lastFmGet({
    method: 'artist.getsimilar',
    artist: name,
    limit: String(Math.max(limit, 20)),
  })) as { similarartists?: { artist?: Array<{ name?: string; match?: string }> } } | null;

  const raw = data?.similarartists?.artist ?? [];
  const out: SimilarArtist[] = [];
  for (const row of raw) {
    const n = row.name?.trim();
    if (!n) continue;
    out.push({ name: n, match: Number(row.match) || 0 });
  }
  artistCache.set(cacheKey, { at: Date.now(), value: out });
  return out.slice(0, limit);
}

/** Tracks Last.fm listeners consider similar to a given track. */
export async function getLastFmSimilarTracks(
  artist: string,
  title: string,
  limit = 25,
): Promise<SimilarTrack[]> {
  const a = artist.trim();
  const t = title.trim();
  if (!a || !t) return [];
  const cacheKey = `${a.toLowerCase()}${t.toLowerCase()}`;
  const cached = readCache(trackCache, cacheKey);
  if (cached) return cached.slice(0, limit);

  const data = (await lastFmGet({
    method: 'track.getsimilar',
    artist: a,
    track: t,
    limit: String(Math.max(limit, 25)),
  })) as {
    similartracks?: {
      track?: Array<{ name?: string; match?: string; artist?: { name?: string } }>;
    };
  } | null;

  const raw = data?.similartracks?.track ?? [];
  const out: SimilarTrack[] = [];
  for (const row of raw) {
    const rt = row.name?.trim();
    const ra = row.artist?.name?.trim();
    if (!rt || !ra) continue;
    out.push({ artist: ra, title: rt, match: Number(row.match) || 0 });
  }
  trackCache.set(cacheKey, { at: Date.now(), value: out });
  return out.slice(0, limit);
}

/** Test-only cache reset. */
export function clearLastFmSimilarCacheForTests(): void {
  artistCache.clear();
  trackCache.clear();
  deezerRelatedCache.clear();
}

// ---------------------------------------------------------------------------
// Deezer related-artists — a KEYLESS similar-artist source. No API key, no
// account, no per-user setup. Used as the default so cross-genre radio works
// out of the box; Last.fm (above) is an optional richer upgrade when a key exists.
// ---------------------------------------------------------------------------

const deezerRelatedCache = new Map<string, CacheEntry<SimilarArtist[]>>();

type DeezerArtistRef = { id?: number; name?: string; nb_fan?: number };

async function deezerJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json' } },
      LOOKUP_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    if (!isJsonLikeContentType(res.headers.get('content-type') ?? '')) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Artists Deezer considers related — free, no-auth, no key. On native, CapacitorHttp
 * bypasses CORS; on web dev it may be blocked, which is fine (callers degrade gracefully).
 */
export async function getDeezerRelatedArtists(
  artist: string,
  limit = 20,
): Promise<SimilarArtist[]> {
  const name = artist.trim();
  if (!name) return [];
  const cacheKey = name.toLowerCase();
  const cached = readCache(deezerRelatedCache, cacheKey);
  if (cached) return cached.slice(0, limit);

  const search = (await deezerJson(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=1`,
  )) as { data?: DeezerArtistRef[] } | null;
  const id = search?.data?.[0]?.id;
  if (!id) {
    deezerRelatedCache.set(cacheKey, { at: Date.now(), value: [] });
    return [];
  }

  const related = (await deezerJson(
    `https://api.deezer.com/artist/${id}/related?limit=${Math.max(limit, 20)}`,
  )) as { data?: DeezerArtistRef[] } | null;
  const raw = related?.data ?? [];
  const out: SimilarArtist[] = [];
  for (const row of raw) {
    const n = row.name?.trim();
    if (!n || n.toLowerCase() === name.toLowerCase()) continue;
    // No per-pair match score from Deezer — approximate ranking by popularity.
    out.push({ name: n, match: Math.min(1, (row.nb_fan ?? 0) / 5_000_000) });
  }
  deezerRelatedCache.set(cacheKey, { at: Date.now(), value: out });
  return out.slice(0, limit);
}

/**
 * Best available similar-artist source: Last.fm when a key is configured (richer), otherwise
 * Deezer related (keyless). Always returns something usable with zero user setup.
 */
export async function getSimilarArtistsBest(
  artist: string,
  limit = 20,
): Promise<SimilarArtist[]> {
  if (isLastFmSimilarAvailable()) {
    const viaLastFm = await getLastFmSimilarArtists(artist, limit);
    if (viaLastFm.length > 0) return viaLastFm;
  }
  return getDeezerRelatedArtists(artist, limit);
}
