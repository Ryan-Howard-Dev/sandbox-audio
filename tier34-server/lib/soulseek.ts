/**
 * Soulseek via slskd — headless client REST bridge (no SoulseekQt, no third-party API).
 * Search, download, and stream through local slskd at SOULSEEK_SLKD_URL.
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AddonResolveRow } from './addonResolve.js';

const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.wav', '.wma', '.opus', '.ape']);

export type SlkdConfig = {
  baseUrl: string;
  apiKey: string;
  downloadsPath: string;
};

export type SoulseekFileRef = {
  username: string;
  filename: string;
  size: number;
};

export type SlkdSearchHit = SoulseekFileRef & {
  extension?: string;
  bitRate?: number;
  uploadSpeed?: number;
  queueLength?: number;
};

type SlkdSearchResponseItem = {
  username?: string;
  uploadSpeed?: number;
  queueLength?: number;
  files?: Array<{
    filename?: string;
    size?: number;
    extension?: string;
    bitRate?: number;
  }>;
};

type SlkdTransferFile = {
  username?: string;
  filename?: string;
  size?: number;
  state?: string;
  percentComplete?: number;
  id?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getSlkdConfig(): SlkdConfig {
  const raw =
    process.env.SOULSEEK_SLKD_URL?.trim() ||
    process.env.SLKD_URL?.trim() ||
    '';
  const baseUrl = raw.replace(/\/$/, '').replace(/\/api\/v0$/i, '');
  return {
    baseUrl,
    apiKey:
      process.env.SOULSEEK_SLKD_API_KEY?.trim() ||
      process.env.SLKD_API_KEY?.trim() ||
      '',
    downloadsPath:
      process.env.SOULSEEK_DOWNLOADS_PATH?.trim() ||
      process.env.SLKD_DOWNLOADS_PATH?.trim() ||
      '/data/slskd-downloads',
  };
}

export function isSoulseekConfigured(): boolean {
  return Boolean(getSlkdConfig().baseUrl);
}

async function slskdFetch<T = unknown>(
  path: string,
  init?: RequestInit & { json?: unknown },
): Promise<T> {
  const { baseUrl, apiKey } = getSlkdConfig();
  if (!baseUrl) throw new Error('slskd not configured');

  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(init?.headers as Record<string, string> | undefined),
  };
  if (apiKey) headers['X-API-KEY'] = apiKey;

  let body = init?.body;
  if (init?.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.json);
  }

  const res = await fetch(`${baseUrl}/api/v0${path}`, {
    ...init,
    headers,
    body,
    signal: init?.signal ?? AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`slskd ${path} HTTP ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('json')) return undefined as T;
  return (await res.json()) as T;
}

export async function slskdReachable(): Promise<boolean> {
  if (!isSoulseekConfigured()) return false;
  try {
    await slskdFetch('/application/state', { method: 'GET', signal: AbortSignal.timeout(4_000) });
    return true;
  } catch {
    return false;
  }
}

function isAudioFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return AUDIO_EXT.has(lower.slice(dot));
}

function normalizeSoulseekPath(filename: string): string {
  return filename.replace(/\\/g, '/').replace(/^@@/, '');
}

function parseFilenameMetadata(
  filename: string,
  query: string,
): { title: string; artist: string; album?: string } {
  const normalized = normalizeSoulseekPath(filename);
  const parts = normalized.split('/').filter(Boolean);
  const fileBase = basename(normalized).replace(/\.[^.]+$/, '');
  const title = fileBase.replace(/^\d+[\s._-]*/, '').trim() || fileBase || query;

  if (parts.length >= 3) {
    const album = parts[parts.length - 2];
    const artist = parts[parts.length - 3];
    return { title, artist, album };
  }
  if (parts.length === 2) {
    return { title, artist: parts[0] };
  }
  return { title, artist: 'Soulseek' };
}

function hitId(username: string, filename: string): string {
  return createHash('sha1').update(`${username}\0${filename}`).digest('hex').slice(0, 12);
}

export function buildSoulseekUrl(username: string, filename: string, size: number): string {
  const params = new URLSearchParams({
    username,
    filename,
    size: String(size),
  });
  return `soulseek://download?${params}`;
}

