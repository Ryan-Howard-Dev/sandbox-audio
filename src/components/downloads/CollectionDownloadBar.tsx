import React from 'react';
import { useDownloadJobs } from '../../hooks/useDownloadJobs';
import {
  selectCollectionDownloadProgress,
  type CollectionDownloadTarget,
} from '../../downloadProgressView';

export interface CollectionDownloadBarProps extends CollectionDownloadTarget {
  /** Album / playlist name, for the screen-reader label. */
  label?: string;
}

/**
 * Download progress for the collection being viewed, pinned to the top of its page.
 * Renders nothing unless that collection is actually downloading, so it costs no layout
 * the rest of the time.
 */
export default function CollectionDownloadBar({
  albumId,
  playlistId,
  label,
}: CollectionDownloadBarProps) {
  const jobs = useDownloadJobs();
  const progress = selectCollectionDownloadProgress(jobs, { albumId, playlistId });
  if (!progress?.active) return null;

  const detail =
    progress.total > 0
      ? `${progress.completed} of ${progress.total}${progress.failed > 0 ? ` · ${progress.failed} failed` : ''}`
      : null;

  return (
    <div
      className="collection-download-bar"
      role="progressbar"
      aria-valuenow={progress.percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ? `Downloading ${label}` : 'Downloading'}
    >
      <div className="collection-download-bar-track">
        <span
          className="collection-download-bar-fill"
          style={{ width: `${progress.percent}%` }}
        />
      </div>
      <div className="collection-download-bar-meta">
        <span>Downloading</span>
        {detail ? <span className="collection-download-bar-detail">{detail}</span> : null}
      </div>
    </div>
  );
}
