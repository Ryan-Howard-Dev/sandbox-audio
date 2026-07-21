/**
 * Artist photo lookup via TheAudioDB (CORS-enabled, free public dev key).
 * iTunes artist entities never include artwork, so catalog search needs an
 * external source for profile photos.
 */

import { preferDirectCatalog } from './catalogDirect';
import { isCatalogCdnUrl, resolveAppProxyUrl, sanitizeCoverArtUrl } from './displaySanitize';
import { fetchWithTimeout, isJsonLikeContentType, raceTimeout } from './fetchWithTimeout';
import type { LockerEntry } from './lockerStorage';
import { isPersistentAlbumArt } from './lockerStorage';

const LOOKUP_TIMEOUT_MS = 10_000;
const CACHE_STORAGE_KEY = 'sandbox_artist_image_cache';
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;

interface ArtistImageCacheEntry {
  /** Resolved URL, or null when TheAudioDB has no match (negative cache). */
  url: string | null;
  at: number;
}

const memoryCache = new Map<string, ArtistImageCacheEntry>();
const inflightLookups = new Map<string, Promise<string | undefined>>();
let storageLoaded = false;

export interface ArtistProfile {
  imageUrl?: string;
  wideImageUrl?: string;
  bio?: string;
}

interface AudioDbArtist {
  strArtist?: string;
  strArtistThumb?: string;
  strArtistWideThumb?: string;
  strArtistFanart?: string;
  strArtistFanart2?: string;
  strArtistBanner?: string;
  strBiographyEN?: string;
  strBiography?: string;
  strGenre?: string;
  strStyle?: string;
  strMood?: string;
}

function normalize(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[ÿý]/g, 'y')
    .trim()
    .replace(/\s+/g, ' ');
}

function cacheKey(artistName: string): string {
  return normalize(artistName.trim());
}

function entryTtlMs(entry: ArtistImageCacheEntry): number {
  return entry.url ? HIT_TTL_MS : MISS_TTL_MS;
}

function isEntryFresh(entry: ArtistImageCacheEntry, now = Date.now()): boolean {
  return now - entry.at < entryTtlMs(entry);
}

