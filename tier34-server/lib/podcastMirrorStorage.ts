/**
 * NAS-backed podcast feed mirror — subscriptions + per-episode blob map.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';
import { subscriptionFeedUrlId } from './podcastMirrorIds.js';

export type PodcastMirrorSubscription = {
  id: string;
  feedUrl: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  subscribedAt: number;
  enabled: boolean;
  source?: 'rss' | 'youtube' | 'opml';
};

export type PodcastMirrorEpisodeRow = {
  id: string;
  guid: string;
  title: string;
  description?: string;
  sourceAudioUrl: string;
  audioType?: string;
  durationSeconds?: number;
  publishedAt?: number;
  artworkUrl?: string;
  blobHash?: string;
  bytes?: number;
  mirroredAt?: number;
  lastError?: string;
};

export type PodcastMirrorFeedState = {
  feedId: string;
  feedUrl: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  updatedAt: number;
  lastPullAt?: number;
  lastPullError?: string;
  episodes: PodcastMirrorEpisodeRow[];
};

export type PodcastMirrorStore = {
  version: 1;
  updatedAt: number;
  subscriptions: PodcastMirrorSubscription[];
};

export type PodcastMirrorStatus = {
  enabled: boolean;
  subscriptionCount: number;
  feedCount: number;
  mirroredEpisodeCount: number;
  pendingEpisodeCount: number;
  lastPullAt?: number;
  storageRoot: string;
};

const MIRROR_DIR = join(LOCKER_STORAGE_ROOT, 'podcast-mirror');
const SUBS_FILE = join(MIRROR_DIR, 'subscriptions.json');
const FEEDS_DIR = join(MIRROR_DIR, 'feeds');

function ensureDirs(): void {
  mkdirSync(FEEDS_DIR, { recursive: true });
}

function emptyStore(): PodcastMirrorStore {
  return { version: 1, updatedAt: 0, subscriptions: [] };
}

export function loadMirrorSubscriptions(): PodcastMirrorStore {
  if (!existsSync(SUBS_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(SUBS_FILE, 'utf8')) as PodcastMirrorStore;
    if (!parsed?.subscriptions || !Array.isArray(parsed.subscriptions)) return emptyStore();
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      subscriptions: parsed.subscriptions,
    };
  } catch {
    return emptyStore();
  }
}

function saveMirrorSubscriptions(store: PodcastMirrorStore): void {
  ensureDirs();
  store.updatedAt = Date.now();
  writeFileSync(SUBS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

export function mergeMirrorSubscriptions(
  incoming: PodcastMirrorSubscription[],
): PodcastMirrorStore {
  const store = loadMirrorSubscriptions();
  const byId = new Map(store.subscriptions.map((s) => [s.id, s]));
  for (const row of incoming) {
    const id = row.id?.trim() || subscriptionFeedUrlId(row.feedUrl);
    const feedUrl = row.feedUrl?.trim();
    if (!feedUrl) continue;
    const prev = byId.get(id);
    byId.set(id, {
      id,
      feedUrl,
      title: row.title?.trim() || prev?.title || 'Podcast',
      description: row.description ?? prev?.description,
      artworkUrl: row.artworkUrl ?? prev?.artworkUrl,
      subscribedAt: row.subscribedAt ?? prev?.subscribedAt ?? Date.now(),
      enabled: row.enabled ?? prev?.enabled ?? true,
      source: row.source ?? prev?.source ?? 'rss',
    });
  }
  const next: PodcastMirrorStore = {
    version: 1,
    updatedAt: Date.now(),
    subscriptions: Array.from(byId.values()).sort(
      (a, b) => b.subscribedAt - a.subscribedAt,
    ),
  };
  saveMirrorSubscriptions(next);
  return next;
}

export function removeMirrorSubscription(feedId: string): boolean {
  const store = loadMirrorSubscriptions();
  const before = store.subscriptions.length;
  store.subscriptions = store.subscriptions.filter((s) => s.id !== feedId);
  if (store.subscriptions.length === before) return false;
  saveMirrorSubscriptions(store);
  const feedPath = feedStatePath(feedId);
  if (existsSync(feedPath)) {
    try {
      writeFileSync(feedPath, '', 'utf8');
    } catch {
      /* best-effort */
    }
  }
  return true;
}

function feedStatePath(feedId: string): string {
  const safe = feedId.replace(/[^a-zA-Z0-9:_-]/g, '');
  return join(FEEDS_DIR, `${safe}.json`);
}

export function loadMirrorFeedState(feedId: string): PodcastMirrorFeedState | null {
  const filePath = feedStatePath(feedId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PodcastMirrorFeedState;
    if (!parsed?.feedId || !Array.isArray(parsed.episodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveMirrorFeedState(state: PodcastMirrorFeedState): void {
  ensureDirs();
  state.updatedAt = Date.now();
  writeFileSync(feedStatePath(state.feedId), JSON.stringify(state, null, 2), 'utf8');
}

export function listMirrorFeedStates(): PodcastMirrorFeedState[] {
  ensureDirs();
  const rows: PodcastMirrorFeedState[] = [];
  for (const sub of loadMirrorSubscriptions().subscriptions) {
    const state = loadMirrorFeedState(sub.id);
    if (state) rows.push(state);
  }
  return rows;
}

export function findMirroredEpisode(
  episodeId: string,
): { feed: PodcastMirrorFeedState; episode: PodcastMirrorEpisodeRow } | null {
  for (const feed of listMirrorFeedStates()) {
    const episode = feed.episodes.find((e) => e.id === episodeId);
    if (episode?.blobHash) return { feed, episode };
  }
  return null;
}

export function listMirroredEpisodesWithBlobs(): Array<{
  feed: PodcastMirrorFeedState;
  episode: PodcastMirrorEpisodeRow;
}> {
  const rows: Array<{ feed: PodcastMirrorFeedState; episode: PodcastMirrorEpisodeRow }> = [];
  for (const feed of listMirrorFeedStates()) {
    for (const episode of feed.episodes) {
      if (episode.blobHash) rows.push({ feed, episode });
    }
  }
  return rows;
}

export function getMirrorStatus(enabled: boolean): PodcastMirrorStatus {
  const subs = loadMirrorSubscriptions().subscriptions;
  const feeds = listMirrorFeedStates();
  let mirrored = 0;
  let pending = 0;
  let lastPullAt: number | undefined;
  for (const feed of feeds) {
    if (feed.lastPullAt && (!lastPullAt || feed.lastPullAt > lastPullAt)) {
      lastPullAt = feed.lastPullAt;
    }
    for (const ep of feed.episodes) {
      if (ep.blobHash) mirrored += 1;
      else pending += 1;
    }
  }
  return {
    enabled,
    subscriptionCount: subs.length,
    feedCount: feeds.length,
    mirroredEpisodeCount: mirrored,
    pendingEpisodeCount: pending,
    lastPullAt,
    storageRoot: MIRROR_DIR,
  };
}
