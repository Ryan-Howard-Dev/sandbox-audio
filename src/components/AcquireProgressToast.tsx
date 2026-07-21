import React, { useEffect, useState } from 'react';
import { Check, Download, Loader2, X } from 'lucide-react';
import {
  getActiveAcquireJobs,
  subscribeAcquireProgressToast,
  type AcquireProgressToastDetail,
} from '../acquireProgressNotify';
import {
  getActivePrefetchJobs,
  subscribePrefetchProgressToast,
  type PrefetchProgressToastDetail,
} from '../prefetchProgressNotify';

type ToastItem =
  | (AcquireProgressToastDetail & { kind: 'acquire' })
  | (PrefetchProgressToastDetail & { kind: 'prefetch' });

export default function AcquireProgressToast() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const unsubAcquire = subscribeAcquireProgressToast((detail) => {
      if (!detail.label && detail.done) {
        setItems((prev) => prev.filter((i) => i.kind !== 'acquire' || i.jobId !== detail.jobId));
        return;
      }
      setItems((prev) => {
        const rest = prev.filter((i) => i.kind !== 'acquire' || i.jobId !== detail.jobId);
        const next = { ...detail, kind: 'acquire' as const };
        if (detail.done && detail.status === 'done') {
          return [next, ...rest].slice(0, 3);
        }
        if (detail.done && detail.status === 'error') {
          return [next, ...rest].slice(0, 3);
        }
        return [next, ...rest.filter((i) => i.kind !== 'acquire' || !i.done)].slice(0, 2);
      });
      if (detail.done) {
        window.setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.kind !== 'acquire' || i.jobId !== detail.jobId));
        }, detail.status === 'error' ? 8000 : 4000);
      }
    });

    const unsubPrefetch = subscribePrefetchProgressToast((detail) => {
      if (!detail.label && detail.done) {
        setItems((prev) =>
          prev.filter((i) => i.kind !== 'prefetch' || i.prefetchId !== detail.prefetchId),
        );
        return;
      }
      setItems((prev) => {
        const rest = prev.filter(
          (i) => i.kind !== 'prefetch' || i.prefetchId !== detail.prefetchId,
        );
        const next = { ...detail, kind: 'prefetch' as const };
        if (detail.done) return [next, ...rest].slice(0, 3);
        return [next, ...rest.filter((i) => i.kind !== 'prefetch' || !i.done)].slice(0, 2);
      });
      if (detail.done) {
        window.setTimeout(() => {
          setItems((prev) =>
            prev.filter((i) => i.kind !== 'prefetch' || i.prefetchId !== detail.prefetchId),
          );
        }, detail.status === 'error' ? 8000 : 4000);
      }
    });

    return () => {
      unsubAcquire();
      unsubPrefetch();
    };
  }, []);

  useEffect(() => {
    const acquireItems: ToastItem[] = getActiveAcquireJobs().map((job) => ({
      kind: 'acquire',
      jobId: job.id,
      label: job.label,
      artist: job.artist,
      progress: job.progress,
      status: job.status,
      done: false,
    }));
    const prefetchItems: ToastItem[] = getActivePrefetchJobs().map((job) => ({
      kind: 'prefetch',
      ...job,
    }));
    if (acquireItems.length > 0 || prefetchItems.length > 0) {
      setItems([...prefetchItems, ...acquireItems].slice(0, 3));
    }
  }, []);

  if (items.length === 0) return null;

  return (
    <div className="acquire-progress-toast" role="status" aria-live="polite">
      {items.map((item) => {
        const key = item.kind === 'acquire' ? item.jobId : item.prefetchId;
        const isError =
          item.kind === 'acquire' ? item.status === 'error' : item.status === 'error';
        const isDone = item.kind === 'acquire' ? item.status === 'done' : item.status === 'done';
        const meta =
          item.kind === 'acquire'
            ? item.status === 'done'
              ? 'Saved to locker'
              : item.status === 'error'
                ? item.error ?? 'Acquire failed'
                : `${item.progress}% · ${item.artist}`
            : item.status === 'done'
              ? 'Cached for offline playback'
              : item.status === 'fallback'
                ? item.error ?? 'Streaming instead'
                : item.status === 'error'
                  ? item.error ?? 'Prefetch failed'
                  : `Prefetching ${item.progress}% · ${item.artist}`;

        return (
          <div
            key={key}
            className={`acquire-progress-toast-item${
              isError ? ' acquire-progress-toast-item--error' : ''
            }`}
          >
            {isDone ? (
              <Check className="w-4 h-4 shrink-0 text-accent" />
            ) : isError ? (
              <X className="w-4 h-4 shrink-0 text-[var(--danger)]" />
            ) : (
              <Loader2 className="w-4 h-4 shrink-0 animate-spin text-accent" />
            )}
            <div className="min-w-0 flex-1">
              <p className="acquire-progress-toast-label truncate">{item.label}</p>
              <p className="acquire-progress-toast-meta truncate">{meta}</p>
              {!item.done && !isError ? (
                <div className="acquire-progress-toast-bar" aria-hidden>
                  <div
                    className="acquire-progress-toast-fill"
                    style={{ width: `${Math.max(4, item.progress)}%` }}
                  />
                </div>
              ) : null}
            </div>
            {!item.done ? <Download className="w-3.5 h-3.5 shrink-0 opacity-60" /> : null}
          </div>
        );
      })}
    </div>
  );
}
