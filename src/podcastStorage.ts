import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const PODCASTS_CHANGE_EVENT = 'sandbox-podcasts-change';

const STORAGE_KEY = 'sandbox_podcast_library';
const RESUME_KEY = 'sandbox_podcast_resume';
const PLAYBACK_STATE_KEY = 'sandbox_podcast_playback_state_v1';
/** Avoid localStorage quota blow-ups on huge feeds (e.g. JRE). */
export const MAX_EPISODES_PERSISTED_PER_FEED = 120;

/**
 * A ceiling for the library as a whole, not just for one feed.
 *
 * The per-feed cap bounds a single enormous show and nothing else, so the size of the library is
 * really the number of subscriptions: forty shows at a hundred and twenty episodes each is the
 * same problem arriving more slowly. On a real phone this key had reached 1.3MB, the largest
 * single thing in a store that was refusing writes.
 *
 * Dropping an episode record costs nothing that cannot be fetched again. Titles, descriptions and
 * audio urls come back with the next feed refresh, and the things that are genuinely yours are
 * kept elsewhere: whether an episode was played lives in the playback state key, and how far in
 * you got lives in the resume key. Neither is touched by any of this.
 */
export const MAX_EPISODES_PERSISTED_TOTAL = 1200;

/**
 * However many shows are subscribed, each keeps at least this many.
 *
 * A budget shared out strictly would give a hundred subscriptions twelve episodes each, which is
 * not a podcast app any more. Past that point the total is allowed to drift over budget rather
 * than gut every show, because somebody with a hundred subscriptions has said what they want.
 */
export const MIN_EPISODES_PERSISTED_PER_FEED = 25;

/**
 * How many episodes each feed may keep, given how many feeds there are.
 *
 * Pure so the awkward end of it can be asserted directly: one feed, no feeds, and enough feeds
 * that the share falls under the floor.
 */
export function episodesPerFeedBudget(feedCount: number): number {
  if (feedCount <= 1) return MAX_EPISODES_PERSISTED_PER_FEED;
  const share = Math.floor(MAX_EPISODES_PERSISTED_TOTAL / feedCount);
  return Math.max(
    MIN_EPISODES_PERSISTED_PER_FEED,
    Math.min(MAX_EPISODES_PERSISTED_PER_FEED, share),
  );
}

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
  /** Show's own website, when an OPML export or feed provided one. */
  siteUrl?: string;
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

/**
 * How many of a show's newest episodes keep their full notes.
 *
 * Measured on a real library: an episode record is about 2.9KB and 2.4KB of that is the
 * description, so show notes are five parts in six of the whole podcast library. Two
 * subscriptions came to 1.3MB, which is why capping the number of episodes alone would not have
 * helped -- there were only 240 of them.
 *
 * The newest keep everything, because those are the ones somebody opens. Older episodes keep
 * their title, artwork, duration and audio url, which is all the list needs to show them and all
 * playback needs to start them. The notes come back with the next feed refresh.
 */
export const EPISODES_WITH_FULL_NOTES_PER_FEED = 25;

/** Everything except the long prose. */
function withoutNotes(episode: PodcastEpisode): PodcastEpisode {
  if (!episode.description) return episode;
  const { description: _dropped, ...rest } = episode;
  return rest;
}

/**
 * Drop the notes from all but the newest episodes.
 *
 * Expects the list already sorted newest first, which is how it is stored and how it arrives.
 */
export function slimOlderEpisodeNotes(
  episodes: PodcastEpisode[],
  keepFull = EPISODES_WITH_FULL_NOTES_PER_FEED,
): PodcastEpisode[] {
  if (episodes.length <= keepFull) return episodes;
  return episodes.map((episode, index) => (index < keepFull ? episode : withoutNotes(episode)));
}

function trimEpisodesForPersistence(
  episodes: PodcastEpisode[],
  cap = MAX_EPISODES_PERSISTED_PER_FEED,
): PodcastEpisode[] {
  const newestFirst = [...episodes].sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  return slimOlderEpisodeNotes(newestFirst.slice(0, cap));
}