export function parseSoulseekUrl(url: string): SoulseekFileRef | null {
  const trimmed = url.trim();
  if (!trimmed.toLowerCase().startsWith('soulseek://')) return null;
  try {
    const parsed = new URL(trimmed);
    const username = parsed.searchParams.get('username')?.trim() ?? '';
    const filename = parsed.searchParams.get('filename')?.trim() ?? '';
    const size = Number(parsed.searchParams.get('size') ?? 0);
    if (!username || !filename) return null;
    return { username, filename, size: Number.isFinite(size) ? size : 0 };
  } catch {
    return null;
  }
}

export function parseSoulseekStreamQuery(query: Record<string, unknown>): SoulseekFileRef | null {
  const username = String(query.username ?? '').trim();
  const filename = String(query.filename ?? '').trim();
  const size = Number(query.size ?? 0);
  if (!username || !filename) return null;
  return { username, filename, size: Number.isFinite(size) ? size : 0 };
}

export function buildSoulseekStreamPath(username: string, filename: string, size: number): string {
  const params = new URLSearchParams({
    username,
    filename,
    size: String(size),
  });
  return `/api/addon/soulseek/stream?${params}`;
}

function flattenTransferFiles(payload: unknown): SlkdTransferFile[] {
  const out: SlkdTransferFile[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (typeof obj.filename === 'string' && typeof obj.state === 'string') {
      out.push(obj as SlkdTransferFile);
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  };
  walk(payload);
  return out;
}

function isTransferComplete(state?: string, percent?: number): boolean {
  const s = (state ?? '').toLowerCase();
  if (s.includes('completed') || s.includes('succeeded')) return true;
  return typeof percent === 'number' && percent >= 99.5;
}

function isTransferFailed(state?: string): boolean {
  const s = (state ?? '').toLowerCase();
  return s.includes('error') || s.includes('cancel') || s.includes('fail');
}

function findOnDisk(downloadsPath: string, soulseekFilename: string): string | null {
  const normalized = normalizeSoulseekPath(soulseekFilename);
  const candidates = [
    join(downloadsPath, normalized),
    join(downloadsPath, basename(normalized)),
    join(downloadsPath, soulseekFilename.replace(/\\/g, '/')),
  ];

  for (const path of candidates) {
    if (existsSync(path) && statSync(path).isFile()) return path;
  }

  const targetBase = basename(normalized).toLowerCase();
  const walkDir = (dir: string, depth: number): string | null => {
    if (depth > 6 || !existsSync(dir)) return null;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return null;
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && entry.toLowerCase() === targetBase) return full;
      if (st.isDirectory()) {
        const nested = walkDir(full, depth + 1);
        if (nested) return nested;
      }
    }
    return null;
  };

  return walkDir(downloadsPath, 0);
}

export async function slskdSearch(query: string, timeoutSec = 12): Promise<SlkdSearchHit[]> {
  const q = query.trim();
  if (!q || !isSoulseekConfigured()) return [];

  const created = await slskdFetch<{ id?: string; state?: string; responses?: SlkdSearchResponseItem[] }>(
    '/searches',
    {
      method: 'POST',
      json: {
        searchText: q,
        searchTimeout: timeoutSec,
        responseLimit: 40,
        minimumResponseFileCount: 1,
        filterResponses: true,
      },
    },
  );

  const searchId = created?.id;
  if (!searchId) return [];

  let responses: SlkdSearchResponseItem[] = created.responses ?? [];
  const deadline = Date.now() + timeoutSec * 1000 + 2_000;

  while (Date.now() < deadline) {
    const state = await slskdFetch<{
      state?: string;
      responses?: SlkdSearchResponseItem[];
    }>(`/searches/${searchId}?includeResponses=true`, { method: 'GET' });

    if (state.responses?.length) responses = state.responses;
    const st = (state.state ?? '').toLowerCase();
    if (st.includes('completed') || st.includes('timedout') || st.includes('cancelled')) break;
    await sleep(500);
  }

  if (!responses.length) {
    try {
      responses = await slskdFetch<SlkdSearchResponseItem[]>(`/searches/${searchId}/responses`, {
        method: 'GET',
      });
    } catch {
      responses = [];
    }
  }

  const hits: SlkdSearchHit[] = [];
  for (const item of responses ?? []) {
    const username = item.username?.trim();
    if (!username) continue;
    for (const file of item.files ?? []) {
      const filename = file.filename?.trim();
      const size = file.size ?? 0;
      if (!filename || !isAudioFile(filename)) continue;
      hits.push({
        username,
        filename,
        size,
        extension: file.extension,
        bitRate: file.bitRate,
        uploadSpeed: item.uploadSpeed,
        queueLength: item.queueLength,
      });
    }
  }

  return hits;
}

