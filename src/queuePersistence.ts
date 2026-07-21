/**
 * Play queue persistence — survives refresh, crash, and Android process kill.
 * Per-device local state; Connect peer-sync may override when active (see docs in sandboxLayer3).
 */

import { prefsGetItem, prefsSetItem, prefsRemoveItem } from './prefsStorage';
import type { AudioFsmState, MediaEnvelope, MediaProvider, MediaTransport } from './sandboxLayer1';
import type { StoredPlayHit } from './playHistory';
import {
  discardNonPersistableLastPlayIntent,
  isPersistablePlayIntent,
  loadLastPlayIntent,
} from './lastPlayIntent';

const PERSISTABLE_PLAYBACK_PROVIDERS: ReadonlySet<MediaProvider> = new Set([
  'local-vault',
  'stream-cache',
  'indexeddb',
  'blob',
]);

function hitToEnvelope(hit: StoredPlayHit): MediaEnvelope {
  return {
    envelopeId: hit.envelopeId,
    title: hit.title,
    artist: hit.artist,
    album: hit.album,
    url: hit.url ?? '',
    artworkUrl: hit.artworkUrl,
    provider: hit.provider ?? 'unknown',
    sourceId: hit.sourceId ?? hit.envelopeId,
    durationSeconds: hit.durationSeconds ?? 0,
    transport: hit.transport ?? 'element-src',
  };
}

/**
 * Strip session-ephemeral or non-persistable stream URLs after a hard reload so
 * executeTrack re-resolves instead of attaching a dead blob or stale HTTP URL.
 */
export function sanitizeRestoredEnvelope(env: MediaEnvelope): MediaEnvelope {
  const url = env.url?.trim() ?? '';
  if (!url) return env;

  if (env.provider === 'local-vault' && env.sourceId) {
    return env;
  }

  if (url.startsWith('blob:') || url.startsWith('data:')) {
    return { ...env, url: '' };
  }

  if (!PERSISTABLE_PLAYBACK_PROVIDERS.has(env.provider)) {
    return { ...env, url: '' };
  }

  return env;
}

/** Session marker — survives in-tab reload, cleared on Android force-stop / new WebView session. */
export const PLAYBACK_SESSION_KEY = 'sandbox_playback_session_v1';
const PAGE_UNLOAD_TS_KEY = 'sandbox_page_unload_ts';
const RELOAD_WINDOW_MS = 8000;

export const QUEUE_STATE_KEY = 'sandbox_play_queue_state_v1';
const LEGACY_LAST_QUEUE_KEY = 'sandbox_last_queue';

/** Keys wiped by Android WebView "Clear storage/data" (localStorage) or manual reset. */
export const PLAYBACK_PERSISTENCE_KEYS = [
  QUEUE_STATE_KEY,
  LEGACY_LAST_QUEUE_KEY,
  'sandbox_play_history',
  'sandbox_last_queue',
] as const;

/** True when the audio FSM is safe to persist as the active track (not mid-resolve). */
export function isStablePlaybackFsmState(state: AudioFsmState | string): boolean {
  return state === 'Ready' || state === 'Playing';
}

/** Only persist a current track id when playback reached a stable state. */
export function persistableCurrentTrackId(
  trackId: string | null | undefined,
  playbackState: AudioFsmState | string,
): string | null {
  if (!trackId?.trim()) return null;
  return isStablePlaybackFsmState(playbackState) ? trackId : null;
}

/** Full page reload (F5, Ctrl+Shift+R, location.reload()). */
export function isPageReloadNavigation(): boolean {
  if (typeof performance === 'undefined') return false;
  const entry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (entry?.type === 'reload') return true;
  const legacy = (performance as Performance & { navigation?: { type?: number } }).navigation;
  return legacy?.type === 1;
}

function readSessionItem(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSessionItem(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    /* quota / private mode */
  }
}

