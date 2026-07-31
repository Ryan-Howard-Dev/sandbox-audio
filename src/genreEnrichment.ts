/**
 * Backfill real musical genres onto locker tracks that were stamped with the
 * catalog-download sentinel ("Downloaded") or left blank. Looks up the album's
 * (or artist's) primary genre on the keyless iTunes Search API and writes it to
 * the vault, so the Locker → Genres tab and weekly genre mixes have real buckets
 * instead of one "Downloaded" pile.
 */
import { ITUNES_SEARCH } from './catalogDirect';
import { getLastFmGenre } from './lastfmSimilar';
import { getMusicBrainzArtistGenre, MB_UNAVAILABLE } from './musicbrainzGenre';
import type { ResolvedGenre } from './genreSpecificity';
import { fetchWithTimeout } from './fetchWithTimeout';
import type { LockerEntry } from './lockerStorage';
import { refreshLockerCache, updateLockerEntryMetadata } from './lockerStorage';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

// v3: genres now split into a coarse `genre` + specific `subGenre`, so the older
// caches (single coarse string) must be discarded and every album re-resolved.
const CACHE_KEY = 'sandbox_genre_enrich_cache_v5';
const VERSION_KEY = 'sandbox_genre_enrich_version';
/** Bump to force a one-time re-enrichment of every album. */
const GENRE_ENRICH_VERSION = 6;
const GROUP_SEP = '␟';

function storedEnrichVersion(): number {
  const raw = Number(prefsGetItem(VERSION_KEY) ?? '0');
  return Number.isFinite(raw) ? raw : 0;
}

/**
 * True when this device still needs the one-time upgrade pass that replaces
 * coarse genres with Last.fm sub-genres.
 */
export function genreEnrichmentUpgradePending(): boolean {
  return storedEnrichVersion() < GENRE_ENRICH_VERSION;
}

/** True when anything still needs enriching (missing genres, or the upgrade). */
export function genreEnrichmentPending(entries: LockerEntry[]): boolean {
  if (genreEnrichmentUpgradePending()) return entries.length > 0;
  return entries.some(entryGenreIsMissing);
}

/** True when a locker entry has no usable genre and should be enriched. */
export function entryGenreIsMissing(entry: Pick<LockerEntry, 'genre'>): boolean {
  const g = (entry.genre ?? '').trim().toLowerCase();
  if (!g) return true;
  if (/^\(?\d+\)?$/.test(g)) return true;
  return /^(downloaded|music|unknown|other|genre)$/.test(g);
}

/**
 * Group by artist, not album. Artist-level lookups are far fewer requests (one
 * per artist, not per album) and MusicBrainz artist genres are much richer than
 * per-release-group tags — the difference between real sub-genres and a single
 * "hip hop" bucket.
 */
function groupKey(entry: LockerEntry): string {
  const artist = (entry.albumArtist || entry.artist || '').trim().toLowerCase();
  return `artist${GROUP_SEP}${artist || 'unknown'}`;
}

function loadCache(): Record<string, string> {
  try {
    const raw = prefsGetItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function saveCache(cache: Record<string, string>): void {
  try {
    prefsSetItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* non-fatal — enrichment just re-fetches next time */
  }
}

async function itunesGenreFor(term: string, entity: string): Promise<string | null> {
  if (!term.trim()) return null;
  const url =
    `${ITUNES_SEARCH}?term=${encodeURIComponent(term)}` +
    `&entity=${entity}&limit=1&media=music`;
  try {
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json' } },
      8000,
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ primaryGenreName?: string }> };
    const genre = data.results?.[0]?.primaryGenreName;
    if (typeof genre !== 'string') return null;
    const trimmed = genre.trim();
    // iTunes uses "Music" as a non-answer for some artist rows.
    if (!trimmed || /^music$/i.test(trimmed)) return null;
    return trimmed;
  } catch {
    return null;
  }
}

/**
 * Resolve a genre with a fallback chain. Last.fm community tags come first
 * because they carry real sub-genres (Trap, Boom Bap, Drill, Nu Metal) where
 * iTunes only ever returns a coarse top-level bucket ("Hip-Hop/Rap"). iTunes
 * then backstops albums Last.fm has no tags for.
 */
interface ArtistGenreOutcome {
  resolved: ResolvedGenre | null;
  /**
   * True when we returned a coarse genre only because MusicBrainz was throttled
   * (503) — a real sub-genre may exist, so retry on a later launch.
   */
  provisional: boolean;
}

async function resolveGenreForArtist(artist: string): Promise<ArtistGenreOutcome> {
  if (!artist) return { resolved: null, provisional: false };

  // Last.fm has the richest sub-genre tags, but needs an API key.
  const fromLastFm = await getLastFmGenre(artist).catch(() => null);
  if (fromLastFm?.subGenre) {
    console.info(`[genreEnrich] lastfm ${artist} → ${JSON.stringify(fromLastFm)}`);
    return { resolved: fromLastFm, provisional: false };
  }

  // MusicBrainz is keyless, so sub-genres still work with zero setup.
  const mb = await getMusicBrainzArtistGenre(artist).catch(() => MB_UNAVAILABLE);
  const mbUnavailable = mb === MB_UNAVAILABLE;
  const fromMusicBrainz: ResolvedGenre | null = mbUnavailable
    ? null
    : (mb as ResolvedGenre | null);
  if (fromMusicBrainz?.subGenre) {
    console.info(`[genreEnrich] mb ${artist} → ${JSON.stringify(fromMusicBrainz)}`);
    return { resolved: fromMusicBrainz, provisional: false };
  }

  // Coarse fallback so the shelf isn't empty; provisional if MB was throttled.
  const coarse = fromLastFm ?? fromMusicBrainz;
  const byArtist = await itunesGenreFor(artist, 'musicArtist');
  const resolved = coarse ?? (byArtist ? { genre: byArtist } : null);
  if (resolved) {
    console.info(
      `[genreEnrich] coarse ${artist} → ${JSON.stringify(resolved)}` +
        (mbUnavailable ? ' (MB throttled, will retry)' : ''),
    );
    return { resolved, provisional: mbUnavailable };
  }
  console.warn(`[genreEnrich] UNRESOLVED ${artist}${mbUnavailable ? ' (MB throttled)' : ''}`);
  return { resolved: null, provisional: mbUnavailable };
}

