/**
 * Curated Explore picks — decades, genres, and moods via chart filtering
 * and era-appropriate seed tracks (not literal iTunes text search).
 */

import { isAirGapEnabled } from './airGapMode';
import type { MediaEnvelope } from './sandboxLayer1';
import { catalogLookupUrl, catalogSearchUrl } from './catalogApi';
import { catalogArtworkUrl, catalogPlayUrlFromPreview } from './catalogDirect';
import { fetchCatalogApiResults, fetchCatalogChartsPayload } from './catalogFetch';
import { parseReleaseYear } from './searchSettings';
import {
  CACHE_KEYS,
  EXPLORE_QUICK_FRESH_TTL_MS,
  prefixedCacheKey,
  readResponseCache,
  writeResponseCache,
} from './responseCache';
import { newMusicExploreCachePart, newMusicSearchLabel, isNewMusicQuery } from './newMusicQuery';
import {
  getPersonalizedExploreGenreLabels,
  personalizedGenreCacheFingerprint,
} from './personalizedGenres';
import { getSessionVector, type SessionVector } from './sessionTaste';
import { scoreCandidateForSession } from './tasteScoring';
import { getTasteProfile } from './tasteProfile';

const EMPTY_SESSION_VECTOR: SessionVector = {
  sessionId: 'none',
  artists: {},
  genres: {},
  avgEnergy: 0.5,
  trackIds: [],
  updatedAt: 0,
};

export type ExploreGroup = 'genre' | 'mood' | 'decade' | 'quick';

export interface ExplorePick {
  group: ExploreGroup;
  label: string;
}

interface CatalogProviderItem {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  previewUrl?: string;
  trackTimeMillis?: number;
  releaseDate?: string;
  artworkUrl100?: string;
}

interface ChartRssGenre {
  genreId?: string;
  name?: string;
}

interface ChartRssSong {
  id?: string;
  name?: string;
  artistName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  contentAdvisoryRating?: string;
  genres?: ChartRssGenre[];
}

interface ExploreSpec {
  displayQuery: string;
  genreIds?: string[];
  yearMin?: number;
  yearMax?: number;
  useCharts?: boolean;
  searchTerms?: string[];
  seeds?: Array<{ title: string; artist: string }>;
}

const GENRE_ITUNES_IDS: Record<string, string> = {
  'Hip-Hop': '18',
  Pop: '14',
  'R&B / Soul': '15',
  'Rock / Indie': '21',
  Metal: '1153',
  Alternative: '20',
  'Dance & Electronic': '17',
  Latin: '12',
  Country: '6',
  Jazz: '11',
  Blues: '2',
  Classical: '5',
  Folk: '10',
  'Reggae / Dancehall': '24',
  Gospel: '22',
  Soundtrack: '16',
};

/** Genres without a dedicated iTunes chart id — seeded via search terms. */
const GENRE_SEARCH_SPECS: Record<string, { searchTerms: string[] }> = {
  'K-Pop': { searchTerms: ['k-pop hits', 'korean pop new'] },
  Afrobeats: { searchTerms: ['afrobeats', 'amapiano hits'] },
};

const DECADE_RANGES: Record<string, { yearMin: number; yearMax: number }> = {
  '1950s': { yearMin: 1950, yearMax: 1959 },
  '1960s': { yearMin: 1960, yearMax: 1969 },
  '1970s': { yearMin: 1970, yearMax: 1979 },
  '1980s': { yearMin: 1980, yearMax: 1989 },
  '1990s': { yearMin: 1990, yearMax: 1999 },
  '2000s': { yearMin: 2000, yearMax: 2009 },
  '2010s': { yearMin: 2010, yearMax: 2019 },
  '2020s': { yearMin: 2020, yearMax: 2029 },
};

