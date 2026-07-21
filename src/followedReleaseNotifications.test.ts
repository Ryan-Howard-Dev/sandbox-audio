import { beforeEach, describe, expect, it } from 'vitest';
import { prefsRemoveItem, prefsSetItem } from './prefsStorage';
import {
  getUnseenFollowedReleaseCount,
  processFollowedReleases,
  markFollowedReleasesSeen,
} from './followedReleaseNotifications';
import { saveFollowedReleaseNotifEnabled } from './followedReleaseNotificationSettings';

describe('followedReleaseNotifications', () => {
  beforeEach(() => {
    prefsRemoveItem('sandbox_followed_release_seen_ids');
    prefsRemoveItem('sandbox_followed_release_baseline_done');
    prefsRemoveItem('sandbox_followed_release_notified_ids');
    saveFollowedReleaseNotifEnabled(true);
  });

  it('baselines existing releases on first run', () => {
    expect(processFollowedReleases(['a', 'b'])).toBe(0);
    expect(getUnseenFollowedReleaseCount()).toBe(0);
    expect(processFollowedReleases(['c'])).toBe(1);
    expect(getUnseenFollowedReleaseCount()).toBe(1);
  });

  it('clears unseen count when releases are marked seen', () => {
    processFollowedReleases(['seed']);
    processFollowedReleases(['new-1', 'new-2']);
    expect(getUnseenFollowedReleaseCount()).toBe(2);
    markFollowedReleasesSeen(['new-1', 'new-2']);
    expect(getUnseenFollowedReleaseCount()).toBe(0);
  });

  it('keeps unseen count stable when the same release is polled again', () => {
    processFollowedReleases(['seed']);
    expect(processFollowedReleases(['drop-1'])).toBe(1);
    expect(processFollowedReleases(['drop-1'])).toBe(1);
    expect(getUnseenFollowedReleaseCount()).toBe(1);
  });
});
