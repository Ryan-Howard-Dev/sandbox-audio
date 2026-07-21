/**
 * USF Lit2Go — books catalog scrape + per-chapter MP3 resolution.
 */

import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';
import {
  fetchScrapeHtml,
  getOrBuildScrapeIndex,
  parseLit2goBookChapterLinks,
  parseLit2goBooksPage,
  parseLit2goChapterMp3,
  SCRAPE_FETCH_DELAY_MS,
  searchScrapeIndex,
  sleep,
} from './audiobookScrapeCore.js';

const BOOKS_URL = 'https://etc.usf.edu/lit2go/books/';
const CHAPTER_CONCURRENCY = 4;

async function buildLit2goIndex() {
  const html = await fetchScrapeHtml(BOOKS_URL);
  if (!html) return [];
  return parseLit2goBooksPage(html);
}

export async function searchLit2goAudiobooks(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const index = await getOrBuildScrapeIndex('lit2go', buildLit2goIndex);
  return searchScrapeIndex(index, query, 'lit2go', limit);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R | null>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const rows = await Promise.all(batch.map((item, offset) => fn(item, i + offset)));
    for (const row of rows) {
      if (row != null) out.push(row);
    }
    if (i + concurrency < items.length) await sleep(SCRAPE_FETCH_DELAY_MS);
  }
  return out;
}

export async function fetchLit2goChapters(bookUrl: string): Promise<AudiobookCatalogChapter[]> {
  const url = bookUrl.trim().replace(/\/?$/, '/');
  if (!url) return [];
  const html = await fetchScrapeHtml(url);
  if (!html) return [];
  const links = parseLit2goBookChapterLinks(html);
  if (links.length === 0) return [];

  const bookId = `lit2go:${url.match(/\/lit2go\/(\d+)\//)?.[1] ?? hashUrl(url)}`;
  const chapters = await mapWithConcurrency(links, CHAPTER_CONCURRENCY, async (link, index) => {
    const chapterHtml = await fetchScrapeHtml(link.url);
    if (!chapterHtml) return null;
    const audioUrl = parseLit2goChapterMp3(chapterHtml);
    if (!audioUrl) return null;
    return {
      id: link.url.split('/').filter(Boolean).pop() ?? String(index + 1),
      bookId,
      title: link.title || `Chapter ${index + 1}`,
      audioUrl,
      chapterNumber: index + 1,
      source: 'lit2go' as const,
    };
  });
  return chapters;
}

function hashUrl(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
