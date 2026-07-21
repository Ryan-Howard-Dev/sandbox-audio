import { episodeEnvelope } from './podcastSearch';
import {
  loadEpisodesForFeed,
  loadSubscriptions,
  type PodcastEpisode,
} from './podcastStorage';
import { isEnvelopeStreamCached } from './streamCache';

export interface OfflinePodcastEpisode {
  feedId: string;
  feedTitle: string;
  feedArtworkUrl?: string;
  episode: PodcastEpisode;
}

export function loadOfflinePodcastEpisodes(): OfflinePodcastEpisode[] {
  const rows: OfflinePodcastEpisode[] = [];
  for (const sub of loadSubscriptions()) {
    for (const episode of loadEpisodesForFeed(sub.id)) {
      const env = episodeEnvelope(episode, sub.title, sub.artworkUrl);
      if (!isEnvelopeStreamCached(env)) continue;
      rows.push({
        feedId: sub.id,
        feedTitle: sub.title,
        feedArtworkUrl: sub.artworkUrl,
        episode,
      });
    }
  }
  return rows.sort(
    (a, b) => (b.episode.publishedAt ?? 0) - (a.episode.publishedAt ?? 0),
  );
}

export function countOfflinePodcastEpisodes(): number {
  return loadOfflinePodcastEpisodes().length;
}
