/**
 * Golden Audiobooks — sitemap index + WordPress post MP3 scrape.
 */

import { dedupeAudiobookBooks } from './audiobookRssCore.js';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';
import {
  fetchScrapeHtml,
  getOrBuildScrapeIndex,
  parseGoldenSearchPage,
  parseSitemapLocs,
  parseWordPressPostMp3s,
  scrapeEntryToBook,
  searchScrapeIndex,
} from './audiobookScrapeCore.js';

const SITE = 'https://goldenaudiobooks.com';
const SITEMAP_URL = `${SITE}/post-sitemap.xml`;

async function buildGoldenIndex() {
  const xml = await fetchScrapeHtml(SITEMAP_URL);
  if (!xml) return [];
  return parseSitemapLocs(xml, 'goldenaudiobooks.com').slice(0, 2500);
}

export async function searchGoldenAudiobooks(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [index, searchHtml] = await Promise.all([
    getOrBuildScrapeIndex('goldenaudiobooks', buildGoldenIndex),
    fetchScrapeHtml(`${SITE}/?s=${encodeURIComponent(q)}`),
  ]);
  const fromSearch = searchHtml
    ? parseGoldenSearchPage(searchHtml).map((entry) => scrapeEntryToBook(entry, 'goldenaudiobooks'))
    : [];
  const fromIndex = searchScrapeIndex(index, q, 'goldenaudiobooks', limit);
  return dedupeAudiobookBooks([...fromSearch, ...fromIndex]).slice(0, limit);
}

export async function fetchGoldenAudiobooksChapters(postUrl: string): Promise<AudiobookCatalogChapter[]> {
  const url = postUrl.trim();
  if (!url) return [];
  const html = await fetchScrapeHtml(url);
  if (!html) return [];
  const tracks = parseWordPressPostMp3s(html);
  const bookId = `goldenaudiobooks:${hashUrl(url)}`;
  return tracks.map((track, index) => ({
    id: String(index + 1),
    bookId,
    title: track.title,
    audioUrl: track.audioUrl,
    chapterNumber: index + 1,
    source: 'goldenaudiobooks' as const,
  }));
}

function hashUrl(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
