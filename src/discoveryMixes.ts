/**
 * Made For You mix engine — Tidal/Spotify-style generation rules.
 *
 * | Mix              | Size    | Refresh           | Sources                          |
 * |------------------|---------|-------------------|----------------------------------|
 * | Daily Discovery  | 25–40   | Daily 6am local   | 70% taste locker/catalog, 30% new artists |
 * | Weekly Discover  | 30      | Weekly Monday     | Same + genre chip filter         |
 * | Release Radar    | variable| Follow feed poll  | followedArtistFeed               |
 * | My Mix (×3–6)    | 50 each | Gradual (~8%/day) | Genre clusters from session vector |
 */

import { normalizeIdentityKey } from './collectionIntelligence';
import type { FollowedFeedRelease } from './followedArtistFeed';
import { getLockerEntriesSnapshot } from './lockerStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import { fetchChartCatalogTracks } from './searchCatalog';
import { lockerEntryToEnvelope, resolveEnvelopeIdsToTracks } from './smartPlaylistEngine';
import { getSessionVector, type SessionVector } from './sessionTaste';
import {
  composeMixRadioDiscoveryPool,
  MIX_RADIO_FAMILIAR_RATIO,
  MIX_RADIO_NEW_ARTIST_RATIO,
} from './playerMixRadio';
import { ensureSonicAnalysisForEnvelope } from './sonicAnalysisQueue';
import { analyzePlaylistSonicCoverage, reorderTracksBySonicPath } from './sonicReorderPolicy';
import { getTasteProfile } from './tasteProfile';
import { isEnvelopeSuppressed } from './tasteSuppressions';
import { prefsGetItem, prefsRemoveItem, prefsSetItem } from './prefsStorage';
import { EXPLORE_GENRES } from './exploreBrowseData';

export type DiscoveryMixKind =
  | 'daily-discovery'
  | 'weekly-discover'
  | 'release-radar'
  | 'my-mix';

export type DiscoveryMix = {
  id: string;
  kind: DiscoveryMixKind;
  title: string;
  subtitle: string;
  tracks: MediaEnvelope[];
  generatedAt: number;
};

export const DAILY_DISCOVERY_MIN = 25;
export const DAILY_DISCOVERY_MAX = 40;
export const WEEKLY_DISCOVER_SIZE = 30;
export const MY_MIX_SIZE = 50;
export const MY_MIX_SLOT_MIN = 3;
export const MY_MIX_SLOT_MAX = 6;
export const FAMILIAR_RATIO = MIX_RADIO_FAMILIAR_RATIO;
export const NEW_ARTIST_RATIO = MIX_RADIO_NEW_ARTIST_RATIO;
export const MY_MIX_GRADUAL_SWAP_RATIO = 0.08;
export const DAILY_REFRESH_HOUR_LOCAL = 6;

const WEEKLY_GENRE_KEY = 'sandbox_weekly_mix_genre_v1';
const MIX_CACHE_KEY = 'sandbox_discovery_mixes_v2';

type CachedMyMixSlot = {
  slot: number;
  genre: string;
  envelopeIds: string[];
  generatedAt: number;
  lastGradualRefreshAt: number;
};

type DiscoveryMixCache = {
  schemaVersion: 2;
  dailyPeriod: string;
  dailyEnvelopeIds: string[];
  dailyGeneratedAt: number;
  weeklyPeriod: string;
  weeklyGenre: string;
  weeklyEnvelopeIds: string[];
  weeklyGeneratedAt: number;
  myMixSlots: CachedMyMixSlot[];
  releaseRadarIds: string[];
  releaseRadarEnvelopeIds: string[];
  releaseRadarGeneratedAt: number;
};

function emptyCache(): DiscoveryMixCache {
  return {
    schemaVersion: 2,
    dailyPeriod: '',
    dailyEnvelopeIds: [],
    dailyGeneratedAt: 0,
    weeklyPeriod: '',
    weeklyGenre: '',
    weeklyEnvelopeIds: [],
    weeklyGeneratedAt: 0,
    myMixSlots: [],
    releaseRadarIds: [],
    releaseRadarEnvelopeIds: [],
    releaseRadarGeneratedAt: 0,
  };
}

function readCache(): DiscoveryMixCache {
  try {
    const raw = prefsGetItem(MIX_CACHE_KEY);
    if (!raw) return emptyCache();
    const parsed = JSON.parse(raw) as DiscoveryMixCache;
    if (parsed?.schemaVersion !== 2) return emptyCache();
    return parsed;
  } catch {
    return emptyCache();
  }
}

