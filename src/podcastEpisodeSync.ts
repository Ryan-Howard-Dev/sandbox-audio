import { runPodcastAutoDownloadsForFeed } from './podcastAutoDownload';
import { processNewPodcastEpisodes } from './podcastEpisodeNotifications';
import { findSubscription, loadEpisodesForFeed, type PodcastEpisode } from './podcastStorage';

/** Side effects after episode list changes: notifications + auto-download. */
export function onPodcastEpisodesUpdated(
  feedId: string,
  episodes: PodcastEpisode[],
): void {
  const sub = findSubscription(feedId);
  const feedTitle = sub?.title ?? 'Podcast';
  processNewPodcastEpisodes(feedId, feedTitle, episodes);
  void runPodcastAutoDownloadsForFeed(feedId, episodes);
}

export function diffAndNotifyPodcastFeed(feedId: string): void {
  const episodes = loadEpisodesForFeed(feedId);
  onPodcastEpisodesUpdated(feedId, episodes);
}
