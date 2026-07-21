/**
 * Android 12-hour background followed-release check via AlarmManager + native bridge.
 * When the alarm fires, JS runs a forced feed fetch and shows notifications if needed.
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { isAndroid, isCapacitorNative } from './platformEnv';
import { getFollowedArtists, FOLLOWED_ARTISTS_CHANGE_EVENT } from './followedArtists';
import {
  fetchFollowedArtistFeed,
  type FollowedFeedRelease,
} from './followedArtistFeed';
import {
  getUnseenFollowedReleaseCount,
  processFollowedReleases,
} from './followedReleaseNotifications';
import { loadFollowedReleaseNotifEnabled } from './followedReleaseNotificationSettings';
import { FOLLOWED_FEED_MIN_FETCH_GAP_MS } from './followedReleasePolling';

export const FOLLOWED_RELEASE_BACKGROUND_CHECK_EVENT =
  'sandbox-followed-release-background-check';

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

function releaseInputs(releases: FollowedFeedRelease[]) {
  return releases.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
  }));
}

/** Force network fetch + badge update (used by background alarm). */
export async function forceFollowedReleaseCheck(
  onUpdate?: (count: number) => void,
): Promise<number> {
  const artists = getFollowedArtists();
  if (artists.length === 0 || !loadFollowedReleaseNotifEnabled()) {
    onUpdate?.(0);
    return 0;
  }
  const feed = await fetchFollowedArtistFeed(artists);
  processFollowedReleases(releaseInputs(feed.releases));
  const count = getUnseenFollowedReleaseCount();
  onUpdate?.(count);
  return count;
}

async function syncAndroidSchedule(): Promise<void> {
  if (!isCapacitorNative() || !isAndroid()) return;
  if (!loadFollowedReleaseNotifEnabled() || getFollowedArtists().length === 0) {
    await FollowedReleaseNative.cancelPeriodicCheck().catch(() => {});
    return;
  }
  await FollowedReleaseNative.schedulePeriodicCheck({
    intervalHours: FOLLOWED_FEED_MIN_FETCH_GAP_MS / (60 * 60 * 1000),
  }).catch(() => {});
}

/** Register background check listeners; returns cleanup. */
export function initFollowedReleaseBackgroundSchedule(
  onUpdate: (count: number) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};

  const onBackgroundCheck = () => {
    void forceFollowedReleaseCheck(onUpdate);
  };

  window.addEventListener(FOLLOWED_RELEASE_BACKGROUND_CHECK_EVENT, onBackgroundCheck);

  const onFollowedChange = () => void syncAndroidSchedule();
  window.addEventListener(FOLLOWED_ARTISTS_CHANGE_EVENT, onFollowedChange);

  let nativeSub: { remove: () => void } | null = null;
  if (Capacitor.isNativePlatform() && isAndroid()) {
    void syncAndroidSchedule();
    void FollowedReleaseNative.addListener('backgroundCheck', onBackgroundCheck).then(
      (sub) => {
        nativeSub = sub;
      },
    );
  }

  return () => {
    window.removeEventListener(FOLLOWED_RELEASE_BACKGROUND_CHECK_EVENT, onBackgroundCheck);
    window.removeEventListener(FOLLOWED_ARTISTS_CHANGE_EVENT, onFollowedChange);
    nativeSub?.remove();
  };
}
