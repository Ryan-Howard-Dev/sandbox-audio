/**
 * Cross-format search coordinator.
 *
 * Each pillar keeps its own dedicated search engine; this fans out to all of them in
 * parallel and normalises the results into one shape so a single query can answer
 * "what do I have / can I get across music, podcasts and audiobooks".
 *
 * Design rules:
 * - `Promise.allSettled` + a per-source timeout, so one slow provider (the audiobook
 *   scrapers are the usual culprit) can never stall the other formats.
 * - Each format is returned separately; the UI decides how to group and how many to show.
 * - Nothing here replaces the per-format searches — it drives them.
 */

import {
  fetchTrendingPodcastShows,
  searchPodcastCatalogShows,
  type PodcastCatalogShow,
} from './podcastCatalog';
import { searchAudiobookCatalog, type AudiobookCatalogBook } from './audiobookCatalog';
import {
  searchArchiveOrgAudiobooks,
  type ArchiveAudiobookHit,
} from './archiveOrgSearch';
import { getLockerEntriesSnapshot, normalizeLockerKeyPart } from './lockerStorage';
import type { LockerEntry } from './lockerStorage';

export type UniversalFormat = 'music' | 'podcast' | 'audiobook';

export interface UniversalHit {
  format: UniversalFormat;
  id: string;
  title: string;
  subtitle: string;
  artworkUrl?: string;
  /** True when this is already in the user's library (locker / subscribed / downloaded). */
  owned?: boolean;
  /** Original row, for the per-format handlers to act on. */
  payload?: unknown;
}

export interface UniversalSearchResults {
  query: string;
  music: UniversalHit[];
  podcast: UniversalHit[];
  audiobook: UniversalHit[];
  /** Formats whose search failed or timed out (UI can show a quiet retry). */
  failed: UniversalFormat[];
}

const SOURCE_TIMEOUT_MS = 9_000;

