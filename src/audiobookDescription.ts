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

export function buildGoogleBooksQueryUrl(title: string, author: string): string {
  const terms = [`intitle:${title.trim()}`];
  if (author.trim()) terms.push(`inauthor:${author.trim()}`);
  return `https://www.googleapis.com/books/v1/volumes?maxResults=5&q=${encodeURIComponent(
    terms.join(' '),
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

  try {
    // fetchWithTimeout, not bare fetch: on device the WebView blocks a cross-origin request to
    // googleapis.com, and this routes through native HTTP (and honours the air-gap block).
    const res = await fetchWithTimeout(
      buildGoogleBooksQueryUrl(trimmedTitle, author),
      { headers: { Accept: 'application/json' } },
      LOOKUP_TIMEOUT_MS,
    );
    if (!res.ok) return null;
    const description = parseGoogleBooksDescription(await res.json());
    cacheAudiobookDescription(trimmedTitle, author, description ?? MISS);
    return description;
  } catch {
    return null;
  }
}
