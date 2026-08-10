/**
 * The server must carry what it does not understand.
 *
 * mergeManifest rebuilds the manifest as a fresh object literal, so any field missing from that
 * literal is dropped and then written back over the master copy. The physical collection and the
 * album sync flags were both missing, which meant switching from file export to the Sandbox Server
 * quietly emptied the collection on the first push — no error, no warning, the field simply gone.
 *
 * These tests pin the carrying behaviour rather than the merge rule itself; the rule is the
 * clients' own, tested in physicalCollectionSync.test.ts, and imported here rather than copied.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PhysicalCopy } from '../../src/physicalCollection.ts';

/*
 * A real temp directory rather than a mocked fs. The module under test reads and writes through
 * the default fs export, and a partial mock of that is fiddly enough to pass while testing the
 * mock instead of the merge. Only the paths are redirected.
 */
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-locker-'));

vi.mock('./lockerPaths.js', () => ({
  LOCKER_BLOBS_DIR: path.join(root, 'blobs'),
  LOCKER_STORAGE_ROOT: root,
  blobPathForHash: (hash: string) => path.join(root, 'blobs', hash),
}));
vi.mock('./mediaGraph.js', () => ({ syncManifestEntry: () => {}, upsertHash: () => {} }));
vi.mock('./meilisearchIndexer.js', () => ({ scheduleReindex: () => {} }));

/*
 * Recent timestamps, because tombstones expire.
 *
 * pruneCopyTombstones drops anything older than the 180 day retention, so a fixture dated near the
 * epoch is silently discarded before the merge ever sees it and the deletion appears not to work.
 */
const NOW = Date.now();

const copy = (over: Partial<PhysicalCopy> = {}): PhysicalCopy => ({
  id: 'copy-1',
  title: 'OK Computer',
  artist: 'Radiohead',
  format: 'cd',
  addedAt: NOW - 10_000,
  updatedAt: NOW - 10_000,
  ...over,
});

const manifest = (over: Record<string, unknown> = {}) => ({
  deviceId: 'phone',
  updatedAt: NOW,
  entries: [],
  ...over,
});

let mergeManifest: typeof import('./lockerStorage.ts').mergeManifest;

beforeEach(async () => {
  fs.rmSync(path.join(root, 'manifest.json'), { force: true });
  vi.resetModules();
  ({ mergeManifest } = await import('./lockerStorage.js'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
});

describe('mergeManifest carries the physical collection', () => {
  it('keeps a copy pushed from a device', () => {
    const merged = mergeManifest(manifest({ physicalCopies: [copy()] }));
    expect(merged.physicalCopies).toHaveLength(1);
    expect(merged.physicalCopies?.[0].title).toBe('OK Computer');
  });

  it('does not drop the stored collection when a device pushes without one', () => {
    mergeManifest(manifest({ physicalCopies: [copy()] }));
    // A second device that has never opened Collection sends the field absent, not empty. Treating
    // absent as "delete everything" is precisely the failure this guards.
    const merged = mergeManifest(manifest({ deviceId: 'desktop' }));
    expect(merged.physicalCopies).toHaveLength(1);
  });

  it('applies a tombstone from one device to the stored copy', () => {
    mergeManifest(manifest({ physicalCopies: [copy()] }));
    const merged = mergeManifest(
      manifest({
        deviceId: 'desktop',
        physicalCopyTombstones: [{ id: 'copy-1', deletedAt: NOW - 5_000 }],
      }),
    );
    expect(merged.physicalCopies).toHaveLength(0);
    expect(merged.physicalCopyTombstones).toEqual([{ id: 'copy-1', deletedAt: NOW - 5_000 }]);
  });

  it('keeps a deletion deleted when a stale device re-sends the copy', () => {
    mergeManifest(manifest({ physicalCopies: [copy()] }));
    mergeManifest(
      manifest({ deviceId: 'desktop', physicalCopyTombstones: [{ id: 'copy-1', deletedAt: NOW - 5_000 }] }),
    );
    // The phone has not synced since the deletion, so its next push still contains the copy.
    const merged = mergeManifest(manifest({ physicalCopies: [copy()] }));
    expect(merged.physicalCopies).toHaveLength(0);
  });

  it('lets an edit made after the deletion win, because that is a re-add', () => {
    mergeManifest(manifest({ physicalCopies: [copy()] }));
    mergeManifest(
      manifest({ deviceId: 'desktop', physicalCopyTombstones: [{ id: 'copy-1', deletedAt: NOW - 5_000 }] }),
    );
    const merged = mergeManifest(
      manifest({ physicalCopies: [copy({ updatedAt: NOW - 1_000, notes: 'bought again' })] }),
    );
    expect(merged.physicalCopies).toHaveLength(1);
    expect(merged.physicalCopies?.[0].notes).toBe('bought again');
  });
});

describe('mergeManifest carries the album sync flags', () => {
  it('unions flags across devices rather than letting the last push win', () => {
    mergeManifest(manifest({ syncAlbums: ['album-a'] }));
    const merged = mergeManifest(manifest({ deviceId: 'desktop', syncAlbums: ['album-b'] }));
    expect([...(merged.syncAlbums ?? [])].sort()).toEqual(['album-a', 'album-b']);
  });

  it('keeps stored flags when a device pushes none', () => {
    mergeManifest(manifest({ syncAlbums: ['album-a'] }));
    const merged = mergeManifest(manifest({ deviceId: 'desktop' }));
    expect(merged.syncAlbums).toEqual(['album-a']);
  });
});
