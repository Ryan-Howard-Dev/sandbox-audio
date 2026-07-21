import { searchProxyTier, searchDebridTier } from './search.js';
import { qmHash } from './utils.js';

export interface FeedItem {
  id: string;
  title: string;
  artist: string;
  url: string;
  artworkUrl?: string;
  releasedAt: string;
  section: 'new' | 'week' | 'month';
  envelopeId?: string;
  provider?: string;
}

export interface MixItem {
  id: string;
  name: string;
  description: string;
  trackCount: number;
  seedQuery: string;
}

export interface VideoItem {
  id: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  watchUrl: string;
}

export async function buildFeed(): Promise<FeedItem[]> {
  const FEED_BUILD_TIMEOUT_MS = 8_000;
  try {
    const items = await Promise.race([
      buildFeedFromSearch(),
      new Promise<FeedItem[]>((_, reject) => {
        setTimeout(() => reject(new Error('feed build timeout')), FEED_BUILD_TIMEOUT_MS);
      }),
    ]);
    if (items.length > 0) return items;
  } catch (err) {
    console.warn('[buildFeed] search pipeline slow or failed, using fallback:', err);
  }
  return buildFeedFallback();
}

function buildFeedFallback(): FeedItem[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'feed-fallback-0',
      title: 'Night Owl',
      artist: 'Broke For Free',
      url: 'https://archive.org/download/Broke_For_Free/Night_Owl.mp3',
      releasedAt: now,
      section: 'new',
      provider: 'stream-proxy',
    },
    {
      id: 'feed-fallback-1',
      title: 'Air Prelude',
      artist: 'Kevin MacLeod',
      url: 'https://archive.org/download/Kevin_MacLeod_-_Public_Domain_Music/Kevin_MacLeod_-_Air_Prelude.mp3',
      releasedAt: now,
      section: 'week',
      provider: 'stream-proxy',
    },
  ];
}

async function buildFeedFromSearch(): Promise<FeedItem[]> {
  const seeds = ['new releases 2026', 'indie electronic', 'hip hop'];
  const items: FeedItem[] = [];
  let idx = 0;
  for (const seed of seeds) {
    const hits = await searchProxyTier(seed);
    for (const h of hits.slice(0, 4)) {
      items.push({
        id: `feed-${idx++}`,
        title: h.title,
        artist: h.artist,
        url: h.url,
        artworkUrl: h.artworkUrl,
        releasedAt: new Date().toISOString(),
        section: idx <= 4 ? 'new' : idx <= 8 ? 'week' : 'month',
        envelopeId: h.envelopeId,
        provider: h.provider,
      });
    }
  }
  return items;
}

export async function buildMixes(lockerTrackTitles: string[]): Promise<MixItem[]> {
  const base = lockerTrackTitles.slice(0, 5);
  const seeds = [
    ...base.map((t) => `mix similar ${t}`),
    'chill radio',
    'workout energy',
    'late night focus',
  ];
  return seeds.slice(0, 6).map((seed, i) => ({
    id: `mix-${i}`,
    name: i < base.length ? `Your Mix ${i + 1}` : `Radio — ${seed.replace(/^mix similar /i, '')}`,
    description: `Generated from locker + mesh (${seed})`,
    trackCount: 12 + (i % 5) * 3,
    seedQuery: seed,
  }));
}

export async function buildVideos(query = 'official music video'): Promise<VideoItem[]> {
  const invidious = [
    'https://invidious.fdn.fr',
    'https://vid.puffyan.us',
  ];
  for (const base of invidious) {
    try {
      const res = await fetch(
        `${base}/api/v1/search?q=${encodeURIComponent(query)}&type=video`,
        { headers: { 'User-Agent': 'SandboxTier34/1.0' }, signal: AbortSignal.timeout(6000) },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as Array<{
        videoId?: string;
        title?: string;
        author?: string;
        videoThumbnails?: Array<{ url?: string }>;
      }>;
      return (data ?? []).slice(0, 12).map((v, i) => ({
        id: v.videoId ?? `vid-${i}`,
        title: v.title ?? 'Video',
        channel: v.author ?? 'Unknown',
        thumbnailUrl: v.videoThumbnails?.[0]?.url ?? '',
        watchUrl: `https://www.youtube.com/watch?v=${v.videoId}`,
      }));
    } catch {
      continue;
    }
  }
  return [
    {
      id: 'fallback-1',
      title: 'Music Video Search',
      channel: 'Sandbox',
      thumbnailUrl: '',
      watchUrl: `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
    },
  ];
}

export function dhtResolve(hash: string, title: string, artist: string) {
  const canonical = qmHash(title, artist);
  return {
    hash: hash || canonical,
    canonical,
    peers: [
      { id: 'peer-local', address: '127.0.0.1', latencyMs: 4 },
      { id: 'peer-mesh-1', address: '10.0.0.2', latencyMs: 18 },
    ],
    resolved: true,
  };
}
