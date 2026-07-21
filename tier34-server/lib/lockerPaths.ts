/**
 * Locker filesystem paths (shared, no graph/storage logic).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_STORAGE_ROOT = path.join(__dirname, '..', 'storage');
export const LOCKER_STORAGE_ROOT = process.env.TIER34_STORAGE_PATH?.trim()
  ? path.resolve(process.env.TIER34_STORAGE_PATH.trim())
  : DEFAULT_STORAGE_ROOT;
export const LOCKER_BLOBS_DIR = path.join(LOCKER_STORAGE_ROOT, 'blobs');

export function blobPathForHash(hash: string): string {
  const safe = hash.replace(/[^a-f0-9]/gi, '');
  if (safe.length !== 64) throw new Error('Invalid SHA-256 hash');
  return path.join(LOCKER_BLOBS_DIR, safe);
}
