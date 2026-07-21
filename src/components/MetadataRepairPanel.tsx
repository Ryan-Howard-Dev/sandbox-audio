import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck, Loader2, Wrench, X } from 'lucide-react';
import { isAirGapEnabled, subscribeAirGap } from '../airGapMode';
import { getLockerEntries, subscribeLockerCache } from '../lockerStorage';
import {
  createMetadataRepairCancelToken,
  METADATA_ISSUE_LABELS,
  MetadataIssueType,
  repairLockerMetadata,
  scanLockerMetadata,
  type MetadataRepairCancelToken,
  type MetadataRepairProgress,
  type MetadataScanReport,
} from '../metadataRepair';
import { scheduleLockerSearchReindex } from '../lockerSearchSync';
import ModalOverlay from '../stations/ModalOverlay';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { C } from '../stations/theme';

export interface MetadataRepairPanelProps {
  /** Modal mode — renders overlay shell. Omit for inline section. */
  modal?: boolean;
  open?: boolean;
  onClose?: () => void;
}

function issueRows(report: MetadataScanReport | null): Array<{ type: MetadataIssueType; count: number }> {
  if (!report) return [];
  return (Object.keys(report.summary) as MetadataIssueType[])
    .map((type) => ({ type, count: report.summary[type] }))
    .filter((row) => row.count > 0);
}

const defaultProgress = (): MetadataRepairProgress => ({
  phase: 'idle',
  scanned: 0,
  total: 0,
  issuesFound: 0,
  repaired: 0,
  failed: 0,
  skippedNetwork: 0,
});

