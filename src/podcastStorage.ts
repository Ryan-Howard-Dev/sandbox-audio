import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const PODCASTS_CHANGE_EVENT = 'sandbox-podcasts-change';

const STORAGE_KEY = 'sandbox_podcast_library';
const RESUME_KEY = 'sandbox_podcast_resume';
const PLAYBACK_STATE_KEY = 'sandbox_podcast_playback_state_v1';
/** Avoid localStorage quota blow-ups on huge feeds (e.g. JRE). */
export const MAX_EPISODES_PERSISTED_PER_FEED = 120;

/** Fraction of duration listened before auto-marking complete. */
export const PODCAST_AUTO_COMPLETE_RATIO = 0.92;

const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((fn) => fn());
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(PODCASTS_CHANGE_EVENT));
  }
}

export function subscribePodcasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export interface PodcastSubscription {
  id: string;
  feedUrl: string;
  title: string;
  description?: string;
  artworkUrl?: string;
  /** RSS/Atom feed vs YouTube channel/playlist pseudo-feed */
  source?: 'rss' | 'youtube';
  subscribedAt: number;
  lastFetchedAt?: number;
  /** Auto-cache newest episodes for offline playback */
  autoDownload?: boolean;
  /** How many newest episodes to keep cached (default 3) */
  autoDownloadCount?: number;
  /** Per-show Wi‑Fi-only override for auto-save (undefined = global setting). */
  autoDownloadWifiOnly?: boolean;
  /** Remove offline cache for played episodes after N days (0 = never). */
  deletePlayedAfterDays?: number;
  /** Last rules change — for Tier34 sync merge. */
  rulesUpdatedAt?: number;
  /** Per-show Voice Boost default (undefined = use global toggle). */
  voiceBoostDefault?: boolean;
}

export interface PodcastChapterRef {
  title: string;
  startSeconds: number;
}

export interface PodcastEpisode {
  id: string;
  feedId: string;
  title: string;
  description?: string;
  audioUrl: string;
  durationSeconds?: number;
  publishedAt?: number;
  artworkUrl?: string;
  /** RSS guid — used for Podcast Index chapter/soundbite lookup */
  guid?: string;
  /** Podcast Index / JSON chapters URL from RSS */
  chaptersUrl?: string;
  /** Parsed chapters cached after first fetch */
  chapters?: PodcastChapterRef[];
}

export interface PodcastEpisodePlaybackState {
  /** When the episode was marked played or finished. */
  playedAt?: number;
  /** Finished listening (manual or auto-complete). */
  completed?: boolean;
}

interface PodcastLibrary {
  subscriptions: PodcastSubscription[];
  episodesByFeed: Record<string, PodcastEpisode[]>;
}

let libraryCacheRaw: string | null | undefined;
let libraryCache: PodcastLibrary | null = null;

let playbackStateCacheRaw: string | null | undefined;
let playbackStateCache: Record<string, PodcastEpisodePlaybackState> | null = null;

let resumeCacheRaw: string | null | undefined;
let resumeCache: Record<string, number> | null = null;

function parseLibrary(raw: string | null): PodcastLibrary {
  if (!raw) return { subscriptions: [], episodesByFeed: {} };
  try {
    const parsed = JSON.parse(raw) as PodcastLibrary;
    return {
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
      episodesByFeed:
        parsed.episodesByFeed && typeof parsed.episodesByFeed === 'object'
          ? parsed.episodesByFeed
          : {},
    };
  } catch {
    return { subscriptions: [], episodesByFeed: {} };
  }
}

function readLibrary(): PodcastLibrary {
  const raw = prefsGetItem(STORAGE_KEY);
  if (libraryCache && raw === libraryCacheRaw) return libraryCache;
  libraryCacheRaw = raw;
  libraryCache = parseLibrary(raw);
  return libraryCache;
}