/**
 * Bring the whole library back inside its budget, newest episodes kept.
 *
 * Subscriptions are never touched -- unsubscribing is a decision, and it is not this function's to
 * make. Only the episode lists shrink, and only to what the current number of feeds affords.
 *
 * Returns how many episode records were dropped, and writes only when that is more than none, so
 * it is safe to call on a schedule without rewriting a megabyte for nothing.
 */
export function prunePodcastLibraryToBudget(): number {
  const lib = readLibrary();
  const feedIds = Object.keys(lib.episodesByFeed);
  if (feedIds.length === 0) return 0;

  const cap = episodesPerFeedBudget(lib.subscriptions.length || feedIds.length);
  let dropped = 0;
  let notesDropped = 0;
  for (const feedId of feedIds) {
    const episodes = lib.episodesByFeed[feedId] ?? [];
    const trimmed = trimEpisodesForPersistence(episodes, cap);
    dropped += Math.max(0, episodes.length - trimmed.length);
    // Counted separately: an existing library is usually within its episode budget already and
    // still carrying a megabyte of show notes, so this is the part that actually reclaims.
    notesDropped += trimmed.filter((ep, i) => episodes[i]?.description && !ep.description).length;
    lib.episodesByFeed[feedId] = trimmed;
  }
  if (dropped > 0 || notesDropped > 0) writeLibrary(lib);
  return dropped + notesDropped;
}

export function saveEpisodesForFeed(feedId: string, episodes: PodcastEpisode[]): void {
  const lib = readLibrary();
  const previous = lib.episodesByFeed[feedId] ?? [];
  // The cap depends on how many shows are subscribed, so a library that has grown wide keeps
  // fewer of each rather than more of everything.
  episodes = trimEpisodesForPersistence(
    episodes,
    episodesPerFeedBudget(lib.subscriptions.length),
  );
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

/** When each position was written. Kept apart from the positions themselves; see below. */
const RESUME_AT_KEY = 'sandbox_podcast_resume_at_v1';
export function getEpisodeResumePosition(episodeId: string): number {
  return readResumeMap()[episodeId] ?? 0;
}

/**
 * When a position was last written, for deciding how far to rewind on resume.
 *
 * Separate from the position itself so the stored map keeps its shape: it is a plain
 * episode-to-seconds record that predates this, and widening every entry would mean migrating
 * everyone's saved places to add a field most of them will never be read for.
 *
 * Undefined for anything saved before this existed. That is the honest answer and the callers
 * treat it as "resume exactly", rather than guessing an age and rewinding every old position
 * on the first launch after an update.
 */
export function getEpisodeResumeSavedAt(episodeId: string): number | undefined {
  const raw = prefsGetItem(RESUME_AT_KEY);
  if (!raw) return undefined;
  try {
    const map = JSON.parse(raw) as Record<string, number>;
    const at = map?.[episodeId];
    return typeof at === 'number' && Number.isFinite(at) ? at : undefined;
  } catch {
    return undefined;
  }
}

function writeResumeSavedAt(episodeId: string, at: number | null): void {
  let map: Record<string, number> = {};
  try {
    const raw = prefsGetItem(RESUME_AT_KEY);
    if (raw) map = (JSON.parse(raw) as Record<string, number>) ?? {};
  } catch {
    map = {};
  }
  if (at === null) delete map[episodeId];
  else map[episodeId] = at;
  prefsSetItem(RESUME_AT_KEY, JSON.stringify(map));
}

export function saveEpisodeResumePosition(episodeId: string, seconds: number): void {
  const map = readResumeMap();
  if (seconds < 3) {
    delete map[episodeId];
    writeResumeSavedAt(episodeId, null);
  } else {
    map[episodeId] = Math.max(0, seconds);
    writeResumeSavedAt(episodeId, Date.now());
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
