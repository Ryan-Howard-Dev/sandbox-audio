/**
 * LAN taste recipe share store — manifest hash → signed JSON (no audio).
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

export type StoredTasteShare = {
  id: string;
  contentHash: string;
  storedAt: number;
  manifest: unknown;
};

const TASTE_SHARE_DIR = join(LOCKER_STORAGE_ROOT, 'taste-shares');

function ensureDir(): void {
  mkdirSync(TASTE_SHARE_DIR, { recursive: true });
}

function safeId(id: string): string | null {
  const trimmed = id.trim().toLowerCase();
  if (!/^[a-f0-9]{8,64}$/.test(trimmed)) return null;
  return trimmed;
}

export function storeTasteShareManifest(manifest: unknown): StoredTasteShare {
  ensureDir();
  const canonical = JSON.stringify(manifest);
  const contentHash = createHash('sha256').update(canonical).digest('hex');
  const id = contentHash.slice(0, 16);
  const row: StoredTasteShare = {
    id,
    contentHash,
    storedAt: Date.now(),
    manifest,
  };
  writeFileSync(join(TASTE_SHARE_DIR, `${id}.json`), JSON.stringify(row, null, 2), 'utf8');
  return row;
}

export function loadTasteShareManifest(id: string): StoredTasteShare | null {
  const safe = safeId(id);
  if (!safe) return null;
  const filePath = join(TASTE_SHARE_DIR, `${safe}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as StoredTasteShare;
    if (!parsed?.manifest) return null;
    return parsed;
  } catch {
    return null;
  }
}
