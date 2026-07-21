/**
 * Universal podcast ad skip — chapter/soundbite heuristics + manual forward jump.
 * Cannot remove DAI from CDN streams; only seeks past labeled markers or +N seconds.
 */

import type { PodcastChapter } from './podcastChapters';
import {
  findActiveChapterIndex,
  seekSecondsForNextChapter,
} from './podcastChapters';
import { loadPodcastManualAdSkipSeconds } from './podcastSettings';

/** Default manual skip when settings unavailable (e.g. unit tests). */
export const DEFAULT_MANUAL_AD_SKIP_SECONDS = 75;

/** @deprecated Use loadPodcastManualAdSkipSeconds() — kept for test imports. */
export const MANUAL_AD_SKIP_SECONDS = DEFAULT_MANUAL_AD_SKIP_SECONDS;

/**
 * Chapter titles matching common ad/sponsor labels from Podcast Index, publishers,
 * and host-read patterns. Works across any show — no per-podcast timestamps.
 */
const AD_CHAPTER_TITLE =
  /\b(advert(?:isement)?s?|sponsor(?:ed|ship)?|commercial|promo(?:tion)?s?|ad\s*break|paid\s+partner|brand\s+partner|brought\s+to\s+you\s+by|presented\s+by|thanks\s+to\s+our\s+sponsor|message\s+from\s+our\s+sponsor|use\s+code|promo\s+code|discount\s+code|listener\s+deal|special\s+offer|affiliate|marketing\s+message|host[\s-]?read\s+ad|mid[\s-]?roll|pre[\s-]?roll)\b/i;

export function isAdTaggedChapter(title: string): boolean {
  const trimmed = title?.trim();
  if (!trimmed) return false;
  return AD_CHAPTER_TITLE.test(trimmed);
}

/**
 * When playback is inside an ad-tagged chapter, return seek target at the next chapter start.
 * Returns null when not in an ad chapter or already on the last chapter.
 */
export function seekTargetAfterAdChapter(
  chapters: PodcastChapter[],
  currentSeconds: number,
): number | null {
  if (!chapters.length || currentSeconds < 0) return null;
  const activeIdx = findActiveChapterIndex(chapters, currentSeconds);
  const active = chapters[activeIdx];
  if (!active || !isAdTaggedChapter(active.title)) return null;
  const next = chapters[activeIdx + 1];
  if (!next) return null;
  if (next.startSeconds <= currentSeconds + 0.25) return null;
  return next.startSeconds;
}

function manualSkipSeconds(override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) return override;
  try {
    return loadPodcastManualAdSkipSeconds();
  } catch {
    return DEFAULT_MANUAL_AD_SKIP_SECONDS;
  }
}

/**
 * One-tap Skip Ad: jump past labeled ad chapters when available, otherwise +N seconds.
 * Cannot remove Megaphone DAI from the stream — only seeks playback forward.
 */
export function seekTargetForManualAdSkip(
  chapters: PodcastChapter[],
  currentSeconds: number,
  durationSeconds?: number,
  manualSkipSec?: number,
): number {
  const adTarget = seekTargetAfterAdChapter(chapters, currentSeconds);
  if (adTarget != null) return adTarget;

  const nextChapter = seekSecondsForNextChapter(chapters, currentSeconds);
  if (nextChapter != null) {
    const activeIdx = findActiveChapterIndex(chapters, currentSeconds);
    const upcoming = chapters[activeIdx + 1];
    if (upcoming && isAdTaggedChapter(upcoming.title)) {
      const afterAd = chapters[activeIdx + 2];
      if (afterAd && afterAd.startSeconds > currentSeconds + 0.25) {
        return afterAd.startSeconds;
      }
    }
  }

  const jumpSec = manualSkipSeconds(manualSkipSec);
  const jump = currentSeconds + jumpSec;
  if (durationSeconds != null && durationSeconds > 0) {
    return Math.min(jump, Math.max(0, durationSeconds - 1));
  }
  return jump;
}

/** Short hint for the Skip Ad button subtitle. */
export function manualAdSkipHint(
  chapters: PodcastChapter[],
  currentSeconds: number,
  manualSkipSec?: number,
): string {
  const adTarget = seekTargetAfterAdChapter(chapters, currentSeconds);
  if (adTarget != null) return 'Next chapter';
  const activeIdx = findActiveChapterIndex(chapters, currentSeconds);
  const upcoming = chapters[activeIdx + 1];
  if (upcoming && isAdTaggedChapter(upcoming.title)) {
    const afterAd = chapters[activeIdx + 2];
    if (afterAd) return 'Next chapter';
  }
  return `+${manualSkipSeconds(manualSkipSec)}s`;
}
