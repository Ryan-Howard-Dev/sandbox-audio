import { describe, expect, it } from 'vitest';
import {
  FOLLOWED_FEED_MIN_FETCH_GAP_MS,
  FOLLOWED_FEED_POLL_VISIBLE_MS,
  followedFeedPollIntervalMs,
  shouldFetchFollowedFeedNetwork,
} from './followedReleasePolling';

describe('followedReleasePolling', () => {
  it('uses a 12-hour visible interval and no hidden interval', () => {
    expect(FOLLOWED_FEED_POLL_VISIBLE_MS).toBe(12 * 60 * 60 * 1000);
    expect(FOLLOWED_FEED_MIN_FETCH_GAP_MS).toBe(12 * 60 * 60 * 1000);
    expect(followedFeedPollIntervalMs(true)).toBe(FOLLOWED_FEED_POLL_VISIBLE_MS);
    expect(followedFeedPollIntervalMs(false)).toBeNull();
  });

  it('forces fetch on follow/unfollow', () => {
    const now = 1_000_000;
    expect(
      shouldFetchFollowedFeedNetwork(now - 1_000, true, now),
    ).toBe(true);
  });

  it('respects minimum fetch gap for resume/foreground', () => {
    const now = 1_000_000;
    const recent = now - FOLLOWED_FEED_MIN_FETCH_GAP_MS + 1_000;
    expect(shouldFetchFollowedFeedNetwork(recent, false, now)).toBe(false);
    expect(
      shouldFetchFollowedFeedNetwork(now - FOLLOWED_FEED_MIN_FETCH_GAP_MS, false, now),
    ).toBe(true);
  });
});
