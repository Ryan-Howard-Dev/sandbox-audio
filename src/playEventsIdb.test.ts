import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefsGetItem, prefsSetItem, prefsRemoveItem } from './prefsStorage';
import {
  PLAY_EVENTS_PAGE_SIZE,
  PLAY_EVENTS_BAK_KEY,
  PLAY_EVENTS_LEGACY_KEY,
  PLAY_EVENTS_MIGRATE_KEY,
  appendPlayEventRecord,
  collectPlayEventsPaged,
  countPlayEvents,
  migratePlayEventsToIdb,
  queryPlayEventsPage,
  resetPlayEventsIdbForTests,
  writePlayEventRecordsInOneTxn,
  type PlayEventRecord,
} from './playEventsIdb';
import {
  ANALYTICS_SCHEMA_VERSION,
  getAllPlayEvents,
  getPlayEventsPage,
  readyPlayHistoryIdb,
  resetPlayHistoryRuntimeForTests,
} from './playHistory';
import { installFakeIndexedDB, resetFakeIndexedDB } from './test/fakeIndexedDB';

function legacyEvent(
  i: number,
  overrides: Partial<{
    envelopeId: string;
    timestamp: number;
    sessionId: string;
    listenedMs: number;
    source: string;
  }> = {},
) {
  const timestamp = overrides.timestamp ?? 1_700_000_000_000 + i * 1000;
  const envelopeId = overrides.envelopeId ?? `track-${i}`;
  return {
    trackId: envelopeId,
    envelopeId,
    artist: `Artist ${i}`,
    title: `Title ${i}`,
    album: `Album ${i}`,
    durationMs: 180_000,
    listenedMs: overrides.listenedMs ?? 60_000,
    completedPct: 33.3,
    skipped: false,
    repeat: false,
    timestamp,
    sessionId: overrides.sessionId ?? `sess-${Math.floor(i / 10)}`,
    source: overrides.source ?? 'online',
  };
}

function makeRecord(i: number, overrides: Partial<PlayEventRecord> = {}): PlayEventRecord {
  const timestamp = overrides.timestamp ?? 1_700_000_000_000 + i * 1000;
  const envelopeId = overrides.envelopeId ?? `env-${i}`;
  const sessionId = overrides.sessionId ?? 'sess-1';
  const listenedMs = overrides.listenedMs ?? 60_000;
  const dedupe_key =
    overrides.dedupe_key ?? `${timestamp}|${envelopeId}|${sessionId}|${listenedMs}`;
  return {
    id: overrides.id ?? `pe-test-${i}`,
    trackId: envelopeId,
    envelopeId,
    artist: 'A',
    title: 'T',
    durationMs: 180_000,
    listenedMs,
    completedPct: 33,
    skipped: false,
    repeat: false,
    timestamp,
    sessionId,
    source: 'tier34',
    dedupe_key,
    origin: 'auto',
    tz_offset_minutes: 420,
    kind: 'music',
    ...overrides,
  };
}

