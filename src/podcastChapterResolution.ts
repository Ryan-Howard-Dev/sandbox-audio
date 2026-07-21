/**
 * Universal podcast chapter resolution for any subscribed show.
 * RSS chaptersUrl → Podcast Index fallback → soundbite ad markers.
 */

import { isAirGapEnabled } from './airGapMode';
import { getTier34BaseUrl } from './tier34/client';
import {
  fetchPodcastChapters,
  parsePodcastChaptersJson,
  type PodcastChapter,
} from './podcastChapters';
import { isAdTaggedChapter } from './podcastAdSkip';
import type { PodcastEpisode } from './podcastStorage';

export interface PodcastEpisodeMeta {
  chaptersUrl?: string;
  soundbites: Array<{ startTime: number; duration?: number; title?: string }>;
}

async function fetchEpisodeMetaFromTier34(
  episode: PodcastEpisode,
  feedUrl: string,
): Promise<PodcastEpisodeMeta | null> {
  if (isAirGapEnabled()) return null;
  const tier34 = getTier34BaseUrl()?.replace(/\/$/, '');
  const params = new URLSearchParams();
  if (feedUrl.trim()) params.set('feedUrl', feedUrl.trim());
  if (episode.guid?.trim()) params.set('guid', episode.guid.trim());
  if (episode.audioUrl?.trim()) params.set('enclosureUrl', episode.audioUrl.trim());
  if ([...params.keys()].length === 0) return null;

  const targets = [
    tier34 ? `${tier34}/api/podcast-episode-meta?${params}` : null,
    `/api/podcast-episode-meta?${params}`,
  ].filter(Boolean) as string[];

  for (const target of targets) {
    try {
      const res = await fetch(target);
      if (!res.ok) continue;
      const data = (await res.json()) as PodcastEpisodeMeta;
      if (data && typeof data === 'object') return data;
    } catch {
      /* try next */
    }
  }
  return null;
}

/** Turn PI soundbites with ad-like titles into synthetic chapter markers. */
export function soundbitesToAdChapters(
  soundbites: PodcastEpisodeMeta['soundbites'],
): PodcastChapter[] {
  const chapters: PodcastChapter[] = [];
  for (const sb of soundbites) {
    const title = sb.title?.trim() || 'Soundbite';
    if (!isAdTaggedChapter(title)) continue;
    if (!Number.isFinite(sb.startTime) || sb.startTime < 0) continue;
    chapters.push({ title, startSeconds: sb.startTime });
  }
  return chapters;
}

/** Merge chapter lists, preferring longer titles on duplicate start times. */
export function mergePodcastChapters(...lists: PodcastChapter[][]): PodcastChapter[] {
  const byStart = new Map<number, PodcastChapter>();
  for (const list of lists) {
    for (const ch of list) {
      const key = Math.round(ch.startSeconds * 100) / 100;
      const existing = byStart.get(key);
      if (!existing || ch.title.length > existing.title.length) {
        byStart.set(key, ch);
      }
    }
  }
  return [...byStart.values()].sort((a, b) => a.startSeconds - b.startSeconds);
}

/**
 * Resolve chapters for any episode: cached → RSS URL → Podcast Index → soundbites.
 */
export async function resolvePodcastChapters(
  episode: PodcastEpisode,
  feedUrl: string,
): Promise<PodcastChapter[]> {
  if (episode.chapters?.length) return episode.chapters;

  const durationHint = episode.durationSeconds;
  let chapters: PodcastChapter[] = [];

  if (episode.chaptersUrl?.trim()) {
    chapters = await fetchPodcastChapters(episode.chaptersUrl, durationHint);
  }

  let meta: PodcastEpisodeMeta | null = null;
  if (!chapters.length) {
    meta = await fetchEpisodeMetaFromTier34(episode, feedUrl);
    if (meta?.chaptersUrl?.trim()) {
      chapters = await fetchPodcastChapters(meta.chaptersUrl, durationHint);
    }
  } else if (!isAirGapEnabled()) {
    meta = await fetchEpisodeMetaFromTier34(episode, feedUrl);
  }

  const soundbiteChapters = soundbitesToAdChapters(meta?.soundbites ?? []);
  return mergePodcastChapters(chapters, soundbiteChapters);
}

export { parsePodcastChaptersJson };
