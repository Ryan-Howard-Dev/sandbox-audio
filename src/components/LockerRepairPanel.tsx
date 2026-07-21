import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Copy, Loader2, RotateCcw, Wrench } from 'lucide-react';
import {
  recoverLockerVaultAudio,
  repairMetadataOnlyLockerTracks,
  scanMetadataOnlyLockerTracks,
  type MetadataOnlyLockerScan,
} from '../lockerAudioRepair';
import {
  auditLockerVaultHealth,
  getLockerEntries,
  subscribeLockerCache,
  type LockerVaultHealthReport,
} from '../lockerStorage';
import {
  formatDownloadJobErrorsText,
  getDownloadJobs,
  summarizeDownloadJobErrors,
} from '../downloadQueue';
import { C } from '../stations/theme';

export default function LockerRepairPanel() {
  const [trackCount, setTrackCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [report, setReport] = useState<MetadataOnlyLockerScan | null>(null);
  const [health, setHealth] = useState<LockerVaultHealthReport | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const copyDownloadErrors = useCallback(() => {
    const text = formatDownloadJobErrorsText(getDownloadJobs());
    const errors = summarizeDownloadJobErrors();
    void navigator.clipboard?.writeText(text).then(() => {
      setCopyHint(
        errors.length > 0
          ? `Copied ${errors.length} download error(s) to clipboard.`
          : 'No download errors in queue — copied status line.',
      );
    }).catch(() => setCopyHint('Could not copy to clipboard.'));
  }, []);

  const refreshTrackCount = useCallback(() => {
    void getLockerEntries().then((entries) => setTrackCount(entries.length));
    void auditLockerVaultHealth().then(setHealth).catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    refreshTrackCount();
    return subscribeLockerCache(refreshTrackCount);
  }, [refreshTrackCount]);

  const busy = scanning || recovering || repairing;
  const preview = useMemo(() => (report?.issues ?? []).slice(0, 12), [report]);
  const orphanedBlobs = health?.orphanedBlobs ?? 0;
  const blobStoreKeys = health?.blobStoreKeys ?? 0;
  const canRecoverOrphans = blobStoreKeys > 0 || trackCount > 0;

  const runScan = useCallback(async () => {
    setScanning(true);
    setLastAction(null);
    try {
      const [next, vaultHealth] = await Promise.all([
        scanMetadataOnlyLockerTracks(),
        auditLockerVaultHealth(),
      ]);
      setReport(next);
      setHealth(vaultHealth);
    } finally {
      setScanning(false);
    }
  }, []);

  const runRecover = useCallback(async () => {
    setRecovering(true);
    setLastAction(null);
    try {
      const result = await recoverLockerVaultAudio();
      const next = await scanMetadataOnlyLockerTracks();
      setReport(next);
      setHealth(result.health);
      setLastAction(
        `Recovered ${result.recoveredBlobs} orphaned blob row(s). ` +
          `Warmed ${result.warmed} native cache entr${result.warmed === 1 ? 'y' : 'ies'}. ` +
          `${result.health.playableTracks} playable · ${result.health.healableTracks} healable · ` +
          `${result.health.metadataOnlyTracks} metadata-only · ` +
          `${result.health.orphanedBlobs} orphaned blob(s) in store.`,
      );
      refreshTrackCount();
    } finally {
      setRecovering(false);
    }
  }, [refreshTrackCount]);

  const runRepair = useCallback(async () => {
    setRepairing(true);
    setLastAction(null);
    try {
      const result = await repairMetadataOnlyLockerTracks({ repairCovers: true });
      const next = await scanMetadataOnlyLockerTracks();
      setReport(next);
      setHealth(result.health);
      setLastAction(
        `Recovered ${result.recoveredBlobs} blob(s). ` +
          `No locker rows were deleted. ` +
          `${result.health.playableTracks} playable · ${result.health.healableTracks} healable · ` +
          `${result.health.metadataOnlyTracks} still need re-download. ` +
          (result.playlistsRepaired > 0
            ? `Repaired ${result.playlistsRepaired} playlist reference(s).`
            : 'Playlist references checked.'),
      );
      refreshTrackCount();
    } finally {
      setRepairing(false);
    }
  }, [refreshTrackCount]);

  return (
    <div className="locker-repair-panel space-y-4 rounded border border-[var(--border)] p-4">
      <div>
        <p className="font-mono text-xs uppercase text-[var(--text)]">Repair Locker Audio</p>
        <p className="ui-hint ui-hint--desc locker-repair-hint mt-1">
          Your locker is never auto-cleaned — this app will not delete your downloads. Scan lists
          tracks missing playable audio. Recover re-links orphaned IDB blobs and warms the native
          cache. Heal & warm retries recovery without removing any rows — re-download from Browse
          if audio bytes are gone from this device.
        </p>
      </div>

      {health ? (
        <p className="text-sm" style={{ color: C.textMid }}>
          {health.trackRows} locker row(s) · {health.blobStoreKeys} blob key(s) ·{' '}
          {health.playableTracks} playable · {health.healableTracks} healable ·{' '}
          {health.metadataOnlyTracks} metadata-only
          {orphanedBlobs > 0 ? ` · ${orphanedBlobs} orphaned blob(s) recoverable` : ''}
        </p>
      ) : (
        <p className="ui-hint ui-hint--desc locker-repair-hint">Checking locker blob store…</p>
      )}

      {trackCount === 0 && blobStoreKeys > 0 ? (
        <p className="ui-hint ui-hint--desc locker-repair-hint text-amber-400/90">
          Locker metadata shows 0 tracks, but {blobStoreKeys} audio blob
          {blobStoreKeys === 1 ? '' : 's'} remain in storage
          {orphanedBlobs > 0 ? ` (${orphanedBlobs} orphaned)` : ''}. Use Scan, then Recover blobs.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void runScan()}
          className="h-9 px-4 rounded btn-accent-outline text-sm font-semibold touch-manipulation flex items-center gap-2 disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <AlertTriangle className="w-4 h-4" />}
          Scan
        </button>
        <button
          type="button"
          disabled={busy || !canRecoverOrphans}
          onClick={() => void runRecover()}
          className="h-9 px-4 rounded btn-accent-outline text-sm font-semibold touch-manipulation flex items-center gap-2 disabled:opacity-50"
          title={
            canRecoverOrphans
              ? undefined
              : 'No locker rows or blob-store keys found on this device.'
          }
        >
          {recovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
          Recover blobs
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void runRepair()}
          className="h-9 px-4 rounded btn-accent text-sm font-semibold touch-manipulation flex items-center gap-2 disabled:opacity-50"
        >
          {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          Heal & warm
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={copyDownloadErrors}
          className="h-9 px-4 rounded border text-sm font-semibold touch-manipulation flex items-center gap-2 border-[var(--border)] text-[var(--text-mid)] hover:border-[var(--orange)] hover:text-accent disabled:opacity-50"
        >
          <Copy className="w-4 h-4" />
          Copy download errors
        </button>
      </div>

      {report ? (
        <div className="space-y-2 text-sm" style={{ color: C.textMid }}>
          <p>
            {report.playableTracks} playable · {report.metadataOnlyCount} metadata-only
            {report.duplicateMetadataOnlyCount > 0
              ? ` (${report.duplicateMetadataOnlyCount} duplicate${report.duplicateMetadataOnlyCount === 1 ? '' : 's'})`
              : ''}
          </p>
          {preview.length > 0 ? (
            <ul className="max-h-48 overflow-y-auto space-y-1 font-mono text-[10px]">
              {preview.map((row) => (
                <li key={row.id} className="truncate">
                  {row.title} — {row.artist}
                  {row.albumName ? ` · ${row.albumName}` : ''}
                  {row.hasPlayableSibling ? ' · duplicate' : ' · no audio'}
                </li>
              ))}
              {report.issues.length > preview.length ? (
                <li className="text-[var(--text-dim)]">
                  +{report.issues.length - preview.length} more…
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="text-emerald-400/90">No metadata-only locker rows detected.</p>
          )}
        </div>
      ) : null}

      {copyHint ? <p className="ui-hint text-[10px]">{copyHint}</p> : null}

      {lastAction ? <p className="ui-hint text-emerald-400/90">{lastAction}</p> : null}

      <p className="ui-hint text-[10px] flex items-start gap-1.5">
        <Wrench className="w-3 h-3 shrink-0 mt-0.5" />
        If audio bytes were wiped by the OS or an older build, Recover cannot invent them — re-download
        from Browse. Track rows stay in your library until you delete them yourself.
      </p>
    </div>
  );
}
