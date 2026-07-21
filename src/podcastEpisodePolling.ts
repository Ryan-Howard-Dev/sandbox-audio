import { Capacitor, registerPlugin } from '@capacitor/core';
import { isAndroid, isCapacitorNative } from './platformEnv';
import { fetchPodcastFeed } from './podcastRss';
import { onPodcastEpisodesUpdated } from './podcastEpisodeSync';
import {
  getUnseenPodcastEpisodeCount,
} from './podcastEpisodeNotifications';
import { loadPodcastNotifEnabled } from './podcastSettings';
import {
  loadSubscriptions,
  saveEpisodesForFeed,
  subscribePodcasts,
  PODCASTS_CHANGE_EVENT,
} from './podcastStorage';

export const PODCAST_BACKGROUND_CHECK_EVENT = 'sandbox-podcast-background-check';

const POLL_INTERVAL_MS = 30 * 60 * 1000;

interface FollowedReleaseNativePlugin {
  schedulePeriodicCheck(options: { intervalHours: number }): Promise<void>;
  cancelPeriodicCheck(): Promise<void>;
  addListener(
    eventName: 'backgroundCheck',
    listenerFunc: () => void,
  ): Promise<{ remove: () => void }>;
}

const FollowedReleaseNative = registerPlugin<FollowedReleaseNativePlugin>(
  'FollowedReleaseNative',
);

export async function forcePodcastEpisodeCheck(
  onUpdate?: (count: number) => void,
): Promise<number> {
  if (!loadPodcastNotifEnabled()) {
    onUpdate?.(0);
    return 0;
  }
  const subs = loadSubscriptions();
  if (subs.length === 0) {
    onUpdate?.(0);
    return 0;
  }

  let totalNew = 0;
  for (const sub of subs) {
    try {
      const parsed = await fetchPodcastFeed(sub.feedUrl);
      saveEpisodesForFeed(sub.id, parsed.episodes);
      onPodcastEpisodesUpdated(sub.id, parsed.episodes);
      totalNew += 1;
    } catch {
      /* skip failed feed */
    }
  }

  const count = getUnseenPodcastEpisodeCount();
  onUpdate?.(count);
  return count;
}

async function syncAndroidSchedule(): Promise<void> {
  if (!isCapacitorNative() || !isAndroid()) return;
  if (!loadPodcastNotifEnabled() || loadSubscriptions().length === 0) {
    return;
  }
  await FollowedReleaseNative.schedulePeriodicCheck({ intervalHours: 6 }).catch(() => {});
}

export function initPodcastBackgroundSchedule(
  onUpdate: (count: number) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onBackgroundCheck = () => {
    void forcePodcastEpisodeCheck(onUpdate);
  };

  window.addEventListener(PODCAST_BACKGROUND_CHECK_EVENT, onBackgroundCheck);

  const onPodcastsChange = () => void syncAndroidSchedule();
  window.addEventListener(PODCASTS_CHANGE_EVENT, onPodcastsChange);

  let interval: number | undefined;
  const startPoll = () => {
    if (interval != null) return;
    interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void forcePodcastEpisodeCheck(onUpdate);
    }, POLL_INTERVAL_MS);
  };
  startPoll();

  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void forcePodcastEpisodeCheck(onUpdate);
    }
  };
  document.addEventListener('visibilitychange', onVisible);

  let nativeSub: { remove: () => void } | null = null;
  if (Capacitor.isNativePlatform() && isAndroid()) {
    void syncAndroidSchedule();
    void FollowedReleaseNative.addListener('backgroundCheck', onBackgroundCheck).then((sub) => {
      nativeSub = sub;
    });
  }

  void forcePodcastEpisodeCheck(onUpdate);

  return () => {
    window.removeEventListener(PODCAST_BACKGROUND_CHECK_EVENT, onBackgroundCheck);
    window.removeEventListener(PODCASTS_CHANGE_EVENT, onPodcastsChange);
    document.removeEventListener('visibilitychange', onVisible);
    if (interval != null) window.clearInterval(interval);
    nativeSub?.remove();
  };
}

export function startPodcastEpisodePolling(
  onUpdate: (count: number) => void,
): () => void {
  return initPodcastBackgroundSchedule(onUpdate);
}