function writeCache(cache: DiscoveryMixCache): void {
  prefsSetItem(MIX_CACHE_KEY, JSON.stringify(cache));
}

/** Period key — rolls at 6:00 local (before 6am counts as previous calendar day). */
export function dailyDiscoveryPeriodKey(now = new Date()): string {
  const d = new Date(now);
  if (d.getHours() < DAILY_REFRESH_HOUR_LOCAL) {
    d.setDate(d.getDate() - 1);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Week period anchored to Monday 6am local. */
export function weeklyDiscoverPeriodKey(now = new Date()): string {
  const d = new Date(now);
  const day = d.getDay();
  const toMonday = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + toMonday);
  if (now.getDay() === 1 && now.getHours() < DAILY_REFRESH_HOUR_LOCAL) {
    d.setDate(d.getDate() - 7);
  }
  return `W-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function lockerPool(): MediaEnvelope[] {
  return (getLockerEntriesSnapshot() ?? [])
    .filter((e) => e.url?.trim())
    .map(lockerEntryToEnvelope);
}

function trackKey(env: MediaEnvelope): string {
  return `${normalizeIdentityKey(env.artist ?? '')}::${normalizeIdentityKey(env.title ?? '')}`;
}

function dedupeTracks(tracks: MediaEnvelope[]): MediaEnvelope[] {
  const seen = new Set<string>();
  const out: MediaEnvelope[] = [];
  for (const t of tracks) {
    const key = trackKey(t);
    if (seen.has(key) || !t.url?.trim()) continue;
    if (isEnvelopeSuppressed(t)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

export { isNewArtistTrack } from './tasteProfile';

/** 70% taste-familiar + 30% new-artist picks; sonic path order when BPM/key data exists. */
export function composeDiscoveryMixTracks(
  pool: MediaEnvelope[],
  totalSize: number,
  options?: { genreFilter?: string; session?: SessionVector | null },
): MediaEnvelope[] {
  const picked = composeMixRadioDiscoveryPool(pool, totalSize, options);
  if (picked.length === 0) return picked;

  let primed = 0;
  for (const track of picked) {
    if (primed >= 20) break;
    ensureSonicAnalysisForEnvelope(track);
    primed++;
  }

  const { detail } = analyzePlaylistSonicCoverage(picked);
  if (detail === 'none') return picked;
  return reorderTracksBySonicPath(picked, { polish: picked.length <= 40 });
}

async function catalogPool(fetchCount: number): Promise<MediaEnvelope[]> {
  try {
    const charts = await fetchChartCatalogTracks(fetchCount);
    return charts.map((c) => c.envelope).filter((e): e is MediaEnvelope => Boolean(e?.url));
  } catch {
    return [];
  }
}

async function fullCandidatePool(fetchCount: number): Promise<MediaEnvelope[]> {
  const locker = lockerPool();
  const catalog = await catalogPool(fetchCount);
  return dedupeTracks([...locker, ...catalog]);
}

function displayGenreLabel(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return 'Mix';
  return trimmed.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getWeeklyMixGenreChips(limit = 5): string[] {
  const profile = getTasteProfile();
  const fromTaste = Object.entries(profile.genreAffinity)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([g]) => displayGenreLabel(g));

  if (fromTaste.length >= 3) return fromTaste.slice(0, limit);

  const fallback = EXPLORE_GENRES.filter((g) => !fromTaste.includes(g)).slice(
    0,
    limit - fromTaste.length,
  );
  return [...fromTaste, ...fallback].slice(0, limit);
}

/** Top genre clusters from session vector for My Mix slots (3–6). */
export function getSessionGenreClusters(limit = MY_MIX_SLOT_MAX): string[] {
  const session = getSessionVector();
  const fromSession =
    session && Object.keys(session.genres).length > 0
      ? Object.entries(session.genres)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([g]) => displayGenreLabel(g))
      : [];

  const chips = getWeeklyMixGenreChips(limit);
  const merged: string[] = [];
  for (const g of [...fromSession, ...chips]) {
    const norm = normalizeIdentityKey(g);
    if (!merged.some((m) => normalizeIdentityKey(m) === norm)) merged.push(g);
    if (merged.length >= limit) break;
  }

  const count = Math.max(MY_MIX_SLOT_MIN, Math.min(MY_MIX_SLOT_MAX, merged.length || MY_MIX_SLOT_MIN));
  while (merged.length < count) {
    const next = EXPLORE_GENRES.find(
      (g) => !merged.some((m) => normalizeIdentityKey(m) === normalizeIdentityKey(g)),
    );
    if (!next) break;
    merged.push(next);
  }
  return merged.slice(0, MY_MIX_SLOT_MAX);
}

export function loadWeeklyMixGenre(): string | null {
  return prefsGetItem(WEEKLY_GENRE_KEY);
}

export function saveWeeklyMixGenre(genre: string | null): void {
  if (genre?.trim()) prefsSetItem(WEEKLY_GENRE_KEY, genre.trim());
  else prefsRemoveItem(WEEKLY_GENRE_KEY);
}

function pickDailySize(): number {
  return (
    DAILY_DISCOVERY_MIN +
    Math.floor(Math.random() * (DAILY_DISCOVERY_MAX - DAILY_DISCOVERY_MIN + 1))
  );
}

function envelopeIds(tracks: MediaEnvelope[]): string[] {
  return tracks.map((t) => t.envelopeId).filter(Boolean);
}

function resolveIds(ids: string[], pool: MediaEnvelope[]): MediaEnvelope[] {
  const locker = getLockerEntriesSnapshot() ?? [];
  return resolveEnvelopeIdsToTracks(ids, locker).filter((t) => t.url?.trim());
}

/** Gradually swap ~8% of tracks for fresh picks in the same genre cluster. */
export function gradualRefreshMyMix(
  current: MediaEnvelope[],
  pool: MediaEnvelope[],
  genre: string,
): MediaEnvelope[] {
  if (current.length === 0) return current;
  const swapCount = Math.max(1, Math.round(current.length * MY_MIX_GRADUAL_SWAP_RATIO));
  const keepCount = current.length - swapCount;
  const kept = current.slice(0, keepCount);
  const exclude = new Set(kept.map((t) => t.envelopeId));
  const fresh = composeDiscoveryMixTracks(
    pool.filter((t) => !exclude.has(t.envelopeId)),
    swapCount,
    { genreFilter: genre },
  );
  return dedupeTracks([...kept, ...fresh]).slice(0, MY_MIX_SIZE);
}

export async function buildDailyDiscovery(): Promise<DiscoveryMix> {
  const period = dailyDiscoveryPeriodKey();
  const cache = readCache();
  const pool = await fullCandidatePool(DAILY_DISCOVERY_MAX * 3);

  if (cache.dailyPeriod === period && cache.dailyEnvelopeIds.length > 0) {
    const tracks = resolveIds(cache.dailyEnvelopeIds, pool);
    if (tracks.length >= DAILY_DISCOVERY_MIN) {
      return {
        id: 'daily-discovery',
        kind: 'daily-discovery',
        title: 'Daily Discovery',
        subtitle: `Refreshes daily 6am · ${tracks.length} tracks · 70% taste / 30% new artists`,
        tracks,
        generatedAt: cache.dailyGeneratedAt,
      };
    }
  }

  const size = pickDailySize();
  const tracks = composeDiscoveryMixTracks(pool, size);
  writeCache({
    ...cache,
    dailyPeriod: period,
    dailyEnvelopeIds: envelopeIds(tracks),
    dailyGeneratedAt: Date.now(),
  });

  return {
    id: 'daily-discovery',
    kind: 'daily-discovery',
    title: 'Daily Discovery',
    subtitle: `Refreshes daily 6am · ${tracks.length} tracks · 70% taste / 30% new artists`,
    tracks,
    generatedAt: Date.now(),
  };
}

export async function buildWeeklyDiscover(genreChip?: string | null): Promise<DiscoveryMix> {
  const period = weeklyDiscoverPeriodKey();
  const genre =
    genreChip?.trim() || loadWeeklyMixGenre() || getWeeklyMixGenreChips(1)[0] || 'Indie';
  saveWeeklyMixGenre(genre);

  const cache = readCache();
  const pool = await fullCandidatePool(WEEKLY_DISCOVER_SIZE * 4);

  if (
    cache.weeklyPeriod === period &&
    normalizeIdentityKey(cache.weeklyGenre) === normalizeIdentityKey(genre) &&
    cache.weeklyEnvelopeIds.length > 0
  ) {
    const tracks = resolveIds(cache.weeklyEnvelopeIds, pool);
    if (tracks.length >= 8) {
      return {
        id: 'weekly-discover',
        kind: 'weekly-discover',
        title: 'Weekly Discover',
        subtitle: `${genre} · Monday refresh · 70% taste / 30% new`,
        tracks: tracks.slice(0, WEEKLY_DISCOVER_SIZE),
        generatedAt: cache.weeklyGeneratedAt,
      };
    }
  }

  let tracks = composeDiscoveryMixTracks(pool, WEEKLY_DISCOVER_SIZE, { genreFilter: genre });
  if (tracks.length < 8) {
    tracks = composeDiscoveryMixTracks(pool, WEEKLY_DISCOVER_SIZE);
  }

  writeCache({
    ...readCache(),
    weeklyPeriod: period,
    weeklyGenre: genre,
    weeklyEnvelopeIds: envelopeIds(tracks),
    weeklyGeneratedAt: Date.now(),
  });

  return {
    id: 'weekly-discover',
    kind: 'weekly-discover',
    title: 'Weekly Discover',
    subtitle: `${genre} · Monday refresh · 70% taste / 30% new`,
    tracks,
    generatedAt: Date.now(),
  };
}

export function buildReleaseRadar(releases: FollowedFeedRelease[]): DiscoveryMix {
  const playableReleases = releases.filter((r) => r.envelope?.url?.trim());
  const releaseIds = playableReleases.map((r) => r.id).filter(Boolean);
  const cache = readCache();
  const idsKey = releaseIds.join('|');

  const releaseRadarSubtitle = (count: number): string => {
    if (count <= 0) return 'Follow artists for recent release picks';
    return `${count} recent from artists you follow`;
  };

  if (cache.releaseRadarIds.join('|') === idsKey && cache.releaseRadarEnvelopeIds.length > 0) {
    const locker = getLockerEntriesSnapshot() ?? [];
    const tracks = resolveEnvelopeIdsToTracks(cache.releaseRadarEnvelopeIds, locker).filter(
      (t) => t.url?.trim() && !isEnvelopeSuppressed(t),
    );
    return {
      id: 'release-radar',
      kind: 'release-radar',
      title: 'Release Radar',
      subtitle: releaseRadarSubtitle(tracks.length),
      tracks,
      generatedAt: cache.releaseRadarGeneratedAt,
    };
  }

  const tracks: MediaEnvelope[] = [];
  for (const r of playableReleases) {
    const env = r.envelope;
    if (!env?.url) continue;
    if (isEnvelopeSuppressed(env)) continue;
    tracks.push({
      ...env,
      artworkUrl: r.artworkUrl ?? env.artworkUrl,
    });
  }

  const deduped = dedupeTracks(tracks);
  writeCache({
    ...readCache(),
    releaseRadarIds: releaseIds,
    releaseRadarEnvelopeIds: envelopeIds(deduped),
    releaseRadarGeneratedAt: Date.now(),
  });

  return {
    id: 'release-radar',
    kind: 'release-radar',
    title: 'Release Radar',
    subtitle: releaseRadarSubtitle(deduped.length),
    tracks: deduped,
    generatedAt: Date.now(),
  };
}

export async function buildMyMixSlots(): Promise<DiscoveryMix[]> {
  const clusters = getSessionGenreClusters();
  const slotCount = Math.max(MY_MIX_SLOT_MIN, Math.min(MY_MIX_SLOT_MAX, clusters.length));
  const genres = clusters.slice(0, slotCount);
  const pool = await fullCandidatePool(MY_MIX_SIZE * 3);
  let cache = readCache();
  const now = Date.now();
  const oneDayMs = 24 * 60 * 60 * 1000;
  const mixes: DiscoveryMix[] = [];

  const nextSlots: CachedMyMixSlot[] = [];

  for (let i = 0; i < genres.length; i++) {
    const genre = genres[i]!;
    const slot = i + 1;
    const prev = cache.myMixSlots.find(
      (s) => s.slot === slot && normalizeIdentityKey(s.genre) === normalizeIdentityKey(genre),
    );

    let tracks: MediaEnvelope[];
    let generatedAt = now;
    let lastGradual = now;

    if (prev && prev.envelopeIds.length >= 10) {
      tracks = resolveIds(prev.envelopeIds, pool);
      generatedAt = prev.generatedAt;
      lastGradual = prev.lastGradualRefreshAt;
      if (now - lastGradual >= oneDayMs) {
        tracks = gradualRefreshMyMix(tracks, pool, genre);
        lastGradual = now;
      }
    } else {
      tracks = composeDiscoveryMixTracks(pool, MY_MIX_SIZE, { genreFilter: genre });
      if (tracks.length < MY_MIX_SIZE / 2) {
        tracks = composeDiscoveryMixTracks(pool, MY_MIX_SIZE);
      }
    }

    tracks = dedupeTracks(tracks).slice(0, MY_MIX_SIZE);
    nextSlots.push({
      slot,
      genre,
      envelopeIds: envelopeIds(tracks),
      generatedAt,
      lastGradualRefreshAt: lastGradual,
    });

    mixes.push({
      id: `my-mix-${slot}`,
      kind: 'my-mix',
      title: `My ${genre} Mix`,
      subtitle: `${tracks.length} tracks · gradual refresh`,
      tracks,
      generatedAt,
    });
  }

  writeCache({ ...readCache(), myMixSlots: nextSlots });
  return mixes;
}

export type MadeForYouBundle = {
  daily: DiscoveryMix;
  weekly: DiscoveryMix;
  releaseRadar: DiscoveryMix;
  myMixes: DiscoveryMix[];
  genreChips: string[];
  dailyPeriod: string;
  weeklyPeriod: string;
};

let cachedBundle: MadeForYouBundle | null = null;

export async function loadMadeForYouBundle(
  releases: FollowedFeedRelease[] = [],
): Promise<MadeForYouBundle> {
  const dailyPeriod = dailyDiscoveryPeriodKey();
  const weeklyPeriod = weeklyDiscoverPeriodKey();
  const releaseKey = releases.map((r) => r.id).join('|');

  if (
    cachedBundle &&
    cachedBundle.dailyPeriod === dailyPeriod &&
    cachedBundle.weeklyPeriod === weeklyPeriod &&
    readCache().releaseRadarIds.join('|') === releaseKey
  ) {
    return cachedBundle;
  }

  const [daily, weekly, myMixes] = await Promise.all([
    buildDailyDiscovery(),
    buildWeeklyDiscover(),
    buildMyMixSlots(),
  ]);
  const releaseRadar = buildReleaseRadar(releases);

  cachedBundle = {
    daily,
    weekly,
    releaseRadar,
    myMixes,
    genreChips: getWeeklyMixGenreChips(5),
    dailyPeriod,
    weeklyPeriod,
  };
  return cachedBundle;
}

export function invalidateMadeForYouCache(): void {
  cachedBundle = null;
}

/** Sync read of cached MFY mix tracks (locker-resolved) for mix-radio continuation. */
export function resolveDiscoveryMixFromCacheSync(
  kind: DiscoveryMixKind,
  id: string,
): DiscoveryMix | null {
  const cache = readCache();
  const locker = getLockerEntriesSnapshot() ?? [];

  const resolveTrackList = (ids: string[], meta: Omit<DiscoveryMix, 'tracks'>): DiscoveryMix | null => {
    const tracks = resolveEnvelopeIdsToTracks(ids, locker).filter(
      (t) => t.url?.trim() && !isEnvelopeSuppressed(t),
    );
    if (tracks.length === 0) return null;
    return { ...meta, tracks };
  };

  switch (kind) {
    case 'daily-discovery':
      return resolveTrackList(cache.dailyEnvelopeIds, {
        id: 'daily-discovery',
        kind,
        title: 'Daily Discovery',
        subtitle: 'Daily refresh',
        generatedAt: cache.dailyGeneratedAt,
      });
    case 'weekly-discover':
      return resolveTrackList(cache.weeklyEnvelopeIds, {
        id: 'weekly-discover',
        kind,
        title: 'Weekly Discover',
        subtitle: cache.weeklyGenre || 'Weekly refresh',
        generatedAt: cache.weeklyGeneratedAt,
      });
    case 'release-radar':
      return resolveTrackList(cache.releaseRadarEnvelopeIds, {
        id: 'release-radar',
        kind,
        title: 'Release Radar',
        subtitle: 'Recent from artists you follow',
        generatedAt: cache.releaseRadarGeneratedAt,
      });
    case 'my-mix': {
      const slotMatch = /^my-mix-(\d+)$/.exec(id);
      const slotNum = slotMatch ? parseInt(slotMatch[1]!, 10) : NaN;
      const slot = cache.myMixSlots.find((s) => s.slot === slotNum);
      if (!slot) return null;
      return resolveTrackList(slot.envelopeIds, {
        id,
        kind,
        title: `My ${slot.genre} Mix`,
        subtitle: slot.genre,
        generatedAt: slot.generatedAt,
      });
    }
    default:
      return null;
  }
}

/** @deprecated Use buildDailyDiscovery */
export const buildDailyMix = buildDailyDiscovery;
/** @deprecated Use buildWeeklyDiscover */
export const buildWeeklyMix = buildWeeklyDiscover;
