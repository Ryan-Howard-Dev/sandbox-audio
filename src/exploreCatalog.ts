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
    return {
      displayQuery: `${label} essentials`,
      genreIds: genreId ? [genreId] : undefined,
      useCharts: Boolean(genreId),
      searchTerms:
        searchOnly?.searchTerms ?? [`${label.split('/')[0].trim()} essentials`],
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

async function fetchFilteredChartEnvelopes(
  spec: ExploreSpec,
  limit = 50,
): Promise<MediaEnvelope[]> {
  const poolSize = spec.genreIds?.length || spec.yearMin ? 100 : limit;
  const data = await fetchCatalogChartsPayload(poolSize, {
    genre: spec.genreIds?.[0],
    yearMin: spec.yearMin,
    yearMax: spec.yearMax,
  });
  if (!data) return [];
  const filtered = (data.feed?.results ?? []).filter((song) =>
    songMatchesFilters(song, spec.genreIds, spec.yearMin, spec.yearMax),
  );
  if (filtered.length === 0) return [];

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
  if (cached?.isFresh) return cached.data;

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
    const perTerm = Math.max(8, Math.ceil(limit / spec.searchTerms.length));
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
  envelopes = envelopes.slice(0, limit);
  if (envelopes.length > 0) {
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
    envelopes = dedupeEnvelopes(collected).slice(0, limit);
    if (envelopes.length > 0) {
      writeResponseCache(cacheKey, envelopes, cacheTtl);
      return envelopes;
    }
  }

  return cached?.data ?? [];
}
