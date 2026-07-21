import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, Copy, Loader2, RotateCcw, X, Clock, PauseCircle } from 'lucide-react';
import { retryDownloadJob } from '../acquisitionPipeline';
import { scanAndQueueIncompleteAlbumDownloads } from '../lockerAlbumCompletion';
import {
  clearFinishedDownloadJobs,
  describeDownloadJobResume,
  formatDownloadJobDisplay,
  formatDownloadJobErrorDetail,
  getDownloadJobs,
  removeDownloadJob,
  subscribeDownloadQueue,
  type DownloadJob,
} from '../downloadQueue';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { useTranslation } from '../i18n';

export function countDownloadSheetBadge(jobs: DownloadJob[]): number {
  return jobs.filter(
    (j) =>
      j.status === 'error' ||
      j.status === 'queued' ||
      j.status === 'paused' ||
      j.status === 'resolving' ||
      j.status === 'downloading' ||
      j.status === 'metadata',
  ).length;
}

function isActiveJob(job: DownloadJob): boolean {
  return (
    job.status === 'queued' ||
    job.status === 'paused' ||
    job.status === 'resolving' ||
    job.status === 'downloading' ||
    job.status === 'metadata'
  );
}

function jobStatusIcon(job: DownloadJob) {
  if (job.status === 'queued') {
    return <Clock className="w-4 h-4 shrink-0 text-[var(--text-dim)]" />;
  }
  if (job.status === 'paused') {
    return <PauseCircle className="w-4 h-4 shrink-0 text-amber-400" />;
  }
  return <Loader2 className="w-4 h-4 shrink-0 animate-spin text-accent" />;
}

function copyErrorText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
}

function canOpenDownloadJob(job: DownloadJob): boolean {
  if (job.mode === 'album' && (job.albumTitle?.trim() || job.label.trim())) return true;
  if (job.mode === 'tracks' && job.totalTracks <= 1 && job.label.trim()) return true;
  if (job.albumTitle?.trim()) return true;
  return false;
}

export interface DownloadActivitySheetProps {
  open: boolean;
  onClose: () => void;
  onOpenJob?: (job: DownloadJob) => void;
}

