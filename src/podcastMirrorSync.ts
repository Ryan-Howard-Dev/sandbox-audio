/**
 * Sync podcast subscriptions to Tier34 NAS mirror for LAN / air-gap playback.
 */

import {
  getSandboxClientHeader,
  getTier34BaseUrl,
  tier34HealthOk,
} from './tier34/client';
import {
  loadSubscriptions,
  PODCASTS_CHANGE_EVENT,
  subscriptionFeedUrlId,
  type PodcastSubscription,
} from './podcastStorage';

export type PodcastMirrorStatus = {
  enabled: boolean;
  subscriptionCount: number;
  feedCount: number;
  mirroredEpisodeCount: number;
  pendingEpisodeCount: number;
  lastPullAt?: number;
};

export function mirrorRssUrlForFeed(feedId: string): string | null {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return null;
  return `${base}/api/podcast/mirror/feeds/${encodeURIComponent(feedId)}/rss`;
}

export async function fetchPodcastMirrorStatus(): Promise<PodcastMirrorStatus | null> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/podcast/mirror/status`, {
      headers: getSandboxClientHeader(),
    });
    if (!res.ok) return null;
    return (await res.json()) as PodcastMirrorStatus;
  } catch {
    return null;
  }
}

export async function syncPodcastSubscriptionsToMirror(
  subs?: PodcastSubscription[],
): Promise<boolean> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return false;
  const ok = await tier34HealthOk();
  if (!ok) return false;

  const subscriptions = (subs ?? loadSubscriptions()).map((s) => ({
    id: s.id,
    feedUrl: s.feedUrl,
    title: s.title,
    description: s.description,
    artworkUrl: s.artworkUrl,
    subscribedAt: s.subscribedAt,
    enabled: true,
    source: s.source ?? 'rss',
  }));

  try {
    const res = await fetch(`${base}/api/podcast/mirror/subscriptions`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...getSandboxClientHeader(),
      },
      body: JSON.stringify({ subscriptions }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function requestPodcastMirrorPull(feedId?: string): Promise<boolean> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return false;
  const path = feedId
    ? `/api/podcast/mirror/pull?feedId=${encodeURIComponent(feedId)}`
    : '/api/podcast/mirror/pull';
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getSandboxClientHeader(),
      },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchMirroredPodcastFeedXml(feedUrl: string): Promise<string | null> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return null;
  const feedId = subscriptionFeedUrlId(feedUrl);
  try {
    const res = await fetch(
      `${base}/api/podcast/mirror/feeds/${encodeURIComponent(feedId)}/rss`,
      { headers: getSandboxClientHeader() },
    );
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export function initPodcastMirrorSync(): () => void {
  if (typeof window === 'undefined') return () => {};

  const sync = () => {
    void syncPodcastSubscriptionsToMirror();
  };

  const onChange = () => sync();
  window.addEventListener(PODCASTS_CHANGE_EVENT, onChange);

  sync();
  const interval = window.setInterval(sync, 10 * 60 * 1000);

  return () => {
    window.removeEventListener(PODCASTS_CHANGE_EVENT, onChange);
    window.clearInterval(interval);
  };
}
