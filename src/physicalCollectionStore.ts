/**
 * Where the shelf is kept.
 *
 * On the device, in prefs, and nowhere else. The whole reason anybody in r/selfhosted asks for this
 * rather than using Discogs is that a collection is a list of things you own, and handing that list
 * to a company is the part they object to. So this never syncs, never phones home, and the only
 * thing that ever leaves during a barcode lookup is the thirteen digits printed on the sleeve.
 *
 * A thin layer on purpose: every decision worth arguing with lives in physicalCollection.ts, which
 * is pure and testable. This just persists and notifies.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import type { PhysicalCopy } from './physicalCollection';
import {
  mergeCopyTombstones,
  pruneCopyTombstones,
  type PhysicalCopyTombstone,
} from './physicalCollectionSync';

const STORE_KEY = 'sandbox_physical_collection_v1';
/*
 * Deletions are recorded, not just applied. A merge is a union and a union never removes anything,
 * so without these a record removed on the phone comes straight back the next time the desktop
 * syncs — and a collection that resurrects what you threw out is worse than one that never syncs.
 */
const TOMBSTONE_KEY = 'sandbox_physical_collection_tombstones_v1';

type Listener = () => void;
const listeners = new Set<Listener>();
let cache: PhysicalCopy[] | null = null;

function read(): PhysicalCopy[] {
  if (cache) return cache;
  try {
    const raw = prefsGetItem(STORE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed) ? (parsed.filter(isCopy) as PhysicalCopy[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/**
 * Rows are validated on the way in, not trusted.
 *
 * This survives app upgrades and hand-edited prefs, and a malformed row would otherwise reach the
 * matcher and throw inside a render. A collection missing one bad row still draws; a collection
 * that crashes the page shows nothing at all.
 */
function isCopy(row: unknown): boolean {
  const c = row as Partial<PhysicalCopy> | null;
  return Boolean(c && typeof c.id === 'string' && c.id && typeof c.title === 'string' && c.title);
}

function write(next: PhysicalCopy[]): void {
  cache = next;
  try {
    prefsSetItem(STORE_KEY, JSON.stringify(next));
  } catch {
    /* A lost write is a lost row, not a crash. The in-memory copy still serves this session. */
  }
  for (const listener of listeners) listener();
}

export function loadPhysicalCopies(): PhysicalCopy[] {
  return read();
}

export function subscribePhysicalCollection(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Add a copy. Returns it, with an id if it arrived without one. */
export function addPhysicalCopy(copy: Omit<PhysicalCopy, 'id' | 'addedAt'> & Partial<Pick<PhysicalCopy, 'id' | 'addedAt'>>): PhysicalCopy {
  const row: PhysicalCopy = {
    ...copy,
    id: copy.id?.trim() || `copy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    addedAt: copy.addedAt ?? Date.now(),
    // Stamped on every write so a merge can tell which side edited a copy last.
    updatedAt: Date.now(),
  };
  write([...read(), row]);
  return row;
}

export function updatePhysicalCopy(id: string, patch: Partial<PhysicalCopy>): void {
  write(
    read().map((row) =>
      row.id === id ? { ...row, ...patch, id: row.id, updatedAt: Date.now() } : row,
    ),
  );
}

export function removePhysicalCopy(id: string): void {
  writeTombstones(
    pruneCopyTombstones(mergeCopyTombstones(loadCopyTombstones(), [{ id, deletedAt: Date.now() }])),
  );
  write(read().filter((row) => row.id !== id));
}

export function loadCopyTombstones(): PhysicalCopyTombstone[] {
  try {
    const raw = prefsGetItem(TOMBSTONE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (row): row is PhysicalCopyTombstone =>
        Boolean(row) &&
        typeof (row as PhysicalCopyTombstone).id === 'string' &&
        typeof (row as PhysicalCopyTombstone).deletedAt === 'number',
    );
  } catch {
    return [];
  }
}

export function writeTombstones(rows: PhysicalCopyTombstone[]): void {
  try {
    prefsSetItem(TOMBSTONE_KEY, JSON.stringify(rows));
  } catch {
    /* a lost tombstone resurrects one record, not a crash */
  }
}

/** Replace the whole shelf — used by sync after a merge, never by the UI. */
export function replacePhysicalCopies(next: PhysicalCopy[]): void {
  write(next);
}

/** Test seam — prefs-backed state would otherwise carry between tests. */
export function resetPhysicalCollectionForTests(): void {
  cache = [];
  try {
    prefsSetItem(TOMBSTONE_KEY, '[]');
    prefsSetItem(STORE_KEY, '[]');
  } catch {
    /* nothing to clear */
  }
}
