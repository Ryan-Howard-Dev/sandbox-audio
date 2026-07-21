/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  countUnplayedEpisodes,
  findNextUnplayedEpisode,
  isEpisodePlayed,
  isEpisodeUnplayed,
  markEpisodeCompleted,
  markEpisodePlayed,
  markEpisodeUnplayed,
  maybeAutoCompleteEpisode,
  type PodcastEpisode,
} from './podcastStorage';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

vi.mock('./prefsStorage', () => ({
  prefsGetItem: vi.fn(() => null),
  prefsSetItem: vi.fn(),
}));

const memory = new Map<string, string>();

const feedId = 'feed-test';
const epA: PodcastEpisode = {
  id: `${feedId}:ep-a`,
  feedId,
  title: 'Older',
  audioUrl: 'https://example.com/a.mp3',
  publishedAt: 1_000,
};
const epB: PodcastEpisode = {
  id: `${feedId}:ep-b`,
  feedId,
  title: 'Newer',
  audioUrl: 'https://example.com/b.mp3',
  publishedAt: 2_000,
};

describe('podcast playback state', () => {
  beforeEach(() => {
    memory.clear();
    vi.mocked(prefsGetItem).mockImplementation((key) => memory.get(key) ?? null);
    vi.mocked(prefsSetItem).mockImplementation((key, value) => {
      memory.set(key, value);
      return true;
    });
  });

  it('marks episodes played and unplayed', () => {
    expect(isEpisodeUnplayed(epA.id)).toBe(true);
    markEpisodePlayed(epA.id, 123);
    expect(isEpisodePlayed(epA.id)).toBe(true);
    markEpisodeUnplayed(epA.id);
    expect(isEpisodeUnplayed(epA.id)).toBe(true);
  });

  it('finds oldest unplayed episode first', () => {
    markEpisodePlayed(epA.id);
    const next = findNextUnplayedEpisode(feedId, [epB, epA]);
    expect(next?.id).toBe(epB.id);
  });

  it('counts unplayed episodes for a feed', () => {
    markEpisodePlayed(epA.id);
    expect(countUnplayedEpisodes(feedId, [epA, epB])).toBe(1);
  });

  it('auto-completes near the end of an episode', () => {
    expect(maybeAutoCompleteEpisode(epB.id, 920, 1000)).toBe(true);
    expect(isEpisodePlayed(epB.id)).toBe(true);
  });

  it('does not auto-complete early playback', () => {
    expect(maybeAutoCompleteEpisode(epB.id, 100, 1000)).toBe(false);
    expect(isEpisodeUnplayed(epB.id)).toBe(true);
  });

  it('markEpisodeCompleted sets played state', () => {
    markEpisodeCompleted(epA.id, 999);
    expect(isEpisodePlayed(epA.id)).toBe(true);
  });
});
