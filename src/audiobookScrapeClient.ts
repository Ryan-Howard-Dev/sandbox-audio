/**
 * On-device scrape-index providers — no Sandbox Server required.
 * Uses the phone/browser network stack (better chance vs Cloudflare than a datacenter IP).
 */

import { fetchPodcastFeed } from './podcastRss';
import { dedupeAudiobookBooks } from '../tier34-server/lib/audiobookRssCore';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookCatalog';
import {
  getOrBuildScrapeIndex,
  isCloudflareChallenge,
  parseAudiobooks4soulCatalogPage,
  parseGoldenSearchPage,
  parseLearnoutloudCatalogPage,
  parseLearnoutloudRssFeedUrl,
  parseLit2goBookChapterLinks,
  parseLit2goBooksPage,
  parseLit2goChapterMp3,
  parseSitemapLocs,
  parseWordPressPostMp3s,
  scrapeEntryToBook,
  searchScrapeIndex,
  sleep,
  SCRAPE_BROWSER_USER_AGENT,
  SCRAPE_FETCH_DELAY_MS,
} from '../tier34-server/lib/audiobookScrapeCore';

const LEARN_BASE = 'https://www.learnoutloud.com/Free-Audiobooks';
const LIT2GO_BOOKS = 'https://etc.usf.edu/lit2go/books/';
const GOLDEN = 'https://goldenaudiobooks.com';
const SOUL = 'https://audiobooks4soul.com';

async function fetchHtml(url: string, timeoutMs = 20_000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': SCRAPE_BROWSER_USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (isCloudflareChallenge(text)) return null;
    return text;
  } catch {
    return null;
  }
}