function removeSessionItem(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/** Record pagehide so the next load can detect reload when Navigation Timing is unreliable (Capacitor WebView). */
export function markPageUnloadForReloadDetection(): void {
  writeSessionItem(PAGE_UNLOAD_TS_KEY, String(Date.now()));
}

export function isLikelyPageReload(): boolean {
  if (isPageReloadNavigation()) return true;
  const raw = readSessionItem(PAGE_UNLOAD_TS_KEY);
  if (!raw) return false;
  const ts = parseInt(raw, 10);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < RELOAD_WINDOW_MS;
}

/** No prior in-tab playback session (cold WebView start, force-stop, or cleared session storage). */
export function isColdPlaybackStart(): boolean {
  return readSessionItem(PLAYBACK_SESSION_KEY) !== '1';
}

export function markActivePlaybackSession(): void {
  writeSessionItem(PLAYBACK_SESSION_KEY, '1');
}

export function clearActivePlaybackSession(): void {
  removeSessionItem(PLAYBACK_SESSION_KEY);
  removeSessionItem(PAGE_UNLOAD_TS_KEY);
}

/** Hard reload — never auto-attach the saved current track (native Exo may still reconcile). */
export function shouldSkipPlayerRestoreOnLoad(): boolean {
  return isLikelyPageReload();
}

/**
 * Whether to auto-load the saved current track into the player after queue rehydrate.
 * Cold start / process kill restores paused; hard reload stays fresh until reconcile.
 */
export function shouldAutoRestorePlayerOnLoad(persisted: PersistedQueueState): boolean {
  if (shouldSkipPlayerRestoreOnLoad()) return false;
  if (isColdPlaybackStart()) return false;
  if (!persisted.currentTrackId?.trim()) return false;
  return true;
}

/** Last-play metadata — only hydrate on in-session resume, not after force-stop. */
export function shouldRestoreLastPlayIntentOnLoad(): boolean {
  if (shouldSkipPlayerRestoreOnLoad()) return false;
  if (isColdPlaybackStart()) return false;
  const intent = loadLastPlayIntent();
  if (!intent || !isPersistablePlayIntent(intent)) return false;
  return true;
}

/** Drop saved current-track pointer so reload/cold start cannot resurrect a ghost player. */
export function clearPersistedCurrentTrack(): void {
  const raw = readPersistedRaw();
  if (!raw?.currentTrackId?.trim()) return;
  writeRawState({
    ...raw,
    currentTrackId: null,
    currentTimeSeconds: 0,
    wasPlaying: false,
  });
}

/** Remove queue + legacy playback persistence (Android clear app data wipes localStorage too). */
export function clearPlaybackPersistence(): void {
  clearPersistedQueue();
  for (const key of PLAYBACK_PERSISTENCE_KEYS) {
    if (key === QUEUE_STATE_KEY || key === LEGACY_LAST_QUEUE_KEY) continue;
    prefsRemoveItem(key);
  }
  clearActivePlaybackSession();
}

let restoreGuardInstalled = false;

/**
 * Call once at app boot (before React). Skips player restore after reload/cold start
 * and registers pagehide for reload heuristics on Capacitor/Android WebView.
 */
export function initPlaybackRestoreGuard(): void {
  if (typeof window === 'undefined' || restoreGuardInstalled) return;
  restoreGuardInstalled = true;

  if (isColdPlaybackStart()) {
    discardNonPersistableLastPlayIntent();
  }

  if (isLikelyPageReload() || isColdPlaybackStart()) {
    clearPersistedCurrentTrack();
  }

  window.addEventListener('pagehide', markPageUnloadForReloadDetection);
}
export const QUEUE_STATE_SCHEMA_VERSION = 1;

export type RepeatMode = 'none' | 'one' | 'all';

/** Minimal track reference — full envelopes rehydrated via locker / play history on load. */
export type PersistedTrackRef = {
  envelopeId: string;
  sourceId?: string;
  provider?: MediaProvider;
  transport?: MediaTransport;
  title: string;
  artist: string;
  album?: string;
  durationSeconds?: number;
  artworkUrl?: string;
};

export type PersistedQueueState = {
  version: typeof QUEUE_STATE_SCHEMA_VERSION;
  savedAt: number;
  playQueue: PersistedTrackRef[];
  queueIndex: number;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  currentTrackId: string | null;
  currentTimeSeconds: number;
  wasPlaying: boolean;
};

export type QueueSaveInput = {
  playQueue: MediaEnvelope[];
  queueIndex: number;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  currentTrackId: string | null;
  currentTimeSeconds: number;
  wasPlaying: boolean;
};

export type QueueRestoreResult = {
  playQueue: MediaEnvelope[];
  queueIndex: number;
  shuffleOn: boolean;
  repeatMode: RepeatMode;
  currentTrackId: string | null;
  currentTimeSeconds: number;
  wasPlaying: boolean;
};

const SAVE_DEBOUNCE_MS = 400;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSave: QueueSaveInput | null = null;
let lifecycleInstalled = false;
let lifecycleGetState: (() => QueueSaveInput | null) | null = null;

export function envelopeToTrackRef(env: MediaEnvelope): PersistedTrackRef {
  return {
    envelopeId: env.envelopeId,
    sourceId: env.sourceId,
    provider: env.provider,
    transport: env.transport,
    title: env.title,
    artist: env.artist,
    album: env.album,
    durationSeconds: env.durationSeconds,
    artworkUrl: env.artworkUrl,
  };
}

export function trackRefToEnvelope(ref: PersistedTrackRef): MediaEnvelope {
  return {
    envelopeId: ref.envelopeId,
    title: ref.title,
    artist: ref.artist,
    album: ref.album,
    url: '',
    durationSeconds: ref.durationSeconds ?? 0,
    provider: ref.provider ?? 'unknown',
    transport: ref.transport ?? 'element-src',
    sourceId: ref.sourceId ?? ref.envelopeId,
    artworkUrl: ref.artworkUrl,
  };
}

function clampQueueIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(index, length - 1));
}