const DECADE_SEEDS: Record<string, Array<{ title: string; artist: string }>> = {
  '2020s': [
    { title: 'Montero', artist: 'Lil Nas X' },
    { title: 'Levitating', artist: 'Dua Lipa' },
    { title: 'drivers license', artist: 'Olivia Rodrigo' },
    { title: 'As It Was', artist: 'Harry Styles' },
    { title: 'Anti-Hero', artist: 'Taylor Swift' },
    { title: 'Flowers', artist: 'Miley Cyrus' },
    { title: 'good 4 u', artist: 'Olivia Rodrigo' },
    { title: 'Heat Waves', artist: 'Glass Animals' },
    { title: 'Stay', artist: 'The Kid LAROI' },
    { title: 'Peaches', artist: 'Justin Bieber' },
  ],
  '2010s': [
    { title: 'Uptown Funk', artist: 'Mark Ronson' },
    { title: 'Shape of You', artist: 'Ed Sheeran' },
    { title: 'Rolling in the Deep', artist: 'Adele' },
    { title: 'Call Me Maybe', artist: 'Carly Rae Jepsen' },
    { title: 'Happy', artist: 'Pharrell Williams' },
    { title: 'Radioactive', artist: 'Imagine Dragons' },
    { title: 'Royals', artist: 'Lorde' },
    { title: 'Thinking Out Loud', artist: 'Ed Sheeran' },
    { title: 'Bad Guy', artist: 'Billie Eilish' },
    { title: 'Old Town Road', artist: 'Lil Nas X' },
  ],
  '2000s': [
    { title: 'Crazy in Love', artist: 'Beyoncé' },
    { title: 'Yeah!', artist: 'Usher' },
    { title: 'In the End', artist: 'Linkin Park' },
    { title: 'Hey Ya!', artist: 'OutKast' },
    { title: 'Toxic', artist: 'Britney Spears' },
    { title: 'Irreplaceable', artist: 'Beyoncé' },
    { title: 'Beautiful', artist: 'Christina Aguilera' },
    { title: 'Complicated', artist: 'Avril Lavigne' },
    { title: 'Fallin', artist: 'Alicia Keys' },
    { title: 'Lose Yourself', artist: 'Eminem' },
  ],
  '1990s': [
    { title: 'Smells Like Teen Spirit', artist: 'Nirvana' },
    { title: '...Baby One More Time', artist: 'Britney Spears' },
    { title: 'Waterfalls', artist: 'TLC' },
    { title: 'I Will Always Love You', artist: 'Whitney Houston' },
    { title: 'Wonderwall', artist: 'Oasis' },
    { title: 'No Scrubs', artist: 'TLC' },
    { title: 'Losing My Religion', artist: 'R.E.M.' },
    { title: 'I Want It That Way', artist: 'Backstreet Boys' },
    { title: 'Gangsta\'s Paradise', artist: 'Coolio' },
    { title: 'Killing Me Softly', artist: 'Fugees' },
  ],
  '1980s': [
    { title: 'Billie Jean', artist: 'Michael Jackson' },
    { title: 'Like a Virgin', artist: 'Madonna' },
    { title: 'Sweet Dreams (Are Made of This)', artist: 'Eurythmics' },
    { title: 'Don\'t Stop Believin\'', artist: 'Journey' },
    { title: 'Every Breath You Take', artist: 'The Police' },
    { title: 'Wake Me Up Before You Go-Go', artist: 'Wham!' },
    { title: 'Take on Me', artist: 'a-ha' },
    { title: 'Girls Just Want to Have Fun', artist: 'Cyndi Lauper' },
    { title: 'I Wanna Dance with Somebody', artist: 'Whitney Houston' },
    { title: 'Livin\' on a Prayer', artist: 'Bon Jovi' },
  ],
  '1970s': [
    { title: 'Stayin\' Alive', artist: 'Bee Gees' },
    { title: 'Bohemian Rhapsody', artist: 'Queen' },
    { title: 'Imagine', artist: 'John Lennon' },
    { title: 'Superstition', artist: 'Stevie Wonder' },
    { title: 'Dancing Queen', artist: 'ABBA' },
    { title: 'Hotel California', artist: 'Eagles' },
    { title: 'Dream On', artist: 'Aerosmith' },
    { title: 'Le Freak', artist: 'Chic' },
    { title: 'September', artist: 'Earth, Wind & Fire' },
    { title: 'Go Your Own Way', artist: 'Fleetwood Mac' },
  ],
  '1960s': [
    { title: 'I Want to Hold Your Hand', artist: 'The Beatles' },
    { title: '(I Can\'t Get No) Satisfaction', artist: 'The Rolling Stones' },
    { title: 'Good Vibrations', artist: 'The Beach Boys' },
    { title: 'Respect', artist: 'Aretha Franklin' },
    { title: 'Light My Fire', artist: 'The Doors' },
    { title: 'My Girl', artist: 'The Temptations' },
    { title: 'A Day in the Life', artist: 'The Beatles' },
    { title: 'Stand by Me', artist: 'Ben E. King' },
    { title: 'I Heard It Through the Grapevine', artist: 'Marvin Gaye' },
    { title: 'Sunshine of Your Love', artist: 'Cream' },
  ],
  '1950s': [
    { title: 'Hound Dog', artist: 'Elvis Presley' },
    { title: 'Johnny B. Goode', artist: 'Chuck Berry' },
    { title: 'Great Balls of Fire', artist: 'Jerry Lee Lewis' },
    { title: 'Rock Around the Clock', artist: 'Bill Haley & His Comets' },
    { title: 'That\'ll Be the Day', artist: 'Buddy Holly' },
    { title: 'Jailhouse Rock', artist: 'Elvis Presley' },
    { title: 'Tutti Frutti', artist: 'Little Richard' },
    { title: 'What\'d I Say', artist: 'Ray Charles' },
    { title: 'La Bamba', artist: 'Ritchie Valens' },
    { title: 'Blue Suede Shoes', artist: 'Carl Perkins' },
  ],
};

