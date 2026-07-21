/**
 * Discovery video feed — tier34 mesh videos + locker uploads.
 */

import { isLockerVideoEntry } from './collectionIntelligence';
import type { LockerEntry } from './lockerStorage';
import { tier34FetchVideos, type VideoItem } from './tier34/client';

export type DiscoveryVideoSource = 'tier34' | 'locker';

export interface DiscoveryVideoItem {
  id: string;
  title: string;
  channel: string;
  thumbnailUrl: string;
  watchUrl: string;
  source: DiscoveryVideoSource;
  /** Direct stream URL for locker-hosted video files. */
  streamUrl?: string;
}

export function extractYoutubeVideoId(watchUrl: string, fallbackId?: string): string | null {
  const trimmed = watchUrl.trim();
  const watch = trimmed.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
  if (watch?.[1]) return watch[1];
  const short = trimmed.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
  if (short?.[1]) return short[1];
  const embed = trimmed.match(/\/embed\/([a-zA-Z0-9_-]{11})/);
  if (embed?.[1]) return embed[1];
  if (/^[a-zA-Z0-9_-]{11}$/.test(fallbackId ?? '')) return fallbackId!;
  return null;
}

export function youtubeEmbedUrl(videoId: string, autoplay = true): string {
  const params = new URLSearchParams({
    autoplay: autoplay ? '1' : '0',
    playsinline: '1',
    rel: '0',
    modestbranding: '1',
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

export function lockerEntryToVideoItem(entry: LockerEntry): DiscoveryVideoItem {
  return {
    id: `locker-${entry.id}`,
    title: entry.title?.trim() || 'Video',
    channel: entry.artist?.trim() || 'Locker',
    thumbnailUrl: entry.albumArt?.trim() ?? '',
    watchUrl: entry.url,
    source: 'locker',
    streamUrl: entry.url,
  };
}

export function tier34ItemToDiscovery(item: VideoItem): DiscoveryVideoItem {
  return {
    id: `tier34-${item.id}`,
    title: item.title?.trim() || 'Video',
    channel: item.channel?.trim() || 'YouTube',
    thumbnailUrl: item.thumbnailUrl?.trim() ?? '',
    watchUrl: item.watchUrl,
    source: 'tier34',
  };
}

function dedupeVideos(items: DiscoveryVideoItem[]): DiscoveryVideoItem[] {
  const seen = new Set<string>();
  const out: DiscoveryVideoItem[] = [];
  for (const item of items) {
    const videoId = extractYoutubeVideoId(item.watchUrl, item.id);
    const key = item.source === 'locker' ? item.id : videoId ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/** Merge locker uploads with tier34 / Invidious discovery results. */
export async function loadDiscoveryVideoFeed(
  lockerEntries: LockerEntry[],
  query = 'official music video',
): Promise<DiscoveryVideoItem[]> {
  const lockerVideos = lockerEntries.filter(isLockerVideoEntry).map(lockerEntryToVideoItem);

  let remote: DiscoveryVideoItem[] = [];
  try {
    remote = (await tier34FetchVideos(query)).map(tier34ItemToDiscovery);
  } catch {
    remote = [];
  }

  return dedupeVideos([...lockerVideos, ...remote]);
}
