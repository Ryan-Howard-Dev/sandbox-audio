/**
 * Append-only play-event log in IndexedDB (SandboxPlayEventsDB).
 *
 * Related to SandboxMusicCoreDB — same open/upgrade/transaction style as lockerStorage.
 * Never getAll() over the store; callers use bounded cursors / IDBKeyRange pages.
 */

import { prefsGetItem, prefsRemoveItem, prefsSetItem } from './prefsStorage';
import { isAudiobookCatalogEnvelopeId } from './audiobookCatalogIds';
import { isAudiobookEnvelopeId } from './audiobookPlayback';
import { isPodcastEnvelopeId } from './podcastStorage';

export const PLAY_EVENTS_DB_NAME = 'SandboxPlayEventsDB';
export const PLAY_EVENTS_DB_VERSION = 1;
export const PLAY_EVENTS_STORE = 'play_events';

export const PLAY_EVENTS_LEGACY_KEY = 'sandbox_play_events';
export const PLAY_EVENTS_BAK_KEY = 'sandbox_play_events_BAK';
export const PLAY_EVENTS_MIGRATE_KEY = 'sandbox_play_events_idb_v3';
export const PLAY_EVENTS_BAK_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** Default page size for cursor reads — kept small so large stores stay bounded. */
export const PLAY_EVENTS_PAGE_SIZE = 200;

/** Chunk size when mapping legacy v2 rows during migration (phase 2). */
export const PLAY_EVENTS_MAP_CHUNK = 500;

export type PlayEventOrigin = 'auto' | 'manual' | 'imported';

export type PlayEventSource =
  | 'locker'
  | 'tier34'
  | 'pd_catalog'
  | 'oauth_spotify'
  | 'oauth_tidal'
  | 'manual';

export type PlayEventKind = 'music' | 'podcast' | 'audiobook';

/** Stored play-event row (v3). */
export type PlayEventRecord = {
  id: string;
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
  source: PlayEventSource;
  context?: 'album' | 'single' | 'radio' | 'playlist';
  dedupe_key: string;
  origin: PlayEventOrigin;
  tz_offset_minutes: number;
  kind: PlayEventKind;
};

export type PlayEventsMigrateState = {
  phase: 0 | 1 | 2 | 3 | 4 | 5;
  status: 'idle' | 'running' | 'done' | 'aborted';
  legacyCount?: number;
  writtenCount?: number;
  error?: string;
  completedAt?: number;
  bakAt?: number;
};

export type PlayEventsQuery = {
  /** Max rows to return (bounded page). */
  limit?: number;
  /** Exclusive upper bound on timestamp (for keyset pagination, newest-first). */
  beforeTimestamp?: number;
  /** Inclusive lower bound on timestamp. */
  sinceTimestamp?: number;
  envelopeId?: string;
  kind?: PlayEventKind;
};

