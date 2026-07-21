import { prefsGetItem, prefsSetItem } from './prefsStorage';
import { loadPodcastNotifEnabled, PODCAST_SETTINGS_CHANGE_EVENT } from './podcastSettings';
import { showNativeBackgroundAlert } from './nativeLocalNotifications';
import {
  loadAllEpisodes,
  loadSubscriptions,
  type PodcastEpisode,
} from './podcastStorage';

const SEEN_IDS_KEY = 'sandbox_podcast_episode_seen_ids';
const NOTIFIED_IDS_KEY = 'sandbox_podcast_episode_notified_ids';
const BASELINE_DONE_KEY = 'sandbox_podcast_notif_baseline_done';

export const PODCAST_EPISODE_NOTIF_UPDATE_EVENT = 'sandbox-podcast-episode-notif-update';

export type PodcastEpisodeNotifInput = {
  id: string;
  title?: string;
  feedTitle?: string;
};

const listeners = new Set<() => void>();
let cachedUnseenCount = 0;

function notify(): void {
  listeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PODCAST_EPISODE_NOTIF_UPDATE_EVENT));
  }
}

function readIdSet(key: string): Set<string> {
  try {
    const raw = prefsGetItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as string[];
    return new Set(parsed.filter((id) => typeof id === 'string' && id.trim()));
  } catch {
    return new Set();
  }
}

function writeIdSet(key: string, ids: Set<string>): void {
  prefsSetItem(key, JSON.stringify([...ids].slice(-1000)));
}

export function episodeNotifId(feedId: string, episodeId: string): string {
  return `${feedId}:${episodeId}`;
}

function showBackgroundPodcastNotifications(items: PodcastEpisodeNotifInput[]): void {
  if (items.length === 0) return;

  void (async () => {
    const notified = readIdSet(NOTIFIED_IDS_KEY);
    let changed = false;

    for (const item of items.slice(0, 3)) {
      if (notified.has(item.id)) continue;
      const show = item.feedTitle?.trim() || 'Podcast';
      const title = item.title?.trim() || 'New episode';
      const tag = `podcast-episode-${item.id}`;
      const posted = await showNativeBackgroundAlert({
        channel: 'podcast-episode',
        tag,
        title: `${show} — ${title}`,
        body: 'New podcast episode available',
      });
      if (!posted) continue;
      notified.add(item.id);
      changed = true;
    }

    if (changed) writeIdSet(NOTIFIED_IDS_KEY, notified);
  })();
}

function recomputeUnseenCount(seen: Set<string>): number {
  let count = 0;
  for (const sub of loadSubscriptions()) {
    const episodes = loadAllEpisodes().filter((ep) => ep.feedId === sub.id);
    for (const ep of episodes) {
      if (!seen.has(episodeNotifId(sub.id, ep.id))) count += 1;
    }
  }
  return count;
}

export function getUnseenPodcastEpisodeCount(): number {
  return cachedUnseenCount;
}

export function subscribePodcastEpisodeNotifications(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mark podcast station opened — clear badge. */
export function markPodcastEpisodesSeen(): void {
  if (cachedUnseenCount === 0) return;
  const seen = readIdSet(SEEN_IDS_KEY);
  const notified = readIdSet(NOTIFIED_IDS_KEY);
  for (const ep of loadAllEpisodes()) {
    const id = episodeNotifId(ep.feedId, ep.id);
    seen.add(id);
    notified.add(id);
  }
  writeIdSet(SEEN_IDS_KEY, seen);
  writeIdSet(NOTIFIED_IDS_KEY, notified);
  cachedUnseenCount = 0;
  notify();
}

export function processNewPodcastEpisodes(
  feedId: string,
  feedTitle: string,
  episodes: PodcastEpisode[],
): number {
  if (!loadPodcastNotifEnabled()) {
    cachedUnseenCount = 0;
    notify();
    return 0;
  }

  const seen = readIdSet(SEEN_IDS_KEY);
  const baselineDone = prefsGetItem(BASELINE_DONE_KEY) === 'true';
  const ids = episodes.map((ep) => episodeNotifId(feedId, ep.id));

  if (!baselineDone) {
    for (const id of ids) seen.add(id);
    writeIdSet(SEEN_IDS_KEY, seen);
    prefsSetItem(BASELINE_DONE_KEY, 'true');
    cachedUnseenCount = 0;
    notify();
    return 0;
  }

  const newlyDetected: PodcastEpisodeNotifInput[] = [];
  for (const ep of episodes) {
    const id = episodeNotifId(feedId, ep.id);
    if (!seen.has(id)) {
      newlyDetected.push({ id, title: ep.title, feedTitle });
    }
  }

  if (newlyDetected.length > 0) {
    showBackgroundPodcastNotifications(newlyDetected);
  }

  cachedUnseenCount = recomputeUnseenCount(seen);
  notify();
  return newlyDetected.length;
}

export function initPodcastEpisodeNotificationListeners(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener(PODCAST_SETTINGS_CHANGE_EVENT, () => {
    if (!loadPodcastNotifEnabled()) {
      cachedUnseenCount = 0;
      notify();
    }
  });
}