/** Serialise a resolved genre for the per-album cache. */
function encodeGenre(resolved: ResolvedGenre): string {
  return resolved.subGenre ? `${resolved.genre}␟${resolved.subGenre}` : resolved.genre;
}

function decodeGenre(raw: string): ResolvedGenre | null {
  if (!raw) return null;
  const [genre, subGenre] = raw.split('␟');
  if (!genre) return null;
  return subGenre ? { genre, subGenre } : { genre };
}

/** Run async tasks with a bounded concurrency pool. */
async function runPooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

let inFlight: Promise<number> | null = null;
/** Groups whose lookup failed this session — retried on the next app run. */
const failedThisSession = new Set<string>();

export interface EnrichLockerGenresResult {
  updated: number;
  groupsResolved: number;
}

/**
 * Enrich missing genres for the given locker entries. Cached per album/artist so
 * repeated calls only fetch new groups. Concurrency-limited so it never starves
 * playback. De-duped: concurrent callers share one in-flight run.
 */
export async function enrichLockerGenres(
  entries: LockerEntry[],
  options: { concurrency?: number; maxGroups?: number } = {},
): Promise<EnrichLockerGenresResult> {
  const { concurrency = 3, maxGroups = 250 } = options;

  // On the upgrade pass every album is re-resolved so coarse genres become
  // sub-genres. Tracks the user edited by hand are never overwritten.
  const upgrading = genreEnrichmentUpgradePending();
  const needing = upgrading
    ? entries.filter((e) => !e.userMetadataLocked)
    : entries.filter(entryGenreIsMissing);
  if (needing.length === 0) return { updated: 0, groupsResolved: 0 };

  // Bucket entries by album/artist group.
  const groups = new Map<string, LockerEntry[]>();
  for (const entry of needing) {
    const key = groupKey(entry);
    const bucket = groups.get(key);
    if (bucket) bucket.push(entry);
    else groups.set(key, [entry]);
  }

  const cache = loadCache();
  // Only positive results are cached. A failed lookup is retried on a later open
  // (network blips / catalogue gaps must not permanently strand an album).
  const pending = [...groups.keys()]
    .filter((key) => !cache[key] && !failedThisSession.has(key))
    .slice(0, maxGroups);

  if (inFlight) {
    // Another run is active; just await it and report from the refreshed cache.
    await inFlight;
  }

  // Genre to apply per group this pass (includes provisional coarse results that
  // aren't written to the long-term cache so they retry next launch).
  const applyByKey = new Map<string, ResolvedGenre>();
  for (const key of groups.keys()) {
    const cached = decodeGenre(cache[key] ?? '');
    if (cached) applyByKey.set(key, cached);
  }

  const run = (async (): Promise<number> => {
    if (pending.length > 0) {
      console.info(`[genreEnrich] resolving ${pending.length} artists…`);
      await runPooled(pending, concurrency, async (key) => {
        const sample = groups.get(key)?.[0];
        if (!sample) return;
        const artist = (sample.albumArtist || sample.artist || '').trim();
        const { resolved, provisional } = await resolveGenreForArtist(artist);
        if (resolved) {
          applyByKey.set(key, resolved);
          // Only cache as final when it's a real answer — provisional coarse
          // results (MB throttled) stay uncached so they retry next launch.
          if (!provisional) cache[key] = encodeGenre(resolved);
        }
        if (!resolved || provisional) failedThisSession.add(key);
      });
      saveCache(cache);
    }

    // Apply resolved genres to the vault (single cache refresh at the end).
    // Never overwrite a genre the user set by hand.
    let updated = 0;
    for (const [key, bucket] of groups) {
      const resolved = applyByKey.get(key);
      if (!resolved) continue;
      for (const entry of bucket) {
        if (entry.userMetadataLocked) continue;
        try {
          await updateLockerEntryMetadata(
            entry.id,
            { genre: resolved.genre, subGenre: resolved.subGenre ?? '' },
            { skipCacheRefresh: true },
          );
          updated += 1;
        } catch {
          /* skip individual failures */
        }
      }
    }
    // Mark the upgrade done only when every artist has a *final* (non-provisional)
    // result — provisional coarse fallbacks must resume on the next launch.
    const stillUnresolved = [...groups.keys()].some((key) => !cache[key]);
    if (upgrading && !stillUnresolved) {
      try {
        prefsSetItem(VERSION_KEY, String(GENRE_ENRICH_VERSION));
      } catch {
        /* non-fatal */
      }
    }
    console.info(
      `[genreEnrich] applied genres to ${updated} tracks; ` +
        `${stillUnresolved ? 'more pending next launch' : 'all artists resolved'}`,
    );
    if (updated > 0) await refreshLockerCache();
    return updated;
  })();

  inFlight = run;
  try {
    const updated = await run;
    const groupsResolved = [...groups.keys()].filter((key) => Boolean(cache[key])).length;
    return { updated, groupsResolved };
  } finally {
    if (inFlight === run) inFlight = null;
  }
}
