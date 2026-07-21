/**
 * Audiobooks4Soul — catalog scrape (Cloudflare may block Tier34 fetch).
 */

import { dedupeAudiobookBooks } from './audiobookRssCore.js';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';
import {
  fetchScrapeHtml,
  getOrBuildScrapeIndex,
  parseAudiobooks4soulCatalogPage,
  parseSitemapLocs,
  parseWordPressPostMp3s,
  scrapeEntryToBook,
  searchScrapeIndex,
  sleep,
  SCRAPE_FETCH_DELAY_MS,
} from './audiobookScrapeCore.js';

const SITE = 'https://audiobooks4soul.com';

async function buildAudiobooks4soulIndex() {
  const urls = [`${SITE}/`, `${SITE}/audiobooks/`, `${SITE}/category/audiobooks/`];
  const entries = [];
  for (const url of urls) {
    const html = await fetchScrapeHtml(url, { browserUa: true });
    if (html) entries.push(...parseAudiobooks4soulCatalogPage(html));
    await sleep(SCRAPE_FETCH_DELAY_MS);
  }
  const sitemap = await fetchScrapeHtml(`${SITE}/sitemap.xml`, { browserUa: true });
  if (sitemap) entries.push(...parseSitemapLocs(sitemap, 'audiobooks4soul.com'));
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function searchAudiobooks4soul(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const index = await getOrBuildScrapeIndex('audiobooks4soul', buildAudiobooks4soulIndex);
  const searchHtml = await fetchScrapeHtml(`${SITE}/?s=${encodeURIComponent(query)}`, {
    browserUa: true,
  });
  const fromSearch = searchHtml
    ? parseAudiobooks4soulCatalogPage(searchHtml).map((entry) =>
        scrapeEntryToBook(entry, 'audiobooks4soul'),
      )
    : [];
  const fromIndex = searchScrapeIndex(index, query, 'audiobooks4soul', limit);
  return dedupeAudiobookBooks([...fromSearch, ...fromIndex]).slice(0, limit);
}

export async function fetchAudiobooks4soulChapters(postUrl: string): Promise<AudiobookCatalogChapter[]> {
  const url = postUrl.trim();
  if (!url) return [];
  const html = await fetchScrapeHtml(url, { browserUa: true });
  if (!html) return [];
  const tracks = parseWordPressPostMp3s(html);
  const bookId = `audiobooks4soul:${hashUrl(url)}`;
  return tracks.map((track, index) => ({
    id: String(index + 1),
    bookId,
    title: track.title,
    audioUrl: track.audioUrl,
    chapterNumber: index + 1,
    source: 'audiobooks4soul' as const,
  }));
}

function hashUrl(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
