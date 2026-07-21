/**
 * Aggressive prefetch progress — reuses acquire toast UI patterns.
 */

const PREFETCH_TOAST_EVENT = 'sandbox-prefetch-progress-toast';

export type PrefetchProgressToastDetail = {
  prefetchId: string;
  label: string;
  artist: string;
  progress: number;
  status: 'prefetching' | 'done' | 'error' | 'fallback';
  done: boolean;
  error?: string;
};

const activePrefetches = new Map<string, PrefetchProgressToastDetail>();

function dispatchToast(detail: PrefetchProgressToastDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(PREFETCH_TOAST_EVENT, { detail }));
}

export function subscribePrefetchProgressToast(
  handler: (detail: PrefetchProgressToastDetail) => void,
): () => void {
  const listener = (ev: Event) => {
    const detail = (ev as CustomEvent<PrefetchProgressToastDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(PREFETCH_TOAST_EVENT, listener);
  return () => window.removeEventListener(PREFETCH_TOAST_EVENT, listener);
}

export function notifyPrefetchProgress(detail: PrefetchProgressToastDetail): void {
  activePrefetches.set(detail.prefetchId, detail);
  dispatchToast(detail);
}

export function dismissPrefetchProgress(prefetchId: string): void {
  activePrefetches.delete(prefetchId);
  dispatchToast({
    prefetchId,
    label: '',
    artist: '',
    progress: 100,
    status: 'done',
    done: true,
  });
}

export function getActivePrefetchJobs(): PrefetchProgressToastDetail[] {
  return [...activePrefetches.values()].filter((j) => !j.done);
}
