import React from 'react';
import { AlertCircle, ArrowDownCircle, Check } from 'lucide-react';
import { useDownloadJobs } from '../../hooks/useDownloadJobs';
import {
  isTrackDownloadInFlight,
  selectTrackDownloadState,
  type TrackDownloadLookup,
} from '../../downloadProgressView';

export interface TrackDownloadProgressProps extends TrackDownloadLookup {
  /** Show the finished tick. Off for lists that already mark downloaded rows. */
  showDone?: boolean;
}

/**
 * Per-track download state, rendered beside the row it belongs to. A ring that fills as the
 * track downloads answers "is this one coming?" where a global activity list cannot.
 */
export default function TrackDownloadProgress({
  trackId,
  title,
  showDone = false,
}: TrackDownloadProgressProps) {
  const jobs = useDownloadJobs();
  const state = selectTrackDownloadState(jobs, { trackId, title });
  if (!state) return null;

  if (state.status === 'error') {
    return (
      <span className="track-download-chip track-download-chip--error" title={state.errorMessage}>
        <AlertCircle className="w-3.5 h-3.5" aria-hidden />
        <span className="sr-only">Download failed</span>
      </span>
    );
  }

  if (state.status === 'done' || state.status === 'skipped') {
    if (!showDone) return null;
    return (
      <span className="track-download-chip track-download-chip--done">
        <Check className="w-3.5 h-3.5" aria-hidden />
        <span className="sr-only">Downloaded</span>
      </span>
    );
  }

  if (!isTrackDownloadInFlight(state)) return null;

  // 'resolving' has no meaningful byte count yet, so show the icon rather than a fake 0%.
  const percent = state.status === 'downloading' ? Math.max(0, Math.min(100, state.percent)) : null;

  return (
    <span
      className="track-download-chip track-download-chip--active"
      role="progressbar"
      aria-valuenow={percent ?? undefined}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Downloading ${state.title || 'track'}`}
    >
      {percent === null ? (
        <ArrowDownCircle className="w-3.5 h-3.5 animate-pulse" aria-hidden />
      ) : (
        <>
          <span
            className="track-download-chip-ring"
            style={{ ['--dl-pct' as string]: `${percent}%` }}
            aria-hidden
          />
          <span className="track-download-chip-pct">{percent}%</span>
        </>
      )}
    </span>
  );
}
