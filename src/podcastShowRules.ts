/**
 * Per-show podcast rules — auto-save, Wi‑Fi, played retention.
 */

import { loadPodcastAutoDownloadWifiOnly } from './podcastSettings';
import type { PodcastSubscription } from './podcastStorage';

export const PODCAST_AUTO_SAVE_COUNTS = [1, 2, 3, 5, 10] as const;
export const PODCAST_DELETE_PLAYED_DAYS_OPTIONS = [0, 7, 14, 30, 90] as const;

export type PodcastShowRulesRow = {
  feedId: string;
  autoDownload?: boolean;
  autoDownloadCount?: number;
  /** Per-show Wi‑Fi override; omit to use global default. */
  wifiOnly?: boolean;
  deletePlayedAfterDays?: number;
  voiceBoostDefault?: boolean;
  updatedAt: number;
};

export function effectiveAutoDownloadWifiOnly(sub: PodcastSubscription): boolean {
  if (sub.autoDownloadWifiOnly != null) return sub.autoDownloadWifiOnly;
  return loadPodcastAutoDownloadWifiOnly();
}

export function rulesFromSubscription(sub: PodcastSubscription): PodcastShowRulesRow {
  return {
    feedId: sub.id,
    autoDownload: sub.autoDownload,
    autoDownloadCount: sub.autoDownloadCount,
    wifiOnly: sub.autoDownloadWifiOnly,
    deletePlayedAfterDays: sub.deletePlayedAfterDays ?? 0,
    voiceBoostDefault: sub.voiceBoostDefault,
    updatedAt: sub.rulesUpdatedAt ?? sub.subscribedAt,
  };
}

export function applyRulesToSubscription(
  sub: PodcastSubscription,
  rules: PodcastShowRulesRow,
): Partial<PodcastSubscription> {
  if (rules.updatedAt < (sub.rulesUpdatedAt ?? 0)) return {};
  return {
    autoDownload: rules.autoDownload ?? sub.autoDownload,
    autoDownloadCount: rules.autoDownloadCount ?? sub.autoDownloadCount,
    autoDownloadWifiOnly: rules.wifiOnly,
    deletePlayedAfterDays: rules.deletePlayedAfterDays ?? sub.deletePlayedAfterDays,
    voiceBoostDefault:
      rules.voiceBoostDefault !== undefined ? rules.voiceBoostDefault : sub.voiceBoostDefault,
    rulesUpdatedAt: rules.updatedAt,
  };
}

export function formatDeletePlayedLabel(days: number): string {
  if (!days) return 'Never';
  if (days === 1) return '1 day';
  return `${days} days`;
}
