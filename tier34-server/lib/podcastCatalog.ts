/**
 * Global podcast catalog — iTunes Search + optional Podcast Index API.
 */

import { createHash } from 'node:crypto';

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

const ITUNES_SEARCH = 'https://itunes.apple.com/search';
const PODCAST_INDEX_BASE = 'https://api.podcastindex.org/api/1.0';

function podcastIndexConfigured(): { key: string; secret: string } | null {
  const key = process.env.PODCAST_INDEX_KEY?.trim() ?? '';
  const secret = process.env.PODCAST_INDEX_SECRET?.trim() ?? '';
  if (!key || !secret) return null;
  return { key, secret };
}

function podcastIndexHeaders(key: string, secret: string): Record<string, string> {
  const apiHeaderTime = Math.floor(Date.now() / 1000);
  const hash = createHash('sha1')
    .update(key + secret + apiHeaderTime)
    .digest('hex');
  return {
    'X-Auth-Date': String(apiHeaderTime),
    'X-Auth-Key': key,
    Authorization: hash,
    'User-Agent': 'SandboxTier34/1.0',
  };
}

function normalizeFeedUrl(url: string): string {
  return url.trim().toLowerCase().replace(/\/$/, '');
}

function dedupeShows(shows: PodcastCatalogShow[]): PodcastCatalogShow[] {
  const seen = new Set<string>();
  const out: PodcastCatalogShow[] = [];
  for (const show of shows) {
    const key = normalizeFeedUrl(show.feedUrl);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(show);
  }
  return out;
}

async function searchItunesShows(query: string, limit: number): Promise<PodcastCatalogShow[]> {
  const url = `${ITUNES_SEARCH}?term=${encodeURIComponent(query)}&media=podcast&entity=podcast&limit=${Math.min(limit, 50)}`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'SandboxTier34/1.0' },
    signal: AbortSignal.timeout(12_000),
  });
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
      collectionCensoredName?: string;
    }>;
  };
  return (data.results ?? [])
    .filter((r) => r.feedUrl?.trim())
    .map((r) => ({
      id: `itunes-${r.collectionId ?? r.feedUrl}`,
      title: (r.collectionName ?? r.collectionCensoredName ?? 'Podcast').trim(),
      author: (r.artistName ?? 'Unknown').trim(),
      feedUrl: r.feedUrl!.trim(),
      artworkUrl: r.artworkUrl600 ?? r.artworkUrl100,
      episodeCount: r.trackCount,
      source: 'itunes' as const,
    }));
}

async function searchPodcastIndexShows(query: string, limit: number): Promise<PodcastCatalogShow[]> {
  const auth = podcastIndexConfigured();
  if (!auth) return [];
  const url = `${PODCAST_INDEX_BASE}/search/byterm?q=${encodeURIComponent(query)}&max=${Math.min(limit, 50)}`;
  const res = await fetch(url, {
    headers: podcastIndexHeaders(auth.key, auth.secret),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    feeds?: Array<{
      id?: number;
      title?: string;
      author?: string;
      description?: string;
      url?: string;
      image?: string;
      episodeCount?: number;
    }>;
  };
  return (data.feeds ?? [])
    .filter((f) => f.url?.trim())
    .map((f) => ({
      id: `pi-${f.id ?? f.url}`,
      title: (f.title ?? 'Podcast').trim(),
      author: (f.author ?? 'Unknown').trim(),
      description: f.description?.trim(),
      feedUrl: f.url!.trim(),
      artworkUrl: f.image,
      episodeCount: f.episodeCount,
      source: 'podcastindex' as const,
    }));
}

async function searchPodcastIndexEpisodes(query: string, limit: number): Promise<PodcastCatalogEpisode[]> {
  const auth = podcastIndexConfigured();
  if (!auth) return [];
  const url = `${PODCAST_INDEX_BASE}/episodes/byterm?q=${encodeURIComponent(query)}&max=${Math.min(limit, 50)}`;
  const res = await fetch(url, {
    headers: podcastIndexHeaders(auth.key, auth.secret),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    items?: Array<{
      id?: number;
      title?: string;
      description?: string;
      enclosureUrl?: string;
      duration?: number;
      datePublished?: number;
      feedTitle?: string;
      feedUrl?: string;
      image?: string;
    }>;
  };
  return (data.items ?? [])
    .filter((e) => e.enclosureUrl?.trim() && e.feedUrl?.trim())
    .map((e) => ({
      id: `pi-ep-${e.id ?? e.enclosureUrl}`,
      title: (e.title ?? 'Episode').trim(),
      description: e.description?.trim(),
      feedTitle: (e.feedTitle ?? 'Podcast').trim(),
      feedUrl: e.feedUrl!.trim(),
      audioUrl: e.enclosureUrl!.trim(),
      durationSeconds: e.duration && e.duration > 0 ? e.duration : undefined,
      artworkUrl: e.image,
      publishedAt: e.datePublished ? e.datePublished * 1000 : undefined,
      source: 'podcastindex' as const,
    }));
}

async function fetchPodcastIndexTrending(max: number): Promise<PodcastCatalogShow[]> {
  const auth = podcastIndexConfigured();
  if (!auth) return [];
  const url = `${PODCAST_INDEX_BASE}/podcasts/trending?max=${Math.min(max, 50)}`;
  const res = await fetch(url, {
    headers: podcastIndexHeaders(auth.key, auth.secret),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    feeds?: Array<{
      id?: number;
      title?: string;
      author?: string;
      description?: string;
      url?: string;
      image?: string;
      episodeCount?: number;
    }>;
  };
  return (data.feeds ?? [])
    .filter((f) => f.url?.trim())
    .map((f) => ({
      id: `pi-trend-${f.id ?? f.url}`,
      title: (f.title ?? 'Podcast').trim(),
      author: (f.author ?? 'Unknown').trim(),
      description: f.description?.trim(),
      feedUrl: f.url!.trim(),
      artworkUrl: f.image,
      episodeCount: f.episodeCount,
      source: 'podcastindex' as const,
    }));
}

/** Merge iTunes + Podcast Index show results. */
export async function searchPodcastCatalogShows(
  query: string,
  limit = 25,
): Promise<PodcastCatalogShow[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const half = Math.ceil(limit / 2);
  const [itunes, index] = await Promise.all([
    searchItunesShows(q, half).catch(() => [] as PodcastCatalogShow[]),
    searchPodcastIndexShows(q, limit).catch(() => [] as PodcastCatalogShow[]),
  ]);
  return dedupeShows([...index, ...itunes]).slice(0, limit);
}

export async function searchPodcastCatalogEpisodes(
  query: string,
  limit = 20,
): Promise<PodcastCatalogEpisode[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  return searchPodcastIndexEpisodes(q, limit).catch(() => []);
}

export async function fetchTrendingPodcastShows(max = 20): Promise<PodcastCatalogShow[]> {
  const trending = await fetchPodcastIndexTrending(max).catch(() => [] as PodcastCatalogShow[]);
  if (trending.length >= 8) return trending.slice(0, max);
  const fallback = await searchItunesShows('podcast', max).catch(() => [] as PodcastCatalogShow[]);
  return dedupeShows([...trending, ...fallback]).slice(0, max);
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