type LegacyPlayEventV2 = {
  trackId?: string;
  envelopeId?: string;
  artist?: string;
  album?: string;
  title?: string;
  durationMs?: number;
  listenedMs?: number;
  completedPct?: number;
  skipped?: boolean;
  repeat?: boolean;
  timestamp?: number;
  sessionId?: string;
  source?: string;
  context?: PlayEventRecord['context'];
  dedupe_key?: string;
  origin?: string;
  tz_offset_minutes?: number;
  kind?: string;
  id?: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;
let migratePromise: Promise<PlayEventsMigrateState> | null = null;
let useIdb = false;

export function isPlayEventsIdbActive(): boolean {
  return useIdb;
}

/** Test seam — reset module singletons between vitest cases. */
export function resetPlayEventsIdbForTests(): void {
  dbPromise = null;
  migratePromise = null;
  useIdb = false;
}

export function playEventKindFromEnvelopeId(envelopeId: string): PlayEventKind {
  const id = envelopeId ?? '';
  if (isPodcastEnvelopeId(id)) return 'podcast';
  if (isAudiobookEnvelopeId(id) || isAudiobookCatalogEnvelopeId(id)) return 'audiobook';
  return 'music';
}

export function captureTzOffsetMinutes(atMs = Date.now()): number {
  return -new Date(atMs).getTimezoneOffset();
}

export function newPlayEventId(now = Date.now()): string {
  return `pe-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildPlayEventDedupeKey(input: {
  timestamp: number;
  envelopeId: string;
  sessionId: string;
  listenedMs: number;
}): string {
  return `${input.timestamp}|${input.envelopeId}|${input.sessionId}|${input.listenedMs}`;
}

export function mapLegacySource(source: string | undefined): PlayEventSource {
  switch (source) {
    case 'locker':
    case 'tier34':
    case 'pd_catalog':
    case 'oauth_spotify':
    case 'oauth_tidal':
    case 'manual':
      return source;
    case 'download':
      return 'locker';
    case 'online':
      return 'tier34';
    default:
      return 'tier34';
  }
}

export function mapV2ToV3(raw: LegacyPlayEventV2, index = 0): PlayEventRecord | null {
  const envelopeId = (raw.envelopeId ?? raw.trackId ?? '').trim();
  if (!envelopeId) return null;
  const timestamp =
    typeof raw.timestamp === 'number' && Number.isFinite(raw.timestamp)
      ? raw.timestamp
      : 0;
  const sessionId =
    typeof raw.sessionId === 'string' && raw.sessionId.trim()
      ? raw.sessionId
      : `legacy-${index}`;
  const listenedMs =
    typeof raw.listenedMs === 'number' && Number.isFinite(raw.listenedMs)
      ? Math.max(0, raw.listenedMs)
      : 0;
  const dedupe_key =
    typeof raw.dedupe_key === 'string' && raw.dedupe_key.trim()
      ? raw.dedupe_key
      : buildPlayEventDedupeKey({
          timestamp,
          envelopeId,
          sessionId,
          listenedMs,
        });
  const origin: PlayEventOrigin =
    raw.origin === 'manual' || raw.origin === 'imported' || raw.origin === 'auto'
      ? raw.origin
      : 'imported';
  const tz_offset_minutes =
    typeof raw.tz_offset_minutes === 'number' && Number.isFinite(raw.tz_offset_minutes)
      ? raw.tz_offset_minutes
      : captureTzOffsetMinutes(timestamp || Date.now());
  const kind: PlayEventKind =
    raw.kind === 'music' || raw.kind === 'podcast' || raw.kind === 'audiobook'
      ? raw.kind
      : playEventKindFromEnvelopeId(envelopeId);

  return {
    id:
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id
        : newPlayEventId(timestamp || Date.now() + index),
    trackId: (raw.trackId ?? envelopeId).trim() || envelopeId,
    envelopeId,
    artist: typeof raw.artist === 'string' ? raw.artist : '',
    album: typeof raw.album === 'string' ? raw.album : undefined,
    title: typeof raw.title === 'string' ? raw.title : '',
    durationMs:
      typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
        ? Math.max(0, raw.durationMs)
        : 0,
    listenedMs,
    completedPct:
      typeof raw.completedPct === 'number' && Number.isFinite(raw.completedPct)
        ? raw.completedPct
        : 0,
    skipped: Boolean(raw.skipped),
    repeat: Boolean(raw.repeat),
    timestamp,
    sessionId,
    source: mapLegacySource(raw.source),
    context: raw.context,
    dedupe_key,
    origin,
    tz_offset_minutes,
    kind,
  };
}

function readMigrateState(): PlayEventsMigrateState {
  const raw = prefsGetItem(PLAY_EVENTS_MIGRATE_KEY);
  if (!raw) return { phase: 0, status: 'idle' };
  try {
    const parsed = JSON.parse(raw) as PlayEventsMigrateState;
    if (!parsed || typeof parsed !== 'object') return { phase: 0, status: 'idle' };
    return parsed;
  } catch {
    return { phase: 0, status: 'idle' };
  }
}

function writeMigrateState(state: PlayEventsMigrateState): void {
  prefsSetItem(PLAY_EVENTS_MIGRATE_KEY, JSON.stringify(state));
}

function ensurePlayEventsStore(db: IDBDatabase): void {
  if (db.objectStoreNames.contains(PLAY_EVENTS_STORE)) return;
  const store = db.createObjectStore(PLAY_EVENTS_STORE, { keyPath: 'id' });
  // Ascending index; newest-first reads use openCursor(..., 'prev').
  store.createIndex('by_time', 'timestamp', { unique: false });
  store.createIndex('by_identity', 'envelopeId', { unique: false });
  store.createIndex('by_kind', 'kind', { unique: false });
  store.createIndex('by_dedupe_key', 'dedupe_key', { unique: true });
}

/** Phase 1 — open DB / create store+indexes. */
export function openPlayEventsDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('indexedDB unavailable'));
      return;
    }
    const request = indexedDB.open(PLAY_EVENTS_DB_NAME, PLAY_EVENTS_DB_VERSION);
    request.onupgradeneeded = () => {
      ensurePlayEventsStore(request.result);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('play events db open failed'));
    };
    request.onblocked = () => {
      console.warn(
        '[Sandbox] SandboxPlayEventsDB versionchange blocked by another tab',
      );
    };
  });
  return dbPromise;
}

function isConstraintError(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: string }).name === 'ConstraintError'
  );
}

function isQuotaExceeded(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'name' in err &&
    (err as { name?: string }).name === 'QuotaExceededError'
  );
}

/** Append one event. Swallows ConstraintError (dedupe). Returns false on hard failure. */
export async function appendPlayEventRecord(
  record: PlayEventRecord,
): Promise<{ ok: boolean; duplicate?: boolean; quotaExceeded?: boolean }> {
  const db = await openPlayEventsDb();
  return new Promise((resolve) => {
    const tx = db.transaction(PLAY_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(PLAY_EVENTS_STORE);
    const req = store.add(record);
    let duplicate = false;
    let quotaExceeded = false;
    let hardFail = false;
    req.onerror = (event) => {
      if (isConstraintError(req.error)) {
        duplicate = true;
        event.preventDefault();
        (event as Event & { stopPropagation?: () => void }).stopPropagation?.();
        return;
      }
      if (isQuotaExceeded(req.error)) {
        quotaExceeded = true;
        hardFail = true;
        return;
      }
      hardFail = true;
    };
    tx.oncomplete = () => {
      resolve({
        ok: !hardFail,
        duplicate: duplicate || undefined,
        quotaExceeded: quotaExceeded || undefined,
      });
    };
    tx.onerror = () => {
      if (isQuotaExceeded(tx.error)) {
        resolve({ ok: false, quotaExceeded: true });
        return;
      }
      if (isConstraintError(tx.error)) {
        resolve({ ok: true, duplicate: true });
        return;
      }
      resolve({ ok: false });
    };
    tx.onabort = () => {
      if (isQuotaExceeded(tx.error) || quotaExceeded) {
        resolve({ ok: false, quotaExceeded: true });
        return;
      }
      if (duplicate || isConstraintError(tx.error)) {
        resolve({ ok: true, duplicate: true });
        return;
      }
      resolve({ ok: false });
    };
  });
}

export async function countPlayEvents(): Promise<number> {
  const db = await openPlayEventsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAY_EVENTS_STORE, 'readonly');
    const req = tx.objectStore(PLAY_EVENTS_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearPlayEventsStore(): Promise<void> {
  const db = await openPlayEventsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAY_EVENTS_STORE, 'readwrite');
    const req = tx.objectStore(PLAY_EVENTS_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error ?? new Error('clear aborted'));
  });
}

/**
 * Bounded newest-first page via by_time cursor. Never getAll().
 */
export async function queryPlayEventsPage(
  query: PlayEventsQuery = {},
): Promise<PlayEventRecord[]> {
  const limit = Math.max(1, Math.min(query.limit ?? PLAY_EVENTS_PAGE_SIZE, 2000));
  const db = await openPlayEventsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAY_EVENTS_STORE, 'readonly');
    const store = tx.objectStore(PLAY_EVENTS_STORE);
    const rows: PlayEventRecord[] = [];

    const onError = () => reject(tx.error ?? new Error('play events query failed'));

    const pushIfMatch = (value: PlayEventRecord): boolean => {
      if (query.envelopeId && value.envelopeId !== query.envelopeId) return false;
      if (query.kind && value.kind !== query.kind) return false;
      if (
        query.sinceTimestamp != null &&
        value.timestamp < query.sinceTimestamp
      ) {
        return false;
      }
      rows.push(value);
      return rows.length >= limit;
    };

    if (query.envelopeId && !query.kind) {
      const index = store.index('by_identity');
      const req = index.openCursor(IDBKeyRange.only(query.envelopeId), 'prev');
      req.onerror = onError;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          // identity index is not time-ordered — sort page newest-first
          rows.sort((a, b) => b.timestamp - a.timestamp);
          resolve(rows.slice(0, limit));
          return;
        }
        const value = cursor.value as PlayEventRecord;
        if (
          query.beforeTimestamp != null &&
          value.timestamp >= query.beforeTimestamp
        ) {
          cursor.continue();
          return;
        }
        if (
          query.sinceTimestamp != null &&
          value.timestamp < query.sinceTimestamp
        ) {
          cursor.continue();
          return;
        }
        rows.push(value);
        if (rows.length >= limit) {
          rows.sort((a, b) => b.timestamp - a.timestamp);
          resolve(rows.slice(0, limit));
          return;
        }
        cursor.continue();
      };
      return;
    }

    if (query.kind && !query.envelopeId) {
      const index = store.index('by_kind');
      const req = index.openCursor(IDBKeyRange.only(query.kind));
      req.onerror = onError;
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor) {
          rows.sort((a, b) => b.timestamp - a.timestamp);
          resolve(rows.slice(0, limit));
          return;
        }
        const value = cursor.value as PlayEventRecord;
        if (
          query.beforeTimestamp != null &&
          value.timestamp >= query.beforeTimestamp
        ) {
          cursor.continue();
          return;
        }
        if (
          query.sinceTimestamp != null &&
          value.timestamp < query.sinceTimestamp
        ) {
          cursor.continue();
          return;
        }
        rows.push(value);
        cursor.continue();
      };
      return;
    }

    const index = store.index('by_time');
    let range: IDBKeyRange | null = null;
    if (query.beforeTimestamp != null && query.sinceTimestamp != null) {
      range = IDBKeyRange.bound(
        query.sinceTimestamp,
        query.beforeTimestamp,
        false,
        true,
      );
    } else if (query.beforeTimestamp != null) {
      range = IDBKeyRange.upperBound(query.beforeTimestamp, true);
    } else if (query.sinceTimestamp != null) {
      range = IDBKeyRange.lowerBound(query.sinceTimestamp, false);
    }

    const req = index.openCursor(range, 'prev');
    req.onerror = onError;
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(rows);
        return;
      }
      const value = cursor.value as PlayEventRecord;
      if (query.envelopeId && value.envelopeId !== query.envelopeId) {
        cursor.continue();
        return;
      }
      if (query.kind && value.kind !== query.kind) {
        cursor.continue();
        return;
      }
      rows.push(value);
      if (rows.length >= limit) {
        resolve(rows);
        return;
      }
      cursor.continue();
    };
  });
}

/**
 * Walk the store newest-first via bounded pages. Collects into `out` without getAll().
 * Prefer this for tests / one-shot exports — not for hot paths that must stay O(page).
 */
export async function collectPlayEventsPaged(
  options: {
    pageSize?: number;
    maxRows?: number;
    sinceTimestamp?: number;
    envelopeId?: string;
    kind?: PlayEventKind;
    onPage?: (page: PlayEventRecord[]) => void;
  } = {},
): Promise<PlayEventRecord[]> {
  const pageSize = options.pageSize ?? PLAY_EVENTS_PAGE_SIZE;
  const maxRows = options.maxRows ?? Number.POSITIVE_INFINITY;
  const out: PlayEventRecord[] = [];
  let beforeTimestamp: number | undefined;
  for (;;) {
    if (out.length >= maxRows) break;
    const page = await queryPlayEventsPage({
      limit: Math.min(pageSize, maxRows - out.length),
      beforeTimestamp,
      sinceTimestamp: options.sinceTimestamp,
      envelopeId: options.envelopeId,
      kind: options.kind,
    });
    if (page.length === 0) break;
    options.onPage?.(page);
    out.push(...page);
    const oldest = page[page.length - 1];
    if (!oldest) break;
    beforeTimestamp = oldest.timestamp;
    if (page.length < pageSize) break;
    // Identical timestamps: advance by continuing past the last id via exclusive upper bound
    // on timestamp alone can loop — nudge by 0 and rely on limit; break if no progress.
    if (
      out.length >= pageSize &&
      page.every((r) => r.timestamp === beforeTimestamp) &&
      page.length === pageSize
    ) {
      // Dense same-timestamp page: step key down by epsilon via beforeTimestamp unchanged
      // would infinite-loop. Fall through with id-aware skip.
      const skipIds = new Set(page.map((r) => r.id));
      const more = await queryPlayEventsPage({
        limit: pageSize,
        beforeTimestamp: beforeTimestamp + 1,
        sinceTimestamp: options.sinceTimestamp,
        envelopeId: options.envelopeId,
        kind: options.kind,
      });
      const fresh = more.filter((r) => !skipIds.has(r.id) && r.timestamp <= beforeTimestamp!);
      if (fresh.length === 0) break;
      out.push(...fresh);
      beforeTimestamp = fresh[fresh.length - 1]!.timestamp;
    }
  }
  return out;
}

function parseLegacyEventsRaw(raw: string): LegacyPlayEventV2[] {
  try {
    const parsed = JSON.parse(raw) as LegacyPlayEventV2[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Map legacy rows in chunks (phase 2) — avoids holding a second giant mapped array
 * when the caller streams into the writer.
 */
export function mapLegacyEventsInChunks(
  legacy: LegacyPlayEventV2[],
  chunkSize = PLAY_EVENTS_MAP_CHUNK,
): PlayEventRecord[] {
  const out: PlayEventRecord[] = [];
  for (let i = 0; i < legacy.length; i += chunkSize) {
    const slice = legacy.slice(i, i + chunkSize);
    for (let j = 0; j < slice.length; j++) {
      const mapped = mapV2ToV3(slice[j]!, i + j);
      if (mapped) out.push(mapped);
    }
  }
  return out;
}

/** Phase 3 — one readwrite txn, add() each; ConstraintError swallowed. */
export async function writePlayEventRecordsInOneTxn(
  records: PlayEventRecord[],
): Promise<{ written: number; duplicates: number; quotaExceeded: boolean }> {
  if (records.length === 0) {
    return { written: 0, duplicates: 0, quotaExceeded: false };
  }
  const db = await openPlayEventsDb();
  return new Promise((resolve) => {
    const tx = db.transaction(PLAY_EVENTS_STORE, 'readwrite');
    const store = tx.objectStore(PLAY_EVENTS_STORE);
    let written = 0;
    let duplicates = 0;
    let quotaExceeded = false;
    let idx = 0;

    const pump = () => {
      while (idx < records.length) {
        const record = records[idx++]!;
        const req = store.add(record);
        req.onsuccess = () => {
          written += 1;
        };
        req.onerror = (event) => {
          if (isConstraintError(req.error)) {
            duplicates += 1;
            event.preventDefault();
            (event as Event & { stopPropagation?: () => void }).stopPropagation?.();
            return;
          }
          if (isQuotaExceeded(req.error)) {
            quotaExceeded = true;
          }
        };
      }
    };

    try {
      pump();
    } catch (err) {
      if (isQuotaExceeded(err)) {
        resolve({ written, duplicates, quotaExceeded: true });
        return;
      }
      resolve({ written, duplicates, quotaExceeded: false });
      return;
    }

    tx.oncomplete = () => {
      resolve({ written, duplicates, quotaExceeded: false });
    };
    tx.onabort = () => {
      resolve({
        written,
        duplicates,
        quotaExceeded: quotaExceeded || isQuotaExceeded(tx.error),
      });
    };
    tx.onerror = () => {
      resolve({
        written,
        duplicates,
        quotaExceeded: quotaExceeded || isQuotaExceeded(tx.error),
      });
    };
  });
}

function maybeCleanupBak(state: PlayEventsMigrateState): void {
  if (state.status !== 'done' || !state.bakAt) return;
  if (Date.now() - state.bakAt < PLAY_EVENTS_BAK_TTL_MS) return;
  prefsRemoveItem(PLAY_EVENTS_BAK_KEY);
  writeMigrateState({ ...state, bakAt: undefined });
}

/**
 * Five-phase migration from prefs PLAY_EVENTS_KEY → IndexedDB.
 * Atomic intent: never delete legacy until phase 4 verifies; resilient to mid-run kill.
 */
export async function migratePlayEventsToIdb(): Promise<PlayEventsMigrateState> {
  if (migratePromise) return migratePromise;
  const run = (async (): Promise<PlayEventsMigrateState> => {
    let state = readMigrateState();
    if (state.status === 'done') {
      useIdb = true;
      maybeCleanupBak(state);
      return state;
    }

    state = { ...state, status: 'running', phase: 1, error: undefined };
    writeMigrateState(state);

    // —— Phase 1: Init ——
    try {
      await openPlayEventsDb();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'phase1 open failed (versionchange blocked?)';
      state = { phase: 1, status: 'aborted', error: message };
      writeMigrateState(state);
      useIdb = false;
      return state;
    }

    // —— Phase 2: Read + map (chunked) ——
    state = { ...state, phase: 2 };
    writeMigrateState(state);

    const legacyRaw = prefsGetItem(PLAY_EVENTS_LEGACY_KEY);
    const legacy = legacyRaw ? parseLegacyEventsRaw(legacyRaw) : [];
    const mapped = mapLegacyEventsInChunks(legacy);
    const legacyCount = mapped.length;

    // Fresh install / empty legacy — still commit IDB path.
    if (legacyCount === 0) {
      const existing = await countPlayEvents();
      if (existing > 0) {
        // Interrupted prior run left rows but no legacy — treat as ready.
        state = {
          phase: 5,
          status: 'done',
          legacyCount: 0,
          writtenCount: existing,
          completedAt: Date.now(),
        };
        writeMigrateState(state);
        useIdb = true;
        return state;
      }
      state = {
        phase: 5,
        status: 'done',
        legacyCount: 0,
        writtenCount: 0,
        completedAt: Date.now(),
      };
      writeMigrateState(state);
      useIdb = true;
      return state;
    }

    // —— Phase 3: Write (one txn; idempotent via unique dedupe_key) ——
    state = { ...state, phase: 3, legacyCount };
    writeMigrateState(state);

    const writeResult = await writePlayEventRecordsInOneTxn(mapped);
    if (writeResult.quotaExceeded) {
      console.warn(
        '[Sandbox] play events migration aborted: QuotaExceededError — keeping legacy prefs path',
      );
      try {
        await clearPlayEventsStore();
      } catch {
        /* ignore */
      }
      state = {
        phase: 3,
        status: 'aborted',
        legacyCount,
        error: 'QuotaExceededError',
      };
      writeMigrateState(state);
      useIdb = false;
      return state;
    }

    // —— Phase 4: Verify count ——
    state = { ...state, phase: 4, writtenCount: writeResult.written };
    writeMigrateState(state);

    const count = await countPlayEvents();
    // Unique dedupe keys may collapse exact duplicates in legacy blob.
    const uniqueKeys = new Set(mapped.map((r) => r.dedupe_key));
    if (count !== uniqueKeys.size) {
      console.warn(
        `[Sandbox] play events migration verify failed: count=${count} expected=${uniqueKeys.size} — clearing store, keeping legacy`,
      );
      try {
        await clearPlayEventsStore();
      } catch {
        /* ignore */
      }
      state = {
        phase: 4,
        status: 'aborted',
        legacyCount,
        writtenCount: writeResult.written,
        error: `verify mismatch count=${count} expected=${uniqueKeys.size}`,
      };
      writeMigrateState(state);
      useIdb = false;
      return state;
    }

    // —— Phase 5: Commit ——
    state = { ...state, phase: 5 };
    writeMigrateState(state);

    // Catch events written to legacy while phases 2–4 ran (sync recordPlayEvent race).
    const lateRaw = prefsGetItem(PLAY_EVENTS_LEGACY_KEY);
    if (lateRaw) {
      const lateMapped = mapLegacyEventsInChunks(parseLegacyEventsRaw(lateRaw));
      const lateWrite = await writePlayEventRecordsInOneTxn(lateMapped);
      if (lateWrite.quotaExceeded) {
        console.warn(
          '[Sandbox] play events migration aborted at commit: QuotaExceededError on late catch-up',
        );
        state = {
          phase: 5,
          status: 'aborted',
          legacyCount,
          error: 'QuotaExceededError late catch-up',
        };
        writeMigrateState(state);
        useIdb = false;
        return state;
      }
      const lateCount = await countPlayEvents();
      const lateUnique = new Set(lateMapped.map((r) => r.dedupe_key));
      if (lateCount < lateUnique.size) {
        console.warn(
          `[Sandbox] play events late catch-up verify failed: count=${lateCount} expected>=${lateUnique.size}`,
        );
        try {
          await clearPlayEventsStore();
        } catch {
          /* ignore */
        }
        state = {
          phase: 5,
          status: 'aborted',
          legacyCount,
          error: `late verify mismatch count=${lateCount} expected=${lateUnique.size}`,
        };
        writeMigrateState(state);
        useIdb = false;
        return state;
      }
    }

    const bakRaw = prefsGetItem(PLAY_EVENTS_LEGACY_KEY);
    if (bakRaw != null) {
      prefsSetItem(PLAY_EVENTS_BAK_KEY, bakRaw);
      prefsRemoveItem(PLAY_EVENTS_LEGACY_KEY);
    }
    const finalCount = await countPlayEvents();
    state = {
      phase: 5,
      status: 'done',
      legacyCount,
      writtenCount: finalCount,
      completedAt: Date.now(),
      bakAt: Date.now(),
    };
    writeMigrateState(state);
    useIdb = true;
    return state;
  })();

  migratePromise = run.then((state) => {
    // Allow retry after abort; keep shared promise only when committed.
    if (state.status !== 'done') migratePromise = null;
    return state;
  });
  return migratePromise;
}

/** Ensure migration has run; activates IDB when successful. */
export async function ensurePlayEventsIdb(): Promise<boolean> {
  const state = await migratePlayEventsToIdb();
  return state.status === 'done';
}

/**
 * Whether a session already contains this envelope — bounded identity cursor, not full scan.
 */
export async function hasEnvelopeInSession(
  sessionId: string,
  envelopeId: string,
): Promise<boolean> {
  const db = await openPlayEventsDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PLAY_EVENTS_STORE, 'readonly');
    const index = tx.objectStore(PLAY_EVENTS_STORE).index('by_identity');
    const req = index.openCursor(IDBKeyRange.only(envelopeId));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(false);
        return;
      }
      const row = cursor.value as PlayEventRecord;
      if (row.sessionId === sessionId) {
        resolve(true);
        return;
      }
      cursor.continue();
    };
  });
}
