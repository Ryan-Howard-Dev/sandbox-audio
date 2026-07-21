import { describe, expect, it } from 'vitest';
import {
  dedupeLockerEntriesForDisplay,
  enrichLockerEntriesPlayability,
  filterPlayableLockerEntries,
  lockerRowHasHealSignals,
  type LockerEntry,
} from './lockerStorage';

const entry = (
  id: string,
  opts: { offlineReady?: boolean; title?: string; artist?: string; addedAt?: number } = {},
): LockerEntry => ({
  id,
  title: opts.title ?? `Track ${id}`,
  artist: opts.artist ?? 'Artist',
  genre: '',
  durationSeconds: 180,
  url: opts.offlineReady ? 'content://locker/x' : '',
  addedAt: opts.addedAt ?? 1,
  offlineReady: opts.offlineReady,
});

describe('enrichLockerEntriesPlayability fast mode', () => {
  it('marks rows playable from blob-store keys without native probes', async () => {
    const rows = [
      entry('idb-track', { offlineReady: false }),
      entry('hollow', { offlineReady: false }),
    ];
    const rowHints = new Map([
      ['idb-track', { hasAudioBlob: true }],
      ['hollow', {}],
    ]);
    const enriched = await enrichLockerEntriesPlayability(rows, {
      mode: 'fast',
      rowHints,
    });
    expect(enriched.find((r) => r.id === 'idb-track')?.offlineReady).toBe(true);
    expect(enriched.find((r) => r.id === 'hollow')?.offlineReady).toBe(false);
  });
});

describe('filterPlayableLockerEntries', () => {
  it('keeps only offlineReady rows', () => {
    const rows = [
      entry('playable', { offlineReady: true }),
      entry('hollow', { offlineReady: false }),
      entry('unknown', {}),
    ];
    expect(filterPlayableLockerEntries(rows).map((r) => r.id)).toEqual(['playable']);
  });
});

describe('lockerRowHasHealSignals', () => {
  it('detects blob store keys and native heal flags', () => {
    expect(lockerRowHasHealSignals({ id: 'a' }, new Set(['a']))).toBe(true);
    expect(lockerRowHasHealSignals({ id: 'b', hasAudioBlob: true })).toBe(true);
    expect(lockerRowHasHealSignals({ id: 'c', nativeAudioCached: true })).toBe(true);
    expect(lockerRowHasHealSignals({ id: 'd', nativeSourcePath: '/tmp/x.flac' })).toBe(true);
    expect(lockerRowHasHealSignals({ id: 'e', title: 'Ghost' })).toBe(false);
  });
});

describe('dedupeLockerEntriesForDisplay', () => {
  it('keeps hollow rows visible when no playable copy exists', () => {
    const hollow = entry('hollow', {
      offlineReady: false,
      title: 'Creep',
      artist: 'Radiohead',
    });
    expect(dedupeLockerEntriesForDisplay([hollow])).toEqual([hollow]);
  });

  it('prefers newest playable duplicate', () => {
    const older = entry('old', {
      offlineReady: true,
      title: 'King',
      artist: 'Kanye West',
      addedAt: 1,
    });
    const newer = entry('new', {
      offlineReady: true,
      title: 'King',
      artist: 'Kanye West',
      addedAt: 99,
    });
    const out = dedupeLockerEntriesForDisplay([older, newer]);
    expect(out).toHaveLength(1);
    expect(out[0]?.id).toBe('new');
  });
});
