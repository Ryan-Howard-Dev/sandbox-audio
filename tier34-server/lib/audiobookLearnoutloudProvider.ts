/**
 * LearnOutLoud free audiobooks — catalog scrape + RSS chapter resolution.
 */

import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';
import { fetchPodcastFeedXml, podcastFeedUrlAllowed } from './podcastFeedProxy.js';
import { parsePodcastMirrorFeedXml } from './podcastMirrorParser.js';
import {
  fetchScrapeHtml,
  getOrBuildScrapeIndex,
  parseLearnoutloudCatalogPage,
  parseLearnoutloudRssFeedUrl,
  SCRAPE_FETCH_DELAY_MS,
  searchScrapeIndex,
  sleep,
} from './audiobookScrapeCore.js';

const CATALOG_BASE = 'https://www.learnoutloud.com/Free-Audiobooks';
const INDEX_PAGES = 6;

async function buildLearnoutloudIndex() {
  const entries = [];
  for (let page = 1; page <= INDEX_PAGES; page += 1) {
    const url = page === 1 ? CATALOG_BASE : `${CATALOG_BASE}/Page${page}`;
    const html = await fetchScrapeHtml(url);
    if (html) entries.push(...parseLearnoutloudCatalogPage(html));
    if (page < INDEX_PAGES) await sleep(SCRAPE_FETCH_DELAY_MS);
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

export async function searchLearnoutloudAudiobooks(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const index = await getOrBuildScrapeIndex('learnoutloud', buildLearnoutloudIndex);
  return searchScrapeIndex(index, query, 'learnoutloud', limit);
}

async function chaptersFromRss(
  bookUrl: string,
  feedUrl: string,
): Promise<AudiobookCatalogChapter[]> {
  if (!podcastFeedUrlAllowed(feedUrl)) return [];
  const { status, body } = await fetchPodcastFeedXml(feedUrl);
  if (status < 200 || status >= 300) return [];
  const parsed = parsePodcastMirrorFeedXml(body, feedUrl);
  const bookId = `learnoutloud:${hashUrl(bookUrl)}`;
  return parsed.episodes
    .filter((ep) => ep.audioUrl?.trim())
    .map((ep, index) => ({
      id: ep.id || String(index + 1),
      bookId,
      title: ep.title.trim() || `Chapter ${index + 1}`,
      audioUrl: ep.audioUrl.trim(),
      durationSeconds: ep.durationSeconds,
      chapterNumber: index + 1,
      source: 'learnoutloud' as const,
    }));
}

function hashUrl(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export async function fetchLearnoutloudChapters(detailUrl: string): Promise<AudiobookCatalogChapter[]> {
  const url = detailUrl.trim();
  if (!url) return [];
  const html = await fetchScrapeHtml(url);
  if (!html) return [];
  const feedUrl = parseLearnoutloudRssFeedUrl(html);
  if (!feedUrl) return [];
  return chaptersFromRss(url, feedUrl);
}
