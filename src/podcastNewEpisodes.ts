/**
 * "What's waiting for me" across every subscription.
 *
 * The podcast library landed on a grid of show tiles, so finding new episodes meant tapping
 * into each show one at a time — the library looked static even when several episodes had
 * arrived. Episodes are the perishable thing in podcasts; subscriptions are the durable one.
 * This flattens the former across the latter so the landing tab has something that changes.
 */

import type { PodcastEpisode, PodcastSubscription } from './podcastStorage';

export interface NewPodcastEpisode {
  episode: PodcastEpisode;
  showTitle: string;
  showArtworkUrl?: string;
}

export interface SelectNewEpisodesOptions {
  /** Keep the strip short — this is a prompt to listen, not the full backlog. */
  limit?: number;
  /** Injected so the selector stays pure and testable. */
  isUnplayed: (episodeId: string) => boolean;
}

export function selectNewPodcastEpisodes(
  episodes: PodcastEpisode[],
  subscriptions: PodcastSubscription[],
  options: SelectNewEpisodesOptions,
): NewPodcastEpisode[] {
  const limit = options.limit ?? 12;
  if (limit <= 0) return [];

  const showsById = new Map(subscriptions.map((sub) => [sub.id, sub]));

  return episodes
    // An episode whose show was unsubscribed can linger in the cache; it is not "waiting".
    .filter((ep) => showsById.has(ep.feedId) && options.isUnplayed(ep.id))
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, limit)
    .map((episode) => {
      const show = showsById.get(episode.feedId);
      return {
        episode,
        showTitle: show?.title ?? '',
        showArtworkUrl: episode.artworkUrl ?? show?.artworkUrl,
      };
    });
}
