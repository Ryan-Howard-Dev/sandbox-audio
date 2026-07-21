/**
 * Project Gutenberg audio provider — client fallback via Gutendex.
 */

import {
  gutendexBookToCatalog,
  gutenbergChaptersFromIndex,
  pickGutenbergIndexUrl,
  type GutendexBook,
} from '../tier34-server/lib/audiobookGutenbergCore';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from '../tier34-server/lib/audiobookRssCore';

const GUTENDEX_API = 'https://gutendex.com/books/';

export async function searchGutenbergAudiobooksClient(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const url = `${GUTENDEX_API}?search=${encodeURIComponent(q)}&mime_type=audio%2Fmpeg&page_size=${Math.min(limit, 32)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: GutendexBook[] };
    return (data.results ?? [])
      .map(gutendexBookToCatalog)
      .filter((b): b is AudiobookCatalogBook => b != null)
      .slice(0, limit);
  } catch {
    return [];
  }
}

export async function fetchGutenbergChaptersClient(
  book: AudiobookCatalogBook,
): Promise<AudiobookCatalogChapter[]> {
  const id = book.sourceId.trim();
  if (!id) return [];
  try {
    const res = await fetch(`${GUTENDEX_API}${id}/`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return [];
    const gutendex = (await res.json()) as GutendexBook;
    if (!gutendex.formats) return [];
    let indexText = '';
    const indexUrl = pickGutenbergIndexUrl(gutendex.formats);
    if (indexUrl) {
      try {
        const indexRes = await fetch(indexUrl, { signal: AbortSignal.timeout(20_000) });
        if (indexRes.ok) indexText = await indexRes.text();
      } catch {
        /* optional index */
      }
    }
    return gutenbergChaptersFromIndex(id, gutendex.formats, indexText);
  } catch {
    return [];
  }
}
