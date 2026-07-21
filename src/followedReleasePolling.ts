/**
 * Followed-artist release checks — battery-conscious.
 *
 * - Network check at most every 12 hours (timer + resume/foreground).
 * - No timer while the app is hidden/backgrounded.
 * - Immediate refresh when you follow/unfollow someone.
 * - Badge still updates from cache instantly on open.
 */

import { App } from '@capacitor/app';
import { isCapacitorNative } from './platformEnv';
import { getFollowedArtists, FOLLOWED_ARTISTS_CHANGE_EVENT } from './followedArtists';
import {
  fetchFollowedArtistFeed,
  getFollowedArtistFeedCache,
  type FollowedFeedRelease,
} from './followedArtistFeed';
import {
  getUnseenFollowedReleaseCount,
  processFollowedReleases,
  subscribeFollowedReleaseNotifications,
  FOLLOWED_RELEASE_NOTIF_UPDATE_EVENT,
} from './followedReleaseNotifications';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

/** Routine refresh interval while the app is visible. */
export const FOLLOWED_FEED_POLL_VISIBLE_MS = TWELVE_HOURS_MS;
/** Minimum gap between network fetches (resume/foreground dedupe). */
export const FOLLOWED_FEED_MIN_FETCH_GAP_MS = TWELVE_HOURS_MS;

export type FollowedReleasePollListener = (unseenCount: number) => void;

function releaseInputs(releases: FollowedFeedRelease[]) {
  return releases.map((r) => ({
    id: r.id,
    title: r.title,
    artist: r.artist,
  }));
}

function resolveLastFetchAt(sessionLastFetchAt: number | null): number | null {
  if (sessionLastFetchAt !== null) return sessionLastFetchAt;
  const feed = getFollowedArtistFeedCache(getFollowedArtists());
  return feed?.fetchedAt ?? null;
}

/** Whether a network fetch is allowed (respects cooldown unless forced). */
export function shouldFetchFollowedFeedNetwork(
  lastFetchAt: number | null,
  force: boolean,
  now = Date.now(),
): boolean {
  if (force) return true;
  const effectiveLastFetch = resolveLastFetchAt(lastFetchAt);
  if (effectiveLastFetch === null) return true;
  return now - effectiveLastFetch >= FOLLOWED_FEED_MIN_FETCH_GAP_MS;
}

export function followedFeedPollIntervalMs(isVisible: boolean): number | null {
  return isVisible ? FOLLOWED_FEED_POLL_VISIBLE_MS : null;
}

function syncBadgeFromCache(): number {
  const artists = getFollowedArtists();
  const feed = getFollowedArtistFeedCache(artists);
  const releases = feed?.releases ?? [];
  processFollowedReleases(releaseInputs(releases));
  return getUnseenFollowedReleaseCount();
}

function pollFollowedFeedNetwork(): Promise<number> {
  const artists = getFollowedArtists();
  if (artists.length === 0) return Promise.resolve(0);
  return fetchFollowedArtistFeed(artists).then((feed) => {
    processFollowedReleases(releaseInputs(feed.releases));
    return getUnseenFollowedReleaseCount();
  });
}

/** Start followed-release polling; returns cleanup. */
export function startFollowedReleasePolling(
  onUpdate: FollowedReleasePollListener,
): () => void {
  if (typeof window === 'undefined') return () => {};

  let pollTimer: number | null = null;
  let inFlight = false;
  let lastFetchAt: number | null = null;

  const emit = (count: number) => onUpdate(count);

  const schedulePoll = () => {
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    const intervalMs = followedFeedPollIntervalMs(
      typeof document !== 'undefined' && document.visibilityState === 'visible',
    );
    if (intervalMs === null) return;
    pollTimer = window.setInterval(() => void runPoll(false), intervalMs);
  };

  const runPoll = async (force: boolean) => {
    if (inFlight) return;
    if (!shouldFetchFollowedFeedNetwork(lastFetchAt, force)) {
      emit(syncBadgeFromCache());
      return;
    }
    inFlight = true;
    try {
      const count = await pollFollowedFeedNetwork();
      lastFetchAt = Date.now();
      emit(count);
    } catch (err) {
      console.warn('[Sandbox] followed-release poll failed:', err);
      emit(syncBadgeFromCache());
    } finally {
      inFlight = false;
    }
  };

  emit(syncBadgeFromCache());
  void runPoll(false);
  schedulePoll();

  const unsubNotif = subscribeFollowedReleaseNotifications(() => {
    emit(getUnseenFollowedReleaseCount());
  });

  const onFollowedChange = () => void runPoll(true);
  const onNotifSettingsChange = () => emit(getUnseenFollowedReleaseCount());
  const onVisibility = () => {
    schedulePoll();
    if (document.visibilityState === 'visible') {
      emit(syncBadgeFromCache());
      void runPoll(false);
    }
  };

  window.addEventListener(FOLLOWED_ARTISTS_CHANGE_EVENT, onFollowedChange);
  window.addEventListener(FOLLOWED_RELEASE_NOTIF_UPDATE_EVENT, onNotifSettingsChange);
  document.addEventListener('visibilitychange', onVisibility);

  let appStateSub: { remove: () => void } | null = null;
  if (isCapacitorNative()) {
    void App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) {
        if (pollTimer !== null) {
          window.clearInterval(pollTimer);
          pollTimer = null;
        }
        return;
      }
      emit(syncBadgeFromCache());
      schedulePoll();
      void runPoll(false);
    }).then((sub) => {
      appStateSub = sub;
    });
  }

  return () => {
    unsubNotif();
    window.removeEventListener(FOLLOWED_ARTISTS_CHANGE_EVENT, onFollowedChange);
    window.removeEventListener(FOLLOWED_RELEASE_NOTIF_UPDATE_EVENT, onNotifSettingsChange);
    document.removeEventListener('visibilitychange', onVisibility);
    if (pollTimer !== null) window.clearInterval(pollTimer);
    appStateSub?.remove();
  };
}
