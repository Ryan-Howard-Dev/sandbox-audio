/**
 * Global podcast discovery — search shows & episodes worldwide via Tier34 / iTunes fallback.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { isAirGapEnabled } from './airGapMode';
import { fetchPodcastFeed, safePodcastPlaybackUrl } from './podcastRss';
import {
  addSubscription,
  loadSubscriptions,
  saveEpisodesForFeed,
  subscriptionFeedUrlId,
  type PodcastSubscription,
} from './podcastStorage';
import { episodeEnvelope } from './podcastSearch';
import {
  mergePodcastSearchHits,
  searchTier34TranscriptHits,
} from './podcastTranscriptSearch';
import { getTier34BaseUrl } from './tier34/client';

export interface PodcastCatalogShow {
  id: string;
  title: string;
  author: string;
  description?: string;
  feedUrl: string;
  artworkUrl?: string;
  episodeCount?: number;
  source: 'itunes' | 'podcastindex';
}

export interface PodcastCatalogEpisode {
  id: string;
  title: string;
  feedTitle: string;
  feedUrl: string;
  audioUrl: string;
  durationSeconds?: number;
  artworkUrl?: string;
  publishedAt?: number;
  description?: string;
  source: 'podcastindex' | 'itunes';
}

export interface PodcastCatalogEpisodeHit {
  episode: PodcastCatalogEpisode;
  envelope: MediaEnvelope;
}

export const PODCAST_DISCOVER_CATEGORIES = [
  { id: 'news', label: 'News', query: 'news daily podcast' },
  { id: 'true-crime', label: 'True Crime', query: 'true crime podcast' },
  { id: 'comedy', label: 'Comedy', query: 'comedy podcast' },
  { id: 'tech', label: 'Tech', query: 'technology podcast' },
  { id: 'business', label: 'Business', query: 'business podcast' },
  { id: 'science', label: 'Science', query: 'science podcast' },
  { id: 'sports', label: 'Sports', query: 'sports podcast' },
  { id: 'health', label: 'Health', query: 'health wellness podcast' },
] as const;

function normalizeFeedUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/$/, '');
}

export function isSubscribedToFeed(feedUrl: string): boolean {
  const key = normalizeFeedUrl(feedUrl);
  return loadSubscriptions().some((s) => normalizeFeedUrl(s.feedUrl) === key);
}

function catalogEpisodeEnvelope(ep: PodcastCatalogEpisode): MediaEnvelope {
  const feedId = subscriptionFeedUrlId(ep.feedUrl);
  return {
    envelopeId: `podcast:${feedId}:${ep.id}`,
    title: ep.title,
    artist: ep.feedTitle,
    album: ep.feedTitle,
    url: safePodcastPlaybackUrl(ep.audioUrl),
    durationSeconds: ep.durationSeconds ?? 0,
    provider: 'https',
    transport: 'element-src',
    sourceId: ep.id,
    artworkUrl: ep.artworkUrl,
    mimeType: 'audio/mpeg',
  };
}

export function catalogEpisodeToHit(ep: PodcastCatalogEpisode): PodcastCatalogEpisodeHit {
  return { episode: ep, envelope: catalogEpisodeEnvelope(ep) };
}

async function searchItunesShowsClient(query: string, limit: number): Promise<PodcastCatalogShow[]> {
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      collectionId?: number;
      collectionName?: string;
      artistName?: string;
      feedUrl?: string;
      artworkUrl600?: string;
      artworkUrl100?: string;
      trackCount?: number;
    }>;
  };
  return (data.results ?? [])
    .filter((r) => r.feedUrl?.trim())
    .map((r) => ({
      id: `itunes-${r.collectionId ?? r.feedUrl}`,
      title: (r.collectionName ?? 'Podcast').trim(),
      author: (r.artistName ?? 'Unknown').trim(),
      feedUrl: r.feedUrl!.trim(),
      artworkUrl: r.artworkUrl600 ?? r.artworkUrl100,
      episodeCount: r.trackCount,
      source: 'itunes' as const,
    }));
}

async function fetchViaTier34<T>(path: string): Promise<T | null> {
  if (isAirGapEnabled() || !getTier34BaseUrl().trim()) return null;
  const base = getTier34BaseUrl().replace(/\/$/, '');
  try {
    const res = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function searchPodcastCatalogShows(
  query: string,
  limit = 25,
): Promise<PodcastCatalogShow[]> {
  const q = query.trim();
  if (q.length < 2 || isAirGapEnabled()) return [];

  const remote = await fetchViaTier34<{ shows?: PodcastCatalogShow[] }>(
    `/api/podcast/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  if (remote?.shows?.length) return remote.shows;

  return searchItunesShowsClient(q, limit);
}

export async function searchPodcastCatalogEpisodes(
  query: string,
  limit = 20,
): Promise<PodcastCatalogEpisodeHit[]> {
  const q = query.trim();
  if (q.length < 2 || isAirGapEnabled()) return [];

  const remote = await fetchViaTier34<{ episodes?: PodcastCatalogEpisode[] }>(
    `/api/podcast/search?q=${encodeURIComponent(q)}&limit=${limit}`,
  );
  const episodes = remote?.episodes ?? [];
  return episodes.map(catalogEpisodeToHit);
}

export async function fetchTrendingPodcastShows(max = 20): Promise<PodcastCatalogShow[]> {
  if (isAirGapEnabled()) return [];

  const remote = await fetchViaTier34<{ shows?: PodcastCatalogShow[] }>(
    `/api/podcast/trending?max=${max}`,
  );
  if (remote?.shows?.length) return remote.shows;

  return searchItunesShowsClient('podcast', max);
}

/** Fetch episodes for a catalog show without subscribing. */
export async function fetchCatalogShowEpisodes(
  show: PodcastCatalogShow,
): Promise<import('./podcastStorage').PodcastEpisode[]> {
  const parsed = await fetchPodcastFeed(show.feedUrl);
  return parsed.episodes;
}