function writeRawState(state: PersistedQueueState): void {
  try {
    const ok = prefsSetItem(QUEUE_STATE_KEY, JSON.stringify(state));
    if (!ok) {
      console.warn('[Sandbox] queue state not saved (storage quota or private mode)');
    }
  } catch (err) {
    console.warn('[Sandbox] queue state write failed:', err);
  }
}

function buildPersistedState(input: QueueSaveInput): PersistedQueueState {
  const playQueue = input.playQueue.map(envelopeToTrackRef);
  return {
    version: QUEUE_STATE_SCHEMA_VERSION,
    savedAt: Date.now(),
    playQueue,
    queueIndex: clampQueueIndex(input.queueIndex, playQueue.length),
    shuffleOn: input.shuffleOn,
    repeatMode: input.repeatMode,
    currentTrackId: input.currentTrackId,
    currentTimeSeconds: Math.max(0, input.currentTimeSeconds),
    wasPlaying: input.wasPlaying,
  };
}

function readPersistedRaw(): PersistedQueueState | null {
  const raw = prefsGetItem(QUEUE_STATE_KEY);
  if (!raw) return migrateLegacyLastQueue();
  try {
    const parsed = JSON.parse(raw) as PersistedQueueState;
    if (parsed?.version !== QUEUE_STATE_SCHEMA_VERSION) return null;
    if (!Array.isArray(parsed.playQueue)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Upgrade v0 `sandbox_last_queue` (full envelopes) into schema v1. */
function migrateLegacyLastQueue(): PersistedQueueState | null {
  const raw = prefsGetItem(LEGACY_LAST_QUEUE_KEY);
  if (!raw || raw === '[]') return null;
  try {
    const queue = JSON.parse(raw) as MediaEnvelope[];
    if (!Array.isArray(queue) || queue.length === 0) return null;
    const refs = queue.map(envelopeToTrackRef);
    const state: PersistedQueueState = {
      version: QUEUE_STATE_SCHEMA_VERSION,
      savedAt: Date.now(),
      playQueue: refs,
      queueIndex: 0,
      shuffleOn: false,
      repeatMode: 'none',
      currentTrackId: refs[0]?.envelopeId ?? null,
      currentTimeSeconds: 0,
      wasPlaying: false,
    };
    writeRawState(state);
    return state;
  } catch {
    return null;
  }
}

export function loadQueueState(): PersistedQueueState | null {
  return readPersistedRaw();
}

export type RehydrateContext = {
  lockerEnvelopes: MediaEnvelope[];
  playHistory: StoredPlayHit[];
};

function rehydrateTrackRef(
  ref: PersistedTrackRef,
  ctx: RehydrateContext,
): MediaEnvelope | null {
  const locker = ctx.lockerEnvelopes.find(
    (e) =>
      e.envelopeId === ref.envelopeId ||
      (ref.sourceId && e.sourceId === ref.sourceId) ||
      (ref.provider === 'local-vault' &&
        ref.sourceId &&
        e.envelopeId === `local-${ref.sourceId}`),
  );
  if (locker) return locker;

  const history = ctx.playHistory.find((h) => h.envelopeId === ref.envelopeId);
  if (history) return sanitizeRestoredEnvelope(hitToEnvelope(history));

  if (!ref.title?.trim()) return null;
  return trackRefToEnvelope(ref);
}

export function rehydrateQueueState(
  state: PersistedQueueState | null,
  ctx: RehydrateContext,
): QueueRestoreResult | null {
  if (!state || state.playQueue.length === 0) return null;

  const playQueue: MediaEnvelope[] = [];
  for (const ref of state.playQueue) {
    const env = rehydrateTrackRef(ref, ctx);
    if (env) playQueue.push(env);
  }
  if (playQueue.length === 0) return null;

  const savedCurrent = state.currentTrackId;
  let queueIndex = clampQueueIndex(state.queueIndex, playQueue.length);
  if (savedCurrent) {
    const idx = playQueue.findIndex((e) => e.envelopeId === savedCurrent);
    if (idx >= 0) queueIndex = idx;
  }

  const currentTrackId =
    savedCurrent && playQueue.some((e) => e.envelopeId === savedCurrent)
      ? savedCurrent
      : playQueue[queueIndex]?.envelopeId ?? null;

  return {
    playQueue,
    queueIndex,
    shuffleOn: state.shuffleOn,
    repeatMode: state.repeatMode,
    currentTrackId,
    currentTimeSeconds: state.currentTimeSeconds,
    wasPlaying: false,
  };
}

export function saveQueueState(input: QueueSaveInput, options?: { immediate?: boolean }): void {
  if (input.playQueue.length === 0) {
    clearPersistedQueue();
    return;
  }

  pendingSave = input;
  if (options?.immediate) {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    writeRawState(buildPersistedState(input));
    pendingSave = null;
    return;
  }

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (!pendingSave) return;
    writeRawState(buildPersistedState(pendingSave));
    pendingSave = null;
  }, SAVE_DEBOUNCE_MS);
}

export function flushQueueState(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  if (pendingSave) {
    writeRawState(buildPersistedState(pendingSave));
    pendingSave = null;
    return;
  }
  if (lifecycleGetState) {
    const snapshot = lifecycleGetState();
    if (snapshot && snapshot.playQueue.length > 0) {
      writeRawState(buildPersistedState(snapshot));
    }
  }
}

export function clearPersistedQueue(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  pendingSave = null;
  prefsRemoveItem(QUEUE_STATE_KEY);
  prefsRemoveItem(LEGACY_LAST_QUEUE_KEY);
}

function onLifecycleFlush(): void {
  flushQueueState();
}

/** Register visibility / pagehide flush hooks. Call once from the shell. */
export function initQueuePersistenceLifecycle(getState: () => QueueSaveInput | null): () => void {
  lifecycleGetState = getState;
  if (lifecycleInstalled) {
    return () => {
      lifecycleGetState = null;
    };
  }
  lifecycleInstalled = true;

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') onLifecycleFlush();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onLifecycleFlush);

  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onLifecycleFlush);
    lifecycleGetState = null;
    lifecycleInstalled = false;
  };
}

/** Minimal queue for Home "Resume Queue" before full rehydrate completes. */
export function loadPersistedQueueShell(): MediaEnvelope[] {
  const state = loadQueueState();
  if (!state?.playQueue.length) return [];
  return state.playQueue.map(trackRefToEnvelope);
}