const MOOD_SPECS: Record<string, { searchTerms: string[] }> = {
  'For DJs': { searchTerms: ['dj set essentials', 'club mix playlist', 'electronic dance dj'] },
  Workout: { searchTerms: ['workout motivation', 'gym pump up', 'running playlist'] },
  Sleep: { searchTerms: ['sleep music calm', 'bedtime ambient', 'peaceful piano sleep'] },
  Party: { searchTerms: ['party hits', 'dance party anthems', 'club bangers'] },
  Relax: { searchTerms: ['relaxing acoustic', 'chill lounge', 'easy listening calm'] },
  Focus: { searchTerms: ['focus study music', 'concentration instrumental', 'deep work playlist'] },
  Drive: { searchTerms: ['road trip hits', 'driving playlist', 'highway anthems'] },
  Chill: { searchTerms: ['chill vibes', 'lofi chill beats', 'mellow playlist'] },
  Wellness: { searchTerms: ['wellness meditation', 'yoga calm music', 'mindful ambient'] },
};

function upscaleArtwork(url?: string): string | undefined {
  if (!url) return undefined;
  return url
    .replace('100x100bb.jpg', '600x600bb.jpg')
    .replace('100x100.jpg', '600x600.jpg')
    .replace('60x60bb.jpg', '600x600bb.jpg');
}

function itemToEnvelope(item: CatalogProviderItem): MediaEnvelope | undefined {
  if (!item.trackName) return undefined;
  const trackId = item.trackId ?? Math.floor(Math.random() * 1_000_000);
  return {
    envelopeId: `catalog-${trackId}`,
    title: item.trackName,
    artist: item.artistName ?? 'Unknown Artist',
    url: catalogPlayUrlFromPreview(item.previewUrl),
    durationSeconds: item.trackTimeMillis
      ? Math.floor(item.trackTimeMillis / 1000)
      : undefined,
    provider: 'https',
    transport: 'element-src',
    sourceId: String(trackId),
    mimeType: 'audio/mpeg',
    artworkUrl: catalogArtworkUrl(item.artworkUrl100) ?? upscaleArtwork(item.artworkUrl100),
    releaseYear: item.releaseDate?.slice(0, 4),
  };
}

function yearInRange(year: number | undefined, min?: number, max?: number): boolean {
  if (year === undefined || Number.isNaN(year)) return min === undefined && max === undefined;
  if (min !== undefined && year < min) return false;
  if (max !== undefined && year > max) return false;
  return true;
}

