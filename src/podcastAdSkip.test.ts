/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MANUAL_AD_SKIP_SECONDS,
  isAdTaggedChapter,
  manualAdSkipHint,
  seekTargetAfterAdChapter,
  seekTargetForManualAdSkip,
} from './podcastAdSkip';
import type { PodcastChapter } from './podcastChapters';

const chapters: PodcastChapter[] = [
  { title: 'Intro', startSeconds: 0 },
  { title: 'Sponsored message from Acme', startSeconds: 120 },
  { title: 'Interview', startSeconds: 300 },
  { title: 'Advertisement break', startSeconds: 1800 },
  { title: 'Outro', startSeconds: 1900 },
];

describe('isAdTaggedChapter', () => {
  it('matches sponsor and advertisement titles', () => {
    expect(isAdTaggedChapter('Sponsored message from Acme')).toBe(true);
    expect(isAdTaggedChapter('Advertisement break')).toBe(true);
    expect(isAdTaggedChapter('Commercial')).toBe(true);
    expect(isAdTaggedChapter('Promo code inside')).toBe(true);
  });

  it('matches host-read and brought-to-you patterns', () => {
    expect(isAdTaggedChapter('Brought to you by NordVPN')).toBe(true);
    expect(isAdTaggedChapter('Presented by Squarespace')).toBe(true);
    expect(isAdTaggedChapter('Host-read ad')).toBe(true);
    expect(isAdTaggedChapter('Mid-roll break')).toBe(true);
    expect(isAdTaggedChapter('Pre-roll sponsor')).toBe(true);
  });

  it('ignores normal chapter titles', () => {
    expect(isAdTaggedChapter('Intro')).toBe(false);
    expect(isAdTaggedChapter('Interview with guest')).toBe(false);
    expect(isAdTaggedChapter('Chapter 3 — The debate')).toBe(false);
  });
});

describe('seekTargetAfterAdChapter', () => {
  it('returns next chapter when inside ad-tagged segment', () => {
    expect(seekTargetAfterAdChapter(chapters, 150)).toBe(300);
    expect(seekTargetAfterAdChapter(chapters, 1850)).toBe(1900);
  });

  it('returns null outside ad chapters', () => {
    expect(seekTargetAfterAdChapter(chapters, 50)).toBeNull();
    expect(seekTargetAfterAdChapter(chapters, 400)).toBeNull();
  });

  it('returns null on last ad chapter with no successor', () => {
    const tail: PodcastChapter[] = [
      { title: 'Main', startSeconds: 0 },
      { title: 'Sponsor read', startSeconds: 100 },
    ];
    expect(seekTargetAfterAdChapter(tail, 150)).toBeNull();
  });
});

describe('seekTargetForManualAdSkip', () => {
  const manual = 90;

  it('jumps to next chapter when inside ad-tagged segment', () => {
    expect(seekTargetForManualAdSkip(chapters, 150, 2000, manual)).toBe(300);
  });

  it('falls back to +N seconds without chapter markers', () => {
    expect(seekTargetForManualAdSkip([], 565, 7806, manual)).toBe(565 + manual);
  });

  it('clamps forward jump to episode duration', () => {
    expect(seekTargetForManualAdSkip([], 7790, 7806, manual)).toBe(7805);
  });

  it('jumps to upcoming ad chapter end from just before ad marker', () => {
    expect(seekTargetForManualAdSkip(chapters, 115, 2000, manual)).toBe(300);
  });

  it('uses default manual skip constant in tests without override', () => {
    expect(seekTargetForManualAdSkip([], 100, 5000, DEFAULT_MANUAL_AD_SKIP_SECONDS)).toBe(
      100 + DEFAULT_MANUAL_AD_SKIP_SECONDS,
    );
  });
});

describe('manualAdSkipHint', () => {
  it('shows next chapter when ad segment is active', () => {
    expect(manualAdSkipHint(chapters, 150)).toBe('Next chapter');
  });

  it('shows +Ns when no labeled ad chapters apply', () => {
    expect(manualAdSkipHint([], 565, 90)).toBe('+90s');
  });
});
