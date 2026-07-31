/**
 * Pure RSS → audiobook catalog mapping (no network).
 */

import type { AudiobookCuratedRssFeed, AudiobookRssFeedKind } from './audiobookRssFeeds.js';
import { subscriptionFeedUrlId } from './podcastMirrorIds.js';

export type AudiobookCatalogSource =
  | 'librivox'
  | 'archive'
  | 'rss'
  | 'gutenberg'
  | 'loyalbooks'
  | 'ravebooksearch'
  | 'learnoutloud'
  | 'lit2go'
  | 'goldenaudiobooks'
  | 'audiobooks4soul';

export interface AudiobookCatalogBook {
  id: string;
  title: string;
  author: string;
  description?: string;
  artworkUrl?: string;
  chapterCount?: number;
  durationSeconds?: number;
  source: AudiobookCatalogSource;
  sourceId: string;
  detailUrl?: string;
  feedUrl?: string;
  /** Source text, when the provider has one. Used to sanity-check the audio length. */
  textUrl?: string;
}

export interface AudiobookCatalogChapter {
  id: string;
  bookId: string;
  title: string;
  audioUrl: string;
  durationSeconds?: number;
  chapterNumber?: number;
  source: AudiobookCatalogSource;
}

export type AudiobookRssEpisode = {
  id: string;
  guid: string;
  title: string;
  description?: string;
  audioUrl: string;
  durationSeconds?: number;
  artworkUrl?: string;
  publishedAt?: number;
};

export type AudiobookRssParsedFeed = {
  feedId: string;
  feedUrl: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  episodes: AudiobookRssEpisode[];
};

