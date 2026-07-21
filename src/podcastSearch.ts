import type { MediaEnvelope } from './sandboxLayer1';
import { safePodcastPlaybackUrl } from './podcastRss';
import {
  findSubscription,
  loadAllEpisodes,
  type PodcastEpisode,
} from './podcastStorage';

export interface PodcastSearchHit {
  episode: PodcastEpisode;
  feedTitle: string;
  feedArtworkUrl?: string;
  envelope: MediaEnvelope;
  /** Local Whisper match snippet (Tier34 NAS). */
  transcriptSnippet?: string;
  searchSource?: 'library' | 'transcript';
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function episodeToEnvelope(
  episode: PodcastEpisode,
  feedTitle: string,
  feedArtworkUrl?: string,
): MediaEnvelope {
  return {
    envelopeId: `podcast:${episode.feedId}:${episode.id}`,
    title: episode.title,
    artist: feedTitle,
    album: feedTitle,
    url: safePodcastPlaybackUrl(episode.audioUrl),
    durationSeconds: episode.durationSeconds ?? 0,
    provider: 'https',
    transport: 'element-src',
    sourceId: episode.id,
    artworkUrl: episode.artworkUrl ?? feedArtworkUrl,
    mimeType: 'audio/mpeg',
  };
}

export function searchPodcastLibrary(query: string, limit = 12): PodcastSearchHit[] {
  const q = normalizeQuery(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return [];

  const hits: PodcastSearchHit[] = [];
  for (const episode of loadAllEpisodes()) {
    const feed = findSubscription(episode.feedId);
    const feedTitle = feed?.title ?? 'Podcast';
    const hay = normalizeQuery(
      `${episode.title} ${episode.description ?? ''} ${feedTitle}`,
    );
    if (!tokens.every((t) => hay.includes(t))) continue;
    hits.push({
      episode,
      feedTitle,
      feedArtworkUrl: feed?.artworkUrl,
      envelope: episodeToEnvelope(episode, feedTitle, feed?.artworkUrl),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function episodeEnvelope(
  episode: PodcastEpisode,
  feedTitle: string,
  feedArtworkUrl?: string,
): MediaEnvelope {
  return episodeToEnvelope(episode, feedTitle, feedArtworkUrl);
}
