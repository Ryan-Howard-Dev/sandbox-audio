import { isAirGapEnabled } from './airGapMode';
import { getTier34BaseUrl, tier34HealthOk } from './tier34/client';
import type { ParsedPodcastFeed } from './podcastRss';
import { subscriptionFeedUrlId } from './podcastStorage';

export function isYoutubePodcastListUrl(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return false;
  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host !== 'youtube.com' && host !== 'm.youtube.com' && host !== 'youtu.be') {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    if (path.startsWith('/playlist')) return true;
    if (path.startsWith('/channel/')) return true;
    if (path.startsWith('/@')) return true;
    if (path.startsWith('/c/') || path.startsWith('/user/')) return true;
    if (parsed.searchParams.has('list')) return true;
    return false;
  } catch {
    return false;
  }
}

function episodeIdFromVideoId(feedId: string, videoId: string): string {
  return `${feedId}:yt-${videoId}`;
}

type YoutubePodcastApiResponse = {
  title?: string;
  description?: string;
  artworkUrl?: string;
  episodes?: Array<{
    videoId?: string;
    title?: string;
    watchUrl?: string;
    durationSeconds?: number;
    publishedAt?: number;
    artworkUrl?: string;
  }>;
  error?: string;
};

export async function fetchYoutubePodcastFeed(feedUrl: string): Promise<ParsedPodcastFeed> {
  const trimmed = feedUrl.trim();
  if (!trimmed) throw new Error('Video channel URL required');
  if (isAirGapEnabled()) {
    throw new Error('Video-channel podcasts are disabled while Air-Gap Mode is active.');
  }
  if (!isYoutubePodcastListUrl(trimmed)) {
    throw new Error('Paste a video channel or playlist URL');
  }

  const tier34Up = await tier34HealthOk();
  if (!tier34Up) {
    throw new Error(
      'Sandbox Server required for video-channel podcasts. Start it on your network with yt-dlp installed (Settings → Addons → Server URL).',
    );
  }

  const base = getTier34BaseUrl().replace(/\/$/, '');
  const res = await fetch(
    `${base}/api/podcast/youtube?url=${encodeURIComponent(trimmed)}`,
  );
  if (!res.ok) {
    let detail = '';
    try {
      const body = (await res.json()) as { error?: string };
      detail = body.error?.trim() ?? '';
    } catch {
      detail = await res.text().catch(() => '');
    }
    throw new Error(detail || `Video feed failed (HTTP ${res.status})`);
  }

  const data = (await res.json()) as YoutubePodcastApiResponse;
  if (data.error) throw new Error(data.error);

  const feedId = subscriptionFeedUrlId(trimmed);
  const episodes = (data.episodes ?? [])
    .filter((ep) => ep.videoId && ep.watchUrl)
    .map((ep) => ({
      id: episodeIdFromVideoId(feedId, ep.videoId!),
      feedId,
      title: ep.title?.trim() || 'Episode',
      audioUrl: ep.watchUrl!,
      durationSeconds: ep.durationSeconds,
      publishedAt: ep.publishedAt,
      artworkUrl: ep.artworkUrl,
    }));

  if (!episodes.length) {
    throw new Error('No episodes returned from video feed');
  }

  return {
    subscription: {
      id: feedId,
      feedUrl: trimmed,
      title: data.title?.trim() || 'YouTube Podcast',
      description: data.description,
      artworkUrl: data.artworkUrl,
      source: 'youtube',
    },
    episodes,
  };
}
