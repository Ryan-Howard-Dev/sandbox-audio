/**
 * In-memory (tmpfs) staging cache — copy locker blobs to RAM for faster stream reads.
 * Serves legitimate locker files only (blob must exist on disk); Interminable Tide is unrelated.
 */

import fs from 'node:fs';
import path from 'node:path';
import { blobExists, loadMasterManifest } from './lockerStorage.js';
import { blobPathForHash } from './lockerPaths.js';

const HASH_RE = /^[a-f0-9]{64}$/i;

type CacheEntry = {
  hash: string;
  trackId: string;
  bytes: number;
  lastAccess: number;
  stagedAt: number;
};

const accessLog = new Map<string, CacheEntry>();
const stageQueue: string[] = [];
let staging = false;

export function getTmpfsCacheDir(): string {
  const raw = process.env.TIER34_TMPFS_CACHE?.trim();
  if (raw) return path.resolve(raw);
  return '/dev/shm/sandbox-tier34-cache';
}

function getMaxBytes(): number {
  const mb = Number(process.env.TIER34_TMPFS_CACHE_MAX_MB) || 512;
  return Math.max(64, mb) * 1024 * 1024;
}

export function ensureTmpfsCacheDir(): void {
  const dir = getTmpfsCacheDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function resolveTrackHash(trackId: string): string | null {
  const id = trackId.trim().toLowerCase();
  if (HASH_RE.test(id)) {
    return blobExists(id) ? id : null;
  }

  const manifest = loadMasterManifest();
  const entry = manifest.entries.find((e) => e.id === trackId || e.id.toLowerCase() === id);
  if (!entry?.contentHash) return null;
  const hash = entry.contentHash.toLowerCase();
  return blobExists(hash) ? hash : null;
}

function tmpfsPathForHash(hash: string): string {
  return path.join(getTmpfsCacheDir(), hash);
}

function touchAccess(hash: string, trackId: string): void {
  const existing = accessLog.get(hash);
  if (existing) {
    existing.lastAccess = Date.now();
    return;
  }
  try {
    const bytes = fs.statSync(tmpfsPathForHash(hash)).size;
    accessLog.set(hash, {
      hash,
      trackId,
      bytes,
      lastAccess: Date.now(),
      stagedAt: Date.now(),
    });
  } catch {
    /* ignore */
  }
}

function currentCacheBytes(): number {
  let total = 0;
  for (const entry of accessLog.values()) {
    total += entry.bytes;
  }
  return total;
}

function rebuildAccessLogFromDisk(): void {
  ensureTmpfsCacheDir();
  accessLog.clear();
  for (const name of fs.readdirSync(getTmpfsCacheDir())) {
    if (!HASH_RE.test(name)) continue;
    try {
      const bytes = fs.statSync(tmpfsPathForHash(name)).size;
      accessLog.set(name, {
        hash: name,
        trackId: name,
        bytes,
        lastAccess: Date.now(),
        stagedAt: Date.now(),
      });
    } catch {
      /* ignore */
    }
  }
}

function evictLru(requiredBytes: number): void {
  const sorted = [...accessLog.values()].sort((a, b) => a.lastAccess - b.lastAccess);
  for (const entry of sorted) {
    if (currentCacheBytes() + requiredBytes <= getMaxBytes()) return;
    try {
      fs.unlinkSync(tmpfsPathForHash(entry.hash));
    } catch {
      /* ignore */
    }
    accessLog.delete(entry.hash);
  }
}

async function copyToTmpfs(hash: string, trackId: string): Promise<boolean> {
  if (!blobExists(hash)) return false;
  ensureTmpfsCacheDir();
  const dest = tmpfsPathForHash(hash);
  if (fs.existsSync(dest)) {
    touchAccess(hash, trackId);
    return true;
  }

  const src = blobPathForHash(hash);
  let size = 0;
  try {
    size = fs.statSync(src).size;
  } catch {
    return false;
  }

  if (size > getMaxBytes()) return false;

  evictLru(size);
  if (currentCacheBytes() + size > getMaxBytes()) return false;

  await fs.promises.copyFile(src, dest);
  accessLog.set(hash, {
    hash,
    trackId,
    bytes: size,
    lastAccess: Date.now(),
    stagedAt: Date.now(),
  });
  return true;
}

export type ResolvedReadPath = {
  path: string;
  source: 'tmpfs' | 'disk';
  hash: string;
};

/** Prefer tmpfs copy when staged; fall back to locker disk blob. */
export function resolveBestReadPath(trackIdOrHash: string): ResolvedReadPath | null {
  const hash = resolveTrackHash(trackIdOrHash);
  if (!hash) return null;

  const staged = tmpfsPathForHash(hash);
  if (fs.existsSync(staged)) {
    touchAccess(hash, trackIdOrHash);
    return { path: staged, source: 'tmpfs', hash };
  }

  if (blobExists(hash)) {
    return { path: blobPathForHash(hash), source: 'disk', hash };
  }

  return null;
}

export function enqueueStageQueue(
  trackIds: string[],
  envelopeIds: string[],
): { accepted: number; queued: number } {
  const ids = new Set<string>();
  for (const id of [...trackIds, ...envelopeIds]) {
    const trimmed = id.trim();
    if (trimmed) ids.add(trimmed);
  }
  for (const id of ids) {
    if (!stageQueue.includes(id)) stageQueue.push(id);
  }
  void drainStageQueue();
  return { accepted: ids.size, queued: stageQueue.length };
}

async function drainStageQueue(): Promise<void> {
  if (staging) return;
  staging = true;
  try {
    if (accessLog.size === 0 && stageQueue.length > 0) {
      rebuildAccessLogFromDisk();
    }
    while (stageQueue.length > 0) {
      const id = stageQueue.shift()!;
      const hash = resolveTrackHash(id);
      if (!hash) continue;
      await copyToTmpfs(hash, id);
    }
  } finally {
    staging = false;
    if (stageQueue.length > 0) {
      void drainStageQueue();
    }
  }
}

export function getTmpfsCacheStatus(): {
  cacheDir: string;
  maxBytes: number;
  usedBytes: number;
  entries: number;
  staging: boolean;
  queued: number;
} {
  if (accessLog.size === 0) {
    try {
      rebuildAccessLogFromDisk();
    } catch {
      /* cache dir may not exist yet */
    }
  }
  return {
    cacheDir: getTmpfsCacheDir(),
    maxBytes: getMaxBytes(),
    usedBytes: currentCacheBytes(),
    entries: accessLog.size,
    staging,
    queued: stageQueue.length,
  };
}