function resolveExploreSpec(group: ExploreGroup, label: string): ExploreSpec | undefined {
  if (group === 'decade') {
    const range = DECADE_RANGES[label];
    if (!range) return undefined;
    return {
      displayQuery: `${label} hits`,
      yearMin: range.yearMin,
      yearMax: range.yearMax,
      useCharts: range.yearMin >= 2010,
      seeds: DECADE_SEEDS[label],
    };
  }

  if (group === 'genre') {
    const genreId = GENRE_ITUNES_IDS[label];
    const searchOnly = GENRE_SEARCH_SPECS[label];
    if (!genreId && !searchOnly) return undefined;
    const genreWord = label.split('/')[0].trim();
    return {
      displayQuery: `${label} essentials`,
      genreIds: genreId ? [genreId] : undefined,
      useCharts: Boolean(genreId),
      // Genre accuracy beats recency here: a plain text search like "Hip-Hop 2026"
      // matches loosely across the catalog and drags in country/worship releases that
      // are not the genre at all. Freshness comes from the genre-FILTERED charts above
      // (genreIds + useCharts), which are both current and on-genre; these terms are
      // only the fallback when the chart path yields nothing.
      searchTerms:
        searchOnly?.searchTerms ?? [
          `${genreWord} hits`,
          `${genreWord} essentials`,
        ],
    };
  }

  if (group === 'mood') {
    const mood = MOOD_SPECS[label];
    if (!mood) return undefined;
    return {
      displayQuery: `${label} vibes`,
      searchTerms: mood.searchTerms,
    };
  }

  if (group === 'quick') {
    if (/top\s*hits|charts|trending/i.test(label)) {
      return { displayQuery: 'Top charts', useCharts: true };
    }
    if (/new\s+music/i.test(label)) {
      const year = new Date().getFullYear();
      return {
        displayQuery: newMusicSearchLabel(year),
        useCharts: true,
        // Only surface genuinely recent releases. Without a year floor, an iTunes search for
        // "new music 2026" loosely matches decades-old tracks (Billie Jean, Wonderwall,
        // Marvin's Room). Require the last ~2 years so the shelf is actually new.
        yearMin: year - 1,
        searchTerms: [
          newMusicSearchLabel(year),
          `new singles ${year}`,
          `latest releases ${year}`,
        ],
      };
    }
    return { displayQuery: label, searchTerms: [label] };
  }

  return undefined;
}

export function exploreDisplayQuery(group: ExploreGroup, label: string): string {
  return resolveExploreSpec(group, label)?.displayQuery ?? label;
}

function songMatchesFilters(
  song: ChartRssSong,
  genreIds?: string[],
  yearMin?: number,
  yearMax?: number,
): boolean {
  const year = parseReleaseYear(song.releaseDate?.slice(0, 4));
  if (!yearInRange(year, yearMin, yearMax)) return false;
  if (genreIds?.length) {
    const ids = new Set((song.genres ?? []).map((g) => g.genreId).filter(Boolean));
    if (!genreIds.some((id) => ids.has(id))) return false;
  }
  return true;
}

/**
 * Pick a varied window from a chart pool.
 *
 * Taking the top N in chart order meant a shelf showed the same handful of artists on
 * every visit. Rotate the starting point once per day and allow at most two entries per
 * artist so one act cannot fill the row.
 */
function diversifyChartPool<T extends { artistName?: string }>(
  pool: T[],
  limit: number,
  dayIndex = Math.floor(Date.now() / 86_400_000),
): T[] {
  if (pool.length <= limit) return pool;
  const offset = (dayIndex * limit) % pool.length;
  const rotated = [...pool.slice(offset), ...pool.slice(0, offset)];
  const perArtist = new Map<string, number>();
  const picked: T[] = [];
  const overflow: T[] = [];
  for (const row of rotated) {
    const key = (row.artistName ?? '').trim().toLowerCase();
    const seen = perArtist.get(key) ?? 0;
    if (key && seen >= 2) {
      overflow.push(row);
      continue;
    }
    perArtist.set(key, seen + 1);
    picked.push(row);
    if (picked.length >= limit) break;
  }
  // Backfill from overflow if diversity capping left the shelf short.
  for (const row of overflow) {
    if (picked.length >= limit) break;
    picked.push(row);
  }
  return picked;
}