function writeLibrary(lib: PodcastLibrary): void {
  const raw = JSON.stringify(lib);
  prefsSetItem(STORAGE_KEY, raw);
  libraryCacheRaw = raw;
  libraryCache = lib;
  notify();
}

export function loadSubscriptions(): PodcastSubscription[] {
  return readLibrary().subscriptions;
}

export function loadEpisodesForFeed(feedId: string): PodcastEpisode[] {
  return readLibrary().episodesByFeed[feedId] ?? [];
}

export function loadAllEpisodes(): PodcastEpisode[] {
  const lib = readLibrary();
  const all: PodcastEpisode[] = [];
  for (const sub of lib.subscriptions) {
    const eps = lib.episodesByFeed[sub.id] ?? [];
    all.push(...eps);
  }
  return all.sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}

export function findSubscription(feedId: string): PodcastSubscription | undefined {
  return readLibrary().subscriptions.find((s) => s.id === feedId);
}

export function subscriptionFeedUrlId(feedUrl: string): string {
  const normalized = feedUrl.trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) | 0;
  }
  return `feed-${Math.abs(hash).toString(36)}`;
}

export function addSubscription(
  sub: Omit<PodcastSubscription, 'subscribedAt'> & { subscribedAt?: number },
): PodcastSubscription {
  const lib = readLibrary();
  const existing = lib.subscriptions.find((s) => s.id === sub.id);
  if (existing) return existing;
  const entry: PodcastSubscription = {
    ...sub,
    subscribedAt: sub.subscribedAt ?? Date.now(),
  };
  lib.subscriptions.unshift(entry);
  writeLibrary(lib);
  return entry;
}

export function removeSubscription(feedId: string): void {
  const lib = readLibrary();
  lib.subscriptions = lib.subscriptions.filter((s) => s.id !== feedId);
  delete lib.episodesByFeed[feedId];
  writeLibrary(lib);
  const resume = readResumeMap();
  for (const ep of Object.keys(resume)) {
    if (ep.startsWith(`${feedId}:`)) delete resume[ep];
  }
  writeResumeMap(resume);
  clearPlaybackStateForFeed(feedId);
}

function trimEpisodesForPersistence(episodes: PodcastEpisode[]): PodcastEpisode[] {
  const cap = MAX_EPISODES_PERSISTED_PER_FEED;
  if (episodes.length <= cap) return episodes;
  return [...episodes]
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0))
    .slice(0, cap);
}

export function saveEpisodesForFeed(feedId: string, episodes: PodcastEpisode[]): void {
  const lib = readLibrary();
  const previous = lib.episodesByFeed[feedId] ?? [];
  episodes = trimEpisodesForPersistence(episodes);
  const previousById = new Map(previous.map((ep) => [ep.id, ep]));
  const merged = episodes.map((ep) => {
    const old = previousById.get(ep.id);
    if (!old) return ep;
    return {
      ...ep,
      chapters: ep.chapters ?? old.chapters,
      chaptersUrl: ep.chaptersUrl ?? old.chaptersUrl,
      guid: ep.guid ?? old.guid,
      description:
        (ep.description?.length ?? 0) >= (old.description?.length ?? 0)
          ? ep.description
          : old.description,
    };
  });
  lib.episodesByFeed[feedId] = merged;
  const sub = lib.subscriptions.find((s) => s.id === feedId);
  if (sub) sub.lastFetchedAt = Date.now();
  writeLibrary(lib);
}

export function updateEpisodeChapters(
  feedId: string,
  episodeId: string,
  chapters: PodcastChapterRef[],
): void {
  const lib = readLibrary();
  const episodes = lib.episodesByFeed[feedId];
  if (!episodes) return;
  const idx = episodes.findIndex((ep) => ep.id === episodeId);
  if (idx < 0) return;
  episodes[idx] = { ...episodes[idx], chapters };
  writeLibrary(lib);
}

export function findEpisode(feedId: string, episodeId: string): PodcastEpisode | undefined {
  return loadEpisodesForFeed(feedId).find((ep) => ep.id === episodeId);
}