function loadStorageCache(): void {
  if (storageLoaded) return;
  storageLoaded = true;
  try {
    const raw = localStorage.getItem(CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, ArtistImageCacheEntry>;
    const now = Date.now();
    for (const [key, entry] of Object.entries(parsed)) {
      if (
        entry &&
        typeof entry.at === 'number' &&
        (entry.url === null || typeof entry.url === 'string') &&
        isEntryFresh(entry, now) &&
        !(entry.url && (isAlbumArtFallback(entry.url) || !sanitizeCoverArtUrl(entry.url)))
      ) {
        memoryCache.set(key, entry);
      }
    }
  } catch {
    /* ignore corrupt cache */
  }
}

function persistStorageCache(): void {
  try {
    const now = Date.now();
    const payload: Record<string, ArtistImageCacheEntry> = {};
    for (const [key, entry] of memoryCache) {
      if (isEntryFresh(entry, now)) payload[key] = entry;
    }
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}

/** iTunes album covers are not artist portraits — never treat them as cached photos. */
function isAlbumArtFallback(url: string | undefined): boolean {
  return !!url && isCatalogCdnUrl(url);
}

function readCache(key: string): ArtistImageCacheEntry | undefined {
  loadStorageCache();
  const entry = memoryCache.get(key);
  if (!entry) return undefined;
  if (!isEntryFresh(entry)) {
    memoryCache.delete(key);
    return undefined;
  }
  if (entry.url && isAlbumArtFallback(entry.url)) {
    memoryCache.delete(key);
    persistStorageCache();
    return undefined;
  }
  return entry;
}

function writeCache(key: string, url: string | null): void {
  loadStorageCache();
  const safe = url ? sanitizeCoverArtUrl(url) ?? null : null;
  memoryCache.set(key, { url: safe, at: Date.now() });
  persistStorageCache();
}

/** Drop a cached artist photo so the next lookup can disambiguate (e.g. wrong Malice). */
export function invalidateArtistImageCache(artistName: string): void {
  const key = cacheKey(artistName);
  if (!key) return;
  loadStorageCache();
  memoryCache.delete(key);
  for (const alias of artistLookupCandidates(artistName)) {
    memoryCache.delete(cacheKey(alias));
  }
  persistStorageCache();
}

/** Purge Last.fm tiles from the artist image cache (metadata only). */
export function clearLastFmArtistImageCache(): number {
  loadStorageCache();
  let cleared = 0;
  for (const [key, entry] of memoryCache) {
    if (entry.url && !sanitizeCoverArtUrl(entry.url)) {
      memoryCache.delete(key);
      cleared += 1;
    }
  }
  if (cleared > 0) persistStorageCache();
  return cleared;
}

/** Sync read: URL, null (known miss), or undefined (not cached / expired). */
export function getCachedArtistImage(artistName: string): string | null | undefined {
  const key = cacheKey(artistName);
  if (!key) return undefined;
  const entry = readCache(key);
  if (!entry) return undefined;
  return entry.url;
}

/** Apply cached artist photos in place (instant, no network). */
export function applyCachedArtistImages<T extends { name: string; artworkUrl?: string }>(
  artists: T[],
): void {
  for (const artist of artists) {
    const cached = getCachedArtistImage(artist.name);
    if (cached) artist.artworkUrl = sanitizeCoverArtUrl(cached) ?? undefined;
  }
}

/** True when TheAudioDB lookup may still improve or replace missing / album-art fallback photos. */
export function artistNeedsPhotoLookup(artist: { name: string; artworkUrl?: string }): boolean {
  if (artist.artworkUrl && !isAlbumArtFallback(artist.artworkUrl)) return false;
  return getCachedArtistImage(artist.name) === undefined;
}

/** Best locker album art for an artist name (primary/guest tracks). */
export function pickLockerArtistCoverArt(
  artistName: string,
  entries: LockerEntry[],
): string | undefined {
  const primaryKey = (name: string) => {
    const segment = name.split(/\s*(?:&|feat\.?|ft\.?|featuring|with)\s*/i)[0] ?? name;
    return normalize(segment);
  };

  let best: { url: string; score: number } | undefined;
  for (const entry of entries) {
    const art = entry.albumArt?.trim();
    if (!art) continue;
    const score = Math.max(
      artistMatchScore(entry.artist, artistName),
      artistMatchScore(entry.albumArtist ?? '', artistName),
      artistMatchScore(entry.artist, primaryKey(artistName)),
      artistMatchScore(entry.albumArtist ?? '', primaryKey(artistName)),
    );
    if (score < 300) continue;
    const persistentBonus = isPersistentAlbumArt(art) ? 50 : 0;
    const ranked = score + persistentBonus;
    if (!best || ranked > best.score) best = { url: art, score: ranked };
  }
  return sanitizeCoverArtUrl(best?.url);
}

/** Best-effort album/track art for artist rows until profile photos resolve. */
export function attachFallbackArtistArtwork<
  TArtist extends { name: string; artworkUrl?: string },
  TAlbum extends { artist: string; artworkUrl?: string },
  TTrack extends { artist: string; artworkUrl?: string },
>(artists: TArtist[], albums: TAlbum[], tracks: TTrack[]): void {
  const primaryKey = (name: string) => {
    const segment = name.split(/\s*(?:&|feat\.?|ft\.?|featuring|with)\s*/i)[0] ?? name;
    return normalize(segment);
  };

  const pickAlbumArt = (artistName: string): string | undefined => {
    let best: { url: string; score: number } | undefined;
    for (const album of albums) {
      if (!album.artworkUrl) continue;
      const score = Math.max(
        artistMatchScore(album.artist, artistName),
        artistMatchScore(album.artist, primaryKey(artistName)),
      );
      if (score < 300) continue;
      if (!best || score > best.score) best = { url: album.artworkUrl, score };
    }
    return best?.url;
  };

  const pickTrackArt = (artistName: string): string | undefined => {
    let best: { url: string; score: number } | undefined;
    for (const track of tracks) {
      if (!track.artworkUrl) continue;
      const score = Math.max(
        artistMatchScore(track.artist, artistName),
        artistMatchScore(track.artist, primaryKey(artistName)),
      );
      if (score < 300) continue;
      if (!best || score > best.score) best = { url: track.artworkUrl, score };
    }
    return best?.url;
  };

  for (const artist of artists) {
    if (artist.artworkUrl && !isAlbumArtFallback(artist.artworkUrl)) {
      const safe = sanitizeCoverArtUrl(artist.artworkUrl);
      if (safe) {
        artist.artworkUrl = safe;
        continue;
      }
      artist.artworkUrl = undefined;
    }
    const albumArt = sanitizeCoverArtUrl(pickAlbumArt(artist.name));
    if (albumArt) {
      artist.artworkUrl = albumArt;
      continue;
    }
    const trackArt = sanitizeCoverArtUrl(pickTrackArt(artist.name));
    if (trackArt) artist.artworkUrl = trackArt;
  }
}

/** Copy album artwork onto tracks that are missing cover art. */
export function attachFallbackTrackArtwork<
  TTrack extends { artist: string; album?: string; artworkUrl?: string },
  TAlbum extends { artist: string; title: string; artworkUrl?: string },
>(tracks: TTrack[], albums: TAlbum[]): void {
  if (albums.length === 0) return;
  for (const track of tracks) {
    if (track.artworkUrl?.trim()) continue;
    const albumName = track.album?.trim();
    if (!albumName) continue;
    let best: { url: string; score: number } | undefined;
    for (const album of albums) {
      const art = album.artworkUrl?.trim();
      if (!art) continue;
      const na = normalize(album.title);
      const nb = normalize(albumName);
      const titleScore =
        na === nb || na.includes(nb) || nb.includes(na) ? 1000 : 0;
      const artistScore = artistMatchScore(album.artist, track.artist);
      const score = titleScore + artistScore;
      if (score < 800) continue;
      if (!best || score > best.score) best = { url: art, score };
    }
    if (best) track.artworkUrl = best.url;
  }
}

/** Resolve artwork for an artist row (profile photo, album/track fallback, or undefined). */
export function resolveArtistRowArtwork<
  TArtist extends { name: string; artworkUrl?: string },
  TAlbum extends { artist: string; artworkUrl?: string },
  TTrack extends { artist: string; artworkUrl?: string },
>(
  artist: TArtist,
  albums: TAlbum[],
  tracks: TTrack[],
): string | undefined {
  if (artist.artworkUrl) return artist.artworkUrl;
  const scratch = { ...artist };
  attachFallbackArtistArtwork([scratch], albums, tracks);
  return scratch.artworkUrl;
}

function artistMatchScore(candidate: string, target: string): number {
  const n = normalize(candidate);
  const q = normalize(target);
  if (!q) return 0;
  if (n === q) return 1000;
  if (n.startsWith(q)) return 900;
  const qWords = q.split(' ').filter(Boolean);
  if (qWords.length > 1 && qWords.every((w) => n.includes(w))) {
    return n.startsWith(qWords[0]) ? 700 : 500;
  }
  if (n.includes(q)) return 300;
  if (qWords.some((w) => n.includes(w))) return 100;
  return 0;
}

function audioDbHipHopScore(artist: AudioDbArtist): number {
  const hay = [
    artist.strGenre,
    artist.strStyle,
    artist.strMood,
    artist.strBiographyEN,
    artist.strBiography,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!hay) return 0;
  let score = 0;
  if (/\b(hip[\s-]?hop|rap|trap|gangsta rap|southern hip hop)\b/.test(hay)) score += 400;
  if (/\b(clipse|pusha|no malice|virginia)\b/.test(hay)) score += 500;
  if (/\b(metal|thrash|heavy metal|hard rock|glam metal|speed metal)\b/.test(hay)) score -= 800;
  return score;
}

/** Prefer hip-hop Malice / No Malice over unrelated rock/metal bands. */
function prefersHipHopDisambiguation(name: string): boolean {
  const key = normalize(name);
  return key === 'malice' || key === 'no malice' || key.includes('malice');
}

function pickBestArtist(candidates: AudioDbArtist[], name: string): AudioDbArtist | undefined {
  const ranked = [...candidates].sort((a, b) => {
    const nameScore =
      artistMatchScore(b.strArtist ?? '', name) - artistMatchScore(a.strArtist ?? '', name);
    if (prefersHipHopDisambiguation(name)) {
      const genreDelta = audioDbHipHopScore(b) - audioDbHipHopScore(a);
      if (genreDelta !== 0) return genreDelta;
    }
    return nameScore;
  });
  for (const candidate of ranked) {
    const nameOk = artistMatchScore(candidate.strArtist ?? '', name) >= 300;
    const hipHopOk =
      !prefersHipHopDisambiguation(name) || audioDbHipHopScore(candidate) >= 0;
    if (pickThumb(candidate) && nameOk && hipHopOk) {
      return candidate;
    }
  }
  // For Malice, never fall back to a metal-scoring match.
  if (prefersHipHopDisambiguation(name)) {
    return ranked.find((c) => pickThumb(c) && audioDbHipHopScore(c) > 0);
  }
  return ranked[0];
}

function normalizeAudioDbUrl(url: string | undefined): string | undefined {
  return sanitizeCoverArtUrl(url?.trim()?.replace(/^http:\/\//i, 'https://'));
}

function pickArtistBio(artist: AudioDbArtist): string | undefined {
  const bio = (artist.strBiographyEN ?? artist.strBiography ?? '').trim();
  return bio.length > 20 ? bio : undefined;
}

function pickPortraitUrl(artist: AudioDbArtist): string | undefined {
  return normalizeAudioDbUrl(artist.strArtistThumb);
}

/** Wide banner for artist hero — fanart when AudioDB has no wide thumb. */
function pickBannerUrl(artist: AudioDbArtist): string | undefined {
  return normalizeAudioDbUrl(
    artist.strArtistWideThumb ||
      artist.strArtistFanart ||
      artist.strArtistFanart2 ||
      artist.strArtistBanner ||
      artist.strArtistThumb,
  );
}

function pickThumb(artist: AudioDbArtist): string | undefined {
  return pickPortraitUrl(artist) ?? pickBannerUrl(artist);
}

/** Names to try when iTunes lists collaborations or legal-name variants. */
export function artistLookupCandidates(artistName: string): string[] {
  const trimmed = artistName.trim();
  if (!trimmed) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  const push = (value: string) => {
    const candidate = value.trim();
    if (candidate.length < 2) return;
    const key = normalize(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  push(trimmed);

  const aliasKey = normalize(trimmed);
  const ARTIST_LOOKUP_ALIASES: Record<string, string[]> = {
    'westside gunn': ['WestsideGunn', 'Westside Gunn & Conway'],
    'conway the machine': ['Conway', 'Conway the Machine'],
    'boldy james': ['Boldy James'],
    // Clipse / Pusha T's brother — avoid metal/rock band "Malice" matches.
    malice: ['No Malice', 'Malice Clipse', 'Gene Elliott Thornton Jr'],
    'no malice': ['No Malice', 'Malice'],
    mereba: ['Mereba'],
    'parimal shais': ['Parimal Shais', 'Parimal'],
    esdeekid: ['EsDeeKid', 'Esdee Kid', 'ESDEEKID'],
    'esdee kid': ['EsDeeKid', 'Esdeekid'],
  };
  for (const alias of ARTIST_LOOKUP_ALIASES[aliasKey] ?? []) {
    push(alias);
  }

  for (const part of trimmed.split(/\s+(?:&|and|feat\.?|ft\.?|featuring|with|x|vs\.?)\s+/i)) {
    push(part);
  }

  const words = trimmed.split(/\s+/).filter(Boolean);
  const hasCollaboration = /\s(?:&|and|feat\.?|ft\.?|featuring|with|x|vs\.?)\s/i.test(trimmed);
  if (words.length >= 3 && !hasCollaboration) {
    push(`${words[0]} ${words[words.length - 1]}`);
  }

  return out;
}

async function searchAudioDbArtists(artistName: string): Promise<AudioDbArtist[]> {
  const name = artistName.trim();
  if (!name) return [];

  const directUrl = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(name)}`;
  const proxyUrl = resolveAppProxyUrl(
    `/api/artist-image?name=${encodeURIComponent(name)}`,
  );

  let res = preferDirectCatalog()
    ? await fetchWithTimeout(directUrl)
    : await fetchWithTimeout(proxyUrl);
  if (!preferDirectCatalog()) {
    const contentType = res.headers.get('content-type') ?? '';
    if (!res.ok || !isJsonLikeContentType(contentType)) {
      res = await fetchWithTimeout(directUrl);
    }
  }
  if (!res.ok) return [];

  const data = (await res.json()) as { artists?: AudioDbArtist[] | null };
  const candidates = data.artists ?? [];
  if (candidates.length === 0) return [];

  candidates.sort(
    (a, b) =>
      artistMatchScore(b.strArtist ?? '', name) - artistMatchScore(a.strArtist ?? '', name),
  );
  return candidates;
}

async function fromAudioDb(artistName: string): Promise<string | undefined> {
  const candidates = await searchAudioDbArtists(artistName);
  if (candidates.length === 0) return undefined;
  return pickThumb(pickBestArtist(candidates, artistName) ?? candidates[0]);
}

/**
 * Resolve artist photo + biography from TheAudioDB.
 */
export async function fetchArtistProfile(artistName: string): Promise<ArtistProfile> {
  const name = artistName.trim();
  if (!name) return {};
  try {
    for (const candidate of artistLookupCandidates(name)) {
      const results = await raceTimeout(searchAudioDbArtists(candidate), LOOKUP_TIMEOUT_MS);
      if (!results?.length) continue;
      const match = pickBestArtist(results, name) ?? results[0];
      const bio = pickArtistBio(match);
      const thumb = pickPortraitUrl(match);
      const wide = pickBannerUrl(match);
      if (bio || thumb || wide) {
        return {
          imageUrl: thumb || wide || undefined,
          wideImageUrl: wide || thumb || undefined,
          bio,
        };
      }
    }
    return {};
  } catch {
    return {};
  }
}

async function lookupArtistImageUncached(artistName: string): Promise<string | undefined> {
  const name = artistName.trim();
  if (!name) return undefined;
  try {
    for (const candidate of artistLookupCandidates(name)) {
      const url =
        (await raceTimeout(fromAudioDb(candidate), LOOKUP_TIMEOUT_MS)) ?? undefined;
      if (url) return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve an artist profile photo URL. Returns `undefined` when no match.
 */
export async function findArtistImage(artistName: string): Promise<string | undefined> {
  const name = artistName.trim();
  if (!name) return undefined;

  const key = cacheKey(name);
  // Force re-lookup for historically wrong Malice/metal matches once per session.
  if (prefersHipHopDisambiguation(name) && !sessionStorage.getItem(`artist-img-recheck:${key}`)) {
    try {
      sessionStorage.setItem(`artist-img-recheck:${key}`, '1');
      invalidateArtistImageCache(name);
    } catch {
      invalidateArtistImageCache(name);
    }
  }

  const cached = readCache(key);
  if (cached !== undefined) {
    return cached.url ?? undefined;
  }

  let pending = inflightLookups.get(key);
  if (!pending) {
    pending = lookupArtistImageUncached(name).then((url) => {
      writeCache(key, url ?? null);
      inflightLookups.delete(key);
      return url;
    });
    inflightLookups.set(key, pending);
  }
  return pending;
}

/**
 * Fill artist photos in place (best-effort, parallel).
 * TheAudioDB photos replace album-art fallbacks when available.
 */
export async function resolveArtistImages<T extends { name: string; artworkUrl?: string }>(
  artists: T[],
): Promise<void> {
  applyCachedArtistImages(artists);

  const toFetch = artists.filter((artist) => {
    const key = cacheKey(artist.name);
    if (!key || readCache(key) !== undefined) return false;
    return !artist.artworkUrl || isAlbumArtFallback(artist.artworkUrl);
  });
  if (toFetch.length === 0) {
    propagateArtistImagesInBatch(artists);
    return;
  }

  await Promise.all(
    toFetch.map(async (artist) => {
      const url = await findArtistImage(artist.name);
      if (url) artist.artworkUrl = url;
    }),
  );

  propagateArtistImagesInBatch(artists);
}

function propagateArtistImagesInBatch<T extends { name: string; artworkUrl?: string }>(
  artists: T[],
): void {
  for (const artist of artists) {
    if (artist.artworkUrl) continue;
    for (const candidate of artistLookupCandidates(artist.name)) {
      const cached = getCachedArtistImage(candidate);
      if (cached) {
        artist.artworkUrl = cached;
        break;
      }
      const peer = artists.find(
        (other) =>
          other !== artist &&
          other.artworkUrl &&
          !isAlbumArtFallback(other.artworkUrl) &&
          normalize(other.name) === normalize(candidate),
      );
      if (peer?.artworkUrl) {
        artist.artworkUrl = peer.artworkUrl;
        break;
      }
    }
  }
}
