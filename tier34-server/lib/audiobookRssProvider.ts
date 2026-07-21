/**
 * Audiobook RSS provider — Tier34 server (curated feeds).
 */

import { AUDIOBOOK_CURATED_RSS_FEEDS, type AudiobookCuratedRssFeed } from './audiobookRssFeeds.js';
import {
  rssChaptersFromFeed,
  searchRssFeed,
  type AudiobookCatalogBook,
  type AudiobookCatalogChapter,
  type AudiobookRssParsedFeed,
} from './audiobookRssCore.js';
import { subscriptionFeedUrlId } from './podcastMirrorIds.js';
import { fetchPodcastFeedXml, podcastFeedUrlAllowed } from './podcastFeedProxy.js';
import { parsePodcastMirrorFeedXml } from './podcastMirrorParser.js';

function mirrorFeedToRssFeed(parsed: ReturnType<typeof parsePodcastMirrorFeedXml>): AudiobookRssParsedFeed {
  return {
    feedId: parsed.feedId,
    feedUrl: parsed.feedUrl,
    title: parsed.title,
    description: parsed.description,
    artworkUrl: parsed.artworkUrl,
    episodes: parsed.episodes.map((ep) => ({
      id: ep.id,
      guid: ep.guid,
      title: ep.title,
      description: ep.description,
      audioUrl: ep.audioUrl,
      durationSeconds: ep.durationSeconds,
      artworkUrl: ep.artworkUrl,
      publishedAt: ep.publishedAt,
    })),
  };
}

async function fetchRssFeed(feedUrl: string): Promise<AudiobookRssParsedFeed | null> {
  if (!podcastFeedUrlAllowed(feedUrl)) return null;
  try {
    const { status, body } = await fetchPodcastFeedXml(feedUrl);
    if (status < 200 || status >= 300) return null;
    return mirrorFeedToRssFeed(parsePodcastMirrorFeedXml(body, feedUrl));
  } catch {
    return null;
  }
}

function curatedByUrl(url: string): AudiobookCuratedRssFeed | undefined {
  const normalized = url.trim().toLowerCase();
  return AUDIOBOOK_CURATED_RSS_FEEDS.find((f) => f.url.trim().toLowerCase() === normalized);
}

function curatedByFeedId(feedId: string): AudiobookCuratedRssFeed | undefined {
  return AUDIOBOOK_CURATED_RSS_FEEDS.find((f) => subscriptionFeedUrlId(f.url) === feedId);
}

export async function searchRssAudiobooks(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const feeds = await Promise.all(
    AUDIOBOOK_CURATED_RSS_FEEDS.map(async (curated) => {
      const parsed = await fetchRssFeed(curated.url);
      return parsed ? { parsed, curated } : null;
    }),
  );

  const hits: AudiobookCatalogBook[] = [];
  for (const row of feeds) {
    if (!row) continue;
    hits.push(...searchRssFeed(row.parsed, query, row.curated.kind, row.curated));
    if (hits.length >= limit) break;
  }
  return hits.slice(0, limit);
}

export async function fetchRssAudiobookChapters(
  sourceId: string,
  feedUrl?: string,
): Promise<AudiobookCatalogChapter[]> {
  const id = sourceId.trim();
  if (!id) return [];

  let resolvedFeedUrl = feedUrl?.trim();
  if (!resolvedFeedUrl) {
    const feedId = id.includes(':') ? id.slice(0, id.indexOf(':')) : id;
    resolvedFeedUrl = curatedByFeedId(feedId)?.url;
  }

  if (!resolvedFeedUrl) return [];
  const parsed = await fetchRssFeed(resolvedFeedUrl);
  if (!parsed) return [];

  const book: AudiobookCatalogBook = {
    id: `rss:${id}`,
    sourceId: id,
    title: parsed.title,
    author: curatedByUrl(resolvedFeedUrl)?.author ?? parsed.title,
    source: 'rss',
    feedUrl: resolvedFeedUrl,
  };
  return rssChaptersFromFeed(book, parsed);
}
