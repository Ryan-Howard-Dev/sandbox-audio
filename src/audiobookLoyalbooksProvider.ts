/**
 * Loyal Books provider — client (curated feeds via podcast RSS stack).
 */

import {
  loyalbooksBookFromFeed,
  loyalbooksChaptersFromFeed,
  searchLoyalbooksFeed,
} from '../tier34-server/lib/audiobookLoyalbooksCore';
import {
  loyalbooksFeedUrl,
  searchLoyalbooksFeedIndex,
  type LoyalbooksFeed,
} from '../tier34-server/lib/audiobookLoyalbooksFeeds';
import type { AudiobookCatalogBook, AudiobookCatalogChapter } from '../tier34-server/lib/audiobookRssCore';
import type { AudiobookRssParsedFeed } from '../tier34-server/lib/audiobookRssCore';
import { fetchPodcastFeed } from './podcastRss';
import { AUDIOBOOK_LOYALBOOKS_FEEDS } from '../tier34-server/lib/audiobookLoyalbooksFeeds';

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

async function fetchLoyalbooksRss(feedUrl: string): Promise<AudiobookRssParsedFeed | null> {
  try {
    const parsed = await fetchPodcastFeed(feedUrl);
    return podcastFeedToRssFeed(parsed, feedUrl);
  } catch {
    return null;
  }
}

function feedMetaBySlug(slug: string): LoyalbooksFeed | undefined {
  return AUDIOBOOK_LOYALBOOKS_FEEDS.find((f) => f.slug === slug);
}

export async function searchLoyalbooksAudiobooksClient(
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

export async function fetchLoyalbooksChaptersClient(
  book: AudiobookCatalogBook,
): Promise<AudiobookCatalogChapter[]> {
  const meta = feedMetaBySlug(book.sourceId);
  if (!meta) return [];
  const parsed = await fetchLoyalbooksRss(loyalbooksFeedUrl(meta.slug));
  if (!parsed) return [];
  return loyalbooksChaptersFromFeed(meta, parsed);
}
