/**
 * Per-episode volume boost (Overcast-style loudness lift, separate from Voice Boost EQ).
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { PODCAST_PLAYBACK_REFRESH_EVENT } from './podcastSettings';

export const PODCAST_EPISODE_VOLUME_BOOST_KEY = 'sandbox_podcast_episode_volume_boost_v1';
export const EPISODE_VOLUME_BOOST_STEPS_DB = [0, 3, 6, 9, 12] as const;

export const PODCAST_EPISODE_BOOST_CHANGE_EVENT = 'sandbox-podcast-episode-boost-change';

function readMap(): Record<string, number> {
  const raw = prefsGetItem(PODCAST_EPISODE_VOLUME_BOOST_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, number>): void {
  prefsSetItem(PODCAST_EPISODE_VOLUME_BOOST_KEY, JSON.stringify(map));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PODCAST_EPISODE_BOOST_CHANGE_EVENT));
    window.dispatchEvent(new Event(PODCAST_PLAYBACK_REFRESH_EVENT));
  }
}

export function loadEpisodeVolumeBoostDb(episodeId: string): number {
  const db = readMap()[episodeId];
  if (db == null || !Number.isFinite(db)) return 0;
  return EPISODE_VOLUME_BOOST_STEPS_DB.includes(db as (typeof EPISODE_VOLUME_BOOST_STEPS_DB)[number])
    ? db
    : 0;
}

export function saveEpisodeVolumeBoostDb(episodeId: string, db: number): number {
  const clamped = EPISODE_VOLUME_BOOST_STEPS_DB.includes(
    db as (typeof EPISODE_VOLUME_BOOST_STEPS_DB)[number],
  )
    ? db
    : 0;
  const map = readMap();
  if (clamped === 0) {
    delete map[episodeId];
  } else {
    map[episodeId] = clamped;
  }
  writeMap(map);
  return clamped;
}

export function cycleEpisodeVolumeBoostDb(episodeId: string): number {
  const cur = loadEpisodeVolumeBoostDb(episodeId);
  const idx = EPISODE_VOLUME_BOOST_STEPS_DB.indexOf(
    cur as (typeof EPISODE_VOLUME_BOOST_STEPS_DB)[number],
  );
  const next =
    idx < 0
      ? EPISODE_VOLUME_BOOST_STEPS_DB[1]
      : EPISODE_VOLUME_BOOST_STEPS_DB[(idx + 1) % EPISODE_VOLUME_BOOST_STEPS_DB.length];
  return saveEpisodeVolumeBoostDb(episodeId, next);
}

export function formatEpisodeVolumeBoostLabel(db: number): string {
  if (!db) return 'Vol';
  return `+${db}dB`;
}
