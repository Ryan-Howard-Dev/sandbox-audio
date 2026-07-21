/**
 * WAN pull worker — fetches RSS + episode audio into locker blobs on NAS.
 */

import { createHash } from 'node:crypto';
import { fetchPodcastFeedXml, podcastFeedUrlAllowed } from './podcastFeedProxy.js';
import { isYoutubePodcastListUrl } from './podcastYoutube.js';
import { blobExists, saveBlob } from './lockerStorage.js';
import {
  loadMirrorFeedState,
  loadMirrorSubscriptions,
  saveMirrorFeedState,
  type PodcastMirrorEpisodeRow,
  type PodcastMirrorFeedState,
} from './podcastMirrorStorage.js';
import { parsePodcastMirrorFeedXml } from './podcastMirrorParser.js';
import { queueTranscriptAfterMirror } from './podcastTranscriptWorker.js';

export type PodcastMirrorPullResult = {
  feedId: string;
  ok: boolean;
  downloaded: number;
  skipped: number;
  failed: number;
  error?: string;
};

let pulling = false;

export function isPodcastMirrorPulling(): boolean {
  return pulling;
}

export function mirrorMaxEpisodesPerFeed(): number {
  const raw = process.env.PODCAST_MIRROR_MAX_EPISODES?.trim();
  const n = raw ? parseInt(raw, 10) : 20;
  return Number.isFinite(n) && n > 0 ? Math.min(n, 100) : 20;
}

export function mirrorMaxBytesPerEpisode(): number {
  const raw = process.env.PODCAST_MIRROR_MAX_BYTES?.trim();
  const n = raw ? parseInt(raw, 10) : 524_288_000;
  return Number.isFinite(n) && n > 0 ? n : 524_288_000;
}

