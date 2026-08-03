import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  appendPlayEventRecord,
  buildPlayEventDedupeKey,
  captureTzOffsetMinutes,
  collectPlayEventsPaged,
  ensurePlayEventsIdb,
  isPlayEventsIdbActive,
  mapLegacySource,
  mapV2ToV3,
  newPlayEventId,
  playEventKindFromEnvelopeId,
  PLAY_EVENTS_LEGACY_KEY,
  queryPlayEventsPage,
  type PlayEventKind,
  type PlayEventOrigin,
  type PlayEventRecord,
  type PlayEventSource,
} from './playEventsIdb';

const PLAY_HISTORY_KEY = 'sandbox_play_history';
const PLAY_SESSIONS_KEY = 'sandbox_play_sessions';
const LISTENING_SESSIONS_KEY = 'sandbox_listening_sessions';
const ANALYTICS_SCHEMA_KEY = 'sandbox_analytics_schema';
const LAST_QUEUE_KEY = 'sandbox_last_queue';

/** v3 = append-only IndexedDB play-event log (+ prior session→event migration). */
export const ANALYTICS_SCHEMA_VERSION = 3;

const MAX_HISTORY = 64;
const MAX_SESSIONS = 8000;
const MAX_LISTENING_SESSIONS = 2000;
const MIN_SESSION_SECONDS = 5;
const SESSION_IDLE_MS = 30 * 60 * 1000;

export const SKIP_THRESHOLD_MS = 30_000;
export const SKIP_THRESHOLD_PCT = 50;
export const COMPLETE_THRESHOLD_PCT = 85;

export const PLAY_HISTORY_CHANGE_EVENT = 'sandbox-play-history-change';

const playHistoryListeners = new Set<() => void>();

function notifyPlayHistoryChange(): void {
  playHistoryListeners.forEach((fn) => fn());
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    window.dispatchEvent(new Event(PLAY_HISTORY_CHANGE_EVENT));
  }
}

export function subscribePlayHistory(listener: () => void): () => void {
  playHistoryListeners.add(listener);
  return () => playHistoryListeners.delete(listener);
}

export type { PlayEventOrigin, PlayEventSource };

/** Granular play event with completion analytics. */
export type PlayEvent = {
  trackId: string;
  envelopeId: string;
  artist: string;
  album?: string;
  title: string;
  durationMs: number;
  listenedMs: number;
  completedPct: number;
  skipped: boolean;
  repeat: boolean;
  timestamp: number;
  sessionId: string;
  /**
   * Acquisition / surface source for the listen.
   * Legacy `download`/`online` still accepted when reading older rows; new writes use v3 values.
   */
  source?: PlayEventSource | 'download' | 'online';
  /** How the user was listening — used to weight album vs single vs radio affinity. */
  context?: 'album' | 'single' | 'radio' | 'playlist';
  /** Present on v3 rows (IndexedDB). */
  id?: string;
  dedupe_key?: string;
  origin?: PlayEventOrigin;
  /** Local UTC offset (minutes) at capture — required on new writes. */
  tz_offset_minutes?: number;
  /**
   * Which pillar this listen was.
   *
   * Taken from the stored type rather than spelled out again here. The two copies had already
   * drifted the moment a fourth pillar existed, and a hand-kept duplicate of a union is a
   * migration waiting to be forgotten.
   */
  kind?: PlayEventKind;
};

/** Continuous listening session (device-local). */
export type ListeningSession = {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
};

/** Legacy session row — kept for smart-playlist and migration. */
export type PlaySession = {
  id: string;
  envelopeId: string;
  title: string;
  artist: string;
  album?: string;
  artworkUrl?: string;
  trackDurationSeconds?: number;
  listenedSeconds: number;
  playedAt: number;
  completed: boolean;
  trackId?: string;
  durationMs?: number;
  listenedMs?: number;
  completedPct?: number;
  skipped?: boolean;
  repeat?: boolean;
  sessionId?: string;
};

export type StoredPlayHit = {
  envelopeId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  provider?: MediaEnvelope['provider'];
  sourceId?: string;
  url?: string;
  album?: string;
  durationSeconds?: number;
  transport?: MediaEnvelope['transport'];
  playCount: number;
  lastPlayedAt: number;
};

