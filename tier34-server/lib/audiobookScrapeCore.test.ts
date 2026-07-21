import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
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
  searchScrapeIndex,
} from './audiobookScrapeCore.js';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

function fixture(name: string): string {
  return readFileSync(join(fixtureDir, name), 'utf8');
}

describe('audiobookScrapeCore parsers', () => {
  it('parses LearnOutLoud catalog listings', () => {
    const html = fixture('learnoutloud-catalog.snippet.html');
    const books = parseLearnoutloudCatalogPage(html);
    expect(books.length).toBeGreaterThanOrEqual(1);
    expect(books[0]?.title).toBe('Think and Grow Rich');
    expect(books[0]?.author).toContain('Napoleon Hill');
    expect(books[0]?.url).toContain('Think-and-Grow-Rich');
  });

  it('extracts LearnOutLoud podcast RSS feed URL', () => {
    const html = fixture('learnoutloud-rss.snippet.html');
    expect(parseLearnoutloudRssFeedUrl(html)).toBe('http://librivox.org/rss/243');
  });

  it('parses Lit2Go books index', () => {
    const html = fixture('lit2go-books.snippet.html');
    const books = parseLit2goBooksPage(html);
    expect(books.some((b) => b.title.includes('Tom Sawyer'))).toBe(true);
    expect(books.find((b) => b.title.includes('Tom Sawyer'))?.author).toContain('Mark Twain');
  });

  it('parses Lit2Go chapter links and MP3 URLs', () => {
    const bookHtml = fixture('lit2go-book.snippet.html');
    const chapters = parseLit2goBookChapterLinks(bookHtml);
    expect(chapters[0]?.title).toBe('Preface');
    expect(chapters[1]?.title).toBe('Chapter 1');

    const chapterHtml = fixture('lit2go-chapter.snippet.html');
    expect(parseLit2goChapterMp3(chapterHtml)).toContain('the-adventures-of-tom-sawyer-001-preface.5429.mp3');
  });

  it('parses Golden Audiobooks sitemap and post MP3s', () => {
    const sitemap = fixture('golden-sitemap.snippet.xml');
    const entries = parseSitemapLocs(sitemap, 'goldenaudiobooks.com');
    expect(entries.some((e) => e.url.includes('pride-book'))).toBe(true);

    const postHtml = fixture('golden-post.snippet.html');
    const tracks = parseWordPressPostMp3s(postHtml);
    expect(tracks.length).toBeGreaterThanOrEqual(2);
    expect(tracks[0]?.audioUrl).toContain('01.mp3');
  });

  it('searches scrape index entries', () => {
    const html = fixture('lit2go-books.snippet.html');
    const books = parseLit2goBooksPage(html);
    const hits = searchScrapeIndex(books, 'sawyer', 'lit2go', 5);
    expect(hits[0]?.source).toBe('lit2go');
    expect(hits[0]?.title.toLowerCase()).toContain('sawyer');
  });

  it('parses Golden search results page', () => {
    const html = fixture('golden-search.snippet.html');
    const rows = parseGoldenSearchPage(html);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.url).toContain('goldenaudiobooks.com');
  });

  it('parses Audiobooks4Soul catalog links and skips category pages', () => {
    const html = fixture('audiobooks4soul-catalog.snippet.html');
    const rows = parseAudiobooks4soulCatalogPage(html);
    expect(rows.some((r) => r.title.includes('Great Gatsby'))).toBe(true);
    expect(rows.some((r) => r.url.includes('/category/'))).toBe(false);
    const hits = searchScrapeIndex(rows, 'gatsby', 'audiobooks4soul', 5);
    expect(hits[0]?.source).toBe('audiobooks4soul');
  });

  it('detects Cloudflare challenge pages', () => {
    expect(isCloudflareChallenge('<title>Just a moment...</title><script>cf-chl</script>')).toBe(true);
    expect(isCloudflareChallenge('<html><body>Normal page</body></html>')).toBe(false);
  });
});