describe('play events IndexedDB migration', () => {
  beforeEach(() => {
    resetFakeIndexedDB();
    installFakeIndexedDB();
    resetPlayEventsIdbForTests();
    resetPlayHistoryRuntimeForTests();
    prefsRemoveItem(PLAY_EVENTS_LEGACY_KEY);
    prefsRemoveItem(PLAY_EVENTS_BAK_KEY);
    prefsRemoveItem(PLAY_EVENTS_MIGRATE_KEY);
    prefsRemoveItem('sandbox_analytics_schema');
    vi.stubGlobal('window', {
      dispatchEvent: vi.fn(),
    });
  });

  it('1. fresh install with no legacy data activates empty IDB path', async () => {
    const state = await migratePlayEventsToIdb();
    expect(state.status).toBe('done');
    expect(state.legacyCount).toBe(0);
    expect(await countPlayEvents()).toBe(0);
    expect(prefsGetItem(PLAY_EVENTS_LEGACY_KEY)).toBeNull();

    const ok = await readyPlayHistoryIdb();
    expect(ok).toBe(true);
    expect(getAllPlayEvents()).toEqual([]);
    expect(ANALYTICS_SCHEMA_VERSION).toBe(3);
  });

  it('2. migrates a populated legacy prefs blob into IDB', async () => {
    const legacy = Array.from({ length: 25 }, (_, i) => legacyEvent(i));
    prefsSetItem(PLAY_EVENTS_LEGACY_KEY, JSON.stringify(legacy));

    const state = await migratePlayEventsToIdb();
    expect(state.status).toBe('done');
    expect(state.legacyCount).toBe(25);
    expect(await countPlayEvents()).toBe(25);

    // Phase 5: legacy renamed to BAK, live key gone
    expect(prefsGetItem(PLAY_EVENTS_LEGACY_KEY)).toBeNull();
    expect(prefsGetItem(PLAY_EVENTS_BAK_KEY)).toBeTruthy();

    await readyPlayHistoryIdb();
    const events = getAllPlayEvents();
    expect(events).toHaveLength(25);
    expect(events.every((e) => typeof e.tz_offset_minutes === 'number')).toBe(true);
    expect(events.every((e) => e.dedupe_key)).toBe(true);
    expect(events.every((e) => e.origin === 'imported')).toBe(true);
    // download/online mapped
    expect(events.every((e) => e.source === 'tier34' || e.source === 'locker')).toBe(true);
  });

  it('3. interrupted between phases 3 and 5 re-runs idempotently without duplicates', async () => {
    const legacy = Array.from({ length: 12 }, (_, i) => legacyEvent(i));
    prefsSetItem(PLAY_EVENTS_LEGACY_KEY, JSON.stringify(legacy));

    // Simulate: phase 1–3 completed (rows in IDB), kill before phase 5 commit
    const first = await migratePlayEventsToIdb();
    expect(first.status).toBe('done');
    // Manually rewind to "interrupted after write": restore legacy, clear done flag, keep IDB rows
    const bak = prefsGetItem(PLAY_EVENTS_BAK_KEY);
    expect(bak).toBeTruthy();
    prefsSetItem(PLAY_EVENTS_LEGACY_KEY, bak!);
    prefsRemoveItem(PLAY_EVENTS_BAK_KEY);
    prefsSetItem(
      PLAY_EVENTS_MIGRATE_KEY,
      JSON.stringify({ phase: 3, status: 'running', legacyCount: 12 }),
    );

    resetPlayEventsIdbForTests();
    resetPlayHistoryRuntimeForTests();
    // Do NOT resetFakeIndexedDB — store still holds the 12 rows

    const second = await migratePlayEventsToIdb();
    expect(second.status).toBe('done');
    expect(await countPlayEvents()).toBe(12);

    const pages = await collectPlayEventsPaged({ pageSize: 5 });
    const keys = pages.map((r) => r.dedupe_key);
    expect(new Set(keys).size).toBe(12);
  });

  it('4. dedupe_key collision is swallowed and the batch continues', async () => {
    await migratePlayEventsToIdb();
    const a = makeRecord(1, { dedupe_key: 'same-key', id: 'id-a' });
    const b = makeRecord(2, { dedupe_key: 'same-key', id: 'id-b', timestamp: a.timestamp + 1 });
    const c = makeRecord(3, { dedupe_key: 'other-key', id: 'id-c', timestamp: a.timestamp + 2 });

    const result = await writePlayEventRecordsInOneTxn([a, b, c]);
    expect(result.quotaExceeded).toBe(false);
    expect(result.duplicates).toBe(1);
    expect(result.written).toBe(2);
    expect(await countPlayEvents()).toBe(2);

    // append path also swallows
    const again = await appendPlayEventRecord({
      ...a,
      id: 'id-a-retry',
      dedupe_key: 'same-key',
    });
    expect(again.ok).toBe(true);
    expect(again.duplicate).toBe(true);
    expect(await countPlayEvents()).toBe(2);
  });

  it('5. paged reads are correct when the store is larger than one page', async () => {
    await migratePlayEventsToIdb();
    const total = PLAY_EVENTS_PAGE_SIZE + 80;
    const records = Array.from({ length: total }, (_, i) => makeRecord(i));
    const write = await writePlayEventRecordsInOneTxn(records);
    expect(write.written).toBe(total);
    expect(await countPlayEvents()).toBe(total);

    const pageSize = 50;
    const page1 = await queryPlayEventsPage({ limit: pageSize });
    expect(page1).toHaveLength(pageSize);
    // Newest first
    expect(page1[0]!.timestamp).toBeGreaterThan(page1[page1.length - 1]!.timestamp);

    const page2 = await queryPlayEventsPage({
      limit: pageSize,
      beforeTimestamp: page1[page1.length - 1]!.timestamp,
    });
    expect(page2.length).toBeGreaterThan(0);
    expect(page2[0]!.timestamp).toBeLessThan(page1[page1.length - 1]!.timestamp);

    const ids = new Set([...page1, ...page2].map((r) => r.id));
    expect(ids.size).toBe(page1.length + page2.length);

    // Full paged collect recovers everyone
    const all = await collectPlayEventsPaged({ pageSize: 75 });
    expect(all).toHaveLength(total);

    await readyPlayHistoryIdb();
    const viaApi = await getPlayEventsPage({ limit: 40 });
    expect(viaApi).toHaveLength(40);
  });
});
