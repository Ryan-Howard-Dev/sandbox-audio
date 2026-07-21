/**
 * Per-show played-episode cache retention — delete offline audio after N days.
 */

import { episodeEnvelope } from './podcastSearch';
import {
  getEpisodePlaybackState,
  loadEpisodesForFeed,
  loadSubscriptions,
} from './podcastStorage';
import { isEnvelopeStreamCached, removeEnvelopeFromStreamCache } from './streamCache';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runPodcastPlayedRetention(): Promise<number> {
  let removed = 0;
  for (const sub of loadSubscriptions()) {
    const days = sub.deletePlayedAfterDays ?? 0;
    if (days <= 0) continue;
    const cutoff = Date.now() - days * DAY_MS;
    for (const episode of loadEpisodesForFeed(sub.id)) {
      const state = getEpisodePlaybackState(episode.id);
      const playedAt = state.playedAt;
      if (!playedAt || playedAt > cutoff) continue;
      const env = episodeEnvelope(episode, sub.title, sub.artworkUrl);
      if (!isEnvelopeStreamCached(env)) continue;
      if (await removeEnvelopeFromStreamCache(env)) removed += 1;
    }
  }
  return removed;
}