export function updateSubscriptionMeta(
  feedId: string,
  patch: Partial<
    Pick<
      PodcastSubscription,
      | 'title'
      | 'description'
      | 'artworkUrl'
      | 'lastFetchedAt'
      | 'source'
      | 'autoDownload'
      | 'autoDownloadCount'
      | 'autoDownloadWifiOnly'
      | 'deletePlayedAfterDays'
      | 'rulesUpdatedAt'
      | 'voiceBoostDefault'
    > & { voiceBoostDefault?: boolean | null }
  >,
): void {
  const lib = readLibrary();
  const sub = lib.subscriptions.find((s) => s.id === feedId);
  if (!sub) return;
  const rulesTouched =
    patch.autoDownload !== undefined ||
    patch.autoDownloadCount !== undefined ||
    patch.autoDownloadWifiOnly !== undefined ||
    patch.deletePlayedAfterDays !== undefined ||
    patch.voiceBoostDefault !== undefined ||
    patch.voiceBoostDefault === null;
  if ('voiceBoostDefault' in patch) {
    if (patch.voiceBoostDefault === null || patch.voiceBoostDefault === undefined) {
      delete sub.voiceBoostDefault;
    } else {
      sub.voiceBoostDefault = patch.voiceBoostDefault;
    }
    delete (patch as { voiceBoostDefault?: boolean | null }).voiceBoostDefault;
  }
  Object.assign(sub, patch);
  if (rulesTouched && patch.rulesUpdatedAt === undefined) {
    sub.rulesUpdatedAt = Date.now();
  }
  writeLibrary(lib);
}

function readResumeMap(): Record<string, number> {
  const raw = prefsGetItem(RESUME_KEY);
  if (resumeCache && raw === resumeCacheRaw) return resumeCache;
  resumeCacheRaw = raw;
  if (!raw) {
    resumeCache = {};
    return resumeCache;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, number>;
    resumeCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    resumeCache = {};
  }
  return resumeCache;
}

function writeResumeMap(map: Record<string, number>): void {
  const raw = JSON.stringify(map);
  prefsSetItem(RESUME_KEY, raw);
  resumeCacheRaw = raw;
  resumeCache = map;
}

export function getEpisodeResumePosition(episodeId: string): number {
  return readResumeMap()[episodeId] ?? 0;
}

export function saveEpisodeResumePosition(episodeId: string, seconds: number): void {
  const map = readResumeMap();
  if (seconds < 3) {
    delete map[episodeId];
  } else {
    map[episodeId] = Math.max(0, seconds);
  }
  writeResumeMap(map);
}

export function clearEpisodeResumePosition(episodeId: string): void {
  const map = readResumeMap();
  if (!(episodeId in map)) return;
  delete map[episodeId];
  writeResumeMap(map);
}

function readPlaybackStateMap(): Record<string, PodcastEpisodePlaybackState> {
  const raw = prefsGetItem(PLAYBACK_STATE_KEY);
  if (playbackStateCache && raw === playbackStateCacheRaw) return playbackStateCache;
  playbackStateCacheRaw = raw;
  if (!raw) {
    playbackStateCache = {};
    return playbackStateCache;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, PodcastEpisodePlaybackState>;
    playbackStateCache = parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    playbackStateCache = {};
  }
  return playbackStateCache;
}

function writePlaybackStateMap(map: Record<string, PodcastEpisodePlaybackState>): void {
  const raw = JSON.stringify(map);
  prefsSetItem(PLAYBACK_STATE_KEY, raw);
  playbackStateCacheRaw = raw;
  playbackStateCache = map;
  notify();
}

function clearPlaybackStateForFeed(feedId: string): void {
  const map = readPlaybackStateMap();
  let changed = false;
  for (const key of Object.keys(map)) {
    if (key.startsWith(`${feedId}:`)) {
      delete map[key];
      changed = true;
    }
  }
  if (changed) writePlaybackStateMap(map);
}

