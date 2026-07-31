import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enqueueDownloadJob,
  getDownloadJobs,
  patchDownloadJob,
} from './downloadQueue';
import { drainDownloadQueue, resetDownloadQueueRunnerStateForTests, scheduleDownloadJob } from './downloadQueueRunner';

/**
 * Wait for a condition instead of for a duration.
 *
 * The version of this test that slept fixed amounts was the suite's one flaky case: it asserted
 * the queue state 10ms in while job A slept 20ms, so on a loaded machine the two crossed and the
 * assertion saw a job it expected to still be running. Timing out here is a real failure, not a
 * slow machine, because the job it waits on is released by the test itself.
 */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

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
    const jobB = enqueueDownloadJob({
      label: 'Album B',
      artist: 'Artist',
      albumTitle: 'Album B',
      mode: 'album',
      tier: 'best',
      totalTracks: 1,
    });

    // Job A blocks until the test releases it, so "is B still queued?" is a question about the
    // runner rather than about how fast the machine got through a sleep.
    let releaseA = () => {};
    const aHeld = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    scheduleDownloadJob(jobA.id, async () => {
      order.push('A-start');
      patchDownloadJob(jobA.id, { status: 'downloading' });
      await aHeld;
      patchDownloadJob(jobA.id, { status: 'done', progress: 100 });
      order.push('A-done');
    });
    scheduleDownloadJob(jobB.id, async () => {
      order.push('B-start');
      patchDownloadJob(jobB.id, { status: 'done', progress: 100 });
      order.push('B-done');
    });

    const drained = drainDownloadQueue();

    await waitFor(() => order.includes('A-start'));
    // A cannot progress, so this is now a statement about concurrency, not about elapsed time.
    expect(order).toEqual(['A-start']);
    expect(getDownloadJobs().find((j) => j.id === jobB.id)?.status).toBe('queued');

    releaseA();
    await waitFor(() => order.includes('B-done'));
    await drained;
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
