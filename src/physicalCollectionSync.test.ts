import { describe, expect, it } from 'vitest';
import type { PhysicalCopy } from './physicalCollection';
import {
  TOMBSTONE_RETENTION_MS,
  mergeCopyTombstones,
  mergePhysicalCollection,
  pruneCopyTombstones,
} from './physicalCollectionSync';

function copy(id: string, overrides: Partial<PhysicalCopy> = {}): PhysicalCopy {
  return {
    id,
    title: `Record ${id}`,
    artist: 'Pink Floyd',
    format: 'vinyl',
    addedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

describe('carrying the shelf between devices', () => {
  it('brings across records the other device has', () => {
    const { copies, stats } = mergePhysicalCollection([copy('a')], [copy('b')], []);
    expect(copies.map((c) => c.id).sort()).toEqual(['a', 'b']);
    expect(stats.added).toBe(1);
  });

  it('keeps the newer edit of a record both devices have', () => {
    const local = copy('a', { notes: 'local', updatedAt: 2_000 });
    const remote = copy('a', { notes: 'remote', updatedAt: 3_000 });
    const { copies, stats } = mergePhysicalCollection([local], [remote], []);
    expect(copies[0]!.notes).toBe('remote');
    expect(stats.updated).toBe(1);
  });

  it('keeps the local edit when it is the newer one', () => {
    const local = copy('a', { notes: 'local', updatedAt: 5_000 });
    const remote = copy('a', { notes: 'remote', updatedAt: 3_000 });
    const { copies, stats } = mergePhysicalCollection([local], [remote], []);
    expect(copies[0]!.notes).toBe('local');
    expect(stats.updated).toBe(0);
  });

  it('falls back to addedAt for rows written before sync existed', () => {
    /*
     * Without the fallback an older row compares as infinitely old and loses every merge, so a
     * collection catalogued before this feature would be silently overwritten by any other device.
     */
    const legacy = { ...copy('a', { notes: 'legacy' }), updatedAt: undefined, addedAt: 9_000 };
    const remote = copy('a', { notes: 'remote', updatedAt: 3_000 });
    const { copies } = mergePhysicalCollection([legacy], [remote], []);
    expect(copies[0]!.notes).toBe('legacy');
  });

  it('leaves an untouched shelf alone', () => {
    const { copies, stats } = mergePhysicalCollection([copy('a')], [], []);
    expect(copies).toHaveLength(1);
    expect(stats).toEqual({ added: 0, updated: 0, deleted: 0 });
  });
});

describe('deletions have to travel too', () => {
  /*
   * The failure this exists for: a merge is a union, a union never removes anything, and without
   * tombstones every record deleted on the phone comes back the next time the desktop syncs.
   */
  it('removes a record the other device deleted', () => {
    const { copies, stats } = mergePhysicalCollection(
      [copy('a'), copy('b')],
      [],
      [{ id: 'a', deletedAt: 5_000 }],
    );
    expect(copies.map((c) => c.id)).toEqual(['b']);
    expect(stats.deleted).toBe(1);
  });

  it('does not resurrect a deleted record that the other device still lists', () => {
    const { copies } = mergePhysicalCollection(
      [],
      [copy('a', { updatedAt: 1_000 })],
      [{ id: 'a', deletedAt: 5_000 }],
    );
    expect(copies).toEqual([]);
  });

  it('keeps a record re-added after it was deleted', () => {
    /*
     * Buying a record again is a thing people do. A tombstone that outranked every future edit
     * would make that id unusable for good.
     */
    const { copies } = mergePhysicalCollection(
      [copy('a', { updatedAt: 9_000, notes: 'bought again' })],
      [],
      [{ id: 'a', deletedAt: 5_000 }],
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]!.notes).toBe('bought again');
  });

  it('keeps the newest deletion when both devices deleted the same record', () => {
    const merged = mergeCopyTombstones(
      [{ id: 'a', deletedAt: 1_000 }],
      [{ id: 'a', deletedAt: 4_000 }],
    );
    expect(merged).toEqual([{ id: 'a', deletedAt: 4_000 }]);
  });

  it('never drops a tombstone the other side has forgotten', () => {
    const merged = mergeCopyTombstones([{ id: 'a', deletedAt: 1_000 }], []);
    expect(merged).toHaveLength(1);
  });
});

describe('not carrying deletions forever', () => {
  it('forgets tombstones old enough that every device has seen them', () => {
    const now = 1_000_000_000_000;
    const kept = { id: 'recent', deletedAt: now - 1_000 };
    const gone = { id: 'ancient', deletedAt: now - TOMBSTONE_RETENTION_MS - 1 };
    expect(pruneCopyTombstones([kept, gone], now)).toEqual([kept]);
  });
});
