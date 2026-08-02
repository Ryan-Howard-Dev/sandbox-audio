import { describe, expect, it } from 'vitest';
import {
  ABANDONED_AFTER_DAYS,
  buildSeriesProgress,
  groupSeriesByStatus,
  resolveStatus,
  resumableSeries,
  seriesKeyOf,
  STALLED_AFTER_DAYS,
  type SeriesCatalogEntry,
} from './seriesProgress';
import type { PlayEvent } from './playHistory';

const NOW = Date.UTC(2026, 7, 1);
const DAY = 86_400_000;
const daysAgo = (n: number) => NOW - n * DAY;

function play(overrides: Partial<PlayEvent> & { envelopeId: string }): PlayEvent {
  return {
    trackId: overrides.envelopeId,
    artist: 'In Our Time',
    album: 'Philosophy',
    title: 'An episode',
    durationMs: 600_000,
    listenedMs: 570_000,
    completedPct: 95,
    skipped: false,
    repeat: false,
    timestamp: daysAgo(1),
    sessionId: 's1',
    ...overrides,
  } as PlayEvent;
}

const show = (total: number): SeriesCatalogEntry => ({
  key: 'podcast:in our time',
  kind: 'podcast',
  title: 'In Our Time',
  totalItems: total,
});

describe('seriesKeyOf', () => {
  it('groups podcasts by show', () => {
    expect(seriesKeyOf(play({ envelopeId: 'podcast:1', artist: 'In Our Time' }))).toEqual({
      key: 'podcast:in our time',
      kind: 'podcast',
    });
  });

  it('groups audiobooks by book, not by author', () => {
    // Someone reading two Brontë novels is on two series, not one.
    const jane = seriesKeyOf(
      play({ envelopeId: 'audiobook:1', artist: 'Charlotte Brontë', album: 'Jane Eyre' }),
    );
    const villette = seriesKeyOf(
      play({ envelopeId: 'audiobook:2', artist: 'Charlotte Brontë', album: 'Villette' }),
    );
    expect(jane?.key).not.toBe(villette?.key);
  });

  it('ignores music, which is not a series', () => {
    expect(seriesKeyOf(play({ envelopeId: 'track:1' }))).toBeNull();
  });
});

describe('resolveStatus', () => {
  const base = { totalItems: 10, completedItems: 5, completionPct: 50, now: NOW };

  it('calls a completed series finished even after a long silence', () => {
    // The single most annoying thing this could do is tell someone they abandoned a book they
    // actually finished, so finished is checked before any idleness rule.
    expect(
      resolveStatus({ ...base, completedItems: 10, completionPct: 100, lastPlayedAt: daysAgo(400) }),
    ).toBe('finished');
  });

  it('calls a long silence at low progress abandoned', () => {
    expect(
      resolveStatus({
        ...base,
        completedItems: 1,
        completionPct: 10,
        lastPlayedAt: daysAgo(ABANDONED_AFTER_DAYS + 1),
      }),
    ).toBe('abandoned');
  });

  it('calls a long silence at high progress stalled, not abandoned', () => {
    expect(
      resolveStatus({ ...base, completionPct: 80, lastPlayedAt: daysAgo(ABANDONED_AFTER_DAYS + 1) }),
    ).toBe('stalled');
  });

  it('calls a medium silence stalled whatever the progress', () => {
    expect(resolveStatus({ ...base, lastPlayedAt: daysAgo(STALLED_AFTER_DAYS + 1) })).toBe(
      'stalled',
    );
  });

  it('does not call one outstanding episode behind', () => {
    // A weekly show drops an episode and everyone is briefly one behind, which is not worth saying.
    expect(
      resolveStatus({ ...base, totalItems: 10, completedItems: 9, lastPlayedAt: daysAgo(1) }),
    ).toBe('up-to-date');
  });

  it('calls two or more outstanding behind', () => {
    expect(
      resolveStatus({ ...base, totalItems: 10, completedItems: 8, lastPlayedAt: daysAgo(1) }),
    ).toBe('behind');
  });

  it('does not claim a series is finished when the total is unknown', () => {
    // A feed that failed to refresh reports zero, and that must not read as "all done".
    expect(
      resolveStatus({ ...base, totalItems: 0, completedItems: 5, lastPlayedAt: daysAgo(1) }),
    ).toBe('up-to-date');
  });
});