async function downloadEpisodeAudio(url: string): Promise<{ hash: string; bytes: number }> {
  const res = await fetch(url, {
    headers: {
      Accept: 'audio/*, application/octet-stream, */*',
      'User-Agent': 'SandboxTier34/1.0 (podcast-mirror)',
    },
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const cl = res.headers.get('content-length');
  if (cl) {
    const size = parseInt(cl, 10);
    if (Number.isFinite(size) && size > mirrorMaxBytesPerEpisode()) {
      throw new Error(`Episode exceeds max size (${size} bytes)`);
    }
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > mirrorMaxBytesPerEpisode()) {
    throw new Error(`Episode exceeds max size (${buf.length} bytes)`);
  }
  if (buf.length < 1024) {
    throw new Error('Episode too small — likely not audio');
  }
  const hash = createHash('sha256').update(buf).digest('hex');
  if (!blobExists(hash)) {
    saveBlob(hash, buf);
  }
  return { hash, bytes: buf.length };
}

function mergeEpisodeRows(
  existing: PodcastMirrorEpisodeRow[],
  parsed: ReturnType<typeof parsePodcastMirrorFeedXml>['episodes'],
  maxEpisodes: number,
): PodcastMirrorEpisodeRow[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const keep = parsed.slice(0, maxEpisodes);
  const rows: PodcastMirrorEpisodeRow[] = [];
  for (const ep of keep) {
    const prev = byId.get(ep.id);
    rows.push({
      id: ep.id,
      guid: ep.guid,
      title: ep.title,
      description: ep.description ?? prev?.description,
      sourceAudioUrl: ep.audioUrl,
      audioType: ep.audioType ?? prev?.audioType,
      durationSeconds: ep.durationSeconds ?? prev?.durationSeconds,
      publishedAt: ep.publishedAt ?? prev?.publishedAt,
      artworkUrl: ep.artworkUrl ?? prev?.artworkUrl,
      blobHash: prev?.sourceAudioUrl === ep.audioUrl ? prev?.blobHash : undefined,
      bytes: prev?.sourceAudioUrl === ep.audioUrl ? prev?.bytes : undefined,
      mirroredAt: prev?.sourceAudioUrl === ep.audioUrl ? prev?.mirroredAt : undefined,
      lastError: prev?.sourceAudioUrl === ep.audioUrl ? prev?.lastError : undefined,
    });
  }
  return rows;
}

export async function pullMirrorFeed(feedId: string): Promise<PodcastMirrorPullResult> {
  const subs = loadMirrorSubscriptions().subscriptions;
  const sub = subs.find((s) => s.id === feedId);
  if (!sub || !sub.enabled) {
    return { feedId, ok: false, downloaded: 0, skipped: 0, failed: 0, error: 'subscription not found' };
  }
  if (sub.source === 'youtube' || isYoutubePodcastListUrl(sub.feedUrl)) {
    return {
      feedId,
      ok: false,
      downloaded: 0,
      skipped: 0,
      failed: 0,
      error: 'YouTube feeds are not mirrored to NAS',
    };
  }
  if (!podcastFeedUrlAllowed(sub.feedUrl)) {
    return { feedId, ok: false, downloaded: 0, skipped: 0, failed: 0, error: 'feed URL not allowed' };
  }

  const maxEpisodes = mirrorMaxEpisodesPerFeed();
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let pullError: string | undefined;

  try {
    const { status, body } = await fetchPodcastFeedXml(sub.feedUrl);
    if (status < 200 || status >= 300) {
      throw new Error(`Feed HTTP ${status}`);
    }
    const parsed = parsePodcastMirrorFeedXml(body, sub.feedUrl);
    const prev = loadMirrorFeedState(feedId);
    const episodes = mergeEpisodeRows(prev?.episodes ?? [], parsed.episodes, maxEpisodes);

    for (const ep of episodes) {
      if (ep.blobHash && blobExists(ep.blobHash)) {
        skipped += 1;
        continue;
      }
      try {
        const { hash, bytes } = await downloadEpisodeAudio(ep.sourceAudioUrl);
        ep.blobHash = hash;
        ep.bytes = bytes;
        ep.mirroredAt = Date.now();
        ep.lastError = undefined;
        downloaded += 1;
        queueTranscriptAfterMirror(ep.id);
      } catch (e) {
        ep.lastError = e instanceof Error ? e.message : String(e);
        failed += 1;
      }
    }

    const state: PodcastMirrorFeedState = {
      feedId,
      feedUrl: sub.feedUrl,
      title: parsed.title || sub.title,
      description: parsed.description ?? sub.description,
      artworkUrl: parsed.artworkUrl ?? sub.artworkUrl,
      updatedAt: Date.now(),
      lastPullAt: Date.now(),
      lastPullError: failed > 0 && downloaded === 0 ? `${failed} episode(s) failed` : undefined,
      episodes,
    };
    saveMirrorFeedState(state);
    return { feedId, ok: true, downloaded, skipped, failed, error: pullError };
  } catch (e) {
    pullError = e instanceof Error ? e.message : String(e);
    const prev = loadMirrorFeedState(feedId);
    const state: PodcastMirrorFeedState = {
      feedId,
      feedUrl: sub.feedUrl,
      title: prev?.title ?? sub.title,
      description: prev?.description ?? sub.description,
      artworkUrl: prev?.artworkUrl ?? sub.artworkUrl,
      updatedAt: Date.now(),
      lastPullAt: Date.now(),
      lastPullError: pullError,
      episodes: prev?.episodes ?? [],
    };
    saveMirrorFeedState(state);
    return { feedId, ok: false, downloaded, skipped, failed, error: pullError };
  }
}

export async function pullAllMirrorFeeds(): Promise<PodcastMirrorPullResult[]> {
  if (pulling) return [];
  pulling = true;
  const results: PodcastMirrorPullResult[] = [];
  try {
    const subs = loadMirrorSubscriptions().subscriptions.filter((s) => s.enabled);
    for (const sub of subs) {
      results.push(await pullMirrorFeed(sub.id));
    }
  } finally {
    pulling = false;
  }
  return results;
}

export function isPodcastMirrorEnabled(): boolean {
  const raw = process.env.PODCAST_MIRROR_ENABLED?.trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return true;
}