export function getEpisodePlaybackState(episodeId: string): PodcastEpisodePlaybackState {
  return readPlaybackStateMap()[episodeId] ?? {};
}

export function isEpisodePlayed(episodeId: string): boolean {
  const state = readPlaybackStateMap()[episodeId];
  return Boolean(state?.completed || state?.playedAt);
}

export function isEpisodeUnplayed(episodeId: string): boolean {
  return !isEpisodePlayed(episodeId);
}

function isEpisodeUnplayedInMap(
  episodeId: string,
  map: Record<string, PodcastEpisodePlaybackState>,
): boolean {
  const state = map[episodeId];
  return !(state?.completed || state?.playedAt);
}

/** Unplayed counts per feed — one library + playback read for the whole list. */
export function getUnplayedCountsByFeed(): Record<string, number> {
  const lib = readLibrary();
  const playback = readPlaybackStateMap();
  const counts: Record<string, number> = {};
  for (const sub of lib.subscriptions) {
    const eps = lib.episodesByFeed[sub.id] ?? [];
    let n = 0;
    for (const ep of eps) {
      if (isEpisodeUnplayedInMap(ep.id, playback)) n += 1;
    }
    if (n > 0) counts[sub.id] = n;
  }
  return counts;
}

export function markEpisodePlayed(episodeId: string, at = Date.now()): void {
  const map = readPlaybackStateMap();
  map[episodeId] = { playedAt: at, completed: true };
  writePlaybackStateMap(map);
  clearEpisodeResumePosition(episodeId);
}

export function markEpisodeUnplayed(episodeId: string): void {
  const map = readPlaybackStateMap();
  if (!(episodeId in map)) return;
  delete map[episodeId];
  writePlaybackStateMap(map);
  clearEpisodeResumePosition(episodeId);
}

export function markEpisodeCompleted(episodeId: string, at = Date.now()): void {
  markEpisodePlayed(episodeId, at);
}

export function countUnplayedEpisodes(
  feedId: string,
  episodes: PodcastEpisode[] = loadEpisodesForFeed(feedId),
): number {
  const playback = readPlaybackStateMap();
  let n = 0;
  for (const ep of episodes) {
    if (isEpisodeUnplayedInMap(ep.id, playback)) n += 1;
  }
  return n;
}

/** Oldest unplayed episode first (catch-up order). */
export function findNextUnplayedEpisode(
  feedId: string,
  episodes: PodcastEpisode[] = loadEpisodesForFeed(feedId),
): PodcastEpisode | undefined {
  const playback = readPlaybackStateMap();
  const sorted = [...episodes].sort(
    (a, b) => (a.publishedAt ?? 0) - (b.publishedAt ?? 0),
  );
  return sorted.find((ep) => isEpisodeUnplayedInMap(ep.id, playback));
}

export function maybeAutoCompleteEpisode(
  episodeId: string,
  positionSeconds: number,
  durationSeconds: number,
): boolean {
  if (!durationSeconds || durationSeconds < 30) return false;
  if (isEpisodePlayed(episodeId)) return false;
  if (positionSeconds / durationSeconds < PODCAST_AUTO_COMPLETE_RATIO) return false;
  markEpisodeCompleted(episodeId);
  return true;
}

export function isEpisodeInProgress(episodeId: string): boolean {
  return getEpisodeResumePosition(episodeId) >= 3;
}

export function isPodcastEnvelopeId(envelopeId: string): boolean {
  return envelopeId.startsWith('podcast:');
}

export function parsePodcastEpisodeId(envelopeId: string): string | null {
  if (!envelopeId.startsWith('podcast:')) return null;
  const parts = envelopeId.split(':');
  return parts.length >= 3 ? parts.slice(2).join(':') : null;
}

export function parsePodcastFeedId(envelopeId: string): string | null {
  if (!envelopeId.startsWith('podcast:')) return null;
  const parts = envelopeId.split(':');
  return parts.length >= 3 ? parts[1] : null;
}
