export type LockerSyncProgressPhase = 'manifest' | 'blobs' | 'done';

export type LockerSyncProgressDetail = {
  phase: LockerSyncProgressPhase;
  current: number;
  total: number;
  label?: string;
  active: boolean;
};

export const LOCKER_SYNC_PROGRESS_EVENT = 'sandbox-locker-sync-progress';
export const LOCKER_SYNC_STARTED_EVENT = 'sandbox-locker-sync-started';

const IDLE: LockerSyncProgressDetail = {
  phase: 'done',
  current: 0,
  total: 0,
  active: false,
};

export function dispatchLockerSyncStarted(label?: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(LOCKER_SYNC_STARTED_EVENT, {
      detail: { label: label ?? 'Syncing library…' },
    }),
  );
}

export function dispatchLockerSyncProgress(detail: Omit<LockerSyncProgressDetail, 'active'>): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(LOCKER_SYNC_PROGRESS_EVENT, {
      detail: { ...detail, active: detail.phase !== 'done' },
    }),
  );
}

export function dispatchLockerSyncIdle(): void {
  dispatchLockerSyncProgress({ phase: 'done', current: 0, total: 0 });
}

export function lockerSyncProgressIdle(): LockerSyncProgressDetail {
  return IDLE;
}
