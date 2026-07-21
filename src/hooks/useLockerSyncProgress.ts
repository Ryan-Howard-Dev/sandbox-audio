import { useEffect, useState } from 'react';
import {
  LOCKER_SYNC_PROGRESS_EVENT,
  LOCKER_SYNC_STARTED_EVENT,
  lockerSyncProgressIdle,
  type LockerSyncProgressDetail,
} from '../lockerSyncProgress';

export function useLockerSyncProgress(): LockerSyncProgressDetail {
  const [progress, setProgress] = useState<LockerSyncProgressDetail>(() =>
    lockerSyncProgressIdle(),
  );

  useEffect(() => {
    const onStarted = (e: Event) => {
      const label = (e as CustomEvent<{ label?: string }>).detail?.label;
      setProgress({
        phase: 'manifest',
        current: 0,
        total: 0,
        label,
        active: true,
      });
    };
    const onProgress = (e: Event) => {
      const detail = (e as CustomEvent<LockerSyncProgressDetail>).detail;
      if (detail) setProgress(detail);
    };
    window.addEventListener(LOCKER_SYNC_STARTED_EVENT, onStarted);
    window.addEventListener(LOCKER_SYNC_PROGRESS_EVENT, onProgress);
    return () => {
      window.removeEventListener(LOCKER_SYNC_STARTED_EVENT, onStarted);
      window.removeEventListener(LOCKER_SYNC_PROGRESS_EVENT, onProgress);
    };
  }, []);

  return progress;
}