export type RecordPlayEventOptions = {
  envelope: MediaEnvelope;
  listenedSeconds: number;
  completed?: boolean;
  skipped?: boolean;
  listenedMs?: number;
  /** How the user was listening (album drill, single tap, radio, playlist). */
  context?: PlayEvent['context'];
  origin?: PlayEventOrigin;
  source?: PlayEventSource;
};

/** Sync mirror for IDB mode — updated on append; hydrated via paged cursors (never getAll). */
let idbEventsMirror: PlayEvent[] | null = null;
let idbHydratePromise: Promise<void> | null = null;
let legacySessionsMigrationDone = false;
let idbEnsurePromise: Promise<boolean> | null = null;

function recordToPlayEvent(row: PlayEventRecord): PlayEvent {
  return {
    id: row.id,
    trackId: row.trackId,
    envelopeId: row.envelopeId,
    artist: row.artist,
    album: row.album,
    title: row.title,
    durationMs: row.durationMs,
    listenedMs: row.listenedMs,
    completedPct: row.completedPct,
    skipped: row.skipped,
    repeat: row.repeat,
    timestamp: row.timestamp,
    sessionId: row.sessionId,
    source: row.source,
    context: row.context,
    dedupe_key: row.dedupe_key,
    origin: row.origin,
    tz_offset_minutes: row.tz_offset_minutes,
    kind: row.kind,
  };
}

function playEventToRecord(event: PlayEvent): PlayEventRecord {
  const envelopeId = event.envelopeId;
  const timestamp = event.timestamp;
  const sessionId = event.sessionId;
  const listenedMs = event.listenedMs;
  const dedupe_key =
    event.dedupe_key ??
    buildPlayEventDedupeKey({ timestamp, envelopeId, sessionId, listenedMs });
  return {
    id: event.id ?? newPlayEventId(timestamp),
    trackId: event.trackId,
    envelopeId,
    artist: event.artist,
    album: event.album,
    title: event.title,
    durationMs: event.durationMs,
    listenedMs,
    completedPct: event.completedPct,
    skipped: event.skipped,
    repeat: event.repeat,
    timestamp,
    sessionId,
    source: mapLegacySource(event.source),
    context: event.context,
    dedupe_key,
    origin: event.origin ?? 'auto',
    tz_offset_minutes:
      event.tz_offset_minutes ?? captureTzOffsetMinutes(timestamp),
    kind: event.kind ?? playEventKindFromEnvelopeId(envelopeId),
  };
}

