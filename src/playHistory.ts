import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { MediaEnvelope } from './sandboxLayer1';

const PLAY_HISTORY_KEY = 'sandbox_play_history';
const PLAY_SESSIONS_KEY = 'sandbox_play_sessions';
const PLAY_EVENTS_KEY = 'sandbox_play_events';
const LISTENING_SESSIONS_KEY = 'sandbox_listening_sessions';
const ANALYTICS_SCHEMA_KEY = 'sandbox_analytics_schema';
const LAST_QUEUE_KEY = 'sandbox_last_queue';

export const ANALYTICS_SCHEMA_VERSION = 2;

const MAX_HISTORY = 64;
const MAX_SESSIONS = 8000;
const MAX_EVENTS = 12000;
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
  window.dispatchEvent(new Event(PLAY_HISTORY_CHANGE_EVENT));
}

export function subscribePlayHistory(listener: () => void): () => void {
  playHistoryListeners.add(listener);
  return () => playHistoryListeners.delete(listener);
}

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
};

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

function readEventsRaw(): PlayEvent[] {
  const raw = prefsGetItem(PLAY_EVENTS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PlayEvent[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeEvents(events: PlayEvent[]): void {
  prefsSetItem(PLAY_EVENTS_KEY, JSON.stringify(events.slice(0, MAX_EVENTS)));
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
  return {
    trackId: session.trackId ?? session.envelopeId,
    envelopeId: session.envelopeId,
    artist: session.artist,
    album: session.album,
    title: session.title,
    durationMs,
    listenedMs,
    completedPct,
    skipped,
    repeat: session.repeat ?? false,
    timestamp: session.playedAt,
    sessionId: session.sessionId ?? sessionId,
  };
}

let migrationDone = false;

function migrateLegacySessionsIfNeeded(): void {
  if (migrationDone) return;
  migrationDone = true;

  const version = readSchemaVersion();
  if (version >= ANALYTICS_SCHEMA_VERSION) return;

  const existingEvents = readEventsRaw();
  if (existingEvents.length > 0) {
    writeSchemaVersion(ANALYTICS_SCHEMA_VERSION);
    return;
  }

  const legacy = readSessions();
  if (legacy.length === 0) {
    writeSchemaVersion(ANALYTICS_SCHEMA_VERSION);
    return;
  }

  const events = legacy.map((s, i) =>
    legacySessionToEvent(s, `legacy-migrated-${Math.floor(s.playedAt / SESSION_IDLE_MS)}-${i}`),
  );
  writeEvents(events);
  writeSchemaVersion(ANALYTICS_SCHEMA_VERSION);
}

export function getAllPlayEvents(): PlayEvent[] {
  migrateLegacySessionsIfNeeded();
  return readEventsRaw();
}

export function getAllListeningSessions(): ListeningSession[] {
  migrateLegacySessionsIfNeeded();
  return readListeningSessionsRaw();
}

export function getAllPlaySessions(): PlaySession[] {
  migrateLegacySessionsIfNeeded();
  const events = readEventsRaw();
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

function isRepeatInSession(sessionId: string, envelopeId: string): boolean {
  return getAllPlayEvents().some(
    (e) => e.sessionId === sessionId && e.envelopeId === envelopeId,
  );
}

export function recordPlayEvent(options: RecordPlayEventOptions): PlayEvent | null {
  getAllPlayEvents();
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

  const event: PlayEvent = {
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
  };

  const events = readEventsRaw();
  events.unshift(event);
  writeEvents(events);
  writeSchemaVersion(ANALYTICS_SCHEMA_VERSION);

  const legacySession = playEventToSession(event);
  const sessions = readSessions();
  sessions.unshift({
    ...legacySession,
    artworkUrl: envelope.artworkUrl,
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
): void {
  recordPlayEvent({ envelope, listenedSeconds, completed, skipped });
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
    artworkUrl: envelope.artworkUrl,
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
