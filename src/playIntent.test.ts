import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cancelMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(async () => undefined),
}));

vi.mock('./ytDlpMobile', () => ({
  cancelYtDlpMobileResolve: cancelMock,
}));

import {
  beginPlayIntent,
  bumpPlayGeneration,
  currentPlayGeneration,
  formatMobilePlaybackError,
  isPlayIntentCurrent,
} from './playIntent';

describe('playIntent', () => {
  beforeEach(() => {
    cancelMock.mockClear();
    beginPlayIntent('seed');
    bumpPlayGeneration();
  });

  it('invalidates prior generation on new tap', () => {
    const genA = beginPlayIntent('track-a');
    expect(isPlayIntentCurrent(genA, 'track-a')).toBe(true);
    const genB = beginPlayIntent('track-b');
    expect(isPlayIntentCurrent(genA, 'track-a')).toBe(false);
    expect(isPlayIntentCurrent(genB, 'track-b')).toBe(true);
    expect(cancelMock).toHaveBeenCalled();
  });

  it('bumps generation for dismiss without changing envelope id', () => {
    const gen = beginPlayIntent('track-a');
    bumpPlayGeneration();
    expect(isPlayIntentCurrent(gen, 'track-a')).toBe(false);
    expect(currentPlayGeneration()).toBe(gen + 1);
  });

  it('shortens mobile resolve errors for UI', () => {
    expect(formatMobilePlaybackError('NO STREAM FOUND')).toBe('No stream found');
    expect(formatMobilePlaybackError('yt-dlp resolve timed out — check mobile data')).toBe(
      'Resolve timed out',
    );
    expect(formatMobilePlaybackError(null)).toBe('Playback unavailable');
  });
});
