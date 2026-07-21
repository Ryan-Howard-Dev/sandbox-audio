/**
 * Loyal Books RSS → audiobook catalog mapping (no network).
 */

import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';
import type { AudiobookRssParsedFeed } from './audiobookRssCore.js';
import { rssChaptersFromFeed, searchRssFeed } from './audiobookRssCore.js';
import type { LoyalbooksFeed } from './audiobookLoyalbooksFeeds.js';
import { loyalbooksFeedUrl } from './audiobookLoyalbooksFeeds.js';

function remapBookSource(_book: AudiobookCatalogBook, feed: LoyalbooksFeed): AudiobookCatalogBook {
  return {
    id: `loyalbooks:${feed.slug}`,
    sourceId: feed.slug,
    title: feed.title,
    author: feed.author,
    description: _book.description,
    artworkUrl: _book.artworkUrl,
    chapterCount: _book.chapterCount,
    durationSeconds: _book.durationSeconds,
    source: 'loyalbooks',
    detailUrl: loyalbooksFeedUrl(feed.slug),
    feedUrl: loyalbooksFeedUrl(feed.slug),
  };
}

function remapChapterSource(chapter: AudiobookCatalogChapter): AudiobookCatalogChapter {
  return {
    ...chapter,
    bookId: chapter.bookId.replace(/^rss:/, 'loyalbooks:'),
    source: 'loyalbooks',
  };
}

export function searchLoyalbooksFeed(
  feed: AudiobookRssParsedFeed,
  query: string,
  meta: LoyalbooksFeed,
): AudiobookCatalogBook[] {
  const curated = {
    url: loyalbooksFeedUrl(meta.slug),
    label: meta.title,
    kind: 'book' as const,
    author: meta.author,
  };
  return searchRssFeed(feed, query, 'book', curated).map((book) => remapBookSource(book, meta));
}

export function loyalbooksChaptersFromFeed(
  meta: LoyalbooksFeed,
  feed: AudiobookRssParsedFeed,
): AudiobookCatalogChapter[] {
  const book: AudiobookCatalogBook = {
    id: `loyalbooks:${meta.slug}`,
    sourceId: meta.slug,
    title: meta.title,
    author: meta.author,
    source: 'loyalbooks',
    feedUrl: loyalbooksFeedUrl(meta.slug),
  };
  return rssChaptersFromFeed(book, feed).map(remapChapterSource);
}

export function loyalbooksBookFromFeed(
  meta: LoyalbooksFeed,
  feed: AudiobookRssParsedFeed,
): AudiobookCatalogBook {
  const ordered = [...feed.episodes].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true }),
  );
  const duration = ordered.reduce((acc, ep) => acc + (ep.durationSeconds ?? 0), 0);
  return {
    id: `loyalbooks:${meta.slug}`,
    sourceId: meta.slug,
    title: meta.title,
    author: meta.author,
    description: feed.description,
    artworkUrl: feed.artworkUrl,
    chapterCount: ordered.length || undefined,
    durationSeconds: duration > 0 ? duration : undefined,
    source: 'loyalbooks',
    detailUrl: loyalbooksFeedUrl(meta.slug),
    feedUrl: loyalbooksFeedUrl(meta.slug),
  };
}
