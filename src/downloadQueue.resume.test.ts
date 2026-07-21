import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDownloadJobs,
  initJobTracks,
  patchDownloadJob,
  patchTrackDownload,
  resetDownloadJobForRetry,
  describeDownloadJobResume,
  enqueueDownloadJob,
  isDownloadJobActivelyRunning,
  listDownloadJobsNeedingResume,
  reconcileOrphanedActiveJobsOnColdStart,
  revalidateDownloadQueueAgainstLocker,
} from './downloadQueue';

vi.mock('./lockerStorage', () => ({
  findPlayableLockerEntryForTrack: vi.fn(async () => null),
  findLockerEntryForTrackIncludingHollow: vi.fn(() => null),
  lockerEntryHasRecoverableAudio: vi.fn(async () => false),
  lockerEntryHasHealSignals: vi.fn(async () => false),
}));

describe('download resume', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps finished tracks when resetting for retry', () => {
    const job = enqueueDownloadJob({
      label: 'Donda (Deluxe)',
      artist: 'Kanye West',
      albumTitle: 'Donda (Deluxe)',
      mode: 'album',
      tier: 'best',
      totalTracks: 3,
    });
    initJobTracks(job.id, [
      { id: 't1', title: 'Track 1' },
      { id: 't2', title: 'Track 2' },
      { id: 't3', title: 'Track 3' },
    ]);
    patchTrackDownload(job.id, 't1', { status: 'done', percent: 100 });
    patchTrackDownload(job.id, 't2', { status: 'downloading', percent: 40 });
    patchTrackDownload(job.id, 't3', { status: 'pending', percent: 0 });

    const next = resetDownloadJobForRetry(job.id);
    expect(next?.tracks.t1?.status).toBe('done');
    expect(next?.tracks.t2?.status).toBe('pending');
    expect(next?.tracks.t3?.status).toBe('pending');
    expect(next?.completedTracks).toBe(1);
    expect(describeDownloadJobResume(next!)).toContain('1 of 3');
  });

  it('lists cold-start paused jobs for auto-resume', () => {
    const job = enqueueDownloadJob({
      label: 'Donda',
      artist: 'Kanye West',
      albumTitle: 'Donda',
      mode: 'album',
      tier: 'best',
      totalTracks: 2,
    });
    initJobTracks(job.id, [
      { id: 't1', title: 'Hurricane' },
      { id: 't2', title: 'Moon' },
    ]);
    patchTrackDownload(job.id, 't1', { status: 'done', percent: 100 });
    patchTrackDownload(job.id, 't2', { status: 'downloading', percent: 12 });
    sessionStorage.clear();
    reconcileOrphanedActiveJobsOnColdStart();
    const needing = listDownloadJobsNeedingResume();
    expect(needing.some((j) => j.albumTitle === 'Donda')).toBe(true);
  });

  it('does not list queued album jobs waiting in serial queue', () => {
    const job = enqueueDownloadJob({
      label: 'Graduation',
      artist: 'Kanye West',
      albumTitle: 'Graduation',
      mode: 'album',
      tier: 'best',
      totalTracks: 2,
    });
    initJobTracks(job.id, [
      { id: 't1', title: 'Good Morning' },
      { id: 't2', title: 'Champion' },
    ]);
    const needing = listDownloadJobsNeedingResume();
    expect(needing.some((j) => j.id === job.id)).toBe(false);
  });

  it('lists queued singles with no track rows for auto-resume', () => {
    const job = enqueueDownloadJob({
      label: 'Walkin',
      artist: 'Denzel Curry',
      mode: 'tracks',
      tier: 'best',
      totalTracks: 1,
    });
    const needing = listDownloadJobsNeedingResume();
    expect(needing.some((j) => j.id === job.id)).toBe(true);
  });

  it('does not revalidate or list actively running jobs for resume', async () => {
    const job = enqueueDownloadJob({
      label: 'Graduation',
      artist: 'Kanye West',
      albumTitle: 'Graduation',
      mode: 'album',
      tier: 'best',
      totalTracks: 2,
    });
    initJobTracks(job.id, [
      { id: 't1', title: 'Good Morning' },
      { id: 't2', title: 'Champion' },
    ]);
    patchTrackDownload(job.id, 't1', { status: 'done', percent: 100 });
    patchTrackDownload(job.id, 't2', { status: 'downloading', percent: 44 });
    patchDownloadJob(job.id, { status: 'downloading' });

    const live = getDownloadJobs().find((j) => j.id === job.id)!;
    expect(isDownloadJobActivelyRunning(live)).toBe(true);
    expect(listDownloadJobsNeedingResume().some((j) => j.id === job.id)).toBe(false);

    await revalidateDownloadQueueAgainstLocker();
    const stillRunning = getDownloadJobs().find((j) => j.id === job.id);
    expect(stillRunning?.status).toBe('downloading');
    expect(stillRunning?.tracks.t1?.status).toBe('done');
    expect(stillRunning?.tracks.t2?.status).toBe('downloading');
  });
});