/** Allow at most two tracks per artist in a shelf, backfilling to keep it full. */
export function diversifyEnvelopesByArtist(
  rows: MediaEnvelope[],
  limit: number,
  maxPerArtist = 2,
): MediaEnvelope[] {
  const perArtist = new Map<string, number>();
  const picked: MediaEnvelope[] = [];
  const overflow: MediaEnvelope[] = [];
  for (const row of rows) {
    const key = (row.artist ?? '').trim().toLowerCase();
    const seen = perArtist.get(key) ?? 0;
    if (key && seen >= maxPerArtist) {
      overflow.push(row);
      continue;
    }
    perArtist.set(key, seen + 1);
    picked.push(row);
    if (picked.length >= limit) return picked;
  }
  for (const row of overflow) {
    if (picked.length >= limit) break;
    picked.push(row);
  }
  return picked;
}

/** @internal test seam for shelf variety logic. */
export const __testDiversifyChartPool = diversifyChartPool;

async function fetchFilteredChartEnvelopes(
  spec: ExploreSpec,
  limit = 50,
): Promise<MediaEnvelope[]> {
  // Always pull a pool well beyond what we display. Fetching only `limit` rows left
  // diversifyChartPool nothing to choose from (it returns the pool untouched when it is
  // not larger than the limit), so shelves like Top charts still repeated one artist.
  const poolSize = Math.max(limit * 4, 100);
  const data = await fetchCatalogChartsPayload(poolSize, {
    genre: spec.genreIds?.[0],
    yearMin: spec.yearMin,
    yearMax: spec.yearMax,
  });
  if (!data) return [];
  const pool = (data.feed?.results ?? []).filter((song) =>
    songMatchesFilters(song, spec.genreIds, spec.yearMin, spec.yearMax),
  );
  if (pool.length === 0) return [];
  const filtered = diversifyChartPool(pool, limit);

  const ids = filtered.map((s) => s.id).filter((id): id is string => Boolean(id));
  const lookupItems = await fetchCatalogApiResults(
    catalogLookupUrl({ id: ids.slice(0, limit).join(','), entity: 'song' }),
  );
  const lookupById = new Map<string, CatalogProviderItem>();
  for (const item of lookupItems) {
    if (item.trackId) lookupById.set(String(item.trackId), item);
  }

  const envelopes: MediaEnvelope[] = [];
  for (const song of filtered) {
    if (envelopes.length >= limit) break;
    const item = song.id ? lookupById.get(song.id) : undefined;
    const merged: CatalogProviderItem = {
      trackId: item?.trackId ?? (song.id ? parseInt(song.id, 10) : undefined),
      trackName: item?.trackName ?? song.name,
      artistName: item?.artistName ?? song.artistName,
      collectionName: item?.collectionName,
      previewUrl: item?.previewUrl,
      trackTimeMillis: item?.trackTimeMillis,
      releaseDate: item?.releaseDate ?? song.releaseDate,
      artworkUrl100: item?.artworkUrl100 ?? song.artworkUrl100,
    };
    const env = itemToEnvelope(merged);
    if (env) envelopes.push(env);
  }
  return envelopes;
}

async function searchSeedEnvelope(
  seed: { title: string; artist: string },
  yearMin?: number,
  yearMax?: number,
): Promise<MediaEnvelope | undefined> {
  const term = `${seed.artist} ${seed.title}`;
  const items = await fetchCatalogApiResults(
    catalogSearchUrl({ term, media: 'music', entity: 'song', limit: 8 }),
  );
  const normalizedTitle = seed.title.toLowerCase();
  const normalizedArtist = seed.artist.toLowerCase();

  for (const item of items) {
    const title = item.trackName?.toLowerCase() ?? '';
    const artist = item.artistName?.toLowerCase() ?? '';
    const year = parseReleaseYear(item.releaseDate?.slice(0, 4));
    if (!title.includes(normalizedTitle.slice(0, Math.min(normalizedTitle.length, 8)))) continue;
    if (!artist.includes(normalizedArtist.split(' ')[0])) continue;
    if (!yearInRange(year, yearMin, yearMax)) continue;
    return itemToEnvelope(item);
  }
  return undefined;
}

