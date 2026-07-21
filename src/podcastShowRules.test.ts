import { describe, expect, it } from 'vitest';
import {
  applyRulesToSubscription,
  effectiveAutoDownloadWifiOnly,
  rulesFromSubscription,
} from './podcastShowRules';
import type { PodcastSubscription } from './podcastStorage';

const baseSub: PodcastSubscription = {
  id: 'feed-test',
  feedUrl: 'https://example.com/feed',
  title: 'Test Show',
  subscribedAt: 1000,
  autoDownload: false,
  autoDownloadCount: 3,
};

describe('podcastShowRules', () => {
  it('falls back to global Wi‑Fi pref when per-show unset', () => {
    expect(effectiveAutoDownloadWifiOnly({ ...baseSub })).toBe(true);
    expect(
      effectiveAutoDownloadWifiOnly({ ...baseSub, autoDownloadWifiOnly: false }),
    ).toBe(false);
  });

  it('merges remote rules when newer', () => {
    const remote = {
      feedId: 'feed-test',
      autoDownload: true,
      autoDownloadCount: 5,
      deletePlayedAfterDays: 14,
      updatedAt: 5000,
    };
    const patch = applyRulesToSubscription(
      { ...baseSub, rulesUpdatedAt: 1000 },
      remote,
    );
    expect(patch.autoDownload).toBe(true);
    expect(patch.autoDownloadCount).toBe(5);
    expect(patch.deletePlayedAfterDays).toBe(14);
  });

  it('serializes subscription to rules row', () => {
    const row = rulesFromSubscription({
      ...baseSub,
      autoDownload: true,
      deletePlayedAfterDays: 7,
      rulesUpdatedAt: 2000,
    });
    expect(row.feedId).toBe('feed-test');
    expect(row.deletePlayedAfterDays).toBe(7);
  });
});
