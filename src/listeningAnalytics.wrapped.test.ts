import { describe, expect, it } from 'vitest';
import {
  getAvailableWrappedYears,
  getWrappedSummary,
  WRAPPED_TIER_LABELS,
} from './listeningAnalytics';
import type { PlayEvent } from './playHistory';

/**
 * A play, complete enough to count.
 *
 * completedPct is well past the meaningful threshold on purpose: an event that reads as a skip
 * would be excluded from the rankings and every assertion here would pass for the wrong reason.
 */
function play(overrides: Partial<PlayEvent> & { envelopeId: string }): PlayEvent {
  return {
    trackId: overrides.envelopeId,
    artist: 'Someone',
    album: 'Something',
    title: 'A thing',
    durationMs: 600_000,
    listenedMs: 570_000,
    completedPct: 95,
    skipped: false,
    repeat: false,
    timestamp: Date.UTC(2026, 5, 1),
    sessionId: 's1',
    ...overrides,
  } as PlayEvent;
}

/** A year with all three formats in it, which is the case the old summary got wrong. */
const MIXED: PlayEvent[] = [
  play({ envelopeId: 'track:1', artist: 'Nick Cave', album: 'Ghosteen', title: 'Bright Horses' }),
  play({ envelopeId: 'track:2', artist: 'Nick Cave', album: 'Ghosteen', title: 'Waiting for You' }),
  play({
    envelopeId: 'podcast:ep-1',
    artist: 'In Our Time',
    album: 'Philosophy',
    title: 'The Stoics',
  }),
  play({
    envelopeId: 'podcast:ep-2',
    artist: 'In Our Time',
    album: 'Philosophy',
    title: 'Epicureanism',
  }),
  play({
    envelopeId: 'podcast:ep-3',
    artist: 'In Our Time',
    album: 'History',
    title: 'The Antonine Wall',
  }),
  play({
    envelopeId: 'audiobook:book-1',
    artist: 'Charlotte Brontë',
    album: 'Jane Eyre',
    title: 'Chapter One',
  }),
];

describe('getWrappedSummary, by format', () => {
  it('pools every format when no kind is given', () => {
    const summary = getWrappedSummary(2026, 'all', MIXED);
    expect(summary.kind).toBe('all');
    expect(summary.totalPlays).toBe(6);
  });

  it('gives the music year its own top artist, not whoever talked the most', () => {
    // The old summary ranked across every format at once, so on a mixed library the top "artist"
    // was routinely a podcast host and the music year vanished behind it.
    const summary = getWrappedSummary(2026, 'music', MIXED);
    expect(summary.kind).toBe('music');
    expect(summary.totalPlays).toBe(2);
    expect(summary.topPrimary?.label).toBe('Nick Cave');
    expect(summary.topSecondary?.label).toBe('Ghosteen');
  });

  it('gives podcasts a top show and series of their own', () => {
    const summary = getWrappedSummary(2026, 'podcast', MIXED);
    expect(summary.totalPlays).toBe(3);
    expect(summary.topPrimary?.label).toBe('In Our Time');
    expect(summary.topSecondary?.label).toBe('Philosophy');
  });

  it('gives audiobooks a top author and book', () => {
    const summary = getWrappedSummary(2026, 'audiobook', MIXED);
    expect(summary.totalPlays).toBe(1);
    expect(summary.topPrimary?.label).toBe('Charlotte Brontë');
    expect(summary.topSecondary?.label).toBe('Jane Eyre');
  });

  it('reports an empty year rather than borrowing another format\'s', () => {
    const musicOnly = [MIXED[0]];
    const summary = getWrappedSummary(2026, 'podcast', musicOnly);
    expect(summary.totalPlays).toBe(0);
    expect(summary.topPrimary).toBeNull();
  });

  it('keeps years apart', () => {
    const lastYear = [play({ envelopeId: 'track:9', timestamp: Date.UTC(2025, 5, 1) })];
    expect(getWrappedSummary(2026, 'music', lastYear).totalPlays).toBe(0);
    expect(getWrappedSummary(2025, 'music', lastYear).totalPlays).toBe(1);
  });
});

describe('getAvailableWrappedYears', () => {
  it('offers only years that format was actually played in', () => {
    // Otherwise the podcasts tab offers a year whose card then renders empty.
    const events = [
      play({ envelopeId: 'track:1', timestamp: Date.UTC(2024, 1, 1) }),
      play({ envelopeId: 'podcast:e', timestamp: Date.UTC(2026, 1, 1) }),
    ];
    expect(getAvailableWrappedYears('podcast', events)).not.toContain(2024);
    expect(getAvailableWrappedYears('music', events)).toContain(2024);
  });

  it('always offers the current year, so a fresh install has something to show', () => {
    const now = new Date().getFullYear();
    expect(getAvailableWrappedYears('music', [])).toContain(now);
  });
});

describe('WRAPPED_TIER_LABELS', () => {
  it('names the tiers for what each format actually holds', () => {
    expect(WRAPPED_TIER_LABELS.music[0]).toBe('Top artist');
    expect(WRAPPED_TIER_LABELS.podcast[0]).toBe('Top show');
    expect(WRAPPED_TIER_LABELS.audiobook[0]).toBe('Top author');
  });

  it('covers every kind the summary can report, so the card cannot be unlabelled', () => {
    for (const kind of ['all', 'music', 'podcast', 'audiobook'] as const) {
      expect(WRAPPED_TIER_LABELS[kind]).toHaveLength(3);
    }
  });
});
