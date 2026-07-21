/**
 * Stem separation job worker — Demucs → locker blobs → stems manifest.
 */

import fs from 'node:fs';
import path from 'node:path';
import { kickJobWorker } from './acquireWorker.js';
import { DemucsNotAvailableError, demucsAvailable, runDemucsSeparation } from './demucsRunner.js';
import {
  enqueueJob,
  getJob,
  markJobComplete,
  markJobFailed,
  updateJobPayload,
} from './jobQueue.js';
import { blobPathForHash, LOCKER_STORAGE_ROOT } from './lockerPaths.js';
import { blobExists, saveBlob, sha256HexFile } from './lockerStorage.js';
import { type StemKind, upsertStemEntry } from './stemStorage.js';

export type StemAnalyzeStatus = 'queued' | 'running' | 'separating' | 'storing' | 'done' | 'error';

export type StemAnalyzeJob = {
  id: string;
  status: StemAnalyzeStatus;
  progress: number;
  trackId: string;
  contentHash: string;
  title?: string;
  artist?: string;
  error?: string;
  stems?: Partial<Record<StemKind, string>>;
  startedAt: number;
};

export type StemAnalyzePayload = {
  type: 'stem-analyze';
  job: StemAnalyzeJob;
};

function newJobId(): string {
  return `stem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persist(job: StemAnalyzeJob): void {
  updateJobPayload(job.id, { type: 'stem-analyze', job } satisfies StemAnalyzePayload);
}

export function createStemAnalyzeJob(input: {
  trackId: string;
  contentHash: string;
  title?: string;
  artist?: string;
}): StemAnalyzeJob {
  const id = newJobId();
  const job: StemAnalyzeJob = {
    id,
    status: 'queued',
    progress: 0,
    trackId: input.trackId,
    contentHash: input.contentHash.toLowerCase(),
    title: input.title,
    artist: input.artist,
    startedAt: Date.now(),
  };
  enqueueJob(id, { type: 'stem-analyze', job } satisfies StemAnalyzePayload);
  kickJobWorker();
  return job;
}

export function getStemAnalyzeJob(jobId: string): StemAnalyzeJob | null {
  const record = getJob(jobId);
  if (!record) return null;
  const payload = record.payload as StemAnalyzePayload;
  if (payload?.type !== 'stem-analyze') return null;
  return payload.job;
}

export function initStemWorker(): void {
  /* worker booted via acquireWorker.initJobWorker */
}

async function storeStemFile(filePath: string): Promise<string> {
  const hash = await sha256HexFile(filePath);
  if (!blobExists(hash)) {
    const buf = fs.readFileSync(filePath);
    saveBlob(hash, buf);
  }
  return hash;
}

export async function runStemAnalyzeJob(job: StemAnalyzeJob): Promise<void> {
  try {
    const available = await demucsAvailable();
    if (!available) {
      throw new DemucsNotAvailableError();
    }

    job.status = 'running';
    job.progress = 5;
    persist(job);

    const hash = job.contentHash.replace(/[^a-f0-9]/gi, '').toLowerCase();
    if (hash.length !== 64) throw new Error('Invalid content hash');
    const sourcePath = blobPathForHash(hash);
    if (!fs.existsSync(sourcePath)) throw new Error(`Locker blob missing for hash ${hash}`);

    const workDir = path.join(LOCKER_STORAGE_ROOT, 'stems-work', job.id);
    const outputDir = path.join(workDir, 'out');
    fs.mkdirSync(workDir, { recursive: true });

    job.status = 'separating';
    job.progress = 20;
    persist(job);

    const stemPaths = await runDemucsSeparation(sourcePath, outputDir);

    job.status = 'storing';
    job.progress = 75;
    persist(job);

    const stems: Partial<Record<StemKind, string>> = {};
    stems.vocals = await storeStemFile(stemPaths.vocals);
    stems.drums = await storeStemFile(stemPaths.drums);
    stems.bass = await storeStemFile(stemPaths.bass);
    stems.other = await storeStemFile(stemPaths.other);

    upsertStemEntry({
      trackId: job.trackId,
      sourceHash: hash,
      stems,
      analyzedAt: Date.now(),
      title: job.title,
      artist: job.artist,
    });

    job.stems = stems;
    job.status = 'done';
    job.progress = 100;
    persist(job);
    markJobComplete(job.id, { stems });

    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* cleanup best-effort */
    }
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    job.progress = 100;
    persist(job);
    markJobFailed(job.id, job.error, false);
  }
}
