/**
 * "About this book" for device-scanned audiobooks.
 *
 * Books scanned off the device carry only what file tags hold — title, author, chapters,
 * duration, cover. There is no synopsis in the data at all, so the detail page had nothing to
 * show. This looks one up by title + author and caches it, so the lookup happens once per book
 * rather than on every open.
 *
 * Google Books answers title+author in a single request and needs no API key. Air-gap mode is
 * honoured: no network call is attempted, and the page simply stays without a description.
 */

import { isAirGapEnabled } from './airGapMode';
import { fetchWithTimeout } from './fetchWithTimeout';

const CACHE_KEY = 'sandbox_audiobook_descriptions_v1';
const LOOKUP_TIMEOUT_MS = 8000;
/** Cache misses too, so a book with genuinely no entry is not re-fetched on every open. */
const MISS = '';

type DescriptionCache = Record<string, string>;

export function audiobookDescriptionKey(title: string, author: string): string {
  return `${title.trim().toLowerCase()}|${author.trim().toLowerCase()}`;
}

function readCache(): DescriptionCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DescriptionCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeCache(cache: DescriptionCache): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
  } catch {
    /* quota — a missing description is not worth failing over */
  }
}

export function getCachedAudiobookDescription(title: string, author: string): string | null {
  const hit = readCache()[audiobookDescriptionKey(title, author)];
  return hit === undefined ? null : hit;
}

export function cacheAudiobookDescription(
  title: string,
  author: string,
  description: string,
): void {
  const cache = readCache();
  cache[audiobookDescriptionKey(title, author)] = description;
  writeCache(cache);
}

/** Pull the first usable volume description out of a Google Books response. */
export function parseGoogleBooksDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items)) return null;
  for (const item of items) {
    const info = (item as { volumeInfo?: { description?: unknown } })?.volumeInfo;
    const description = info?.description;
    if (typeof description === 'string' && description.trim()) {
      return description.trim();
    }
  }
  return null;
}

const JUNK_AUTHORS = new Set(['', 'unknown', 'unknown author', 'various', 'va', 'n/a']);
const FILE_NOISE =
  /\b(un)?abridged\b|\bfull audiobook\b|\baudio ?book\b|\bpart \d+\b|\bcomplete\b/gi;

/**
 * Device files name themselves, not their contents: titles arrive as
 * "Underworld The Mysterious Origins Of Civilization by Graham Hancock" with the author field
 * holding the uploader ("motivator8") or nothing at all. Searching those verbatim returns zero
 * results, which is why books with clean tags resolved and scanned files did not.
 */
export function normalizeBookQuery(title: string, author: string): string {
  let work = title
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/[._]+/g, ' ')
    // Split run-together names like "TheSacredMushroom" so the words are searchable.
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(FILE_NOISE, ' ');

  // "<Title> by <Author>" — the trailing name is more trustworthy than the metadata field.
  let credited = '';
  const byMatch = work.match(/^(.*?)\s+by\s+([^-–—|]+)$/i);
  if (byMatch?.[1]?.trim() && byMatch[2]?.trim()) {
    work = byMatch[1];
    credited = byMatch[2];
  }

  const tagged = author.trim();
  const useTagged = !JUNK_AUTHORS.has(tagged.toLowerCase());
  const who = credited.trim() || (useTagged ? tagged : '');

  return [work, who]
    .map((part) => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

export function buildOpenLibrarySearchUrl(title: string, author: string): string {
  // Free-text q, not title=/author=: the strict fields return nothing for filename-derived
  // titles, while q finds the work from the same words.
  const params = new URLSearchParams({
    q: normalizeBookQuery(title, author),
    limit: '5',
    fields: 'key',
  });
  return `https://openlibrary.org/search.json?${params.toString()}`;
}

/** First work key (`/works/OL…W`) from an Open Library search response. */
export function parseOpenLibraryWorkKey(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const docs = (payload as { docs?: unknown }).docs;
  if (!Array.isArray(docs)) return null;
  for (const doc of docs) {
    const key = (doc as { key?: unknown })?.key;
    if (typeof key === 'string' && key.trim().startsWith('/works/')) return key.trim();
  }
  return null;
}

export function buildOpenLibraryWorkUrl(workKey: string): string {
  return `https://openlibrary.org${workKey.trim()}.json`;
}

/** Open Library returns description as either a plain string or `{ type, value }`. */
export function parseOpenLibraryDescription(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const description = (payload as { description?: unknown }).description;
  if (typeof description === 'string' && description.trim()) return description.trim();
  if (description && typeof description === 'object') {
    const value = (description as { value?: unknown }).value;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function buildGoogleBooksQueryUrl(title: string, author: string): string {
  return `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(
    normalizeBookQuery(title, author),
  )}`;
}

/**
 * Resolve a description, preferring cache. Returns null when air-gapped, when nothing is
 * found, or on any network failure — callers render nothing rather than an error.
 */
export async function fetchAudiobookDescription(
  title: string,
  author: string,
): Promise<string | null> {
  const trimmedTitle = title?.trim() ?? '';
  if (!trimmedTitle) return null;

  const cached = getCachedAudiobookDescription(trimmedTitle, author);
  if (cached !== null) return cached === MISS ? null : cached;

  if (isAirGapEnabled()) return null;

  // Open Library first: open data, no key, and aligned with the Gutenberg / Archive providers
  // this app already leans on. Google Books stays as a fallback for modern titles Open Library
  // has catalogued but not described.
  const description =
    (await lookupOpenLibrary(trimmedTitle, author)) ??
    (await lookupGoogleBooks(trimmedTitle, author));

  // Only cache a definite answer. A network failure must not poison the cache with a miss.
  if (description !== undefined) {
    cacheAudiobookDescription(trimmedTitle, author, description ?? MISS);
  }
  return description ?? null;
}

/** `undefined` = lookup failed (do not cache); `null` = no description exists. */
async function getJson(url: string): Promise<unknown | undefined> {
  try {
    // fetchWithTimeout, not bare fetch: on device the WebView blocks cross-origin requests,
    // and this routes through native HTTP (and honours the air-gap block).
    const res = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/json' } },
      LOOKUP_TIMEOUT_MS,
    );
    if (!res.ok) return undefined;
    return await res.json();
  } catch {
    return undefined;
  }
}

async function lookupOpenLibrary(
  title: string,
  author: string,
): Promise<string | null | undefined> {
  const search = await getJson(buildOpenLibrarySearchUrl(title, author));
  if (search === undefined) return undefined;
  const workKey = parseOpenLibraryWorkKey(search);
  if (!workKey) return null;
  const work = await getJson(buildOpenLibraryWorkUrl(workKey));
  if (work === undefined) return undefined;
  return parseOpenLibraryDescription(work);
}

async function lookupGoogleBooks(
  title: string,
  author: string,
): Promise<string | null | undefined> {
  const payload = await getJson(buildGoogleBooksQueryUrl(title, author));
  if (payload === undefined) return undefined;
  return parseGoogleBooksDescription(payload);
}
