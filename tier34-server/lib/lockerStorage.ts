/**
 * Tier 3/4 locker blob + manifest storage (flat JSON + filesystem blobs).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { LOCKER_BLOBS_DIR, LOCKER_STORAGE_ROOT, blobPathForHash } from './lockerPaths.js';
import { syncManifestEntry, upsertHash } from './mediaGraph.js';
import { scheduleReindex } from './meilisearchIndexer.js';

const MANIFEST_PATH = path.join(LOCKER_STORAGE_ROOT, 'manifest.json');

export { LOCKER_BLOBS_DIR, LOCKER_STORAGE_ROOT, blobPathForHash } from './lockerPaths.js';

export type LockerSyncManifestEntry = {
  id: string;
  contentHash: string;
  title: string;
  artist: string;
  albumName?: string;
  durationSeconds: number;
  addedAt: number;
  remoteBlobUrl?: string;
  coverHash?: string;
  releaseYear?: string;
  creditsJson?: string;
  acoustidId?: string;
  musicbrainzRecordingId?: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  version: number;
};

export type LockerSyncManifestPlaylist = {
  id: string;
  name: string;
  description?: string;
  trackEnvelopeIds: string[];
  updatedAt: number;
};

export type PlaylistTombstone = {
  id: string;
  deletedAt: number;
};

export type TrackTombstone = {
  id: string;
  deletedAt: number;
};

export type LockerSyncManifest = {
  deviceId: string;
  updatedAt: number;
  entries: LockerSyncManifestEntry[];
  /** Exported from client locker sync — used by DLNA Playlists container. */
  playlists?: LockerSyncManifestPlaylist[];
  playlistTombstones?: PlaylistTombstone[];
  trackTombstones?: TrackTombstone[];
};

const EMPTY_MANIFEST: LockerSyncManifest = {
  deviceId: 'tier34-server',
  updatedAt: 0,
  entries: [],
};

function ensureDirs(): void {
  fs.mkdirSync(LOCKER_BLOBS_DIR, { recursive: true });
}

export function sha256HexBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** Stream SHA-256 of a file on disk (memory-safe for large blobs). */
export function sha256HexFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk: Buffer | string) => {
      hash.update(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    });
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const QUARANTINE_DIR = path.join(LOCKER_STORAGE_ROOT, 'quarantine');

/** Move corrupt blob to quarantine/ for inspection. */
export function quarantineCorruptBlob(expectedHash: string): string | null {
  try {
    const src = blobPathForHash(expectedHash);
    if (!fs.existsSync(src)) return null;
    fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
    const dest = path.join(QUARANTINE_DIR, `${expectedHash.replace(/[^a-f0-9]/gi, '')}.corrupt`);
    fs.renameSync(src, dest);
    return dest;
  } catch {
    return null;
  }
}

export function loadMasterManifest(): LockerSyncManifest {
  ensureDirs();
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
    const parsed = JSON.parse(raw) as LockerSyncManifest;
    if (!parsed || !Array.isArray(parsed.entries)) return { ...EMPTY_MANIFEST };
    return parsed;
  } catch {
    return { ...EMPTY_MANIFEST };
  }
}

function normalizeHash(hash: string): string {
  return hash.replace(/[^a-f0-9]/gi, '').toLowerCase();
}

/** Find locker row by content SHA-256 (acquire dedup). */
export function findManifestEntryByContentHash(hash: string): LockerSyncManifestEntry | undefined {
  const safe = normalizeHash(hash);
  if (safe.length !== 64) return undefined;
  return loadMasterManifest().entries.find((e) => normalizeHash(e.contentHash) === safe);
}

/** Find locker row by MusicBrainz recording id (AcoustID dedup). */
export function findManifestEntryByRecordingId(recordingId: string): LockerSyncManifestEntry | undefined {
  const id = recordingId.trim().toLowerCase();
  if (!id) return undefined;
  return loadMasterManifest().entries.find(
    (e) => (e.musicbrainzRecordingId ?? '').trim().toLowerCase() === id,
  );
}

export function saveMasterManifest(manifest: LockerSyncManifest): void {
  ensureDirs();
  const next = { ...manifest, updatedAt: Date.now() };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(next, null, 2), 'utf8');
}

/** Union track ids preserving order; dedupe by envelope id. */
function mergePlaylistRows(
  existing: LockerSyncManifestPlaylist,
  incoming: LockerSyncManifestPlaylist,
): LockerSyncManifestPlaylist {
  const seen = new Set<string>();
  const trackEnvelopeIds: string[] = [];
  for (const id of [...existing.trackEnvelopeIds, ...incoming.trackEnvelopeIds]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    trackEnvelopeIds.push(id);
  }
  const existingTs = existing.updatedAt ?? 0;
  const incomingTs = incoming.updatedAt ?? 0;
  const useIncomingMeta = incomingTs > existingTs;
  return {
    id: incoming.id,
    name: useIncomingMeta ? incoming.name : existing.name,
    description: useIncomingMeta
      ? incoming.description ?? existing.description
      : existing.description ?? incoming.description,
    trackEnvelopeIds,
    updatedAt: Math.max(existingTs, incomingTs),
  };
}

