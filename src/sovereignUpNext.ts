/**
 * Sovereign Up Next — unified music + podcast queue modes.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import {
  findSubscription,
  isEpisodeUnplayed,
  isPodcastEnvelopeId,
  loadEpisodesForFeed,
  parsePodcastEpisodeId,
  type PodcastEpisode,
} from './podcastStorage';
import { episodeEnvelope } from './podcastSearch';
import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { QueueAdvanceInput, QueueAdvanceResult } from './play/queueAdvancePolicy';
import { computeNextQueueIndex } from './play/queueAdvancePolicy';
import { countDistinctQueueEnvelopeIds } from './play/radioQueueDedupe';

export const SOVEREIGN_UP_NEXT_ENABLED_KEY = 'sandbox_sovereign_up_next_enabled';
export const SOVEREIGN_UP_NEXT_UNPLAYED_KEY = 'sandbox_sovereign_up_next_unplayed_only';
export const SOVEREIGN_UP_NEXT_STOP_AFTER_KEY = 'sandbox_sovereign_up_next_stop_after_episodes';
export const SOVEREIGN_UP_NEXT_INSERT_TOP_KEY = 'sandbox_sovereign_up_next_insert_newest_top';

export const SOVEREIGN_UP_NEXT_STOP_AFTER_OPTIONS = [0, 1, 2, 3, 5, 10] as const;

export const SOVEREIGN_UP_NEXT_CHANGE_EVENT = 'sandbox-sovereign-up-next-change';

export type SovereignUpNextSettings = {
  enabled: boolean;
  unplayedOnly: boolean;
  stopAfterEpisodes: number;
  insertNewestAtTop: boolean;
};

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

function loadNumber(key: string, fallback: number): number {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(SOVEREIGN_UP_NEXT_CHANGE_EVENT));
    window.dispatchEvent(new Event('sandbox-settings-change'));
  }
}

export function loadSovereignUpNextSettings(): SovereignUpNextSettings {
  const stopRaw = loadNumber(SOVEREIGN_UP_NEXT_STOP_AFTER_KEY, 0);
  const stopAfterEpisodes = SOVEREIGN_UP_NEXT_STOP_AFTER_OPTIONS.includes(
    stopRaw as (typeof SOVEREIGN_UP_NEXT_STOP_AFTER_OPTIONS)[number],
  )
    ? stopRaw
    : 0;
  return {
    enabled: loadBool(SOVEREIGN_UP_NEXT_ENABLED_KEY, false),
    unplayedOnly: loadBool(SOVEREIGN_UP_NEXT_UNPLAYED_KEY, false),
    stopAfterEpisodes,
    insertNewestAtTop: loadBool(SOVEREIGN_UP_NEXT_INSERT_TOP_KEY, false),
  };
}

export function saveSovereignUpNextSettings(patch: Partial<SovereignUpNextSettings>): void {
  const cur = loadSovereignUpNextSettings();
  const next = { ...cur, ...patch };
  prefsSetItem(SOVEREIGN_UP_NEXT_ENABLED_KEY, String(next.enabled));
  prefsSetItem(SOVEREIGN_UP_NEXT_UNPLAYED_KEY, String(next.unplayedOnly));
  prefsSetItem(SOVEREIGN_UP_NEXT_STOP_AFTER_KEY, String(next.stopAfterEpisodes));
  prefsSetItem(SOVEREIGN_UP_NEXT_INSERT_TOP_KEY, String(next.insertNewestAtTop));
  notify();
}

export function isEnvelopeEligibleForUpNext(
  env: MediaEnvelope,
  settings: SovereignUpNextSettings,
): boolean {
  if (!settings.enabled || !settings.unplayedOnly) return true;
  if (!isPodcastEnvelopeId(env.envelopeId)) return true;
  const episodeId = parsePodcastEpisodeId(env.envelopeId);
  if (!episodeId) return true;
  return isEpisodeUnplayed(episodeId);
}

export function filterQueueForUpNext(
  queue: MediaEnvelope[],
  settings: SovereignUpNextSettings,
): MediaEnvelope[] {
  if (!settings.enabled || !settings.unplayedOnly) return queue;
  return queue.filter((env) => isEnvelopeEligibleForUpNext(env, settings));
}

export type UpNextInsertMode = 'append' | 'play-next';

export function mergeIntoUpNextQueue(
  queue: MediaEnvelope[],
  queueIndex: number,
  incoming: MediaEnvelope[],
  settings: SovereignUpNextSettings,
  mode: UpNextInsertMode = 'append',
): MediaEnvelope[] {
  if (incoming.length === 0) return queue;
  const existing = new Set(queue.map((e) => e.envelopeId));
  let batch = incoming.filter((env) => {
    if (existing.has(env.envelopeId)) return false;
    return isEnvelopeEligibleForUpNext(env, settings);
  });
  if (batch.length === 0) return queue;

  const insertAtTop =
    mode === 'play-next' ||
    (settings.enabled && settings.insertNewestAtTop && mode === 'append');

  if (!insertAtTop) {
    return [...queue, ...batch];
  }

  if (settings.insertNewestAtTop) {
    batch = [...batch].reverse();
  }

  const insertAt =
    queue.length === 0 ? 0 : queueIndex >= 0 ? Math.min(queueIndex + 1, queue.length) : queue.length;
  const next = [...queue];
  next.splice(insertAt, 0, ...batch);
  return next;
}

export function computeNextQueueIndexWithUpNext(
  input: QueueAdvanceInput & {
    queue: MediaEnvelope[];
    settings: SovereignUpNextSettings;
  },
): QueueAdvanceResult {
  const distinctTrackCount = countDistinctQueueEnvelopeIds(input.queue);
  const base = computeNextQueueIndex({ ...input, distinctTrackCount });
  if (!input.settings.enabled || !input.settings.unplayedOnly) return base;
  if (base.action === 'none' || base.action === 'repeat-one') return base;

  let idx = base.action === 'wrap' ? 0 : base.index;
  const { queue } = input;
  if (queue.length === 0) return { action: 'none' };

  let guard = 0;
  while (guard < queue.length) {
    const env = queue[idx];
    if (!env || isEnvelopeEligibleForUpNext(env, input.settings)) {
      if (base.action === 'wrap') return { action: 'wrap', index: idx };
      return { action: 'advance', index: idx };
    }
    idx += 1;
    if (idx >= queue.length) {
      if (input.repeatMode === 'all' && distinctTrackCount > 1) {
        idx = 0;
      } else {
        return { action: 'none' };
      }
    }
    guard += 1;
  }
  return { action: 'none' };
}

export function shouldStopUpNextAfterPodcast(
  settings: SovereignUpNextSettings,
  podcastEpisodesCompleted: number,
  endedEnvelope: MediaEnvelope | null,
): boolean {
  if (!settings.enabled || settings.stopAfterEpisodes <= 0) return false;
  if (!endedEnvelope || !isPodcastEnvelopeId(endedEnvelope.envelopeId)) return false;
  return podcastEpisodesCompleted >= settings.stopAfterEpisodes;
}

export function buildPodcastQueueForFeed(
  feedId: string,
  options: {
    unplayedOnly?: boolean;
    newestFirst?: boolean;
    limit?: number;
  } = {},
): MediaEnvelope[] {
  const sub = findSubscription(feedId);
  if (!sub) return [];
  let episodes: PodcastEpisode[] = loadEpisodesForFeed(feedId);
  if (options.unplayedOnly) {
    episodes = episodes.filter((ep) => isEpisodeUnplayed(ep.id));
  }
  episodes = [...episodes].sort(
    (a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0),
  );
  if (options.newestFirst === false) {
    episodes.reverse();
  }
  const limit = options.limit ?? episodes.length;
  return episodes.slice(0, limit).map((ep) => episodeEnvelope(ep, sub.title, sub.artworkUrl));
}