function pickEpisodeByQuery(
  episodes: import('./podcastStorage').PodcastEpisode[],
  episodeQuery: string,
): import('./podcastStorage').PodcastEpisode | undefined {
  const q = episodeQuery.trim();
  if (!q) return episodes[0];
  const epNum = q.match(/#?(\d{3,5})\b/)?.[1];
  if (epNum) {
    return (
      episodes.find((e) => e.title.includes(epNum) || e.id.includes(epNum)) ?? episodes[0]
    );
  }
  const tokens = q.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
  if (!tokens.length) return episodes[0];
  return (
    episodes.find((e) => {
      const blob = e.title.toLowerCase();
      return tokens.every((t) => blob.includes(t));
    }) ?? episodes[0]
  );
}

/** Fetch RSS and pick one episode without writing the full library (online stream E2E). */
export async function resolveOnlineCatalogEpisode(
  feedQuery: string,
  episodeQuery: string,
): Promise<{
  feedTitle: string;
  feedArtworkUrl?: string;
  episode: import('./podcastStorage').PodcastEpisode;
} | null> {
  const shows = await searchPodcastCatalogShows(feedQuery, 8);
  const feedLower = feedQuery.trim().toLowerCase();
  const show =
    shows.find((s) => s.title.toLowerCase().includes(feedLower.split(' ')[0] ?? '')) ??
    shows.find((s) => feedLower.split(/\s+/).every((t) => t.length > 2 && s.title.toLowerCase().includes(t))) ??
    shows[0];
  if (!show?.feedUrl?.trim()) return null;
  const parsed = await fetchPodcastFeed(show.feedUrl);
  const episode = pickEpisodeByQuery(parsed.episodes, episodeQuery);
  if (!episode?.audioUrl?.trim()) return null;
  return {
    feedTitle: show.title || parsed.subscription.title,
    feedArtworkUrl: show.artworkUrl ?? parsed.subscription.artworkUrl,
    episode,
  };
}

/** Subscribe to a catalog show and fetch episodes. */
export async function subscribeFromCatalogShow(
  show: PodcastCatalogShow,
): Promise<{ subscription: PodcastSubscription; episodes: import('./podcastStorage').PodcastEpisode[] }> {
  if (isSubscribedToFeed(show.feedUrl)) {
    const existing = loadSubscriptions().find(
      (s) => normalizeFeedUrl(s.feedUrl) === normalizeFeedUrl(show.feedUrl),
    );
    if (existing) {
      const parsed = await fetchPodcastFeed(show.feedUrl);
      saveEpisodesForFeed(existing.id, parsed.episodes);
      return { subscription: existing, episodes: parsed.episodes };
    }
  }

  const parsed = await fetchPodcastFeed(show.feedUrl);
  const sub = addSubscription({
    id: subscriptionFeedUrlId(show.feedUrl),
    feedUrl: show.feedUrl,
    title: show.title || parsed.subscription.title,
    description: show.description ?? parsed.subscription.description,
    artworkUrl: show.artworkUrl ?? parsed.subscription.artworkUrl,
    source: parsed.subscription.source ?? 'rss',
    subscribedAt: Date.now(),
    lastFetchedAt: Date.now(),
  });
  saveEpisodesForFeed(sub.id, parsed.episodes);
  return { subscription: sub, episodes: parsed.episodes };
}

/** Unified podcast search — local library + Tier34 transcripts + global catalog. */
export async function searchPodcastsUnified(
  query: string,
  options?: { localLimit?: number; catalogLimit?: number },
): Promise<{
  localHits: import('./podcastSearch').PodcastSearchHit[];
  transcriptHits: import('./podcastSearch').PodcastSearchHit[];
  catalogHits: PodcastCatalogEpisodeHit[];
  catalogShows: PodcastCatalogShow[];
}> {
  const { searchPodcastLibrary } = await import('./podcastSearch');
  const localLimit = options?.localLimit ?? 12;
  const libraryHits = searchPodcastLibrary(query, localLimit);
  const transcriptHits =
    getTier34BaseUrl().trim().length > 0
      ? await searchTier34TranscriptHits(query, localLimit)
      : [];
  const localHits = mergePodcastSearchHits(libraryHits, transcriptHits, localLimit);
  const [catalogHits, catalogShows] = await Promise.all([
    searchPodcastCatalogEpisodes(query, options?.catalogLimit ?? 16),
    searchPodcastCatalogShows(query, 12),
  ]);
  return { localHits, transcriptHits, catalogHits, catalogShows };
}