export default function DownloadActivitySheet({
  open,
  onClose,
  onOpenJob,
}: DownloadActivitySheetProps) {
  const { t } = useTranslation();
  const [jobs, setJobs] = useState<DownloadJob[]>(() => getDownloadJobs());
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useDismissableOverlay(open, onClose);

  useEffect(() => subscribeDownloadQueue(() => setJobs(getDownloadJobs())), []);

  useEffect(() => {
    if (!open) return;
    void scanAndQueueIncompleteAlbumDownloads();
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const active = jobs.filter(isActiveJob);
  const errors = jobs.filter((j) => j.status === 'error');
  const done = jobs
    .filter((j) => j.status === 'done')
    .slice()
    .sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))
    .slice(0, 12);
  const empty = active.length === 0 && errors.length === 0 && done.length === 0;

  const handleOpenJob = (job: DownloadJob) => {
    if (!onOpenJob || !canOpenDownloadJob(job)) return;
    onOpenJob(job);
  };

  return createPortal(
    <div
      className="download-activity-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-activity-sheet-title"
      data-testid="download-activity-sheet"
    >
      <button
        type="button"
        className="download-activity-sheet-backdrop"
        aria-label={t('download.activity.close')}
        onClick={onClose}
      />
      <div className="download-activity-sheet-panel" onClick={(e) => e.stopPropagation()}>
        <div className="download-activity-sheet-handle" aria-hidden />
        <header className="download-activity-sheet-head">
          <div className="min-w-0">
            <p className="download-activity-sheet-eyebrow">{t('download.activity.eyebrow')}</p>
            <h2 id="download-activity-sheet-title" className="download-activity-sheet-title">
              {t('download.activity.title')}
            </h2>
          </div>
          <button
            type="button"
            className="download-activity-sheet-close touch-manipulation"
            onClick={onClose}
            aria-label={t('download.activity.close')}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {empty ? (
          <p className="download-activity-sheet-empty">{t('download.activity.empty')}</p>
        ) : (
          <div className="download-activity-sheet-sections">
            {active.length > 0 ? (
              <section>
                <h3 className="download-activity-sheet-section-label">
                  {t('download.activity.inProgress')}
                </h3>
                <ul className="download-activity-sheet-list">
                  {active.map((job) => {
                    const display = formatDownloadJobDisplay(job);
                    const openable = Boolean(onOpenJob && canOpenDownloadJob(job));
                    return (
                      <li
                        key={job.id}
                        className={`download-activity-sheet-item${openable ? ' download-activity-sheet-item--tappable' : ''}`}
                      >
                        {jobStatusIcon(job)}
                        {openable ? (
                          <button
                            type="button"
                            className="download-activity-sheet-body touch-manipulation"
                            onClick={() => handleOpenJob(job)}
                            aria-label={t('download.activity.openRelease', { title: display.title })}
                          >
                            <p className="download-activity-sheet-label truncate">{display.title}</p>
                            <p className="download-activity-sheet-meta truncate">
                              {display.statusLine}
                              {' · '}
                              {t('download.activity.percent', { percent: display.progressPercent })}
                            </p>
                            {display.detailLine ? (
                              <p className="download-activity-sheet-detail truncate">{display.detailLine}</p>
                            ) : null}
                            <div className="download-activity-sheet-bar" aria-hidden>
                              <div
                                className="download-activity-sheet-bar-fill"
                                style={{ width: `${Math.max(4, display.progressPercent)}%` }}
                              />
                            </div>
                          </button>
                        ) : (
                          <div className="download-activity-sheet-body min-w-0 flex-1">
                            <p className="download-activity-sheet-label truncate">{display.title}</p>
                            <p className="download-activity-sheet-meta truncate">
                              {display.statusLine}
                              {' · '}
                              {t('download.activity.percent', { percent: display.progressPercent })}
                            </p>
                            {display.detailLine ? (
                              <p className="download-activity-sheet-detail truncate">{display.detailLine}</p>
                            ) : null}
                            <div className="download-activity-sheet-bar" aria-hidden>
                              <div
                                className="download-activity-sheet-bar-fill"
                                style={{ width: `${Math.max(4, display.progressPercent)}%` }}
                              />
                            </div>
                          </div>
                        )}
                        <div className="download-activity-sheet-actions shrink-0 flex items-center gap-1">
                          <button
                            type="button"
                            className="download-activity-sheet-action"
                            onClick={() => removeDownloadJob(job.id)}
                            aria-label={t('download.activity.dismiss', { label: display.title })}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {done.length > 0 ? (
              <section>
                <h3 className="download-activity-sheet-section-label">
                  Completed
                </h3>
                <ul className="download-activity-sheet-list">
                  {done.map((job) => {
                    const display = formatDownloadJobDisplay(job);
                    const openable = Boolean(onOpenJob) && canOpenDownloadJob(job);
                    return (
                      <li
                        key={job.id}
                        className={`download-activity-sheet-item${openable ? ' download-activity-sheet-item--tappable' : ''}`}
                      >
                        {openable ? (
                          <button
                            type="button"
                            className="download-activity-sheet-body touch-manipulation"
                            onClick={() => handleOpenJob(job)}
                          >
                            <p className="download-activity-sheet-label truncate">{display.title}</p>
                            <p className="download-activity-sheet-meta truncate">
                              {job.artist?.trim() || display.statusLine}
                            </p>
                          </button>
                        ) : (
                          <div className="download-activity-sheet-body min-w-0 flex-1">
                            <p className="download-activity-sheet-label truncate">{display.title}</p>
                            <p className="download-activity-sheet-meta truncate">
                              {job.artist?.trim() || display.statusLine}
                            </p>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {errors.length > 0 ? (
              <section>
                <h3 className="download-activity-sheet-section-label">
                  {t('download.activity.needsAttention')}
                </h3>
                <ul className="download-activity-sheet-list">
                  {errors.map((job) => {
                    const display = formatDownloadJobDisplay(job);
                    const errorText = formatDownloadJobErrorDetail(job);
                    const resumeHint = describeDownloadJobResume(job);
                    const openable = Boolean(onOpenJob && canOpenDownloadJob(job));
                    return (
                      <li
                        key={job.id}
                        className={`download-activity-sheet-item download-activity-sheet-item--error${openable ? ' download-activity-sheet-item--tappable' : ''}`}
                      >
                        <AlertCircle className="w-4 h-4 shrink-0 text-[var(--danger)]" />
                        {openable ? (
                          <button
                            type="button"
                            className="download-activity-sheet-body touch-manipulation"
                            onClick={() => handleOpenJob(job)}
                            aria-label={t('download.activity.openRelease', { title: display.title })}
                          >
                            <p className="download-activity-sheet-label truncate">{display.title}</p>
                            <p className="download-activity-sheet-meta download-activity-sheet-meta--error" title={errorText}>
                              {errorText}
                            </p>
                            {resumeHint ? (
                              <p className="download-activity-sheet-meta truncate text-accent/90">
                                {resumeHint}
                              </p>
                            ) : null}
                          </button>
                        ) : (
                          <div className="download-activity-sheet-body min-w-0 flex-1">
                            <p className="download-activity-sheet-label truncate">{display.title}</p>
                            <p className="download-activity-sheet-meta download-activity-sheet-meta--error" title={errorText}>
                              {errorText}
                            </p>
                            {resumeHint ? (
                              <p className="download-activity-sheet-meta truncate text-accent/90">
                                {resumeHint}
                              </p>
                            ) : null}
                          </div>
                        )}
                        <div className="download-activity-sheet-actions shrink-0 flex items-center gap-1">
                          <button
                            type="button"
                            className="download-activity-sheet-action"
                            disabled={retryingId === job.id}
                            onClick={() => {
                              setRetryingId(job.id);
                              void retryDownloadJob(job.id).finally(() => setRetryingId(null));
                            }}
                            aria-label={t('download.activity.retry', { label: display.title })}
                          >
                            <RotateCcw
                              className={`w-3.5 h-3.5 ${retryingId === job.id ? 'animate-spin' : ''}`}
                            />
                          </button>
                          <button
                            type="button"
                            className="download-activity-sheet-action"
                            onClick={() => copyErrorText(errorText)}
                            aria-label={t('download.activity.copyError')}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            className="download-activity-sheet-action"
                            onClick={() => removeDownloadJob(job.id)}
                            aria-label={t('download.activity.dismiss', { label: display.title })}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
          </div>
        )}

        {errors.length > 0 ? (
          <footer className="download-activity-sheet-footer">
            <button
              type="button"
              className="download-activity-sheet-clear touch-manipulation"
              onClick={() => clearFinishedDownloadJobs()}
            >
              {t('download.activity.clearAll')}
            </button>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
