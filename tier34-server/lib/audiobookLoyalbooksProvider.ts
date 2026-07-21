/**
 * Loyal Books provider — curated per-book RSS feeds via Tier34 feed proxy.
 */

import {
  loyalbooksBookFromFeed,
  loyalbooksChaptersFromFeed,
  searchLoyalbooksFeed,
} from './audiobookLoyalbooksCore.js';
import {
  AUDIOBOOK_LOYALBOOKS_FEEDS,
  loyalbooksFeedUrl,
  searchLoyalbooksFeedIndex,
  type LoyalbooksFeed,
} from './audiobookLoyalbooksFeeds.js';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from './audiobookRssCore.js';
import type { AudiobookRssParsedFeed } from './audiobookRssCore.js';
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

async function fetchLoyalbooksRss(feedUrl: string): Promise<AudiobookRssParsedFeed | null> {
  if (!podcastFeedUrlAllowed(feedUrl)) return null;
  try {
    const { status, body } = await fetchPodcastFeedXml(feedUrl);
    if (status < 200 || status >= 300) return null;
    return mirrorFeedToRssFeed(parsePodcastMirrorFeedXml(body, feedUrl));
  } catch {
    return null;
  }
}

function feedMetaBySlug(slug: string): LoyalbooksFeed | undefined {
  return AUDIOBOOK_LOYALBOOKS_FEEDS.find((f) => f.slug === slug);
}

export async function searchLoyalbooksAudiobooks(
  query: string,
  limit: number,
): Promise<AudiobookCatalogBook[]> {
  const matches = searchLoyalbooksFeedIndex(query).slice(0, Math.min(limit, 8));
  const batches = await Promise.all(
    matches.map(async (meta) => {
      const parsed = await fetchLoyalbooksRss(loyalbooksFeedUrl(meta.slug));
      if (!parsed) return [] as AudiobookCatalogBook[];
      const fromSearch = searchLoyalbooksFeed(parsed, query, meta);
      if (fromSearch.length > 0) return fromSearch;
      return [loyalbooksBookFromFeed(meta, parsed)];
    }),
  );
  return batches.flat().slice(0, limit);
}

export async function fetchLoyalbooksChapters(slug: string): Promise<AudiobookCatalogChapter[]> {
  const meta = feedMetaBySlug(slug.trim());
  if (!meta) return [];
  const parsed = await fetchLoyalbooksRss(loyalbooksFeedUrl(meta.slug));
  if (!parsed) return [];
  return loyalbooksChaptersFromFeed(meta, parsed);
}
