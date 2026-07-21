/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import { parsePodcastChaptersJson } from './podcastChapters';

describe('parsePodcastChaptersJson', () => {
  it('parses Podcast Index chapter JSON', () => {
    const chapters = parsePodcastChaptersJson(
      {
        version: '1.2.0',
        chapters: [
          { startTime: 0, title: 'Intro' },
          { startTime: 125, title: 'Interview' },
        ],
      },
      3600,
    );
    expect(chapters).toHaveLength(2);
    expect(chapters[1].title).toBe('Interview');
    expect(chapters[1].startSeconds).toBe(125);
  });

  it('converts millisecond timestamps when needed', () => {
    const chapters = parsePodcastChaptersJson(
      {
        chapters: [{ startTime: 90_000, title: 'Late start' }],
      },
      600,
    );
    expect(chapters[0]?.startSeconds).toBe(90);
  });
});
