/**
 * User-added audiobook RSS feeds (client prefs) + curated feed list.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  AUDIOBOOK_CURATED_RSS_FEEDS,
  type AudiobookCuratedRssFeed,
  type AudiobookRssFeedKind,
} from '../tier34-server/lib/audiobookRssFeeds';

export { AUDIOBOOK_CURATED_RSS_FEEDS, type AudiobookCuratedRssFeed, type AudiobookRssFeedKind };

const USER_FEEDS_KEY = 'sandbox_audiobook_rss_feeds';
const FEEDS_CHANGE_EVENT = 'sandbox-audiobook-rss-feeds-change';

export type UserAudiobookRssFeed = {
  url: string;
  label?: string;
  kind?: AudiobookRssFeedKind;
  author?: string;
  addedAt: number;
};

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(FEEDS_CHANGE_EVENT));
  }
}

export function subscribeAudiobookRssFeeds(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener(FEEDS_CHANGE_EVENT, handler);
  return () => window.removeEventListener(FEEDS_CHANGE_EVENT, handler);
}

export function loadUserAudiobookRssFeeds(): UserAudiobookRssFeed[] {
  try {
    const raw = prefsGetItem(USER_FEEDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserAudiobookRssFeed[];
    return Array.isArray(parsed) ? parsed.filter((f) => f.url?.trim()) : [];
  } catch {
    return [];
  }
}

function saveUserAudiobookRssFeeds(feeds: UserAudiobookRssFeed[]): void {
  prefsSetItem(USER_FEEDS_KEY, JSON.stringify(feeds));
  notify();
}

export function addUserAudiobookRssFeed(feed: Omit<UserAudiobookRssFeed, 'addedAt'>): UserAudiobookRssFeed {
  const url = feed.url.trim();
  const existing = loadUserAudiobookRssFeeds();
  const normalized = url.toLowerCase();
  const dup = existing.find((f) => f.url.trim().toLowerCase() === normalized);
  if (dup) return dup;
  const row: UserAudiobookRssFeed = {
    url,
    label: feed.label?.trim() || undefined,
    kind: feed.kind ?? 'book',
    author: feed.author?.trim() || undefined,
    addedAt: Date.now(),
  };
  saveUserAudiobookRssFeeds([row, ...existing]);
  return row;
}

export function removeUserAudiobookRssFeed(url: string): void {
  const normalized = url.trim().toLowerCase();
  saveUserAudiobookRssFeeds(
    loadUserAudiobookRssFeeds().filter((f) => f.url.trim().toLowerCase() !== normalized),
  );
}

export function listAudiobookRssFeedConfigs(): AudiobookCuratedRssFeed[] {
  const userFeeds = loadUserAudiobookRssFeeds().map((f) => ({
    url: f.url,
    label: f.label?.trim() || f.url,
    kind: f.kind ?? ('book' as const),
    author: f.author,
  }));
  const seen = new Set<string>();
  const out: AudiobookCuratedRssFeed[] = [];
  for (const feed of [...userFeeds, ...AUDIOBOOK_CURATED_RSS_FEEDS]) {
    const key = feed.url.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(feed);
  }
  return out;
}
