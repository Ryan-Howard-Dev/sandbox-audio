/**
 * Client API for tier34 Demucs stem separation jobs.
 */

import { appendSandboxClientQuery, getTier34BaseUrl } from './tier34/client';

export type StemKind = 'vocals' | 'drums' | 'bass' | 'other';

export type StemUrls = Partial<Record<StemKind, string>>;

export type StemAnalyzeJob = {
  id: string;
  status: 'queued' | 'running' | 'separating' | 'storing' | 'done' | 'error';
  progress: number;
  trackId: string;
  contentHash: string;
  error?: string;
  stems?: StemUrls;
};

export type StemCapabilities = {
  demucsAvailable: boolean;
  hint: string;
};

function tier34Root(): string {
  return getTier34BaseUrl().replace(/\/$/, '');
}

export async function fetchStemCapabilities(): Promise<StemCapabilities | null> {
  const base = tier34Root();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/stems/capabilities`);
    if (!res.ok) return null;
    return (await res.json()) as StemCapabilities;
  } catch {
    return null;
  }
}

export async function submitStemAnalyze(input: {
  trackId: string;
  contentHash?: string;
  title?: string;
  artist?: string;
}): Promise<string> {
  const base = tier34Root();
  if (!base) throw new Error('Sandbox Server URL required for stem separation.');
  const res = await fetch(`${base}/api/stems/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Stem analyze failed (HTTP ${res.status})${detail ? ` — ${detail}` : ''}`);
  }
  const data = (await res.json()) as { jobId?: string };
  if (!data.jobId) throw new Error('Stem analyze missing jobId');
  return data.jobId;
}

export async function fetchStemAnalyzeStatus(jobId: string): Promise<StemAnalyzeJob> {
  const base = tier34Root();
  const res = await fetch(`${base}/api/stems/status/${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error(`Stem status failed (HTTP ${res.status})`);
  return (await res.json()) as StemAnalyzeJob;
}

export async function pollStemAnalyzeUntilDone(
  jobId: string,
  onProgress?: (job: StemAnalyzeJob) => void,
  timeoutMs = 1_800_000,
): Promise<StemAnalyzeJob> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const job = await fetchStemAnalyzeStatus(jobId);
    onProgress?.(job);
    if (job.status === 'done' || job.status === 'error') return job;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('Stem separation timed out');
}

export async function fetchStemUrlsForTrack(trackId: string): Promise<StemUrls | null> {
  const base = tier34Root();
  if (!base) return null;
  try {
    const res = await fetch(
      appendSandboxClientQuery(`${base}/api/stems/track/${encodeURIComponent(trackId)}`),
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { stemUrls?: StemUrls };
    const urls = data.stemUrls;
    if (!urls || Object.keys(urls).length < 4) return null;
    return urls;
  } catch {
    return null;
  }
}

export function stemUrlsComplete(urls: StemUrls | null | undefined): urls is Record<StemKind, string> {
  if (!urls) return false;
  return Boolean(urls.vocals && urls.drums && urls.bass && urls.other);
}
