/**
 * Project Gutenberg audio provider — Gutendex search + MP3 chapter resolution.
 */

import {
  gutendexBookToCatalog,
  gutenbergChaptersFromIndex,
  pickGutenbergIndexUrl,
  type GutendexBook,
} from './audiobookGutenbergCore.js';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';

const GUTENDEX_API = 'https://gutendex.com/books/';
const USER_AGENT = 'SandboxTier34/1.0';

async function fetchGutendex(path: string): Promise<GutendexBook[] | GutendexBook | null> {
  const res = await fetch(`${GUTENDEX_API}${path}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  return (await res.json()) as GutendexBook[] | GutendexBook;
}

export async function searchGutenbergAudiobooks(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const url = `?search=${encodeURIComponent(q)}&mime_type=audio%2Fmpeg&page_size=${Math.min(limit, 32)}`;
  const data = (await fetchGutendex(url)) as { results?: GutendexBook[] } | null;
  if (!data || !('results' in data)) return [];
  return (data.results ?? [])
    .map(gutendexBookToCatalog)
    .filter((b): b is AudiobookCatalogBook => b != null)
    .slice(0, limit);
}

async function fetchGutenbergIndexText(formats: Record<string, string>): Promise<string> {
  const indexUrl = pickGutenbergIndexUrl(formats);
  if (!indexUrl) return '';
  try {
    const res = await fetch(indexUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

export async function fetchGutenbergChapters(sourceId: string): Promise<AudiobookCatalogChapter[]> {
  const id = sourceId.trim();
  if (!id) return [];
  const book = (await fetchGutendex(`${id}/`)) as GutendexBook | null;
  if (!book?.formats) return [];
  const indexText = await fetchGutenbergIndexText(book.formats);
  return gutenbergChaptersFromIndex(id, book.formats, indexText);
}
