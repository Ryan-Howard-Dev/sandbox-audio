import { describe, expect, it } from 'vitest';
import {
  extractYoutubeVideoId,
  lockerEntryToVideoItem,
  tier34ItemToDiscovery,
  youtubeEmbedUrl,
} from './discoveryVideoFeed';
import type { LockerEntry } from './lockerStorage';

describe('discoveryVideoFeed', () => {
  it('extracts YouTube video ids from common URL shapes', () => {
    expect(extractYoutubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://youtu.be/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(extractYoutubeVideoId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toBe(
      'dQw4w9WgXcQ',
    );
  });

  it('maps locker entries and tier34 items', () => {
    const entry: LockerEntry = {
      id: 'v1',
      title: 'Live Set',
      artist: 'Artist',
      genre: 'video',
      durationSeconds: 120,
      url: '/locker/live.mp4',
      addedAt: 1,
    };
    const locker = lockerEntryToVideoItem(entry);
    expect(locker.source).toBe('locker');
    expect(locker.streamUrl).toBe('/locker/live.mp4');

    const remote = tier34ItemToDiscovery({
      id: 'abc',
      title: 'Official Video',
      channel: 'VEVO',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      watchUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    });
    expect(remote.source).toBe('tier34');
    expect(remote.channel).toBe('VEVO');
  });

  it('builds nocookie embed URLs', () => {
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toContain('youtube-nocookie.com/embed/dQw4w9WgXcQ');
    expect(youtubeEmbedUrl('dQw4w9WgXcQ')).toContain('autoplay=1');
  });
});
