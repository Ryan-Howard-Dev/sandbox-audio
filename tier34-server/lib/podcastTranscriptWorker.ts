/**
 * Whisper transcription worker for mirrored podcast episodes (local NAS blobs only).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { blobExists, blobPathForHash } from './lockerStorage.js';
import {
  findMirroredEpisode,
  listMirroredEpisodesWithBlobs,
  type PodcastMirrorEpisodeRow,
  type PodcastMirrorFeedState,
} from './podcastMirrorStorage.js';
import {
  hasCompleteTranscript,
  loadPodcastTranscript,
  savePodcastTranscript,
} from './podcastTranscriptStorage.js';
import {
  transcribeAudioFile,
  whisperAvailable,
  whisperMaxEpisodeSeconds,
  whisperModel,
} from './whisperRunner.js';

export type TranscriptJobResult = {
  episodeId: string;
  ok: boolean;
  error?: string;
};

let transcribing = false;

export function isPodcastTranscriptRunning(): boolean {
  return transcribing;
}

export function isPodcastWhisperEnabled(): boolean {
  const raw = process.env.PODCAST_WHISPER_ENABLED?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}

export function whisperMaxJobsPerRun(): number {
  const raw = process.env.PODCAST_WHISPER_MAX_JOBS?.trim();
  const n = raw ? parseInt(raw, 10) : 2;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 2;
}

function episodeNeedsTranscript(episodeId: string): boolean {
  const existing = loadPodcastTranscript(episodeId);
  if (existing?.status === 'complete') return false;
  if (existing?.status === 'pending') return true;
  if (existing?.status === 'failed') return true;
  return true;
}

export function listEpisodesNeedingTranscript(limit = whisperMaxJobsPerRun()): Array<{
  feed: PodcastMirrorFeedState;
  episode: PodcastMirrorEpisodeRow;
}> {
  const rows: Array<{ feed: PodcastMirrorFeedState; episode: PodcastMirrorEpisodeRow }> = [];
  for (const row of listMirroredEpisodesWithBlobs()) {
    if (!episodeNeedsTranscript(row.episode.id)) continue;
    rows.push(row);
    if (rows.length >= limit) break;
  }
  return rows;
}

export async function transcribeMirroredEpisode(episodeId: string): Promise<TranscriptJobResult> {
  if (!isPodcastWhisperEnabled()) {
    return { episodeId, ok: false, error: 'whisper disabled' };
  }
  const available = await whisperAvailable();
  if (!available) {
    return { episodeId, ok: false, error: 'whisper not installed on Tier34 host' };
  }

  const located = findMirroredEpisode(episodeId);
  if (!located?.episode.blobHash) {
    return { episodeId, ok: false, error: 'mirrored episode not found' };
  }
  const { feed, episode } = located;
  const hash = episode.blobHash;
  if (!blobExists(hash)) {
    return { episodeId, ok: false, error: 'audio blob missing' };
  }

  if (hasCompleteTranscript(episodeId)) {
    return { episodeId, ok: true };
  }

  if (
    episode.durationSeconds != null &&
    episode.durationSeconds > whisperMaxEpisodeSeconds()
  ) {
    return {
      episodeId,
      ok: false,
      error: `episode exceeds PODCAST_WHISPER_MAX_SECONDS (${whisperMaxEpisodeSeconds()}s)`,
    };
  }

  const srcPath = blobPathForHash(hash);
  const ext = guessAudioExtension(episode.audioType, srcPath);
  const tmpPath = path.join(os.tmpdir(), `sandbox-whisper-${hash.slice(0, 16)}${ext}`);

  try {
    fs.copyFileSync(srcPath, tmpPath);
    const result = await transcribeAudioFile(tmpPath);
    savePodcastTranscript({
      episodeId: episode.id,
      feedId: feed.feedId,
      feedTitle: feed.title,
      episodeTitle: episode.title,
      blobHash: hash,
      language: result.language,
      text: result.text,
      segments: result.segments,
      transcribedAt: Date.now(),
      model: result.model,
      status: 'complete',
    });
    return { episodeId, ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    savePodcastTranscript({
      episodeId: episode.id,
      feedId: feed.feedId,
      feedTitle: feed.title,
      episodeTitle: episode.title,
      blobHash: hash,
      text: '',
      segments: [],
      transcribedAt: Date.now(),
      model: whisperModel(),
      status: 'failed',
      lastError: msg,
    });
    return { episodeId, ok: false, error: msg };
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
  }
}

function guessAudioExtension(audioType: string | undefined, srcPath: string): string {
  const ext = path.extname(srcPath);
  if (ext) return ext;
  const type = (audioType ?? '').toLowerCase();
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('m4a') || type.includes('mp4')) return '.m4a';
  if (type.includes('wav')) return '.wav';
  return '.mp3';
}

export async function runPodcastTranscriptBatch(): Promise<TranscriptJobResult[]> {
  if (transcribing || !isPodcastWhisperEnabled()) return [];
  transcribing = true;
  const results: TranscriptJobResult[] = [];
  try {
    const pending = listEpisodesNeedingTranscript();
    for (const row of pending) {
      results.push(await transcribeMirroredEpisode(row.episode.id));
    }
  } finally {
    transcribing = false;
  }
  return results;
}

export function queueTranscriptAfterMirror(episodeId: string): void {
  if (!isPodcastWhisperEnabled()) return;
  if (hasCompleteTranscript(episodeId)) return;
  setTimeout(() => {
    void transcribeMirroredEpisode(episodeId);
  }, 2_000);
}