async function searchTermEnvelopes(
  term: string,
  limit: number,
  yearMin?: number,
  yearMax?: number,
): Promise<MediaEnvelope[]> {
  const items = await fetchCatalogApiResults(
    catalogSearchUrl({ term, media: 'music', entity: 'song', limit: 25 }),
  );
  const out: MediaEnvelope[] = [];
  for (const item of items) {
    const year = parseReleaseYear(item.releaseDate?.slice(0, 4));
    if (!yearInRange(year, yearMin, yearMax)) continue;
    const env = itemToEnvelope(item);
    if (env) out.push(env);
    if (out.length >= limit) break;
  }
  return out;
}

function dedupeEnvelopes(envelopes: MediaEnvelope[]): MediaEnvelope[] {
  const seen = new Set<string>();
  const out: MediaEnvelope[] = [];
  for (const env of envelopes) {
    const key = `${env.title.toLowerCase()}|${env.artist.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(env);
  }
  return out;
}

function rankExploreEnvelopesByTaste(envelopes: MediaEnvelope[]): MediaEnvelope[] {
  if (envelopes.length <= 1) return envelopes;
  try {
    const profile = getTasteProfile();
    const session = getSessionVector() ?? EMPTY_SESSION_VECTOR;
    return [...envelopes].sort(
      (a, b) =>
        scoreCandidateForSession(b, session, profile) -
        scoreCandidateForSession(a, session, profile),
    );
  } catch {
    return envelopes;
  }
}

/** Fresh catalog picks biased to the listener's onboarding + taste genres. */
async function fetchTasteGenreNewReleases(
  genreLabel: string,
  limit: number,
): Promise<MediaEnvelope[]> {
  const year = new Date().getFullYear();
  const genreSpec = resolveExploreSpec('genre', genreLabel);
  if (!genreSpec) return [];

  const collected: MediaEnvelope[] = [];
  const recentYearMin = year - 1;

  if (genreSpec.genreIds?.length) {
    collected.push(
      ...(await fetchFilteredChartEnvelopes(
        {
          displayQuery: `${genreLabel} new`,
          genreIds: genreSpec.genreIds,
          yearMin: recentYearMin,
          yearMax: year,
          useCharts: true,
        },
        limit,
      )),
    );
  }

  const genreShort = genreLabel.split('/')[0].trim();
  const searchTerms = [
    `new ${genreShort} ${year}`,
    `${genreShort} new releases ${year}`,
    ...(genreSpec.searchTerms ?? []),
  ];
  const perTerm = Math.max(4, Math.ceil(limit / searchTerms.length));
  for (const term of searchTerms) {
    collected.push(...(await searchTermEnvelopes(term, perTerm)));
    if (collected.length >= limit) break;
  }

  if (collected.length < Math.min(limit, 4)) {
    for (const term of searchTerms) {
      collected.push(
        ...(await searchTermEnvelopes(term, perTerm, recentYearMin, year)),
      );
      if (collected.length >= limit) break;
    }
  }

  return collected;
}

/** Return a randomly shuffled window of `limit` items from a cached pool (fresh each visit). */
function shuffleExplorePool(pool: MediaEnvelope[], limit: number): MediaEnvelope[] {
  const out = [...pool];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out.slice(0, limit);
}

/** Fetch curated catalog previews for an Explore category pick. */
export async function fetchExploreEnvelopes(
  group: ExploreGroup,
  label: string,
  limit = 50,
): Promise<MediaEnvelope[]> {
  if (isAirGapEnabled()) return [];

  const isNewMusicQuick = group === 'quick' && /new\s+music/i.test(label);
  const tasteGenres = isNewMusicQuick ? getPersonalizedExploreGenreLabels(4) : [];
  const tasteFingerprint = personalizedGenreCacheFingerprint(tasteGenres);

  const cachePart = isNewMusicQuick
    ? `${newMusicExploreCachePart(undefined, tasteFingerprint)}|${limit}`
    : `${group}|${label}|${limit}`;
  const cacheKey = prefixedCacheKey(CACHE_KEYS.EXPLORE, cachePart);
  const cacheTtl =
    group === 'quick' ? EXPLORE_QUICK_FRESH_TTL_MS : undefined;
  const cached = readResponseCache<MediaEnvelope[]>(cacheKey);
  if (cached?.isFresh) {
    // New-music shelf: present a freshly shuffled window of the cached pool each visit so it
    // doesn't look frozen, while still avoiding a network round-trip every open.
    return isNewMusicQuick ? shuffleExplorePool(cached.data, limit) : cached.data;
  }

  const spec = resolveExploreSpec(group, label);
  if (!spec) return cached?.data ?? [];

  const collected: MediaEnvelope[] = [];

  if (spec.useCharts) {
    collected.push(...(await fetchFilteredChartEnvelopes(spec, limit)));
  }

  if (spec.seeds?.length) {
    const seedResults = await Promise.all(
      spec.seeds.map((seed) => searchSeedEnvelope(seed, spec.yearMin, spec.yearMax)),
    );
    for (const env of seedResults) {
      if (env) collected.push(env);
    }
  }

  if (spec.searchTerms?.length) {
    // Over-fetch per term so the per-artist cap has spare candidates to draw on.
    // At exactly `limit` rows the cap had to backfill duplicates, which is how mood
    // shelves (e.g. Chill) still came back as one artist four times over.
    const perTerm = Math.max(12, Math.ceil((limit * 3) / spec.searchTerms.length));
    for (const term of spec.searchTerms) {
      collected.push(
        ...(await searchTermEnvelopes(term, perTerm, spec.yearMin, spec.yearMax)),
      );
    }
  }

  if (isNewMusicQuick && tasteGenres.length > 0) {
    const perGenre = Math.max(8, Math.ceil((limit * 2) / tasteGenres.length));
    for (const genre of tasteGenres) {
      collected.push(...(await fetchTasteGenreNewReleases(genre, perGenre)));
    }
  }

  let envelopes = dedupeEnvelopes(collected);
  if (isNewMusicQuick && tasteGenres.length > 0) {
    envelopes = rankExploreEnvelopesByTaste(envelopes);
  }
  if (envelopes.length > 0) {
    // Cache a larger pool than we show, so each visit can present a different shuffled window
    // (new-music only). Non-new-music shelves keep their deterministic taste ordering.
    if (isNewMusicQuick) {
      const pool = envelopes.slice(0, Math.max(limit * 2, limit));
      writeResponseCache(cacheKey, pool, cacheTtl);
      return shuffleExplorePool(pool, limit);
    }
    // Cap per-artist so a search-driven shelf cannot come back as the same act six
    // times over (mood rows like "Chill" were returning one library-music artist for
    // every slot). Chart-driven shelves get the same treatment in diversifyChartPool.
    envelopes = diversifyEnvelopesByArtist(envelopes, limit);
    writeResponseCache(cacheKey, envelopes, cacheTtl);
    return envelopes;
  }

  // Last resort: literal catalog search (same path as typing the query in Search).
  const fallbackTerms = [
    spec.displayQuery ?? label,
    label,
    ...(isNewMusicQuick ? [`new releases ${new Date().getFullYear()}`] : []),
  ];
  for (const term of fallbackTerms) {
    collected.push(...(await searchTermEnvelopes(term, limit)));
    envelopes = diversifyEnvelopesByArtist(dedupeEnvelopes(collected), limit);
    if (envelopes.length > 0) {
      writeResponseCache(cacheKey, envelopes, cacheTtl);
      return envelopes;
    }
  }

  return cached?.data ?? [];
}
