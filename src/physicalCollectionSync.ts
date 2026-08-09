/**
 * Getting the shelf from the phone to the desktop.
 *
 * The split that makes this necessary: scanning is a phone job, because the camera is on the phone
 * and the records are on a shelf you walk along, while tidying up two hundred entries is a desktop
 * job, because that is what a keyboard and a big screen are for. Capture on one, curate on the
 * other, and the collection has to travel between them.
 *
 * Rides the locker manifest rather than inventing a transport. Whatever the listener already
 * trusts to move their library — their own WebDAV, their own Sandbox Server, a file they carry on
 * a stick — moves this too, and nothing new needs a server.
 *
 * Tombstones are not optional here, and they are the part that is easy to leave out. Without them
 * a merge is a union, a union never removes anything, and every record you delete on the phone
 * comes back the next time the desktop syncs. A collection that resurrects records you threw out
 * is worse than one that does not sync at all.
 */

import type { PhysicalCopy } from './physicalCollection';

export interface PhysicalCopyTombstone {
  id: string;
  deletedAt: number;
}

export interface PhysicalCollectionMergeStats {
  added: number;
  updated: number;
  deleted: number;
}

/**
 * When this copy last changed, for last-write-wins.
 *
 * Falls back to addedAt so rows written before this existed still compare sensibly rather than
 * being treated as infinitely old and losing every merge.
 */
function changedAt(copy: PhysicalCopy): number {
  return copy.updatedAt ?? copy.addedAt ?? 0;
}

/** Newest deletion wins, and a tombstone never disappears just because the other side forgot it. */
export function mergeCopyTombstones(
  local: readonly PhysicalCopyTombstone[],
  remote: readonly PhysicalCopyTombstone[],
): PhysicalCopyTombstone[] {
  const byId = new Map<string, PhysicalCopyTombstone>();
  for (const row of [...local, ...remote]) {
    if (!row?.id) continue;
    const existing = byId.get(row.id);
    if (!existing || row.deletedAt > existing.deletedAt) byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * Fold a remote shelf into the local one.
 *
 * Per copy, the newer edit wins; a deletion wins over an edit older than it, and loses to one
 * newer. That last case is deliberate: re-adding a record you had deleted is a thing people do,
 * and a tombstone that outranks every future edit would make the id unusable forever.
 */
export function mergePhysicalCollection(
  localCopies: readonly PhysicalCopy[],
  remoteCopies: readonly PhysicalCopy[],
  tombstones: readonly PhysicalCopyTombstone[],
): { copies: PhysicalCopy[]; stats: PhysicalCollectionMergeStats } {
  const stats: PhysicalCollectionMergeStats = { added: 0, updated: 0, deleted: 0 };
  const deletedAt = new Map(tombstones.map((row) => [row.id, row.deletedAt]));
  const byId = new Map<string, PhysicalCopy>();

  for (const copy of localCopies) {
    if (copy?.id) byId.set(copy.id, copy);
  }

  for (const remote of remoteCopies) {
    if (!remote?.id) continue;
    const local = byId.get(remote.id);
    if (!local) {
      byId.set(remote.id, remote);
      stats.added += 1;
      continue;
    }
    if (changedAt(remote) > changedAt(local)) {
      byId.set(remote.id, remote);
      stats.updated += 1;
    }
  }

  for (const [id, when] of deletedAt) {
    const copy = byId.get(id);
    if (!copy) continue;
    // A copy edited after it was deleted elsewhere is a re-add, and survives.
    if (changedAt(copy) > when) continue;
    byId.delete(id);
    stats.deleted += 1;
  }

  return { copies: [...byId.values()], stats };
}

/**
 * Drop tombstones for copies nobody will ever see again.
 *
 * They are tiny, but a collection edited for years would otherwise carry a deletion record for
 * every record ever removed, in every manifest, forever. Six months is long enough for any device
 * that was going to sync to have synced.
 */
export const TOMBSTONE_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export function pruneCopyTombstones(
  tombstones: readonly PhysicalCopyTombstone[],
  now = Date.now(),
): PhysicalCopyTombstone[] {
  return tombstones.filter((row) => now - row.deletedAt < TOMBSTONE_RETENTION_MS);
}
