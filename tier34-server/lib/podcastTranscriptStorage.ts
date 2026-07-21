/**
 * NAS-backed podcast transcripts — local Whisper output, LAN-searchable.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';
import type { WhisperSegment } from './whisperRunner.js';

export type PodcastTranscriptRecord = {
  episodeId: string;
  feedId: string;
  feedTitle: string;
  episodeTitle: string;
  blobHash: string;
  language?: string;
  text: string;
  segments: WhisperSegment[];
  transcribedAt: number;
  model: string;
  status: 'complete' | 'failed' | 'pending';
  lastError?: string;
};

export type PodcastTranscriptSearchHit = {
  episodeId: string;
  feedId: string;
  feedTitle: string;
  episodeTitle: string;
  blobHash: string;
  snippet: string;
  matchOffset?: number;
  transcribedAt: number;
};

export type PodcastTranscriptStatus = {
  enabled: boolean;
  whisperAvailable: boolean;
  transcriptCount: number;
  pendingCount: number;
  failedCount: number;
  storageRoot: string;
  model: string;
};

const TRANSCRIPT_DIR = join(LOCKER_STORAGE_ROOT, 'podcast-transcripts');
const INDEX_FILE = join(TRANSCRIPT_DIR, 'index.json');

type TranscriptIndexEntry = {
  episodeId: string;
  feedId: string;
  feedTitle: string;
  episodeTitle: string;
  blobHash: string;
  textPreview: string;
  transcribedAt: number;
  status: PodcastTranscriptRecord['status'];
};

type TranscriptIndex = {
  version: 1;
  updatedAt: number;
  entries: TranscriptIndexEntry[];
};

function ensureDirs(): void {
  mkdirSync(TRANSCRIPT_DIR, { recursive: true });
}

function safeEpisodeFileId(episodeId: string): string {
  return episodeId.replace(/[^a-zA-Z0-9:_-]/g, '_');
}

function episodeFilePath(episodeId: string): string {
  return join(TRANSCRIPT_DIR, `${safeEpisodeFileId(episodeId)}.json`);
}

function emptyIndex(): TranscriptIndex {
  return { version: 1, updatedAt: 0, entries: [] };
}

function readIndex(): TranscriptIndex {
  if (!existsSync(INDEX_FILE)) return emptyIndex();
  try {
    const parsed = JSON.parse(readFileSync(INDEX_FILE, 'utf8')) as TranscriptIndex;
    if (!parsed?.entries || !Array.isArray(parsed.entries)) return emptyIndex();
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      entries: parsed.entries,
    };
  } catch {
    return emptyIndex();
  }
}

function writeIndex(index: TranscriptIndex): void {
  ensureDirs();
  index.updatedAt = Date.now();
  writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
}

function upsertIndexEntry(record: PodcastTranscriptRecord): void {
  const index = readIndex();
  const preview = record.text.slice(0, 600);
  const row: TranscriptIndexEntry = {
    episodeId: record.episodeId,
    feedId: record.feedId,
    feedTitle: record.feedTitle,
    episodeTitle: record.episodeTitle,
    blobHash: record.blobHash,
    textPreview: preview,
    transcribedAt: record.transcribedAt,
    status: record.status,
  };
  const without = index.entries.filter((e) => e.episodeId !== record.episodeId);
  without.unshift(row);
  writeIndex({ version: 1, updatedAt: Date.now(), entries: without });
}

export function loadPodcastTranscript(episodeId: string): PodcastTranscriptRecord | null {
  const filePath = episodeFilePath(episodeId);
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as PodcastTranscriptRecord;
    if (!parsed?.episodeId || !parsed.text) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function savePodcastTranscript(record: PodcastTranscriptRecord): void {
  ensureDirs();
  writeFileSync(episodeFilePath(record.episodeId), JSON.stringify(record, null, 2), 'utf8');
  upsertIndexEntry(record);
}

export function markTranscriptPending(
  row: Omit<PodcastTranscriptRecord, 'text' | 'segments' | 'transcribedAt' | 'model' | 'status'> & {
    model?: string;
  },
): void {
  savePodcastTranscript({
    ...row,
    text: '',
    segments: [],
    transcribedAt: Date.now(),
    model: row.model ?? 'pending',
    status: 'pending',
  });
}

export function hasCompleteTranscript(episodeId: string): boolean {
  const row = loadPodcastTranscript(episodeId);
  return row?.status === 'complete' && Boolean(row.text.trim());
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

function snippetAroundMatch(text: string, token: string, radius = 80): string {
  const lower = text.toLowerCase();
  const idx = lower.indexOf(token);
  if (idx < 0) return text.slice(0, radius * 2).trim();
  const start = Math.max(0, idx - radius);
  const end = Math.min(text.length, idx + token.length + radius);
  const slice = text.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${slice}${end < text.length ? '…' : ''}`;
}

export function searchPodcastTranscripts(
  query: string,
  limit = 20,
): PodcastTranscriptSearchHit[] {
  const q = normalizeQuery(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ').filter((t) => t.length > 1);
  if (!tokens.length) return [];

  const hits: PodcastTranscriptSearchHit[] = [];
  for (const entry of readIndex().entries) {
    if (entry.status !== 'complete') continue;
    const full = loadPodcastTranscript(entry.episodeId);
    const text = full?.text ?? entry.textPreview;
    const hay = normalizeQuery(
      `${entry.episodeTitle} ${entry.feedTitle} ${text}`,
    );
    if (!tokens.every((t) => hay.includes(t))) continue;
    const anchor = tokens[0]!;
    hits.push({
      episodeId: entry.episodeId,
      feedId: entry.feedId,
      feedTitle: entry.feedTitle,
      episodeTitle: entry.episodeTitle,
      blobHash: entry.blobHash,
      snippet: snippetAroundMatch(text, anchor),
      transcribedAt: entry.transcribedAt,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function getTranscriptStatus(
  enabled: boolean,
  whisperAvailable: boolean,
  model: string,
): PodcastTranscriptStatus {
  const entries = readIndex().entries;
  return {
    enabled,
    whisperAvailable,
    transcriptCount: entries.filter((e) => e.status === 'complete').length,
    pendingCount: entries.filter((e) => e.status === 'pending').length,
    failedCount: entries.filter((e) => e.status === 'failed').length,
    storageRoot: TRANSCRIPT_DIR,
    model,
  };
}
