/**
 * Chromaprint (fpcalc) + AcoustID lookup for audio identification.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ACOUSTID_LOOKUP = 'https://api.acoustid.org/v2/lookup';
const MB_USER_AGENT = 'SandboxTier34/1.0 (acoustid)';

export type ChromaprintResult = {
  duration: number;
  fingerprint: string;
};

export type AcoustidRecordingMatch = {
  acoustidId: string;
  score: number;
  musicbrainzRecordingId: string;
  title: string;
  artist: string;
  musicbrainzReleaseId?: string;
  musicbrainzReleaseGroupId?: string;
  releaseYear?: string;
};

export type AcoustidLookupResult = {
  fingerprint: string;
  duration: number;
  match: AcoustidRecordingMatch | null;
  source: 'acoustid' | 'unavailable';
  reason?: string;
};

let fpcalcChecked: boolean | null = null;

export function resetFpcalcCache(): void {
  fpcalcChecked = null;
}

export async function isFpcalcAvailable(): Promise<boolean> {
  if (fpcalcChecked != null) return fpcalcChecked;
  try {
    await execFileAsync('fpcalc', ['-version'], { timeout: 4_000 });
    fpcalcChecked = true;
  } catch {
    fpcalcChecked = false;
  }
  return fpcalcChecked;
}

/** Parse fpcalc plain-text or JSON stdout. */
export function parseFpcalcOutput(stdout: string): ChromaprintResult | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{')) {
    try {
      const data = JSON.parse(trimmed) as { duration?: number; fingerprint?: string };
      const duration = Number(data.duration);
      const fingerprint = String(data.fingerprint ?? '').trim();
      if (!fingerprint || !Number.isFinite(duration) || duration <= 0) return null;
      return { duration, fingerprint };
    } catch {
      return null;
    }
  }

  let duration = 0;
  let fingerprint = '';
  for (const line of trimmed.split(/\r?\n/)) {
    const [key, ...rest] = line.split('=');
    const value = rest.join('=').trim();
    if (key === 'DURATION') duration = Number(value);
    if (key === 'FINGERPRINT') fingerprint = value;
  }
  if (!fingerprint || !Number.isFinite(duration) || duration <= 0) return null;
  return { duration, fingerprint };
}

export async function chromaprintFromFile(filePath: string): Promise<ChromaprintResult | null> {
  if (!(await isFpcalcAvailable())) return null;
  try {
    const { stdout } = await execFileAsync('fpcalc', ['-json', filePath], {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return parseFpcalcOutput(stdout);
  } catch {
    try {
      const { stdout } = await execFileAsync('fpcalc', [filePath], {
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      return parseFpcalcOutput(stdout);
    } catch {
      return null;
    }
  }
}

function sniffAudioExtension(buf: Buffer): string {
  if (buf.length >= 4 && buf[0] === 0x66 && buf[1] === 0x4c && buf[2] === 0x61 && buf[3] === 0x43) {
    return '.flac';
  }
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    return '.mp3';
  }
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    return '.wav';
  }
  if (buf.length >= 4 && buf.toString('ascii', 0, 4) === 'OggS') {
    return '.ogg';
  }
  return '.bin';
}

export async function chromaprintFromBuffer(buf: Buffer): Promise<ChromaprintResult | null> {
  if (buf.length < 8_000) return null;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sandbox-fp-'));
  const tmpFile = path.join(tmpDir, `audio${sniffAudioExtension(buf)}`);
  try {
    await fs.writeFile(tmpFile, buf);
    return await chromaprintFromFile(tmpFile);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

type AcoustidApiRecording = {
  id?: string;
  title?: string;
  artists?: Array<{ name?: string }>;
  releasegroups?: Array<{ id?: string; title?: string }>;
};

type AcoustidApiResult = {
  id?: string;
  score?: number;
  recordings?: AcoustidApiRecording[];
};

/** Pick highest-scoring recording from AcoustID API payload. */
export function pickBestAcoustidMatch(
  results: AcoustidApiResult[],
  minScore = 0.5,
): AcoustidRecordingMatch | null {
  let best: AcoustidRecordingMatch | null = null;

  for (const row of results) {
    const score = Number(row.score ?? 0);
    if (!Number.isFinite(score) || score < minScore) continue;
    const recording = row.recordings?.find((r) => r.id?.trim());
    if (!recording?.id) continue;

    const artist =
      recording.artists?.map((a) => a.name?.trim()).filter(Boolean).join(', ') ?? '';
    const candidate: AcoustidRecordingMatch = {
      acoustidId: String(row.id ?? ''),
      score,
      musicbrainzRecordingId: recording.id,
      title: recording.title?.trim() ?? '',
      artist,
      musicbrainzReleaseGroupId: recording.releasegroups?.[0]?.id,
    };

    if (!best || candidate.score > best.score) {
      best = candidate;
    }
  }

  return best;
}

async function mbRecordingDetails(
  recordingId: string,
): Promise<Partial<AcoustidRecordingMatch>> {
  try {
    const res = await fetch(
      `https://musicbrainz.org/ws/2/recording/${encodeURIComponent(recordingId)}?inc=releases&fmt=json`,
      {
        headers: { 'User-Agent': MB_USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      releases?: Array<{ id?: string; date?: string }>;
    };
    const release = data.releases?.[0];
    if (!release?.id) return {};
    return {
      musicbrainzReleaseId: release.id,
      releaseYear: release.date?.slice(0, 4),
    };
  } catch {
    return {};
  }
}

export async function lookupAcoustId(
  fingerprint: string,
  durationSeconds: number,
  apiKey = process.env.ACOUSTID_API_KEY ?? '',
): Promise<AcoustidRecordingMatch | null> {
  const fp = fingerprint.trim();
  const duration = Math.round(durationSeconds);
  if (!fp || duration <= 0) return null;
  if (!apiKey.trim()) return null;

  const params = new URLSearchParams({
    client: apiKey.trim(),
    meta: 'recordings+releasegroups+compress',
    duration: String(duration),
    fingerprint: fp,
  });

  try {
    const res = await fetch(`${ACOUSTID_LOOKUP}?${params.toString()}`, {
      headers: { Accept: 'application/json', 'User-Agent': MB_USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { status?: string; results?: AcoustidApiResult[] };
    if (data.status !== 'ok') return null;
    const match = pickBestAcoustidMatch(data.results ?? [], 0.5);
    if (!match) return null;

    const mbExtra = await mbRecordingDetails(match.musicbrainzRecordingId);
    return { ...match, ...mbExtra };
  } catch {
    return null;
  }
}

export async function identifyAudioBuffer(
  buf: Buffer,
  durationHintSeconds = 0,
): Promise<AcoustidLookupResult> {
  const chroma = await chromaprintFromBuffer(buf);
  if (!chroma) {
    return {
      fingerprint: '',
      duration: durationHintSeconds,
      match: null,
      source: 'unavailable',
      reason: (await isFpcalcAvailable()) ? 'fingerprint-failed' : 'fpcalc-missing',
    };
  }

  const match = await lookupAcoustId(chroma.fingerprint, chroma.duration);
  return {
    fingerprint: chroma.fingerprint,
    duration: chroma.duration,
    match,
    source: match ? 'acoustid' : 'unavailable',
    reason: match ? undefined : process.env.ACOUSTID_API_KEY ? 'no-match' : 'api-key-missing',
  };
}
