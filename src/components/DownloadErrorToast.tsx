import React, { useEffect, useState } from 'react';
import { AlertCircle, Copy, RotateCcw, X } from 'lucide-react';
import { retryDownloadJob } from '../acquisitionPipeline';
import {
  clearFinishedDownloadJobs,
  getDownloadJobs,
  subscribeDownloadQueue,
  type DownloadJob,
} from '../downloadQueue';

function copyErrorText(text: string): void {
  void navigator.clipboard?.writeText(text).catch(() => {
    /* fallback ignored */
  });
}

export default function DownloadErrorToast({ hidden = false }: { hidden?: boolean }) {
  const [jobs, setJobs] = useState<DownloadJob[]>(() => getDownloadJobs());
  const [retryingId, setRetryingId] = useState<string | null>(null);

  useEffect(() => subscribeDownloadQueue(() => setJobs(getDownloadJobs())), []);

  const errors = jobs.filter((j) => j.status === 'error').slice(0, 2);
  if (hidden || errors.length === 0) return null;

  return (
    <div className="download-error-toast" role="alert" aria-live="assertive">
      <ul className="download-error-toast-list">
        {errors.map((job) => {
          const errorText = job.error ?? 'Download failed';
          return (
            <li key={job.id} className="download-error-toast-item">
              <AlertCircle className="w-4 h-4 shrink-0 text-[var(--danger)]" />
              <div className="min-w-0 flex-1">
                <p className="download-error-toast-label truncate">{job.label}</p>
                <p className="download-error-toast-meta truncate">{errorText}</p>
              </div>
              <div className="download-error-toast-actions shrink-0 flex items-center gap-1">
                <button
                  type="button"
                  className="download-error-toast-action"
                  disabled={retryingId === job.id}
                  onClick={() => {
                    setRetryingId(job.id);
                    void retryDownloadJob(job.id).finally(() => setRetryingId(null));
                  }}
                  aria-label={`Retry download for ${job.label}`}
                  title="Retry"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${retryingId === job.id ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  className="download-error-toast-action"
                  onClick={() => copyErrorText(errorText)}
                  aria-label="Copy error message"
                  title="Copy error"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        className="download-error-toast-dismiss"
        onClick={() => clearFinishedDownloadJobs()}
        aria-label="Dismiss download errors"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
