/**
 * Platform outbox — unified store for social, messages, marketplace, shares.
 * v0: household node; federation pull later.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

export type OutboxEntryType = 'message' | 'post' | 'listing' | 'share';

export type OutboxVisibility = 'public' | 'friends' | 'direct' | 'unlisted';

export type OutboxEntry = {
  id: string;
  type: OutboxEntryType;
  authorKeyId: string;
  createdAt: number;
  updatedAt: number;
  visibility: OutboxVisibility;
  /** E2E ciphertext for direct messages; plain JSON for public posts/listings */
  payload: unknown;
  /** locker blob hashes — images, audio, art attachments */
  mediaRefs: string[];
  /** direct message: recipient key id */
  toKeyId?: string;
  /** thread id for SMS/WhatsApp-style conversations */
  threadId?: string;
  signature?: string;
};

const OUTBOX_DIR = join(LOCKER_STORAGE_ROOT, 'platform-outbox');

function ensureDir(): void {
  mkdirSync(OUTBOX_DIR, { recursive: true });
}

function safeId(id: string): string | null {
  const trimmed = id.trim().toLowerCase();
  if (!/^[a-f0-9]{8,64}$/.test(trimmed)) return null;
  return trimmed;
}

function entryPath(id: string): string {
  return join(OUTBOX_DIR, `${id}.json`);
}

export function storeOutboxEntry(
  partial: Omit<OutboxEntry, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): OutboxEntry {
  ensureDir();
  const now = Date.now();
  const canonical = JSON.stringify({
    type: partial.type,
    authorKeyId: partial.authorKeyId,
    visibility: partial.visibility,
    payload: partial.payload,
    mediaRefs: partial.mediaRefs,
    toKeyId: partial.toKeyId,
    threadId: partial.threadId,
    signature: partial.signature,
  });
  const contentHash = createHash('sha256').update(canonical).digest('hex');
  const id = partial.id ?? contentHash.slice(0, 16);
  const row: OutboxEntry = {
    id,
    type: partial.type,
    authorKeyId: partial.authorKeyId,
    createdAt: now,
    updatedAt: now,
    visibility: partial.visibility,
    payload: partial.payload,
    mediaRefs: partial.mediaRefs ?? [],
    toKeyId: partial.toKeyId,
    threadId: partial.threadId,
    signature: partial.signature,
  };
  writeFileSync(entryPath(id), JSON.stringify(row, null, 2), 'utf8');
  return row;
}

export function loadOutboxEntry(id: string): OutboxEntry | null {
  const safe = safeId(id);
  if (!safe) return null;
  const filePath = entryPath(safe);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as OutboxEntry;
  } catch {
    return null;
  }
}

export type OutboxQuery = {
  type?: OutboxEntryType;
  authorKeyId?: string;
  threadId?: string;
  visibility?: OutboxVisibility;
  limit?: number;
};

export function listOutboxEntries(query: OutboxQuery = {}): OutboxEntry[] {
  ensureDir();
  const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
  const rows: OutboxEntry[] = [];
  for (const file of readdirSync(OUTBOX_DIR)) {
    if (!file.endsWith('.json')) continue;
    try {
      const row = JSON.parse(readFileSync(join(OUTBOX_DIR, file), 'utf8')) as OutboxEntry;
      if (query.type && row.type !== query.type) continue;
      if (query.authorKeyId && row.authorKeyId !== query.authorKeyId) continue;
      if (query.threadId && row.threadId !== query.threadId) continue;
      if (query.visibility && row.visibility !== query.visibility) continue;
      rows.push(row);
    } catch {
      /* skip corrupt */
    }
  }
  rows.sort((a, b) => b.createdAt - a.createdAt);
  return rows.slice(0, limit);
}

export function listThreadsForKey(keyId: string): { threadId: string; updatedAt: number }[] {
  const entries = listOutboxEntries({ type: 'message', limit: 200 });
  const map = new Map<string, number>();
  for (const e of entries) {
    if (e.authorKeyId !== keyId && e.toKeyId !== keyId) continue;
    const tid = e.threadId ?? e.id;
    const prev = map.get(tid) ?? 0;
    if (e.updatedAt > prev) map.set(tid, e.updatedAt);
  }
  return [...map.entries()]
    .map(([threadId, updatedAt]) => ({ threadId, updatedAt }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}