function mergeTombstoneRows(
  master: PlaylistTombstone[],
  incoming: PlaylistTombstone[],
): PlaylistTombstone[] {
  const byId = new Map<string, PlaylistTombstone>();
  for (const t of [...master, ...incoming]) {
    if (!t?.id) continue;
    const prev = byId.get(t.id);
    byId.set(t.id, {
      id: t.id,
      deletedAt: Math.max(prev?.deletedAt ?? 0, t.deletedAt ?? 0),
    });
  }
  return [...byId.values()];
}

/** Last-write-wins per track id (MVP conflict rule). Playlists merge by id with union tracks. */
export function mergeManifest(incoming: LockerSyncManifest): LockerSyncManifest {
  const master = loadMasterManifest();
  const byId = new Map(master.entries.map((e) => [e.id, e]));

  for (const row of incoming.entries ?? []) {
    if (!row?.id) continue;
    const existing = byId.get(row.id);
    if (!existing || (row.addedAt ?? 0) >= (existing.addedAt ?? 0)) {
      byId.set(row.id, {
        ...row,
        remoteBlobUrl: row.remoteBlobUrl ?? `/api/locker/blob/${row.contentHash}`,
        version: Math.max(row.version ?? 1, existing?.version ?? 0),
      });
    }
  }

  const incomingPlaylists = Array.isArray(incoming.playlists) ? incoming.playlists : [];
  const masterPlaylists = Array.isArray(master.playlists) ? master.playlists : [];
  const playlistById = new Map(masterPlaylists.map((pl) => [pl.id, pl]));
  for (const pl of incomingPlaylists) {
    if (!pl?.id) continue;
    const existing = playlistById.get(pl.id);
    playlistById.set(pl.id, existing ? mergePlaylistRows(existing, pl) : pl);
  }

  const tombstones = mergeTombstoneRows(
    master.playlistTombstones ?? [],
    incoming.playlistTombstones ?? [],
  );
  for (const tomb of tombstones) {
    const pl = playlistById.get(tomb.id);
    if (pl && tomb.deletedAt >= (pl.updatedAt ?? 0)) {
      playlistById.delete(tomb.id);
    }
  }

  const trackTombstones = mergeTombstoneRows(
    master.trackTombstones ?? [],
    incoming.trackTombstones ?? [],
  );
  for (const tomb of trackTombstones) {
    const row = byId.get(tomb.id);
    if (row && tomb.deletedAt >= (row.addedAt ?? 0)) {
      byId.delete(tomb.id);
    }
  }

  const merged: LockerSyncManifest = {
    deviceId: incoming.deviceId || master.deviceId || 'tier34-server',
    updatedAt: Date.now(),
    entries: [...byId.values()].sort((a, b) => b.addedAt - a.addedAt),
    playlists: playlistById.size > 0 ? [...playlistById.values()] : masterPlaylists,
    playlistTombstones: tombstones.length > 0 ? tombstones : master.playlistTombstones,
    trackTombstones: trackTombstones.length > 0 ? trackTombstones : master.trackTombstones,
  };
  saveMasterManifest(merged);
  for (const row of incoming.entries ?? []) {
    if (!row?.id) continue;
    try {
      syncManifestEntry(row, 'local');
    } catch {
      /* graph best-effort */
    }
  }
  scheduleReindex();
  return merged;
}

export function blobExists(hash: string): boolean {
  try {
    return fs.existsSync(blobPathForHash(hash));
  } catch {
    return false;
  }
}

export function saveBlob(hash: string, body: Buffer): { hash: string; bytes: number } {
  ensureDirs();
  const computed = sha256HexBuffer(body);
  if (computed !== hash.replace(/[^a-f0-9]/gi, '')) {
    throw new Error('Hash mismatch — body does not match :hash');
  }
  const filePath = blobPathForHash(computed);
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, body);
  }
  try {
    upsertHash(computed, body.length);
  } catch {
    /* graph best-effort */
  }
  return { hash: computed, bytes: body.length };
}

export function readBlob(hash: string): Buffer | null {
  try {
    const filePath = blobPathForHash(hash);
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

export function upsertManifestEntry(entry: LockerSyncManifestEntry): LockerSyncManifest {
  return mergeManifest({
    deviceId: 'tier34-server',
    updatedAt: Date.now(),
    entries: [entry],
  });
}
