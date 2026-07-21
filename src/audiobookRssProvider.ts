/**
 * Audiobook RSS provider — client (curated + user feeds).
 */

import { fetchPodcastFeed } from './podcastRss';
import {
  rssChaptersFromFeed,
  searchRssFeed,
  type AudiobookCatalogBook,
  type AudiobookCatalogChapter,
  type AudiobookRssParsedFeed,
} from '../tier34-server/lib/audiobookRssCore';
import { listAudiobookRssFeedConfigs, type AudiobookCuratedRssFeed } from './audiobookRssFeeds';

function podcastFeedToRssFeed(
  parsed: Awaited<ReturnType<typeof fetchPodcastFeed>>,
  feedUrl: string,
): AudiobookRssParsedFeed {
  return {
    feedId: parsed.subscription.id,
    feedUrl,
    title: parsed.subscription.title,
    description: parsed.subscription.description,
    artworkUrl: parsed.subscription.artworkUrl,
    episodes: parsed.episodes.map((ep) => ({
      id: ep.id,
      guid: ep.guid ?? ep.id,
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
  try {
    const parsed = await fetchPodcastFeed(feedUrl);
    return podcastFeedToRssFeed(parsed, feedUrl.trim());
  } catch {
    return null;
  }
}

function curatedForUrl(url: string, configs: AudiobookCuratedRssFeed[]): AudiobookCuratedRssFeed | undefined {
  const normalized = url.trim().toLowerCase();
  return configs.find((f) => f.url.trim().toLowerCase() === normalized);
}

export async function searchRssAudiobooks(query: string, limit: number): Promise<AudiobookCatalogBook[]> {
  const configs = listAudiobookRssFeedConfigs();
  const feeds = await Promise.all(
    configs.map(async (curated) => {
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

export async function fetchRssAudiobookChapters(book: AudiobookCatalogBook): Promise<AudiobookCatalogChapter[]> {
  const feedUrl = book.feedUrl?.trim();
  if (!feedUrl) return [];
  const parsed = await fetchRssFeed(feedUrl);
  if (!parsed) return [];
  return rssChaptersFromFeed(book, parsed);
}

export async function probeAudiobookRssFeed(
  feedUrl: string,
): Promise<{ title: string; episodeCount: number } | null> {
  const parsed = await fetchRssFeed(feedUrl);
  if (!parsed) return null;
  return { title: parsed.title, episodeCount: parsed.episodes.length };
}

export function rssFeedLabel(url: string): string {
  return curatedForUrl(url, listAudiobookRssFeedConfigs())?.label ?? url;
}
