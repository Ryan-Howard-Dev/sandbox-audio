import { describe, expect, it } from 'vitest';
import type { PodcastEpisode } from './podcastStorage';
import { episodeEnvelope } from './podcastSearch';
import { streamCacheKey } from './streamCache';

describe('podcast episode downloaded filter', () => {
  it('uses the same stream cache key for episode envelope and offline listing', () => {
    const episode: PodcastEpisode = {
      id: 'ep-2523',
      feedId: 'jre-feed',
      title: '#2523 - Ali Siddiq',
      audioUrl: 'https://cdn.example.com/ep2523.mp3',
      publishedAt: Date.now(),
    };
    const env = episodeEnvelope(episode, 'The Joe Rogan Experience', 'https://art.example/jre.jpg');
    expect(streamCacheKey(env)).toBe(
      'ep-2523|#2523 - ali siddiq|the joe rogan experience|the joe rogan experience',
    );
  });
});