function withTimeout<T>(p: Promise<T>, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, SOURCE_TIMEOUT_MS);
    void p
      .then((v) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/** Locker matches — instant, offline, and the most relevant thing for an owned library. */
export function searchLockerForUniversal(query: string, limit = 8): UniversalHit[] {
  const q = normalizeLockerKeyPart(query);
  if (!q) return [];
  const entries: LockerEntry[] = getLockerEntriesSnapshot() ?? [];
  const hits: UniversalHit[] = [];
  for (const entry of entries) {
    const haystack = normalizeLockerKeyPart(
      `${entry.title ?? ''} ${entry.artist ?? ''} ${entry.albumName ?? ''}`,
    );
    if (!haystack.includes(q)) continue;
    hits.push({
      format: 'music',
      id: `locker-${entry.id}`,
      title: entry.title ?? '',
      subtitle: [entry.artist, entry.albumName].filter(Boolean).join(' · '),
      artworkUrl: entry.albumArt,
      owned: true,
      payload: entry,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function podcastToHit(show: PodcastCatalogShow): UniversalHit {
  return {
    format: 'podcast',
    id: `podcast-${show.id}`,
    title: show.title,
    subtitle: show.author || 'Podcast',
    artworkUrl: show.artworkUrl,
    payload: show,
  };
}

function archiveBookToHit(book: ArchiveAudiobookHit): UniversalHit {
  return {
    format: 'audiobook',
    id: `audiobook-archive-${book.identifier}`,
    title: book.title,
    subtitle: book.author || 'Audiobook',
    artworkUrl: book.artworkUrl,
    payload: book,
  };
}

function audiobookToHit(book: AudiobookCatalogBook): UniversalHit {
  return {
    format: 'audiobook',
    id: `audiobook-${book.source}-${book.sourceId}`,
    title: book.title,
    subtitle: book.author || 'Audiobook',
    artworkUrl: book.artworkUrl,
    payload: book,
  };
}

/**
 * Run one query across all three pillars.
 *
 * `musicSearch` is injected because the music catalog search lives in searchCatalog.ts,
 * which pulls in a large dependency graph — the caller passes the function it already has
 * so this module stays cheap to import.
 */
export async function searchEverything(
  query: string,
  musicSearch?: (q: string) => Promise<UniversalHit[]>,
  options?: { limitPerFormat?: number },
): Promise<UniversalSearchResults> {
  const q = query.trim();
  const limit = options?.limitPerFormat ?? 8;
  const empty: UniversalSearchResults = {
    query: q,
    music: [],
    podcast: [],
    audiobook: [],
    failed: [],
  };
  if (q.length < 2) return empty;

  const failed: UniversalFormat[] = [];
  const SENTINEL = Symbol('failed');

  const [musicRes, podcastRes, audiobookRes] = await Promise.all([
    withTimeout<UniversalHit[] | typeof SENTINEL>(
      musicSearch ? musicSearch(q) : Promise.resolve([]),
      SENTINEL,
    ),
    withTimeout<PodcastCatalogShow[] | typeof SENTINEL>(
      searchPodcastCatalogShows(q, limit),
      SENTINEL,
    ),
    // archive.org first: librivox.org's own API takes ~11s and gutendex times out, so the
    // mirrored collections on archive.org (~1s) are the only reliable audiobook source.
    withTimeout<ArchiveAudiobookHit[] | typeof SENTINEL>(
      searchArchiveOrgAudiobooks(q, limit).then((rows) =>
        rows.length > 0
          ? rows
          : searchAudiobookCatalog(q, limit).then((legacy) =>
              legacy.map((b) => ({
                identifier: b.sourceId,
                title: b.title,
                author: b.author,
                artworkUrl: b.artworkUrl ?? '',
              })),
            ),
      ),
      SENTINEL,
    ),
  ]);

  // Locker results always lead the music column — they are owned and need no network.
  const lockerHits = searchLockerForUniversal(q, Math.min(limit, 5));
  let music = lockerHits;
  if (musicRes === SENTINEL) {
    failed.push('music');
  } else {
    const ownedIds = new Set(lockerHits.map((h) => normalizeLockerKeyPart(h.title)));
    music = [
      ...lockerHits,
      ...musicRes.filter((h) => !ownedIds.has(normalizeLockerKeyPart(h.title))),
    ].slice(0, limit);
  }

  if (podcastRes === SENTINEL) failed.push('podcast');
  if (audiobookRes === SENTINEL) failed.push('audiobook');

  return {
    query: q,
    music,
    podcast: podcastRes === SENTINEL ? [] : podcastRes.slice(0, limit).map(podcastToHit),
    audiobook:
      audiobookRes === SENTINEL ? [] : audiobookRes.slice(0, limit).map(archiveBookToHit),
    failed,
  };
}

/**
 * Idle browse rows for a non-music format.
 *
 * Music already has Quick Picks / Genres to show before anything is typed; Pods and Books
 * had nothing, so switching to those tabs on an empty query looked broken. Trending shows
 * and featured books give each pillar the same "something to browse" starting point.
 */
export async function browseFormatIdle(
  format: UniversalFormat,
  limit = 10,
): Promise<UniversalHit[]> {
  if (format === 'podcast') {
    const shows = await withTimeout(fetchTrendingPodcastShows(limit), [] as PodcastCatalogShow[]);
    return shows.slice(0, limit).map(podcastToHit);
  }
  if (format === 'audiobook') {
    // Empty query = archive.org's most-downloaded-this-week LibriVox items, which makes a
    // reasonable "featured" shelf without needing a separate trending endpoint.
    const books = await withTimeout(
      searchArchiveOrgAudiobooks('', limit),
      [] as ArchiveAudiobookHit[],
    );
    return books.slice(0, limit).map(archiveBookToHit);
  }
  return [];
}

/**
 * Taste-driven rows for the non-music pillars.
 *
 * Mirrors tasteDiscover.ts's shape — seed from what the user already has, expand, then
 * exclude what they own — but seeds from the right signal per format: subscribed shows for
 * podcasts, owned authors for books. Falls back to the generic trending/featured rows when
 * there is no signal yet, so a new install is never empty.
 */
export async function buildFormatTasteRows(
  format: UniversalFormat,
  seeds: string[],
  ownedKeys: Set<string>,
  limit = 10,
): Promise<UniversalHit[]> {
  if (seeds.length === 0) return browseFormatIdle(format, limit);

  // Rotate the seed each day so the row is not identical every visit.
  const day = Math.floor(Date.now() / 86_400_000);
  const ordered = seeds.map((s, i) => seeds[(i + day) % seeds.length]!);
  const picked: UniversalHit[] = [];
  const seen = new Set<string>();

  for (const seed of ordered.slice(0, 3)) {
    if (picked.length >= limit) break;
    const rows =
      format === 'podcast'
        ? await withTimeout(searchPodcastCatalogShows(seed, limit), [] as PodcastCatalogShow[]).then(
            (r) => r.map(podcastToHit),
          )
        : await withTimeout(
            searchArchiveOrgAudiobooks(seed, limit),
            [] as ArchiveAudiobookHit[],
          ).then((r) => r.map(archiveBookToHit));

    for (const hit of rows) {
      const key = normalizeLockerKeyPart(hit.title);
      // Recommendations, so skip anything already subscribed/owned.
      if (!key || seen.has(key) || ownedKeys.has(key)) continue;
      seen.add(key);
      picked.push(hit);
      if (picked.length >= limit) break;
    }
  }
  return picked.length > 0 ? picked : browseFormatIdle(format, limit);
}

/** Total hits across formats — used to decide between "no results" and a spinner. */
export function totalUniversalHits(results: UniversalSearchResults): number {
  return results.music.length + results.podcast.length + results.audiobook.length;
}
