/**
 * Acquire job progress — Android notification shade + desktop toast/banner.
 */

import type { DownloadJob } from './downloadQueue';

const ACQUIRE_TOAST_EVENT = 'sandbox-acquire-progress-toast';
const activeJobs = new Map<string, DownloadJob>();

export type AcquireProgressToastDetail = {
  jobId: string;
  label: string;
  artist: string;
  progress: number;
  status: DownloadJob['status'];
  done: boolean;
  error?: string;
};

function statusLabel(job: DownloadJob): string {
  if (job.status === 'done') return 'Saved to locker';
  if (job.status === 'error') return job.error ?? 'Acquire failed';
  if (job.status === 'resolving') return 'Finding source…';
  if (job.status === 'metadata') return 'Identifying audio (AcoustID)…';
  if (job.currentTrack) return job.currentTrack;
  return 'Downloading…';
}

function dispatchToast(detail: AcquireProgressToastDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ACQUIRE_TOAST_EVENT, { detail }));
}

export function subscribeAcquireProgressToast(
  handler: (detail: AcquireProgressToastDetail) => void,
): () => void {
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<AcquireProgressToastDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(ACQUIRE_TOAST_EVENT, listener);
  return () => window.removeEventListener(ACQUIRE_TOAST_EVENT, listener);
}

export function notifyAcquireProgress(job: DownloadJob): void {
  activeJobs.set(job.id, job);
  const done = job.status === 'done' || job.status === 'error';
  const detail: AcquireProgressToastDetail = {
    jobId: job.id,
    label: job.label,
    artist: job.artist,
    progress: job.progress,
    status: job.status,
    done,
    error: job.error,
  };
  dispatchToast(detail);
}

export function dismissAcquireProgress(jobId: string): void {
  activeJobs.delete(jobId);
  dispatchToast({
    jobId,
    label: '',
    artist: '',
    progress: 100,
    status: 'done',
    done: true,
  });
}

export function getActiveAcquireJobs(): DownloadJob[] {
  return [...activeJobs.values()].filter((j) => j.status !== 'done' && j.status !== 'error');
}
