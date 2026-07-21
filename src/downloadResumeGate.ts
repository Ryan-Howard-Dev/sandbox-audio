/**
 * Throttle auto-resume / re-queue so failed or queued jobs are not retried in a tight loop.
 */

import type { DownloadJob } from './downloadQueue';
import { isDownloadJobActivelyRunning } from './downloadQueue';

const AUTO_RESUME_SCAN_COOLDOWN_MS = 45_000;
const AUTO_RESUME_JOB_COOLDOWN_MS = 90_000;
const AUTO_RESUME_MAX_ATTEMPTS = 6;

const lastGlobalScanAt = { value: 0 };
const jobAttempts = new Map<string, { count: number; lastAt: number }>();

/** Debounce boot / locker-heal / downloads-sheet scans. */
export function shouldThrottleAutoResumeScan(now = Date.now()): boolean {
  return now - lastGlobalScanAt.value < AUTO_RESUME_SCAN_COOLDOWN_MS;
}

export function markAutoResumeScan(now = Date.now()): void {
  lastGlobalScanAt.value = now;
}

export function resetAutoResumeGateForTests(): void {
  lastGlobalScanAt.value = 0;
  jobAttempts.clear();
}

function jobAttempt(jobId: string): { count: number; lastAt: number } {
  const existing = jobAttempts.get(jobId);
  if (existing) return existing;
  const created = { count: 0, lastAt: 0 };
  jobAttempts.set(jobId, created);
  return created;
}

export function recordAutoResumeAttempt(jobId: string, now = Date.now()): void {
  const entry = jobAttempt(jobId);
  entry.count += 1;
  entry.lastAt = now;
}

/** True when auto-resume / completion re-queue may run for this job. */
export function canAutoResumeDownloadJob(job: DownloadJob, now = Date.now()): boolean {
  if (isDownloadJobActivelyRunning(job)) return false;
  const entry = jobAttempts.get(job.id);
  if (!entry) return true;
  if (entry.count >= AUTO_RESUME_MAX_ATTEMPTS) return false;
  return now - entry.lastAt >= AUTO_RESUME_JOB_COOLDOWN_MS;
}

/** Test-only: seed attempt history. */
export function seedAutoResumeAttemptForTests(
  jobId: string,
  count: number,
  lastAt: number,
): void {
  jobAttempts.set(jobId, { count, lastAt });
}
