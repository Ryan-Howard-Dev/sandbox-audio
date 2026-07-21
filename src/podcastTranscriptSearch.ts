/**
 * Tier34 local transcript search — LAN / air-gap, no third-party APIs.
 */

import { getSandboxClientHeader, getTier34BaseUrl } from './tier34/client';
import { podcastPlaybackUrl } from './podcastRss';
import type { PodcastEpisode } from './podcastStorage';
import type { PodcastSearchHit } from './podcastSearch';

export type Tier34TranscriptSearchRow = {
  episodeId: string;
  feedId: string;
  feedTitle: string;
  episodeTitle: string;
  blobHash: string;
  snippet: string;
  transcribedAt: number;
};

export type PodcastTranscriptStatus = {
  enabled: boolean;
  whisperAvailable: boolean;
  transcriptCount: number;
  pendingCount: number;
  failedCount: number;
  running?: boolean;
  model?: string;
};

export async function fetchPodcastTranscriptStatus(): Promise<PodcastTranscriptStatus | null> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base) return null;
  try {
    const res = await fetch(`${base}/api/podcast/transcripts/status`, {
      headers: getSandboxClientHeader(),
    });
    if (!res.ok) return null;
    return (await res.json()) as PodcastTranscriptStatus;
  } catch {
    return null;
  }
}

export async function searchTier34TranscriptHits(
  query: string,
  limit = 12,
): Promise<PodcastSearchHit[]> {
  const base = getTier34BaseUrl().replace(/\/$/, '');
  if (!base || query.trim().length < 2) return [];
  try {
    const res = await fetch(
      `${base}/api/podcast/transcripts/search?q=${encodeURIComponent(query.trim())}&limit=${limit}`,
      { headers: getSandboxClientHeader() },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { hits?: Tier34TranscriptSearchRow[] };
    return (data.hits ?? []).map(transcriptRowToSearchHit);
  } catch {
    return [];
  }
}

function transcriptRowToSearchHit(row: Tier34TranscriptSearchRow): PodcastSearchHit {
  const audioUrl = podcastPlaybackUrl(`/api/locker/blob/${row.blobHash}`);
  const episode: PodcastEpisode = {
    id: row.episodeId,
    feedId: row.feedId,
    title: row.episodeTitle,
    audioUrl,
  };
  return {
    episode,
    feedTitle: row.feedTitle,
    envelope: {
      envelopeId: `podcast:${row.feedId}:${row.episodeId}`,
      title: row.episodeTitle,
      artist: row.feedTitle,
      album: row.feedTitle,
      url: audioUrl,
      durationSeconds: 0,
      provider: 'local-vault',
      transport: 'element-src',
      sourceId: row.episodeId,
      mimeType: 'audio/mpeg',
    },
    transcriptSnippet: row.snippet,
    searchSource: 'transcript',
  };
}

export function mergePodcastSearchHits(
  primary: PodcastSearchHit[],
  extra: PodcastSearchHit[],
  limit = 16,
): PodcastSearchHit[] {
  const byEnvelope = new Map<string, PodcastSearchHit>();
  for (const hit of primary) {
    byEnvelope.set(hit.envelope.envelopeId, hit);
  }
  for (const hit of extra) {
    const existing = byEnvelope.get(hit.envelope.envelopeId);
    if (!existing) {
      byEnvelope.set(hit.envelope.envelopeId, hit);
      continue;
    }
    if (hit.transcriptSnippet && !existing.transcriptSnippet) {
      byEnvelope.set(hit.envelope.envelopeId, { ...existing, ...hit });
    }
  }
  return Array.from(byEnvelope.values()).slice(0, limit);
}
