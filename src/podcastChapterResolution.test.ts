/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  mergePodcastChapters,
  soundbitesToAdChapters,
} from './podcastChapterResolution';

describe('soundbitesToAdChapters', () => {
  it('creates chapters only for ad-like soundbite titles', () => {
    const chapters = soundbitesToAdChapters([
      { startTime: 120, title: 'Sponsor message from Acme' },
      { startTime: 600, title: 'Funny moment' },
      { startTime: 1800, title: 'Commercial break' },
    ]);
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({ title: 'Sponsor message from Acme', startSeconds: 120 });
    expect(chapters[1]).toEqual({ title: 'Commercial break', startSeconds: 1800 });
  });
});

describe('mergePodcastChapters', () => {
  it('dedupes by start time and sorts', () => {
    const merged = mergePodcastChapters(
      [
        { title: 'Intro', startSeconds: 0 },
        { title: 'Sponsor read', startSeconds: 120 },
      ],
      [
        { title: 'Sponsored message from Acme', startSeconds: 120 },
        { title: 'Main', startSeconds: 300 },
      ],
    );
    expect(merged).toEqual([
      { title: 'Intro', startSeconds: 0 },
      { title: 'Sponsored message from Acme', startSeconds: 120 },
      { title: 'Main', startSeconds: 300 },
    ]);
  });
});
