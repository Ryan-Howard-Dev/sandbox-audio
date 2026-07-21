import React from 'react';
import type { LockerSyncProgressDetail } from '../../lockerSyncProgress';

export interface LockerSyncProgressBarProps {
  progress: LockerSyncProgressDetail;
  label?: string;
}

export default function LockerSyncProgressBar({ progress, label }: LockerSyncProgressBarProps) {
  if (!progress.active) return null;

  const pct =
    progress.total > 0
      ? Math.min(100, Math.round((progress.current / progress.total) * 100))
      : undefined;

  return (
    <div className="locker-sync-progress" role="status" aria-live="polite">
      <div className="locker-sync-progress-label">
        {label ?? progress.label ?? 'Syncing…'}
        {progress.total > 0 ? (
          <span className="locker-sync-progress-count">
            {progress.current}/{progress.total}
          </span>
        ) : null}
      </div>
      <div className="locker-sync-progress-track" aria-hidden>
        <div
          className={`locker-sync-progress-fill${pct == null ? ' locker-sync-progress-fill--indeterminate' : ''}`}
          style={pct != null ? { width: `${pct}%` } : undefined}
        />
      </div>
    </div>
  );
}