export default function MetadataRepairPanel({
  modal = false,
  open = true,
  onClose,
}: MetadataRepairPanelProps) {
  useDismissableOverlay(modal && open, onClose ?? (() => undefined));

  const [airGap, setAirGap] = useState(isAirGapEnabled);
  const [trackCount, setTrackCount] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [report, setReport] = useState<MetadataScanReport | null>(null);
  const [progress, setProgress] = useState<MetadataRepairProgress>(defaultProgress);
  const cancelRef = useRef<MetadataRepairCancelToken | null>(null);

  const refreshTrackCount = useCallback(() => {
    void getLockerEntries().then((entries) => setTrackCount(entries.length));
  }, []);

  useEffect(() => {
    refreshTrackCount();
    return subscribeLockerCache(refreshTrackCount);
  }, [refreshTrackCount]);

  useEffect(() => subscribeAirGap(setAirGap), []);

  const busy = scanning || repairing;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.scanned / progress.total) * 100)) : 0;

  const runScan = useCallback(async () => {
    setScanning(true);
    setProgress(defaultProgress());
    try {
      const tracks = await getLockerEntries();
      const next = scanLockerMetadata(tracks);
      setReport(next);
      setProgress({
        phase: 'done',
        scanned: next.totalIssues,
        total: next.totalIssues,
        issuesFound: next.totalIssues,
        repaired: 0,
        failed: 0,
        skippedNetwork: 0,
        message:
          next.totalIssues === 0
            ? 'No metadata issues detected.'
            : `Found ${next.totalIssues} issue(s) across ${tracks.length} tracks.`,
      });
    } finally {
      setScanning(false);
    }
  }, []);

  const runRepair = useCallback(async () => {
    const tracks = await getLockerEntries();
    const scan = report ?? scanLockerMetadata(tracks);
    if (!report) setReport(scan);
    if (scan.totalIssues === 0) return;

    cancelRef.current = createMetadataRepairCancelToken();
    setRepairing(true);
    setProgress({
      phase: 'repairing',
      scanned: 0,
      total: scan.totalIssues,
      issuesFound: scan.totalIssues,
      repaired: 0,
      failed: 0,
      skippedNetwork: 0,
      airGapBlocked: airGap,
      message: airGap
        ? 'Air-Gap Mode — network repairs skipped.'
        : 'Repairing metadata in background…',
    });

    try {
      const result = await repairLockerMetadata(
        tracks,
        {
          repairAlbumArt: true,
          repairArtistImages: true,
          repairGenres: true,
          repairReleaseGroups: true,
          repairCredits: true,
        },
        setProgress,
        cancelRef.current,
      );
      setReport(result.report);
      scheduleLockerSearchReindex();
    } finally {
      setRepairing(false);
      cancelRef.current = null;
      refreshTrackCount();
    }
  }, [airGap, report, refreshTrackCount]);

  const cancelRepair = useCallback(() => {
    if (cancelRef.current) cancelRef.current.cancelled = true;
  }, []);

  const summaryRows = useMemo(() => issueRows(report), [report]);

  const body = (
    <div className="metadata-repair-panel space-y-4">
      <div>
        <p className="font-mono text-xs uppercase text-[var(--text)]">Repair Library</p>
        <p className="ui-hint ui-hint--desc metadata-repair-hint mt-1">
          Fetch metadata online — artwork, artist, album, year, and genre from MusicBrainz and the
          catalog. Scans for missing art, wrong artists, and bad tags. Updates IndexedDB only — audio
          files are not re-ingested.
        </p>
        {airGap ? (
          <p className="ui-hint mt-2 text-amber-400/90">
            Air-Gap Mode is on. Network lookups (MusicBrainz, Cover Art Archive, TheAudioDB) are
            skipped; embedded tags and local credit normalization still run.
          </p>
        ) : null}
      </div>

      {trackCount === 0 ? (
        <p className="ui-hint ui-hint--desc metadata-repair-hint text-[var(--text-dim)]">
          No tracks in locker — download music first, or use Repair Locker Audio below for
          orphaned blob recovery.
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy || trackCount === 0}
          onClick={() => void runScan()}
          className="h-9 px-4 rounded btn-accent-outline text-sm font-semibold touch-manipulation flex items-center gap-2 disabled:opacity-50"
        >
          {scanning ? <Loader2 className="w-4 h-4 animate-spin" /> : <ClipboardCheck className="w-4 h-4" />}
          Scan
        </button>
        <button
          type="button"
          disabled={busy || trackCount === 0 || (report?.totalIssues ?? 0) === 0}
          onClick={() => void runRepair()}
          className="h-9 px-4 rounded btn-accent text-sm font-semibold touch-manipulation flex items-center gap-2 disabled:opacity-50"
        >
          {repairing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wrench className="w-4 h-4" />}
          {repairing ? 'Repairing…' : 'Fetch metadata online'}
        </button>
        {repairing ? (
          <button
            type="button"
            onClick={cancelRepair}
            className="h-9 px-4 rounded border text-sm font-semibold touch-manipulation border-[var(--border)] text-[var(--text-mid)]"
          >
            Cancel
          </button>
        ) : null}
        <span className="font-mono text-[10px] text-[var(--text-mid)]">
          {trackCount} track(s) in locker
        </span>
      </div>

      {(busy || progress.phase !== 'idle') && progress.total > 0 ? (
        <div className="space-y-2">
          <div className="h-2 w-full rounded overflow-hidden" style={{ backgroundColor: C.bg }}>
            <div
              className="h-full rounded transition-all"
              style={{
                width: `${pct}%`,
                backgroundColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))',
              }}
            />
          </div>
          <p className="font-mono text-[10px] text-[var(--text-mid)]">
            {progress.currentLabel
              ? `${progress.currentLabel} (${progress.scanned}/${progress.total})`
              : `${progress.scanned}/${progress.total}`}
            {progress.repaired > 0 ? ` · repaired ${progress.repaired}` : ''}
            {progress.failed > 0 ? ` · failed ${progress.failed}` : ''}
            {progress.skippedNetwork > 0 ? ` · skipped (air-gap) ${progress.skippedNetwork}` : ''}
          </p>
        </div>
      ) : null}

      {progress.message ? (
        <p className="font-mono text-xs text-[var(--text-mid)]">{progress.message}</p>
      ) : null}

      {summaryRows.length > 0 ? (
        <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: C.border }}>
          <p className="ui-field-label">Issue summary</p>
          <ul className="space-y-1">
            {summaryRows.map((row) => (
              <li
                key={row.type}
                className="flex justify-between font-mono text-[10px] text-[var(--text-mid)]"
              >
                <span>{METADATA_ISSUE_LABELS[row.type]}</span>
                <span>{row.count}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );

  if (!modal) {
    return body;
  }

  if (!open) return null;

  return (
    <ModalOverlay open={open} onClose={onClose ?? (() => undefined)}>
      <div
        className="metadata-repair-modal w-full max-w-lg rounded-xl border p-5 shadow-xl"
        style={{ backgroundColor: C.card, borderColor: C.border }}
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <h2 className="font-display text-lg font-bold text-[var(--text)]">Repair Library</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-[var(--text-mid)] hover:text-[var(--text)]"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {body}
      </div>
    </ModalOverlay>
  );
}