function readHistory(): StoredPlayHit[] {
  const raw = prefsGetItem(PLAY_HISTORY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as StoredPlayHit[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeHistory(entries: StoredPlayHit[]): void {
  prefsSetItem(PLAY_HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
  notifyPlayHistoryChange();
}

function readSchemaVersion(): number {
  const raw = prefsGetItem(ANALYTICS_SCHEMA_KEY);
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as { version?: number };
    return typeof parsed.version === 'number' ? parsed.version : 0;
  } catch {
    return 0;
  }
}

function writeSchemaVersion(version: number): void {
  prefsSetItem(ANALYTICS_SCHEMA_KEY, JSON.stringify({ version }));
}

function readEventsRawLegacy(): PlayEvent[] {
  const raw = prefsGetItem(PLAY_EVENTS_LEGACY_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PlayEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Legacy-only write — used when IDB migration aborted / unavailable. Uncapped IDB has no MAX. */
function writeEventsLegacy(events: PlayEvent[]): void {
  prefsSetItem(PLAY_EVENTS_LEGACY_KEY, JSON.stringify(events));
  notifyPlayHistoryChange();
}

function readListeningSessionsRaw(): ListeningSession[] {
  const raw = prefsGetItem(LISTENING_SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as ListeningSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeListeningSessions(sessions: ListeningSession[]): void {
  prefsSetItem(
    LISTENING_SESSIONS_KEY,
    JSON.stringify(sessions.slice(0, MAX_LISTENING_SESSIONS)),
  );
  notifyPlayHistoryChange();
}

function readSessions(): PlaySession[] {
  const raw = prefsGetItem(PLAY_SESSIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PlaySession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeSessions(sessions: PlaySession[]): void {
  prefsSetItem(PLAY_SESSIONS_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
  notifyPlayHistoryChange();
}

function durationMsFromEnvelope(envelope: MediaEnvelope): number {
  const secs = envelope.durationSeconds;
  return secs != null && secs > 0 ? Math.round(secs * 1000) : 0;
}

export function computeCompletedPct(listenedMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    return listenedMs >= SKIP_THRESHOLD_MS ? 100 : 0;
  }
  return Math.min(100, Math.round((listenedMs / durationMs) * 1000) / 10);
}

export function computeSkipped(
  listenedMs: number,
  durationMs: number,
  completed: boolean,
): boolean {
  if (completed) return false;
  const pct = computeCompletedPct(listenedMs, durationMs);
  return listenedMs < SKIP_THRESHOLD_MS && pct < SKIP_THRESHOLD_PCT;
}

function playEventToSession(event: PlayEvent): PlaySession {
  return {
    id: `${event.timestamp}-${event.envelopeId}`,
    envelopeId: event.envelopeId,
    trackId: event.trackId,
    title: event.title,
    artist: event.artist,
    album: event.album,
    trackDurationSeconds:
      event.durationMs > 0 ? Math.round(event.durationMs / 1000) : undefined,
    listenedSeconds: Math.floor(event.listenedMs / 1000),
    playedAt: event.timestamp,
    completed: event.completedPct >= COMPLETE_THRESHOLD_PCT,
    durationMs: event.durationMs,
    listenedMs: event.listenedMs,
    completedPct: event.completedPct,
    skipped: event.skipped,
    repeat: event.repeat,
    sessionId: event.sessionId,
  };
}

function legacySessionToEvent(session: PlaySession, sessionId: string): PlayEvent {
  const listenedMs =
    session.listenedMs ?? Math.max(0, Math.floor(session.listenedSeconds * 1000));
  const durationMs =
    session.durationMs ??
    (session.trackDurationSeconds != null && session.trackDurationSeconds > 0
      ? Math.round(session.trackDurationSeconds * 1000)
      : 0);
  const completedPct =
    session.completedPct ?? computeCompletedPct(listenedMs, durationMs);
  const skipped =
    session.skipped ?? computeSkipped(listenedMs, durationMs, session.completed);
  const timestamp = session.playedAt;
  const envelopeId = session.envelopeId;
  return {
    trackId: session.trackId ?? session.envelopeId,
    envelopeId,
    artist: session.artist,
    album: session.album,
    title: session.title,
    durationMs,
    listenedMs,
    completedPct,
    skipped,
    repeat: session.repeat ?? false,
    timestamp,
    sessionId: session.sessionId ?? sessionId,
    source: 'tier34',
    origin: 'imported',
    dedupe_key: buildPlayEventDedupeKey({
      timestamp,
      envelopeId,
      sessionId: session.sessionId ?? sessionId,
      listenedMs,
    }),
    tz_offset_minutes: captureTzOffsetMinutes(timestamp),
    kind: playEventKindFromEnvelopeId(envelopeId),
  };
}

function migrateLegacySessionsIfNeeded(): void {
  if (legacySessionsMigrationDone) return;
  legacySessionsMigrationDone = true;

  const version = readSchemaVersion();
  // Still run session→events prefs migration when below v2; v3 IDB migration is separate.
  if (version >= 2) return;

  const existingEvents = readEventsRawLegacy();
  if (existingEvents.length > 0) {
    writeSchemaVersion(Math.max(version, 2));
    return;
  }

  const legacy = readSessions();
  if (legacy.length === 0) {
    writeSchemaVersion(Math.max(version, 2));
    return;
  }

  const events = legacy.map((s, i) =>
    legacySessionToEvent(s, `legacy-migrated-${Math.floor(s.playedAt / SESSION_IDLE_MS)}-${i}`),
  );
  writeEventsLegacy(events);
  writeSchemaVersion(2);
}

function kickIdbEnsure(): void {
  if (idbEnsurePromise) return;
  idbEnsurePromise = ensurePlayEventsIdb()
    .then(async (ok) => {
      if (ok && isPlayEventsIdbActive()) {
        await hydrateIdbMirror();
        writeSchemaVersion(ANALYTICS_SCHEMA_VERSION);
      }
      return ok;
    })
    .catch((err) => {
      console.warn('[Sandbox] play events IDB ensure failed:', err);
      return false;
    });
}

async function hydrateIdbMirror(): Promise<void> {
  if (idbHydratePromise) return idbHydratePromise;
  idbHydratePromise = (async () => {
    const rows = await collectPlayEventsPaged();
    idbEventsMirror = rows.map(recordToPlayEvent);
  })();
  return idbHydratePromise;
}

/** Await IDB migration + mirror hydrate (tests / boot). */
export async function readyPlayHistoryIdb(): Promise<boolean> {
  migrateLegacySessionsIfNeeded();
  kickIdbEnsure();
  const ok = (await idbEnsurePromise) === true;
  if (ok) await hydrateIdbMirror();
  return ok && isPlayEventsIdbActive();
}

/** Test seam. */
export function resetPlayHistoryRuntimeForTests(): void {
  idbEventsMirror = null;
  idbHydratePromise = null;
  legacySessionsMigrationDone = false;
  idbEnsurePromise = null;
}

export function getAllPlayEvents(): PlayEvent[] {
  migrateLegacySessionsIfNeeded();
  kickIdbEnsure();
  if (isPlayEventsIdbActive()) {
    return idbEventsMirror ?? [];
  }
  return readEventsRawLegacy();
}

/**
 * Bounded newest-first page from IDB (or legacy prefs slice). Prefer this over getAllPlayEvents
 * when the store may be large.
 */
export async function getPlayEventsPage(options?: {
  limit?: number;
  beforeTimestamp?: number;
  sinceTimestamp?: number;
  envelopeId?: string;
  kind?: PlayEvent['kind'];
}): Promise<PlayEvent[]> {
  migrateLegacySessionsIfNeeded();
  await readyPlayHistoryIdb();
  if (isPlayEventsIdbActive()) {
    const page = await queryPlayEventsPage({
      limit: options?.limit,
      beforeTimestamp: options?.beforeTimestamp,
      sinceTimestamp: options?.sinceTimestamp,
      envelopeId: options?.envelopeId,
      kind: options?.kind,
    });
    return page.map(recordToPlayEvent);
  }
  let events = readEventsRawLegacy();
  if (options?.envelopeId) {
    events = events.filter((e) => e.envelopeId === options.envelopeId);
  }
  if (options?.kind) {
    events = events.filter(
      (e) => (e.kind ?? playEventKindFromEnvelopeId(e.envelopeId)) === options.kind,
    );
  }
  if (options?.sinceTimestamp != null) {
    events = events.filter((e) => e.timestamp >= options.sinceTimestamp!);
  }
  if (options?.beforeTimestamp != null) {
    events = events.filter((e) => e.timestamp < options.beforeTimestamp!);
  }
  events = [...events].sort((a, b) => b.timestamp - a.timestamp);
  return events.slice(0, options?.limit ?? 200);
}

export function getAllListeningSessions(): ListeningSession[] {
  migrateLegacySessionsIfNeeded();
  return readListeningSessionsRaw();
}

export function getAllPlaySessions(): PlaySession[] {
  migrateLegacySessionsIfNeeded();
  const events = getAllPlayEvents();
  if (events.length > 0) {
    return events.map(playEventToSession);
  }
  return readSessions();
}

/** Full play history for smart playlist evaluation (not capped for display). */
export function getAllPlayHistory(): StoredPlayHit[] {
  return readHistory();
}

/**
 * Play stats for smart playlist evaluation — merges capped history hits with
 * full session aggregates so tracks outside the history window keep counts.
 */
export function getSmartPlaylistPlayHistory(): StoredPlayHit[] {
  const byId = new Map<string, StoredPlayHit>();
  for (const hit of readHistory()) {
    byId.set(hit.envelopeId, { ...hit });
  }

  const sessionCounts = new Map<
    string,
    { count: number; lastAt: number; sample: PlaySession }
  >();
  for (const session of getAllPlaySessions()) {
    const id = session.envelopeId?.trim();
    if (!id) continue;
    const row = sessionCounts.get(id);
    if (row) {
      row.count += 1;
      if (session.playedAt > row.lastAt) {
        row.lastAt = session.playedAt;
        row.sample = session;
      }
    } else {
      sessionCounts.set(id, { count: 1, lastAt: session.playedAt, sample: session });
    }
  }

  for (const [id, agg] of sessionCounts) {
    const hit = byId.get(id);
    if (hit) {
      hit.playCount = Math.max(hit.playCount, agg.count);
      hit.lastPlayedAt = Math.max(hit.lastPlayedAt, agg.lastAt);
    } else {
      byId.set(id, {
        envelopeId: id,
        title: agg.sample.title,
        artist: agg.sample.artist,
        album: agg.sample.album,
        artworkUrl: agg.sample.artworkUrl,
        playCount: agg.count,
        lastPlayedAt: agg.lastAt,
      });
    }
  }

  return [...byId.values()];
}

/** Active listening session id if idle window not exceeded; does not create a session. */
export function getActiveListeningSessionId(now = Date.now()): string | null {
  const sessions = readListeningSessionsRaw();
  const latest = sessions[0];
  if (latest && now - latest.endedAt < SESSION_IDLE_MS) {
    return latest.id;
  }
  return null;
}

function resolveActiveListeningSessionId(now = Date.now()): string {
  const existing = getActiveListeningSessionId(now);
  if (existing) return existing;
  const sessions = readListeningSessionsRaw();
  const id = `ls-${now}-${Math.random().toString(36).slice(2, 8)}`;
  sessions.unshift({
    id,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
  });
  writeListeningSessions(sessions);
  return id;
}

function touchListeningSession(sessionId: string, listenedMs: number, now = Date.now()): void {
  const sessions = readListeningSessionsRaw();
  const idx = sessions.findIndex((s) => s.id === sessionId);
  if (idx < 0) return;
  const cur = sessions[idx];
  sessions[idx] = {
    ...cur,
    endedAt: now,
    durationMs: cur.durationMs + Math.max(0, listenedMs),
  };
  writeListeningSessions(sessions);
}

/** Drop heavy base64/blob artwork before persisting — it overflows localStorage. */
function lightArtworkUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return url.startsWith('data:') || url.startsWith('blob:') ? undefined : url;
}

function isRepeatInSession(sessionId: string, envelopeId: string): boolean {
  if (isPlayEventsIdbActive() && idbEventsMirror) {
    return idbEventsMirror.some(
      (e) => e.sessionId === sessionId && e.envelopeId === envelopeId,
    );
  }
  return getAllPlayEvents().some(
    (e) => e.sessionId === sessionId && e.envelopeId === envelopeId,
  );
}

export function recordPlayEvent(options: RecordPlayEventOptions): PlayEvent | null {
  migrateLegacySessionsIfNeeded();
  kickIdbEnsure();
  const { envelope, listenedSeconds, completed = false, skipped } = options;
  if (!envelope.envelopeId?.trim()) return null;

  const listenedMs =
    options.listenedMs ?? Math.max(0, Math.floor(listenedSeconds * 1000));
  if (listenedMs < MIN_SESSION_SECONDS * 1000) return null;

  const now = Date.now();
  const durationMs = durationMsFromEnvelope(envelope);
  const completedPct = computeCompletedPct(listenedMs, durationMs);
  const isCompleted =
    completed || completedPct >= COMPLETE_THRESHOLD_PCT;
  const isSkipped =
    skipped ?? computeSkipped(listenedMs, durationMs, isCompleted);

  const sessionId = resolveActiveListeningSessionId(now);
  const repeat = isRepeatInSession(sessionId, envelope.envelopeId);

  const source: PlayEventSource =
    options.source ??
    (envelope.provider === 'local-vault' ? 'locker' : 'tier34');
  const origin: PlayEventOrigin = options.origin ?? 'auto';
  const tz_offset_minutes = captureTzOffsetMinutes(now);
  const kind = playEventKindFromEnvelopeId(envelope.envelopeId);
  const dedupe_key = buildPlayEventDedupeKey({
    timestamp: now,
    envelopeId: envelope.envelopeId,
    sessionId,
    listenedMs,
  });

  const event: PlayEvent = {
    id: newPlayEventId(now),
    trackId: envelope.envelopeId,
    envelopeId: envelope.envelopeId,
    title: envelope.title,
    artist: envelope.artist,
    album: envelope.album,
    durationMs,
    listenedMs,
    completedPct,
    skipped: isSkipped,
    repeat,
    timestamp: now,
    sessionId,
    source,
    context: options.context,
    dedupe_key,
    origin,
    tz_offset_minutes,
    kind,
  };

  if (isPlayEventsIdbActive()) {
    if (!idbEventsMirror) idbEventsMirror = [];
    idbEventsMirror.unshift(event);
    void appendPlayEventRecord(playEventToRecord(event)).then((result) => {
      if (result.quotaExceeded) {
        console.warn(
          '[Sandbox] play event IDB append QuotaExceededError — event kept in memory mirror only',
        );
      }
    });
    writeSchemaVersion(ANALYTICS_SCHEMA_VERSION);
    notifyPlayHistoryChange();
  } else {
    const events = readEventsRawLegacy();
    events.unshift(event);
    writeEventsLegacy(events);
    writeSchemaVersion(Math.max(readSchemaVersion(), 2));
  }

  const legacySession = playEventToSession(event);
  const sessions = readSessions();
  sessions.unshift({
    ...legacySession,
    artworkUrl: lightArtworkUrl(envelope.artworkUrl),
  });
  writeSessions(sessions);

  touchListeningSession(sessionId, listenedMs, now);
  return event;
}

export function recordPlaySession(
  envelope: MediaEnvelope,
  listenedSeconds: number,
  completed = false,
  skipped?: boolean,
  context?: PlayEvent['context'],
): void {
  recordPlayEvent({ envelope, listenedSeconds, completed, skipped, context });
}

export function recordPlay(envelope: MediaEnvelope): void {
  if (!envelope.envelopeId?.trim()) return;
  const now = Date.now();
  const entries = readHistory();
  const idx = entries.findIndex((e) => e.envelopeId === envelope.envelopeId);
  const base: StoredPlayHit = {
    envelopeId: envelope.envelopeId,
    title: envelope.title,
    artist: envelope.artist,
    artworkUrl: lightArtworkUrl(envelope.artworkUrl),
    provider: envelope.provider,
    sourceId: envelope.sourceId,
    url: envelope.url,
    album: envelope.album,
    durationSeconds: envelope.durationSeconds,
    transport: envelope.transport,
    playCount: 1,
    lastPlayedAt: now,
  };
  if (idx >= 0) {
    entries[idx] = {
      ...entries[idx],
      ...base,
      playCount: entries[idx].playCount + 1,
      lastPlayedAt: now,
    };
  } else {
    entries.unshift(base);
  }
  entries.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
  writeHistory(entries);
}

export function getMostPlayed(limit = 5): StoredPlayHit[] {
  return [...readHistory()]
    .sort((a, b) => b.playCount - a.playCount || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, limit);
}

/** Most recent plays by lastPlayedAt (newest first). */
export function getRecentlyPlayed(limit = 5): StoredPlayHit[] {
  return readHistory().slice(0, limit);
}

export function storedHitToEnvelope(hit: StoredPlayHit): MediaEnvelope {
  return {
    envelopeId: hit.envelopeId,
    title: hit.title,
    artist: hit.artist,
    album: hit.album,
    url: hit.url,
    artworkUrl: hit.artworkUrl,
    provider: hit.provider,
    sourceId: hit.sourceId,
    durationSeconds: hit.durationSeconds,
    transport: hit.transport,
  };
}

export function saveLastQueue(queue: MediaEnvelope[]): void {
  if (queue.length === 0) {
    prefsSetItem(LAST_QUEUE_KEY, '[]');
    return;
  }
  prefsSetItem(LAST_QUEUE_KEY, JSON.stringify(queue));
}

export function loadLastQueue(): MediaEnvelope[] {
  const raw = prefsGetItem(LAST_QUEUE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as MediaEnvelope[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Re-export mapper for tests / tooling. */
export { mapV2ToV3 };