export async function enqueueSoulseekDownload(ref: SoulseekFileRef): Promise<void> {
  const encodedUser = encodeURIComponent(ref.username);
  await slskdFetch(`/transfers/downloads/${encodedUser}`, {
    method: 'POST',
    json: [{ filename: ref.filename, size: ref.size }],
  });
}

export async function waitForSoulseekDownload(
  ref: SoulseekFileRef,
  timeoutMs = 300_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const payload = await slskdFetch('/transfers/downloads', { method: 'GET' });
    const transfers = flattenTransferFiles(payload);
    const match = transfers.find(
      (t) =>
        t.username === ref.username &&
        t.filename === ref.filename &&
        (ref.size <= 0 || !t.size || t.size === ref.size),
    );
    if (match) {
      if (isTransferComplete(match.state, match.percentComplete)) return;
      if (isTransferFailed(match.state)) {
        throw new Error(`Soulseek download failed (${match.state ?? 'unknown'})`);
      }
    }
    await sleep(1_000);
  }
  throw new Error('Soulseek download timed out');
}

export async function readSoulseekDownloadBuffer(ref: SoulseekFileRef): Promise<Buffer> {
  const { downloadsPath } = getSlkdConfig();
  await enqueueSoulseekDownload(ref);
  await waitForSoulseekDownload(ref);

  const path = findOnDisk(downloadsPath, ref.filename);
  if (!path) {
    throw new Error('Soulseek file not found on disk after download');
  }

  const buf = readFileSync(path);
  if (buf.length < 8_000) {
    throw new Error('Soulseek download too small');
  }
  return buf;
}

function estimateDurationSeconds(hit: SlkdSearchHit): number {
  if (hit.bitRate && hit.bitRate > 0 && hit.size > 0) {
    return Math.round((hit.size * 8) / hit.bitRate);
  }
  return 0;
}

function queryRelevance(title: string, artist: string, query: string): number {
  const hay = `${title} ${artist}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 1;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}

function rankSoulseekHits(hits: SlkdSearchHit[], query: string): SlkdSearchHit[] {
  return [...hits]
    .map((h) => {
      const meta = parseFilenameMetadata(h.filename, query);
      return { hit: h, score: queryRelevance(meta.title, meta.artist, query) };
    })
    .filter((r) => r.score >= 0.25)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aq = a.hit.queueLength ?? 999_999;
      const bq = b.hit.queueLength ?? 999_999;
      if (aq !== bq) return aq - bq;
      return (b.hit.uploadSpeed ?? 0) - (a.hit.uploadSpeed ?? 0);
    })
    .map((r) => r.hit)
    .slice(0, 8);
}

/** Addon search — returns ranked rows with tier34 stream paths. */
export async function resolveSoulseekAddon(query: string): Promise<AddonResolveRow[]> {
  if (!isSoulseekConfigured()) return [];

  try {
    const reachable = await slskdReachable();
    if (!reachable) return [];

    const hits = rankSoulseekHits(await slskdSearch(query), query);
    const rows: AddonResolveRow[] = [];

    for (const hit of hits) {
      const meta = parseFilenameMetadata(hit.filename, query);
      const id = hitId(hit.username, hit.filename);
      rows.push({
        id: `slsk-${id}`,
        title: meta.title.slice(0, 160),
        artist: (meta.album ? `${meta.artist} · ${meta.album}` : meta.artist).slice(0, 120),
        url: buildSoulseekStreamPath(hit.username, hit.filename, hit.size),
        durationSeconds: estimateDurationSeconds(hit),
        sourceId: buildSoulseekUrl(hit.username, hit.filename, hit.size),
        provider: 'soulseek',
        transport: 'stream-proxy',
        resolveHint: buildSoulseekUrl(hit.username, hit.filename, hit.size),
      });
    }

    return rows;
  } catch (e) {
    console.warn('[tier34] soulseek search', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Acquire resolve — pick best Soulseek file for a title/artist query. */
export async function resolveSoulseekCandidate(
  query: string,
): Promise<{ url: string; title?: string; artist?: string; durationSeconds?: number } | null> {
  const rows = await resolveSoulseekAddon(query);
  const first = rows[0];
  if (!first?.sourceId) return null;
  return {
    url: first.sourceId,
    title: first.title,
    artist: first.artist,
    durationSeconds: first.durationSeconds,
  };
}