function hashUrl(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

async function buildLearnoutloudIndex() {
  const entries = [];
  for (let page = 1; page <= 4; page += 1) {
    const url = page === 1 ? LEARN_BASE : `${LEARN_BASE}/Page${page}`;
    const html = await fetchHtml(url);
    if (html) entries.push(...parseLearnoutloudCatalogPage(html));
    if (page < 4) await sleep(SCRAPE_FETCH_DELAY_MS);
  }
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}

export async function searchLearnoutloudClient(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const index = await getOrBuildScrapeIndex('client-learnoutloud', buildLearnoutloudIndex);
  return searchScrapeIndex(index, query, 'learnoutloud', limit);
}

export async function fetchLearnoutloudChaptersClient(
  detailUrl: string,
): Promise<AudiobookCatalogChapter[]> {
  const url = detailUrl.trim();
  if (!url) return [];
  const html = await fetchHtml(url);
  if (!html) return [];
  const feedUrl = parseLearnoutloudRssFeedUrl(html);
  if (!feedUrl) return [];
  try {
    const parsed = await fetchPodcastFeed(feedUrl);
    const bookId = `learnoutloud:${hashUrl(url)}`;
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
  } catch {
    return [];
  }
}

export async function searchLit2goClient(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const index = await getOrBuildScrapeIndex('client-lit2go', async () => {
    const html = await fetchHtml(LIT2GO_BOOKS);
    return html ? parseLit2goBooksPage(html) : [];
  });
  return searchScrapeIndex(index, query, 'lit2go', limit);
}

export async function fetchLit2goChaptersClient(bookUrl: string): Promise<AudiobookCatalogChapter[]> {
  const url = bookUrl.trim().replace(/\/?$/, '/');
  if (!url) return [];
  const html = await fetchHtml(url);
  if (!html) return [];
  const links = parseLit2goBookChapterLinks(html).slice(0, 40);
  const bookId = `lit2go:${url.match(/\/lit2go\/(\d+)\//)?.[1] ?? hashUrl(url)}`;
  const chapters: AudiobookCatalogChapter[] = [];
  for (let i = 0; i < links.length; i += 3) {
    const batch = links.slice(i, i + 3);
    const rows = await Promise.all(
      batch.map(async (link, offset) => {
        const chapterHtml = await fetchHtml(link.url);
        if (!chapterHtml) return null;
        const audioUrl = parseLit2goChapterMp3(chapterHtml);
        if (!audioUrl) return null;
        const index = i + offset;
        return {
          id: link.url.split('/').filter(Boolean).pop() ?? String(index + 1),
          bookId,
          title: link.title || `Chapter ${index + 1}`,
          audioUrl,
          chapterNumber: index + 1,
          source: 'lit2go' as const,
        } satisfies AudiobookCatalogChapter;
      }),
    );
    for (const row of rows) {
      if (row) chapters.push(row);
    }
    if (i + 3 < links.length) await sleep(SCRAPE_FETCH_DELAY_MS);
  }
  return chapters;
}

export async function searchGoldenAudiobooksClient(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [index, searchHtml] = await Promise.all([
    getOrBuildScrapeIndex('client-goldenaudiobooks', async () => {
      const xml = await fetchHtml(`${GOLDEN}/post-sitemap.xml`);
      return xml ? parseSitemapLocs(xml, 'goldenaudiobooks.com').slice(0, 2500) : [];
    }),
    fetchHtml(`${GOLDEN}/?s=${encodeURIComponent(q)}`),
  ]);
  const fromSearch = searchHtml
    ? parseGoldenSearchPage(searchHtml).map((entry) => scrapeEntryToBook(entry, 'goldenaudiobooks'))
    : [];
  const fromIndex = searchScrapeIndex(index, q, 'goldenaudiobooks', limit);
  return dedupeAudiobookBooks([...fromSearch, ...fromIndex]).slice(0, limit);
}

export async function fetchGoldenAudiobooksChaptersClient(
  postUrl: string,
): Promise<AudiobookCatalogChapter[]> {
  const url = postUrl.trim();
  if (!url) return [];
  const html = await fetchHtml(url);
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

export async function searchAudiobooks4soulClient(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const [index, searchHtml] = await Promise.all([
    getOrBuildScrapeIndex('client-audiobooks4soul', async () => {
      const urls = [`${SOUL}/`, `${SOUL}/audiobooks/`, `${SOUL}/category/audiobooks/`];
      const entries = [];
      for (const url of urls) {
        const html = await fetchHtml(url);
        if (html) entries.push(...parseAudiobooks4soulCatalogPage(html));
        await sleep(SCRAPE_FETCH_DELAY_MS);
      }
      const sitemap = await fetchHtml(`${SOUL}/sitemap.xml`);
      if (sitemap) entries.push(...parseSitemapLocs(sitemap, 'audiobooks4soul.com'));
      const seen = new Set<string>();
      return entries.filter((entry) => {
        const key = entry.url.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }),
    fetchHtml(`${SOUL}/?s=${encodeURIComponent(q)}`),
  ]);
  const fromSearch = searchHtml
    ? parseAudiobooks4soulCatalogPage(searchHtml).map((entry) =>
        scrapeEntryToBook(entry, 'audiobooks4soul'),
      )
    : [];
  const fromIndex = searchScrapeIndex(index, q, 'audiobooks4soul', limit);
  return dedupeAudiobookBooks([...fromSearch, ...fromIndex]).slice(0, limit);
}

export async function fetchAudiobooks4soulChaptersClient(
  postUrl: string,
): Promise<AudiobookCatalogChapter[]> {
  const url = postUrl.trim();
  if (!url) return [];
  const html = await fetchHtml(url);
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

/** Parallel on-device scrape search across all four catalogs. */
export async function searchScrapeAudiobooksClient(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const per = Math.max(3, Math.ceil(limit / 4));
  const batches = await Promise.all([
    searchLearnoutloudClient(query, per).catch(() => []),
    searchLit2goClient(query, per).catch(() => []),
    searchGoldenAudiobooksClient(query, per).catch(() => []),
    searchAudiobooks4soulClient(query, per).catch(() => []),
  ]);
  return dedupeAudiobookBooks(batches.flat()).slice(0, limit);
}
