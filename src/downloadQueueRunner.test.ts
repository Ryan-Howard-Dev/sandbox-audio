import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueDownloadJob,
  getDownloadJobs,
  patchDownloadJob,
} from './downloadQueue';
import { drainDownloadQueue, resetDownloadQueueRunnerStateForTests, scheduleDownloadJob } from './downloadQueueRunner';

describe('downloadQueueRunner', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDownloadQueueRunnerStateForTests();
    vi.restoreAllMocks();
  });

  it('runs one job at a time and leaves the second queued', async () => {
    const order: string[] = [];

    const jobA = enqueueDownloadJob({
      label: 'Album A',
      artist: 'Artist',
      albumTitle: 'Album A',
      mode: 'album',
      tier: 'best',
      totalTracks: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    const jobB = enqueueDownloadJob({
      label: 'Album B',
      artist: 'Artist',
      albumTitle: 'Album B',
      mode: 'album',
      tier: 'best',
      totalTracks: 1,
    });

    scheduleDownloadJob(jobA.id, async () => {
      order.push('A-start');
      patchDownloadJob(jobA.id, { status: 'downloading' });
      await new Promise((r) => setTimeout(r, 20));
      patchDownloadJob(jobA.id, { status: 'done', progress: 100 });
      order.push('A-done');
    });
    scheduleDownloadJob(jobB.id, async () => {
      order.push('B-start');
      patchDownloadJob(jobB.id, { status: 'done', progress: 100 });
      order.push('B-done');
    });

    void drainDownloadQueue();
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual(['A-start']);
    expect(getDownloadJobs().find((j) => j.id === jobB.id)?.status).toBe('queued');

    await new Promise((r) => setTimeout(r, 40));
    expect(order).toEqual(['A-start', 'A-done', 'B-start', 'B-done']);
  });

  it('does not spin when a queued job has no in-memory runner', async () => {
    const acquisition = await import('./acquisitionPipeline');
    const resumeSpy = vi
      .spyOn(acquisition, 'resumeOrphanQueuedDownloadJob')
      .mockResolvedValue(undefined);

    const orphan = enqueueDownloadJob({
      label: 'Orphan',
      artist: 'Artist',
      mode: 'tracks',
      tier: 'best',
      totalTracks: 1,
    });

    await drainDownloadQueue();
    expect(resumeSpy).toHaveBeenCalledWith(orphan.id);
    expect(getDownloadJobs().find((j) => j.id === orphan.id)?.status).toBe('queued');
  });
});
