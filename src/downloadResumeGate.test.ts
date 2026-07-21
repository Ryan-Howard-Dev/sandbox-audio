import { beforeEach, describe, expect, it } from 'vitest';
import {
  canAutoResumeDownloadJob,
  markAutoResumeScan,
  recordAutoResumeAttempt,
  resetAutoResumeGateForTests,
  seedAutoResumeAttemptForTests,
  shouldThrottleAutoResumeScan,
} from './downloadResumeGate';
import type { DownloadJob } from './downloadQueue';

function sampleJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    id: 'dl-test',
    label: 'Test',
    artist: 'Artist',
    mode: 'album',
    tier: 'best',
    status: 'error',
    progress: 0,
    totalTracks: 2,
    completedTracks: 0,
    tracks: {},
    startedAt: Date.now(),
    error: 'Download paused — resuming remaining tracks…',
    ...overrides,
  };
}

describe('downloadResumeGate', () => {
  beforeEach(() => {
    resetAutoResumeGateForTests();
  });

  it('throttles repeated global auto-resume scans', () => {
    const now = 1_000_000;
    expect(shouldThrottleAutoResumeScan(now)).toBe(false);
    markAutoResumeScan(now);
    expect(shouldThrottleAutoResumeScan(now + 10_000)).toBe(true);
    expect(shouldThrottleAutoResumeScan(now + 50_000)).toBe(false);
  });

  it('backs off per-job auto-resume after repeated attempts', () => {
    const now = 2_000_000;
    const job = sampleJob();
    expect(canAutoResumeDownloadJob(job, now)).toBe(true);
    recordAutoResumeAttempt(job.id, now);
    expect(canAutoResumeDownloadJob(job, now + 30_000)).toBe(false);
    expect(canAutoResumeDownloadJob(job, now + 100_000)).toBe(true);
    seedAutoResumeAttemptForTests(job.id, 6, now);
    expect(canAutoResumeDownloadJob(job, now + 200_000)).toBe(false);
  });
});
