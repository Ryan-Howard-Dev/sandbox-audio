import { afterEach, describe, expect, it } from 'vitest';
import { isDlnaEnvEnabled } from './dlnaMediaServer.js';
import { isIngestWatcherEnvEnabled } from './ingestionWatcher.js';
import { isPodcastMirrorEnabled } from './podcastMirrorWorker.js';
import { isPodcastWhisperEnabled } from './podcastTranscriptWorker.js';

const KEYS = [
  'PODCAST_MIRROR_ENABLED',
  'PODCAST_WHISPER_ENABLED',
  'TIER34_DLNA',
  'DLNA_MEDIASERVER',
  'TIER34_INGEST_WATCHER',
] as const;

function withEnv(overrides: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void): void {
  const prev: Record<string, string | undefined> = {};
  for (const k of KEYS) {
    prev[k] = process.env[k];
    if (!(k in overrides)) {
      delete process.env[k];
    }
  }
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe('tier34 background opt-in defaults', () => {
  afterEach(() => {
    for (const k of KEYS) delete process.env[k];
  });

  it('defaults all heavy background flags off', () => {
    withEnv({}, () => {
      expect(isPodcastMirrorEnabled()).toBe(false);
      expect(isPodcastWhisperEnabled()).toBe(false);
      expect(isDlnaEnvEnabled()).toBe(false);
      expect(isIngestWatcherEnvEnabled()).toBe(false);
    });
  });

  it('enables when set to 1 / true', () => {
    withEnv(
      {
        PODCAST_MIRROR_ENABLED: '1',
        PODCAST_WHISPER_ENABLED: 'true',
        TIER34_DLNA: 'yes',
        TIER34_INGEST_WATCHER: 'on',
      },
      () => {
        expect(isPodcastMirrorEnabled()).toBe(true);
        expect(isPodcastWhisperEnabled()).toBe(true);
        expect(isDlnaEnvEnabled()).toBe(true);
        expect(isIngestWatcherEnvEnabled()).toBe(true);
      },
    );
  });

  it('accepts DLNA_MEDIASERVER alias', () => {
    withEnv({ DLNA_MEDIASERVER: '1' }, () => {
      expect(isDlnaEnvEnabled()).toBe(true);
    });
  });
});
