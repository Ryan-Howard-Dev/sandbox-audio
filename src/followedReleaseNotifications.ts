/**
 * Subtle in-app notifications for new releases from followed artists.
 * Badge on Discover tab; cleared when the user opens the Feed tab.
 * System notifications when permission granted and the app is in background.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  loadFollowedReleaseNotifEnabled,
  FOLLOWED_RELEASE_NOTIF_CHANGE_EVENT,
} from './followedReleaseNotificationSettings';
import { showNativeBackgroundAlert } from './nativeLocalNotifications';

const SEEN_IDS_KEY = 'sandbox_followed_release_seen_ids';
const BASELINE_DONE_KEY = 'sandbox_followed_release_baseline_done';
const NOTIFIED_IDS_KEY = 'sandbox_followed_release_notified_ids';

export const FOLLOWED_RELEASE_NOTIF_UPDATE_EVENT = 'sandbox-followed-release-notif-update';

export type FollowedReleaseNotifInput = {
  id: string;
  title?: string;
  artist?: string;
};

const listeners = new Set<() => void>();
let notifyDepth = 0;

function notify(): void {
  if (notifyDepth > 0) return;
  notifyDepth += 1;
  try {
    listeners.forEach((fn) => fn());
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(FOLLOWED_RELEASE_NOTIF_UPDATE_EVENT));
    }
  } finally {
    notifyDepth -= 1;
  }
}

function readSeenIds(): Set<string> {
  try {
    const raw = prefsGetItem(SEEN_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === 'string' && id.trim()));
  } catch {
    return new Set();
  }
}

function writeSeenIds(ids: Set<string>): void {
  prefsSetItem(SEEN_IDS_KEY, JSON.stringify([...ids].slice(-500)));
}

function readNotifiedIds(): Set<string> {
  try {
    const raw = prefsGetItem(NOTIFIED_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id) => typeof id === 'string' && id.trim()));
  } catch {
    return new Set();
  }
}

function writeNotifiedIds(ids: Set<string>): void {
  prefsSetItem(NOTIFIED_IDS_KEY, JSON.stringify([...ids].slice(-500)));
}

function showBackgroundReleaseNotifications(items: FollowedReleaseNotifInput[]): void {
  if (items.length === 0) return;

  void (async () => {
    const notified = readNotifiedIds();
    let changed = false;

    for (const item of items.slice(0, 3)) {
      if (notified.has(item.id)) continue;
      const artist = item.artist?.trim() || 'Artist you follow';
      const title = item.title?.trim() || 'New release';
      const tag = `followed-release-${item.id}`;
      const posted = await showNativeBackgroundAlert({
        channel: 'music-release',
        tag,
        title: `${artist} — ${title}`,
        body: 'New music from an artist you follow',
      });
      if (!posted) continue;
      notified.add(item.id);
      changed = true;
    }

    if (changed) writeNotifiedIds(notified);
  })();
}

let cachedUnseenCount = 0;

export function getUnseenFollowedReleaseCount(): number {
  return cachedUnseenCount;
}

function normalizeReleaseInputs(
  releases: string[] | FollowedReleaseNotifInput[],
): FollowedReleaseNotifInput[] {
  if (releases.length === 0) return [];
  if (typeof releases[0] === 'string') {
    return (releases as string[]).map((id) => ({ id }));
  }
  return releases as FollowedReleaseNotifInput[];
}

/** Compare feed release IDs to seen set; returns unseen count (updates cache). */
export function processFollowedReleases(
  releases: string[] | FollowedReleaseNotifInput[],
): number {
  const items = normalizeReleaseInputs(releases);
  const ids = items.map((r) => r.id);

  if (!loadFollowedReleaseNotifEnabled()) {
    cachedUnseenCount = 0;
    notify();
    return 0;
  }

  const seen = readSeenIds();
  const baselineDone = prefsGetItem(BASELINE_DONE_KEY) === 'true';

  if (!baselineDone) {
    for (const id of ids) seen.add(id);
    writeSeenIds(seen);
    prefsSetItem(BASELINE_DONE_KEY, 'true');
    cachedUnseenCount = 0;
    notify();
    return 0;
  }

  const newlyDetected = items.filter((r) => !seen.has(r.id));
  cachedUnseenCount = newlyDetected.length;
  if (newlyDetected.length > 0) {
    showBackgroundReleaseNotifications(newlyDetected);
  }
  notify();
  return cachedUnseenCount;
}

export function markFollowedReleasesSeen(releaseIds: string[]): void {
  if (releaseIds.length === 0) return;
  const seen = readSeenIds();
  const notified = readNotifiedIds();
  let changed = false;
  for (const id of releaseIds) {
    if (!seen.has(id)) {
      seen.add(id);
      changed = true;
    }
    if (!notified.has(id)) {
      notified.add(id);
    }
  }
  if (!changed) return;
  writeSeenIds(seen);
  writeNotifiedIds(notified);
  cachedUnseenCount = 0;
  notify();
}

export function subscribeFollowedReleaseNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function initFollowedReleaseNotificationListeners(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(FOLLOWED_RELEASE_NOTIF_CHANGE_EVENT, () => {
    cachedUnseenCount = 0;
    notify();
  });
}
