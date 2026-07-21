import { beforeEach, describe, expect, it } from 'vitest';
import {
  PLAYBACK_SESSION_KEY,
  shouldAutoRestorePlayerOnLoad,
  shouldRestoreLastPlayIntentOnLoad,
  type PersistedQueueState,
} from './queuePersistence';

const sampleQueue = (): PersistedQueueState => ({
  version: 1,
  savedAt: Date.now(),
  playQueue: [
    {
      envelopeId: 'search-hit-1',
      title: 'Creep',
      artist: 'Radiohead',
      provider: 'https',
    },
  ],
  queueIndex: 0,
  shuffleOn: false,
  repeatMode: 'none',
  currentTrackId: 'search-hit-1',
  currentTimeSeconds: 12,
  wasPlaying: true,
});

describe('playback restore guards', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('does not auto-restore queue track on cold start', () => {
    expect(shouldAutoRestorePlayerOnLoad(sampleQueue())).toBe(false);
    expect(shouldRestoreLastPlayIntentOnLoad()).toBe(false);
  });

  it('restores in-session when playback session marker is set', () => {
    sessionStorage.setItem(PLAYBACK_SESSION_KEY, '1');
    expect(shouldAutoRestorePlayerOnLoad(sampleQueue())).toBe(true);
  });
});
