import { useSyncExternalStore } from 'react';
import { getDownloadJobs, subscribeDownloadQueue, type DownloadJob } from '../downloadQueue';

/**
 * Live download queue for inline progress UI. The queue replaces its jobs array on every
 * mutation, so reference equality is a valid snapshot check here.
 */
export function useDownloadJobs(): DownloadJob[] {
  return useSyncExternalStore(subscribeDownloadQueue, getDownloadJobs, getDownloadJobs);
}