describe('buildSeriesProgress', () => {
  it('counts distinct items rather than plays', () => {
    const events = [
      play({ envelopeId: 'podcast:a' }),
      play({ envelopeId: 'podcast:a' }),
      play({ envelopeId: 'podcast:b' }),
    ];
    const [progress] = buildSeriesProgress(events, [show(10)], NOW);
    expect(progress.completedItems).toBe(2);
    expect(progress.startedItems).toBe(2);
  });

  it('does not count a skip as a start', () => {
    // Without this a single mis-tap marks a twelve-hour audiobook as begun, and it then sits on
    // the shelf reproaching you forever.
    const events = [play({ envelopeId: 'podcast:a', completedPct: 0, skipped: true })];
    expect(buildSeriesProgress(events, [show(10)], NOW)).toHaveLength(0);
  });

  it('counts a partial listen as started but not completed', () => {
    const events = [play({ envelopeId: 'podcast:a', completedPct: 30 })];
    const [progress] = buildSeriesProgress(events, [show(10)], NOW);
    expect(progress.startedItems).toBe(1);
    expect(progress.completedItems).toBe(0);
  });

  it('keeps a series whose catalogue entry has gone', () => {
    // An unsubscribed show, or a feed that stopped resolving, that someone was halfway through is
    // exactly the case worth surfacing rather than hiding.
    const [progress] = buildSeriesProgress([play({ envelopeId: 'podcast:a' })], [], NOW);
    expect(progress.title).toBe('In Our Time');
    expect(progress.totalItems).toBe(0);
  });

  it('reports how many are left untouched', () => {
    const events = [play({ envelopeId: 'podcast:a' }), play({ envelopeId: 'podcast:b' })];
    const [progress] = buildSeriesProgress(events, [show(12)], NOW);
    expect(progress.remaining).toBe(10);
    expect(progress.completionPct).toBeCloseTo(16.7, 1);
  });

  it('orders by what was listened to most recently', () => {
    const events = [
      play({ envelopeId: 'podcast:a', artist: 'Old Show', timestamp: daysAgo(40) }),
      play({ envelopeId: 'podcast:b', artist: 'New Show', timestamp: daysAgo(1) }),
    ];
    expect(buildSeriesProgress(events, [], NOW).map((p) => p.title)).toEqual([
      'New Show',
      'Old Show',
    ]);
  });

  it('separates podcasts from audiobooks', () => {
    const events = [
      play({ envelopeId: 'podcast:a', artist: 'In Our Time' }),
      play({ envelopeId: 'audiobook:x', artist: 'Charlotte Brontë', album: 'Jane Eyre' }),
    ];
    const progress = buildSeriesProgress(events, [], NOW);
    expect(progress).toHaveLength(2);
    expect(progress.map((p) => p.kind).sort()).toEqual(['audiobook', 'podcast']);
  });
});

describe('grouping and resuming', () => {
  const events = [
    play({ envelopeId: 'podcast:a', artist: 'Behind Show', timestamp: daysAgo(1) }),
    play({ envelopeId: 'podcast:b', artist: 'Done Show', timestamp: daysAgo(2) }),
    play({ envelopeId: 'podcast:c', artist: 'Gone Show', timestamp: daysAgo(200), completedPct: 5 }),
  ];
  const catalog: SeriesCatalogEntry[] = [
    { key: 'podcast:behind show', kind: 'podcast', title: 'Behind Show', totalItems: 20 },
    { key: 'podcast:done show', kind: 'podcast', title: 'Done Show', totalItems: 1 },
    { key: 'podcast:gone show', kind: 'podcast', title: 'Gone Show', totalItems: 50 },
  ];

  it('puts the actionable group first', () => {
    const groups = groupSeriesByStatus(buildSeriesProgress(events, catalog, NOW));
    expect(groups[0].status).toBe('behind');
    expect(groups.map((g) => g.status)).not.toContain('up-to-date');
  });

  it('offers what is worth resuming and leaves out what is finished', () => {
    const resumable = resumableSeries(buildSeriesProgress(events, catalog, NOW));
    const titles = resumable.map((s) => s.title);
    expect(titles).toContain('Behind Show');
    expect(titles).not.toContain('Done Show');
    expect(titles).not.toContain('Gone Show');
  });
});
