import { useCallback, useEffect, useState } from 'react';
import {
  LOCKER_SYNC_CONFLICTS_EVENT,
  loadLockerSyncConflicts,
  type LockerMetadataConflict,
} from '../lockerSyncConflicts';
import { resolveLockerMetadataConflict } from '../lockerSync';

type LockerSyncConflictsPanelProps = {
  className?: string;
};

/** Resolve metadata conflicts when two devices edited the same locker track. */
export default function LockerSyncConflictsPanel({ className = '' }: LockerSyncConflictsPanelProps) {
  const [conflicts, setConflicts] = useState<LockerMetadataConflict[]>(() =>
    loadLockerSyncConflicts(),
  );
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () => setConflicts(loadLockerSyncConflicts());
    refresh();
    window.addEventListener(LOCKER_SYNC_CONFLICTS_EVENT, refresh);
    return () => window.removeEventListener(LOCKER_SYNC_CONFLICTS_EVENT, refresh);
  }, []);

  const resolve = useCallback(async (trackId: string, choice: 'local' | 'remote') => {
    setBusyId(trackId);
    try {
      await resolveLockerMetadataConflict(trackId, choice);
      setConflicts(loadLockerSyncConflicts());
    } finally {
      setBusyId(null);
    }
  }, []);

  if (conflicts.length === 0) return null;

  return (
    <div
      className={`rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 space-y-3 ${className}`}
      data-testid="locker-sync-conflicts"
    >
      <div>
        <p className="font-mono text-xs font-semibold uppercase text-[var(--text)]">
          Sync conflicts ({conflicts.length})
        </p>
        <p className="ui-hint ui-hint--desc mt-1">
          The same track was edited on another device. Choose which metadata to keep.
        </p>
      </div>
      <ul className="space-y-3">
        {conflicts.map((c) => (
          <li key={c.trackId} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
            <p className="font-mono text-xs text-[var(--text-dim)]">Track id: {c.trackId}</p>
            <div className="grid gap-2 sm:grid-cols-2 text-sm">
              <div>
                <p className="font-mono text-[10px] uppercase text-[var(--text-dim)]">This device</p>
                <p className="text-[var(--text)]">{c.localTitle}</p>
                <p className="text-[var(--text-dim)]">{c.localArtist}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase text-[var(--text-dim)]">Remote</p>
                <p className="text-[var(--text)]">{c.remoteTitle}</p>
                <p className="text-[var(--text-dim)]">{c.remoteArtist}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busyId === c.trackId}
                className="font-mono text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] hover:bg-[var(--surface)]"
                onClick={() => void resolve(c.trackId, 'local')}
              >
                Keep this device
              </button>
              <button
                type="button"
                disabled={busyId === c.trackId}
                className="font-mono text-xs px-3 py-1.5 rounded-lg border border-accent text-accent hover:bg-accent/10"
                onClick={() => void resolve(c.trackId, 'remote')}
              >
                Use remote
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