function stripHtml(raw: string | undefined): string {
  if (!raw?.trim()) return '';
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesQuery(text: string | undefined, qLower: string): boolean {
  if (!text?.trim()) return false;
  return text.toLowerCase().includes(qLower);
}

function feedAuthor(feed: AudiobookRssParsedFeed, curated?: AudiobookCuratedRssFeed): string {
  return curated?.author?.trim() || feed.title.trim() || 'RSS';
}

function episodeBookId(feedId: string, episodeId: string): string {
  return `rss:${feedId}:${episodeId}`;
}

function bookIdForFeed(feedId: string): string {
  return `rss:${feedId}`;
}

function totalDuration(episodes: AudiobookRssEpisode[]): number | undefined {
  const sum = episodes.reduce((acc, ep) => acc + (ep.durationSeconds ?? 0), 0);
  return sum > 0 ? sum : undefined;
}

export function searchRssFeed(
  feed: AudiobookRssParsedFeed,
  query: string,
  kind: AudiobookRssFeedKind,
  curated?: AudiobookCuratedRssFeed,
): AudiobookCatalogBook[] {
  const q = query.trim();
  if (q.length < 2) return [];
  const qLower = q.toLowerCase();
  const author = feedAuthor(feed, curated);
  const feedId = feed.feedId;

  if (kind === 'book') {
    const channelHit =
      matchesQuery(feed.title, qLower) ||
      matchesQuery(author, qLower) ||
      matchesQuery(feed.description, qLower) ||
      matchesQuery(curated?.label, qLower);
    const chapterHit = feed.episodes.some(
      (ep) => matchesQuery(ep.title, qLower) || matchesQuery(ep.description, qLower),
    );
    if (!channelHit && !chapterHit) return [];

    const sorted = [...feed.episodes].sort((a, b) => {
      const aPub = a.publishedAt ?? 0;
      const bPub = b.publishedAt ?? 0;
      if (aPub !== bPub) return aPub - bPub;
      return a.title.localeCompare(b.title, undefined, { numeric: true });
    });
    return [
      {
        id: bookIdForFeed(feedId),
        sourceId: feedId,
        title: curated?.label?.trim() || feed.title.trim() || 'Audiobook',
        author,
        description: stripHtml(feed.description),
        artworkUrl: feed.artworkUrl,
        chapterCount: sorted.length || undefined,
        durationSeconds: totalDuration(sorted),
        source: 'rss',
        detailUrl: feed.feedUrl,
        feedUrl: feed.feedUrl,
      },
    ];
  }

  const out: AudiobookCatalogBook[] = [];
  for (const ep of feed.episodes) {
    if (
      !matchesQuery(ep.title, qLower) &&
      !matchesQuery(ep.description, qLower) &&
      !matchesQuery(feed.title, qLower)
    ) {
      continue;
    }
    out.push({
      id: episodeBookId(feedId, ep.id),
      sourceId: `${feedId}:${ep.id}`,
      title: ep.title.trim() || 'Story',
      author,
      description: stripHtml(ep.description),
      artworkUrl: ep.artworkUrl || feed.artworkUrl,
      chapterCount: 1,
      durationSeconds: ep.durationSeconds,
      source: 'rss',
      detailUrl: feed.feedUrl,
      feedUrl: feed.feedUrl,
    });
  }
  return out;
}

export function rssChaptersFromFeed(
  book: Pick<AudiobookCatalogBook, 'id' | 'sourceId' | 'feedUrl' | 'title' | 'artworkUrl'>,
  feed: AudiobookRssParsedFeed,
): AudiobookCatalogChapter[] {
  const feedId = subscriptionFeedUrlId(feed.feedUrl);
  const episodeKey = book.sourceId.includes(':')
    ? book.sourceId.slice(book.sourceId.indexOf(':') + 1)
    : null;

  if (episodeKey && book.sourceId.startsWith(`${feedId}:`)) {
    const ep = feed.episodes.find((e) => e.id === episodeKey);
    if (!ep) return [];
    return [
      {
        id: ep.id,
        bookId: book.id,
        title: ep.title.trim() || 'Chapter 1',
        audioUrl: ep.audioUrl,
        durationSeconds: ep.durationSeconds,
        chapterNumber: 1,
        source: 'rss',
      },
    ];
  }

  const ordered = [...feed.episodes].sort((a, b) => {
    const aPub = a.publishedAt ?? 0;
    const bPub = b.publishedAt ?? 0;
    if (aPub !== bPub) return aPub - bPub;
    return a.title.localeCompare(b.title, undefined, { numeric: true });
  });
  return ordered.map((ep, index) => ({
    id: ep.id,
    bookId: book.id,
    title: ep.title.trim() || `Chapter ${index + 1}`,
    audioUrl: ep.audioUrl,
    durationSeconds: ep.durationSeconds,
    chapterNumber: index + 1,
    source: 'rss' as const,
  }));
}

function catalogSourcePriority(source: AudiobookCatalogSource): number {
  // Prefer direct API / RSS sources over meta-search and scrape-index when titles collide.
  if (
    source === 'librivox' ||
    source === 'archive' ||
    source === 'rss' ||
    source === 'gutenberg' ||
    source === 'loyalbooks'
  ) {
    return 0;
  }
  if (
    source === 'learnoutloud' ||
    source === 'lit2go' ||
    source === 'goldenaudiobooks' ||
    source === 'audiobooks4soul'
  ) {
    return 1;
  }
  // ravebooksearch / unknown
  return 2;
}

export function dedupeAudiobookBooks(books: AudiobookCatalogBook[]): AudiobookCatalogBook[] {
  const seen = new Set<string>();
  const titleAuthorSeen = new Set<string>();
  const out: AudiobookCatalogBook[] = [];
  const sorted = [...books].sort(
    (a, b) => catalogSourcePriority(a.source) - catalogSourcePriority(b.source),
  );

  for (const book of sorted) {
    const key = `${book.source}:${normalizeTitleKey(book.title)}:${normalizeTitleKey(book.author)}`;
    const titleAuthorKey = `${normalizeTitleKey(book.title)}:${normalizeTitleKey(book.author)}`;
    if (seen.has(key)) continue;
    if (book.source === 'ravebooksearch' && titleAuthorSeen.has(titleAuthorKey)) continue;
    seen.add(key);
    titleAuthorSeen.add(titleAuthorKey);
    out.push(book);
  }
  return out;
}
