import { describe, expect, it } from 'vitest';
import { catalogEpisodeToHit, isSubscribedToFeed } from './podcastCatalog';
import type { PodcastCatalogEpisode } from './podcastCatalog';

describe('podcastCatalog', () => {
  it('maps catalog episodes to playable envelopes', () => {
    const ep: PodcastCatalogEpisode = {
      id: 'ep-1',
      title: 'Episode One',
      feedTitle: 'Global Show',
      feedUrl: 'https://example.com/feed.xml',
      audioUrl: 'https://cdn.example.com/ep1.mp3',
      durationSeconds: 3600,
      source: 'podcastindex',
    };
    const hit = catalogEpisodeToHit(ep);
    expect(hit.envelope.title).toBe('Episode One');
    expect(hit.envelope.artist).toBe('Global Show');
    expect(hit.envelope.envelopeId).toContain('podcast:');
    expect(hit.envelope.url).toContain('ep1.mp3');
  });

  it('detects subscribed feeds', () => {
    expect(isSubscribedToFeed('https://unknown.example/feed')).toBe(false);
  });
});
