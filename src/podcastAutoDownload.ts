import { episodeEnvelope } from './podcastSearch';
import { effectiveAutoDownloadWifiOnly } from './podcastShowRules';
import { findSubscription, type PodcastEpisode } from './podcastStorage';
import { isWifiNetwork } from './networkPlayPolicy';
import { loadStreamCacheEnabled } from './sandboxSettings';
import {
  cacheEnvelopeForOffline,
  isEnvelopeStreamCached,
  removeEnvelopeFromStreamCache,
} from './streamCache';

export async function runPodcastAutoDownloadsForFeed(
  feedId: string,
  episodes: PodcastEpisode[],
): Promise<number> {
  const sub = findSubscription(feedId);
  if (!sub?.autoDownload || !loadStreamCacheEnabled()) return 0;
  if (effectiveAutoDownloadWifiOnly(sub) && !isWifiNetwork()) return 0;

  const count = Math.max(1, Math.min(sub.autoDownloadCount ?? 3, 10));
  let downloaded = 0;
  const keep = episodes.slice(0, count);

  for (const episode of keep) {
    const env = episodeEnvelope(episode, sub.title, sub.artworkUrl);
    if (isEnvelopeStreamCached(env)) continue;
    try {
      await cacheEnvelopeForOffline(env);
      downloaded += 1;
    } catch {
      /* skip individual failures */
    }
  }

  for (const episode of episodes.slice(count)) {
    const env = episodeEnvelope(episode, sub.title, sub.artworkUrl);
    if (!isEnvelopeStreamCached(env)) continue;
    try {
      await removeEnvelopeFromStreamCache(env);
    } catch {
      /* skip */
    }
  }

  return downloaded;
}
