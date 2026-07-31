import { describe, expect, it } from 'vitest';
import type { PodcastEpisode, PodcastSubscription } from './podcastStorage';
import { selectNewPodcastEpisodes } from './podcastNewEpisodes';

function ep(id: string, feedId: string, publishedAt: number): PodcastEpisode {
  return { id, feedId, title: `Episode ${id}`, audioUrl: `https://x/${id}`, publishedAt };
}

const subs = [
  { id: 'f1', title: 'The Peter McCormack Show' },
  { id: 'f2', title: 'The Joe Rogan Experience' },
] as unknown as PodcastSubscription[];

const unplayedAll = { isUnplayed: () => true };

describe('selectNewPodcastEpisodes', () => {
  it('flattens unplayed episodes across shows, newest first', () => {
    const result = selectNewPodcastEpisodes(
      [ep('a', 'f1', 100), ep('b', 'f2', 300), ep('c', 'f1', 200)],
      subs,
      unplayedAll,
    );
    expect(result.map((r) => r.episode.id)).toEqual(['b', 'c', 'a']);
  });

  it('attaches the show title so a cross-show list stays legible', () => {
    const result = selectNewPodcastEpisodes([ep('b', 'f2', 300)], subs, unplayedAll);
    expect(result[0]!.showTitle).toBe('The Joe Rogan Experience');
  });

  it('excludes played episodes', () => {
    const result = selectNewPodcastEpisodes([ep('a', 'f1', 100), ep('b', 'f2', 300)], subs, {
      isUnplayed: (id) => id !== 'b',
    });
    expect(result.map((r) => r.episode.id)).toEqual(['a']);
  });

  it('drops episodes whose show is no longer subscribed', () => {
    const result = selectNewPodcastEpisodes([ep('z', 'gone', 400)], subs, unplayedAll);
    expect(result).toEqual([]);
  });

  it('caps the strip so it prompts rather than dumps the backlog', () => {
    const many = Array.from({ length: 30 }, (_, i) => ep(`e${i}`, 'f1', i));
    expect(selectNewPodcastEpisodes(many, subs, { ...unplayedAll, limit: 5 })).toHaveLength(5);
    expect(selectNewPodcastEpisodes(many, subs, { ...unplayedAll, limit: 0 })).toEqual([]);
  });

  it('treats a missing publish date as oldest rather than crashing the sort', () => {
    const undated = { ...ep('u', 'f1', 0), publishedAt: undefined };
    const result = selectNewPodcastEpisodes([undated, ep('a', 'f1', 100)], subs, unplayedAll);
    expect(result.map((r) => r.episode.id)).toEqual(['a', 'u']);
  });
});
