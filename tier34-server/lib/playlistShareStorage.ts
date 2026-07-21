/**
 * LAN collaborative playlist share store — manifest JSON + edit token (no audio blobs).
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

export type SharedPlaylistTrackRow = {
  title: string;
  artist: string;
  album?: string;
  envelopeId?: string;
  url?: string;
  durationSeconds?: number;
};

export type SharedPlaylistManifest = {
  schemaVersion: 1;
  name: string;
  description?: string;
  updatedAt: number;
  collaborative: boolean;
  tracks: SharedPlaylistTrackRow[];
};

export type StoredPlaylistShare = {
  id: string;
  editToken: string;
  contentHash: string;
  storedAt: number;
  updatedAt: number;
  manifest: SharedPlaylistManifest;
};

const PLAYLIST_SHARE_DIR = join(LOCKER_STORAGE_ROOT, 'playlist-shares');

function ensureDir(): void {
  mkdirSync(PLAYLIST_SHARE_DIR, { recursive: true });
}

function safeId(id: string): string | null {
  const trimmed = id.trim().toLowerCase();
  if (!/^[a-f0-9]{8,64}$/.test(trimmed)) return null;
  return trimmed;
}

function hashManifest(manifest: SharedPlaylistManifest): string {
  return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}

export function storePlaylistShareManifest(
  manifest: SharedPlaylistManifest,
  existingId?: string,
  existingToken?: string,
): StoredPlaylistShare {
  ensureDir();
  const contentHash = hashManifest(manifest);
  const id = existingId?.trim() || contentHash.slice(0, 16);
  const editToken = existingToken?.trim() || randomBytes(16).toString('hex');
  const now = Date.now();
  const filePath = join(PLAYLIST_SHARE_DIR, `${id}.json`);
  let storedAt = now;
  if (existsSync(filePath)) {
    try {
      const prev = JSON.parse(readFileSync(filePath, 'utf8')) as StoredPlaylistShare;
      storedAt = prev.storedAt ?? now;
    } catch {
      /* fresh row */
    }
  }
  const row: StoredPlaylistShare = {
    id,
    editToken,
    contentHash,
    storedAt,
    updatedAt: manifest.updatedAt || now,
    manifest,
  };
  writeFileSync(filePath, JSON.stringify(row, null, 2), 'utf8');
  return row;
}

export function loadPlaylistShare(id: string): StoredPlaylistShare | null {
  const safe = safeId(id);
  if (!safe) return null;
  const filePath = join(PLAYLIST_SHARE_DIR, `${safe}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as StoredPlaylistShare;
    if (!parsed?.manifest || parsed.manifest.schemaVersion !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function updatePlaylistShareManifest(
  id: string,
  editToken: string,
  manifest: SharedPlaylistManifest,
): StoredPlaylistShare | 'forbidden' | null {
  const row = loadPlaylistShare(id);
  if (!row) return null;
  if (row.editToken !== editToken.trim()) return 'forbidden';
  return storePlaylistShareManifest(manifest, row.id, row.editToken);
}

export function publicPlaylistShareRow(row: StoredPlaylistShare): Omit<StoredPlaylistShare, 'editToken'> {
  const { editToken: _omit, ...rest } = row;
  return rest;
}
