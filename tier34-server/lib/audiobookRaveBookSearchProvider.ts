/**
 * RaveBookSearch meta-search provider — Cloudflare Worker JSON API with brief cache.
 */

import type { AudiobookCatalogBook } from './audiobookRssCore.js';
import {
  parseRaveBookSearchResults,
  type RaveBookSearchResult,
} from './audiobookRaveBookSearchCore.js';

const RAVE_WORKER_BASE = 'https://ravebooksearch.cloudflare-s3cvv.workers.dev';
const CACHE_TTL_MS = 5 * 60_000;

const searchCache = new Map<string, { expiresAt: number; books: AudiobookCatalogBook[] }>();

export async function searchRaveBookSearch(
  query: string,
  limit = 25,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const cacheKey = `${q.toLowerCase()}:${limit}`;
  const cached = searchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.books;

  try {
    const url = `${RAVE_WORKER_BASE}/search/all?q=${encodeURIComponent(q)}&mode=audiobooks`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      console.warn('[ravebooksearch] search HTTP', res.status);
      return [];
    }
    const data = (await res.json()) as { results?: RaveBookSearchResult[] };
    const books = parseRaveBookSearchResults(data.results ?? [], limit);
    searchCache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, books });
    return books;
  } catch (err) {
    console.warn('[ravebooksearch] search failed', err);
    return [];
  }
}

/** Test helper — clear in-memory search cache between unit tests. */
export function clearRaveBookSearchCache(): void {
  searchCache.clear();
}
