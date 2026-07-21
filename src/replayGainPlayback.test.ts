import { describe, expect, it } from 'vitest';
import {
  computePlaybackGainDb,
  EBU_TARGET_LUFS,
  FALLBACK_LUFS_GAIN_DB,
} from './replayGainPlayback';

describe('computePlaybackGainDb', () => {
  it('uses tag gain when present', () => {
    expect(computePlaybackGainDb(-6.5)).toBe(-6.5);
  });

  it('falls back to EBU proxy when tag is 0 dB placeholder', () => {
    expect(computePlaybackGainDb(0)).toBe(FALLBACK_LUFS_GAIN_DB);
  });

  it('exports EBU target constant for docs parity', () => {
    expect(EBU_TARGET_LUFS).toBe(-14);
  });
});
