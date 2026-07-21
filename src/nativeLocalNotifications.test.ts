import { describe, expect, it } from 'vitest';
import {
  MUSIC_RELEASE_CHANNEL_ID,
  PODCAST_EPISODE_CHANNEL_ID,
  notificationIdFromTag,
} from './nativeLocalNotifications';

describe('nativeLocalNotifications', () => {
  it('derives stable positive notification ids from tags', () => {
    const a = notificationIdFromTag('followed-release-abc');
    const b = notificationIdFromTag('followed-release-abc');
    const c = notificationIdFromTag('podcast-episode-xyz');
    expect(a).toBe(b);
    expect(a).toBeGreaterThan(0);
    expect(c).toBeGreaterThan(0);
    expect(a).not.toBe(c);
  });

  it('exports distinct channel ids for music and podcasts', () => {
    expect(MUSIC_RELEASE_CHANNEL_ID).not.toBe(PODCAST_EPISODE_CHANNEL_ID);
    expect(MUSIC_RELEASE_CHANNEL_ID).toContain('release');
    expect(PODCAST_EPISODE_CHANNEL_ID).toContain('podcast');
  });
});
