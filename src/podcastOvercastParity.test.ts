import { describe, expect, it } from 'vitest';
import {
  cycleEpisodeVolumeBoostDb,
  EPISODE_VOLUME_BOOST_STEPS_DB,
  formatEpisodeVolumeBoostLabel,
  loadEpisodeVolumeBoostDb,
} from './podcastEpisodeBoost';
import {
  seekSecondsForNextChapter,
  seekSecondsForPreviousChapter,
} from './podcastChapters';
import { applyRulesToSubscription } from './podcastShowRules';
import type { PodcastSubscription } from './podcastStorage';

describe('podcastEpisodeBoost', () => {
  it('cycles volume boost steps', () => {
    const id = 'ep-vol-test';
    expect(loadEpisodeVolumeBoostDb(id)).toBe(0);
    const first = cycleEpisodeVolumeBoostDb(id);
    expect(EPISODE_VOLUME_BOOST_STEPS_DB).toContain(first);
    expect(formatEpisodeVolumeBoostLabel(first)).toMatch(/Vol|\+/);
  });
});

describe('podcast chapter navigation', () => {
  const chapters = [
    { title: 'Intro', startSeconds: 0 },
    { title: 'Interview', startSeconds: 120 },
    { title: 'Outro', startSeconds: 600 },
  ];

  it('seeks to previous chapter start', () => {
    expect(seekSecondsForPreviousChapter(chapters, 150)).toBe(0);
    expect(seekSecondsForPreviousChapter(chapters, 650)).toBe(120);
  });

  it('seeks to next chapter start', () => {
    expect(seekSecondsForNextChapter(chapters, 10)).toBe(120);
    expect(seekSecondsForNextChapter(chapters, 650)).toBeNull();
  });
});

describe('podcast show rules voice boost', () => {
  const baseSub: PodcastSubscription = {
    id: 'feed-vb',
    feedUrl: 'https://example.com/feed',
    title: 'Show',
    subscribedAt: 1000,
  };

  it('merges per-show voice boost from remote rules', () => {
    const patch = applyRulesToSubscription(baseSub, {
      feedId: 'feed-vb',
      voiceBoostDefault: true,
      updatedAt: 5000,
    });
    expect(patch.voiceBoostDefault).toBe(true);
  });
});
