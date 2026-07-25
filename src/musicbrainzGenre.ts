/**
 * Keyless sub-genre lookup via MusicBrainz. Used so genre shelves get real
 * sub-genres (Trap, Boom Bap, Nu Metal) with zero setup — Last.fm needs an API
 * key, and iTunes only ever returns coarse top-level buckets.
 *
 * MusicBrainz asks clients to stay under ~1 request/second, so every call goes
 * through a serial queue with spacing.
 */
import { fetchWithTimeout } from './fetchWithTimeout';
import { splitGenreTags, type ResolvedGenre } from './genreSpecificity';

const MB_ENDPOINT = 'https://musicbrainz.org/ws/2';
const MIN_REQUEST_SPACING_MS = 1300;
const LOOKUP_TIMEOUT_MS = 9000;
const MAX_503_RETRIES = 3;

/** Sentinel — MusicBrainz was reachable-but-throttled (503) after all retries. */
export const MB_UNAVAILABLE = Symbol('mb-unavailable');
export type MbResult<T> = T | typeof MB_UNAVAILABLE | null;

let queueTail: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;

/** Serialise + space out MusicBrainz calls to respect their rate limit. */
function scheduleMb<T>(task: () => Promise<T>): Promise<T> {
  const run = queueTail.then(async () => {
    const wait = Math.max(0, MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestAt = Date.now();
    return task();
  });
  // Keep the chain alive even when a task rejects.
  queueTail = run.catch(() => undefined);
  return run;
}

async function mbJson<T>(path: string): Promise<MbResult<T>> {
  return scheduleMb(async () => {
    // MusicBrainz throttles anonymous clients with 503; back off and retry
    // rather than falling straight through to coarse genres.
    for (let attempt = 0; attempt <= MAX_503_RETRIES; attempt += 1) {
      try {
        const res = await fetchWithTimeout(
          `${MB_ENDPOINT}${path}`,
          { headers: { Accept: 'application/json' } },
          LOOKUP_TIMEOUT_MS,
        );
        if (res.status === 503) {
          if (attempt < MAX_503_RETRIES) {
            const backoff = 1500 * (attempt + 1);
            await new Promise((resolve) => setTimeout(resolve, backoff));
            continue;
          }
          console.warn(`[mbGenre] 503 after retries for ${path.slice(0, 50)}`);
          return MB_UNAVAILABLE;
        }
        if (!res.ok) {
          console.warn(`[mbGenre] HTTP ${res.status} for ${path.slice(0, 50)}`);
          return null;
        }
        return (await res.json()) as T;
      } catch (err) {
        if (attempt < MAX_503_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
          continue;
        }
        console.warn(`[mbGenre] fetch threw for ${path.slice(0, 50)}`, err);
        return MB_UNAVAILABLE;
      }
    }
    return MB_UNAVAILABLE;
  });
}

type MbGenre = { name?: string; count?: number };

function topGenreName(genres: MbGenre[] | undefined): ResolvedGenre | null {
  if (!Array.isArray(genres) || genres.length === 0) return null;
  const ranked = [...genres].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  // Split into umbrella + specific: "hip hop" almost always outranks
  // "trap"/"cloud rap", which would otherwise collapse every rapper into one shelf.
  return splitGenreTags(ranked.map((g) => g.name));
}

/** Lucene-escape a value going into a MusicBrainz query string. */
function escapeQuery(value: string): string {
  return value.replace(/["\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Artist-only MusicBrainz genres (2 requests) — used by per-artist enrichment.
 * Returns MB_UNAVAILABLE when MusicBrainz throttled us (503), so the caller can
 * fall back to a coarse genre now yet retry for a real sub-genre next launch.
 */
export async function getMusicBrainzArtistGenre(
  artist: string,
): Promise<MbResult<ResolvedGenre>> {
  const name = artist.trim();
  if (!name) return null;

  const query = `artist:"${escapeQuery(name)}"`;
  const search = await mbJson<{ artists?: Array<{ id?: string }> }>(
    `/artist?query=${encodeURIComponent(query)}&fmt=json&limit=1`,
  );
  if (search === MB_UNAVAILABLE) return MB_UNAVAILABLE;
  const id = search?.artists?.[0]?.id;
  if (!id) return null;

  const detail = await mbJson<{ genres?: MbGenre[] }>(`/artist/${id}?inc=genres&fmt=json`);
  if (detail === MB_UNAVAILABLE) return MB_UNAVAILABLE;
  return topGenreName(detail?.genres);
}
