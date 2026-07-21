/**
 * Persistent SQLite job queue — survives tier34 restarts.
 * Uses the same media-graph.db file as mediaGraph.ts.
 */

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

const DB_PATH = path.join(LOCKER_STORAGE_ROOT, 'media-graph.db');

export type JobStatus = 'pending' | 'processing' | 'failed' | 'complete';

export type JobRecord = {
  jobId: string;
  payload: unknown;
  status: JobStatus;
  retryCount: number;
  createdAt: number;
  updatedAt: number;
  result?: unknown;
  error?: string;
};

let db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(LOCKER_STORAGE_ROOT, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS job_queue (
      job_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'processing', 'failed', 'complete')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      result_json TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_job_queue_status ON job_queue(status, created_at);
  `);
  return db;
}

function rowToRecord(row: {
  job_id: string;
  payload_json: string;
  status: JobStatus;
  retry_count: number;
  created_at: number;
  updated_at: number;
  result_json: string | null;
  error: string | null;
}): JobRecord {
  let payload: unknown;
  let result: unknown;
  try {
    payload = JSON.parse(row.payload_json);
  } catch {
    payload = null;
  }
  if (row.result_json) {
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = row.result_json;
    }
  }
  return {
    jobId: row.job_id,
    payload,
    status: row.status,
    retryCount: row.retry_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    result,
    error: row.error ?? undefined,
  };
}

export function enqueueJob(jobId: string, payload: unknown): JobRecord {
  const database = getDb();
  const now = Date.now();
  database
    .prepare(`
      INSERT INTO job_queue (job_id, payload_json, status, retry_count, created_at, updated_at)
      VALUES (?, ?, 'pending', 0, ?, ?)
    `)
    .run(jobId, JSON.stringify(payload), now, now);
  return getJob(jobId)!;
}

export function getJob(jobId: string): JobRecord | null {
  const database = getDb();
  const row = database
    .prepare(
      'SELECT job_id, payload_json, status, retry_count, created_at, updated_at, result_json, error FROM job_queue WHERE job_id = ?',
    )
    .get(jobId) as
    | {
        job_id: string;
        payload_json: string;
        status: JobStatus;
        retry_count: number;
        created_at: number;
        updated_at: number;
        result_json: string | null;
        error: string | null;
      }
    | undefined;
  return row ? rowToRecord(row) : null;
}

export function updateJobPayload(jobId: string, payload: unknown): void {
  const database = getDb();
  database
    .prepare('UPDATE job_queue SET payload_json = ?, updated_at = ? WHERE job_id = ?')
    .run(JSON.stringify(payload), Date.now(), jobId);
}

export function markJobProcessing(jobId: string): void {
  const database = getDb();
  database
    .prepare("UPDATE job_queue SET status = 'processing', updated_at = ? WHERE job_id = ?")
    .run(Date.now(), jobId);
}

export function markJobComplete(jobId: string, result?: unknown): void {
  const database = getDb();
  database
    .prepare(`
      UPDATE job_queue SET status = 'complete', result_json = ?, updated_at = ?, error = NULL
      WHERE job_id = ?
    `)
    .run(result != null ? JSON.stringify(result) : null, Date.now(), jobId);
}

export function markJobFailed(jobId: string, error: string, incrementRetry = true): void {
  const database = getDb();
  if (incrementRetry) {
    database
      .prepare(`
        UPDATE job_queue SET status = 'failed', error = ?, retry_count = retry_count + 1, updated_at = ?
        WHERE job_id = ?
      `)
      .run(error, Date.now(), jobId);
  } else {
    database
      .prepare(`
        UPDATE job_queue SET status = 'failed', error = ?, updated_at = ?
        WHERE job_id = ?
      `)
      .run(error, Date.now(), jobId);
  }
}

/** Reset in-flight jobs to pending on boot (crash recovery). */
export function resetProcessingJobs(): number {
  const database = getDb();
  const result = database
    .prepare("UPDATE job_queue SET status = 'pending', updated_at = ? WHERE status = 'processing'")
    .run(Date.now());
  return Number(result.changes ?? 0);
}

/** Claim the oldest pending job of a given payload type (e.g. ingest-file). */
export function claimNextJobByType(type: string): JobRecord | null {
  const database = getDb();
  const rows = database
    .prepare(`
      SELECT job_id, payload_json, status, retry_count, created_at, updated_at, result_json, error
      FROM job_queue WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT 32
    `)
    .all() as Array<{
      job_id: string;
      payload_json: string;
      status: JobStatus;
      retry_count: number;
      created_at: number;
      updated_at: number;
      result_json: string | null;
      error: string | null;
    }>;

  for (const row of rows) {
    let payload: { type?: string };
    try {
      payload = JSON.parse(row.payload_json) as { type?: string };
    } catch {
      continue;
    }
    if (payload?.type !== type) continue;

    const claimed = database
      .prepare(
        "UPDATE job_queue SET status = 'processing', updated_at = ? WHERE job_id = ? AND status = 'pending'",
      )
      .run(Date.now(), row.job_id);

    if ((claimed.changes ?? 0) === 0) continue;
    return rowToRecord({ ...row, status: 'processing' });
  }
  return null;
}

/** Claim the oldest pending job atomically (excludes ingest-file — separate pump). */
export function claimNextJob(): JobRecord | null {
  const database = getDb();
  const rows = database
    .prepare(`
      SELECT job_id, payload_json, status, retry_count, created_at, updated_at, result_json, error
      FROM job_queue WHERE status = 'pending'
      ORDER BY created_at ASC LIMIT 32
    `)
    .all() as Array<{
      job_id: string;
      payload_json: string;
      status: JobStatus;
      retry_count: number;
      created_at: number;
      updated_at: number;
      result_json: string | null;
      error: string | null;
    }>;

  for (const row of rows) {
    try {
      const payload = JSON.parse(row.payload_json) as { type?: string };
      if (payload?.type === 'ingest-file') continue;
    } catch {
      /* continue */
    }

    const claimed = database
      .prepare(
        "UPDATE job_queue SET status = 'processing', updated_at = ? WHERE job_id = ? AND status = 'pending'",
      )
      .run(Date.now(), row.job_id);

    if ((claimed.changes ?? 0) === 0) continue;
    return rowToRecord({ ...row, status: 'processing' });
  }
  return null;
}

export function enqueueHealBlobJob(payload: {
  hash: string;
  expectedHash: string;
  actualHash: string;
  envelopeId?: string;
}): JobRecord {
  const jobId = `heal-${payload.hash.slice(0, 12)}-${Date.now()}`;
  return enqueueJob(jobId, { type: 'heal-blob', ...payload });
}
