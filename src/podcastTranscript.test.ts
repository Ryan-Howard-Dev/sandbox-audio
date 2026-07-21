import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { parseWhisperJsonOutput } from '../tier34-server/lib/whisperRunner';
import {
  savePodcastTranscript,
  searchPodcastTranscripts,
} from '../tier34-server/lib/podcastTranscriptStorage';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('whisperRunner', () => {
  it('parses openai-whisper JSON segments', () => {
    const raw = JSON.stringify({
      text: 'Hello underground radio.',
      language: 'en',
      segments: [
        { start: 0, end: 1.2, text: 'Hello' },
        { start: 1.2, end: 2.8, text: 'underground radio.' },
      ],
    });
    const parsed = parseWhisperJsonOutput(raw);
    expect(parsed?.text).toContain('underground');
    expect(parsed?.segments).toHaveLength(2);
    expect(parsed?.language).toBe('en');
  });
});

describe('podcastTranscriptStorage search', () => {
  const prev = process.env.TIER34_STORAGE_PATH;
  const storage = join(tmpdir(), `sandbox-transcript-test-${Date.now()}`);

  beforeAll(() => {
    process.env.TIER34_STORAGE_PATH = storage;
    mkdirSync(storage, { recursive: true });
    savePodcastTranscript({
      episodeId: 'feed-test:ep-1',
      feedId: 'feed-test',
      feedTitle: 'Off Grid Hour',
      episodeTitle: 'Solar mesh networks',
      blobHash: 'a'.repeat(64),
      text: 'We discuss mesh networking and privacy first podcast hosting without cloud APIs.',
      segments: [],
      transcribedAt: Date.now(),
      model: 'base',
      status: 'complete',
    });
  });

  afterAll(() => {
    if (prev) process.env.TIER34_STORAGE_PATH = prev;
    else delete process.env.TIER34_STORAGE_PATH;
    if (existsSync(storage)) rmSync(storage, { recursive: true, force: true });
  });

  it('finds episodes by transcript tokens', () => {
    const hits = searchPodcastTranscripts('mesh privacy', 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.episodeTitle).toBe('Solar mesh networks');
    expect(hits[0]?.snippet.toLowerCase()).toContain('mesh');
  });
});
