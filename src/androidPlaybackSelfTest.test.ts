import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: vi.fn(() => 'web') },
}));

vi.mock('./androidNativePlayback', () => ({
  prepareNativeExoPlayback: vi.fn(async () => ({ ok: true, message: 'ready' })),
  nativeExoPlayUrl: vi.fn(async () => {}),
  nativeExoStop: vi.fn(async () => {}),
  getNativeExoPlaybackStatus: vi.fn(async () => ({ state: 'playing' })),
  NativeExoPlayback: {},
}));

vi.mock('./backgroundMedia', () => ({
  configureAndroidAudioSession: vi.fn(async () => null),
}));

vi.mock('./prefsStorage', () => ({
  prefsGetItem: vi.fn(() => null),
  prefsSetItem: vi.fn(),
}));

import {
  buildAudibleTestToneWavBytes,
  runAndroidPlaybackSelfTest,
} from './androidPlaybackSelfTest';

describe('buildAudibleTestToneWavBytes', () => {
  it('produces a valid RIFF WAV larger than the silent prime', () => {
    const bytes = buildAudibleTestToneWavBytes();
    const header = String.fromCharCode(bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!);
    expect(header).toBe('RIFF');
    expect(bytes.length).toBeGreaterThan(1000);
  });

  it('contains non-zero PCM samples (audible tone, not silence)', () => {
    const bytes = buildAudibleTestToneWavBytes({ durationSec: 0.1, amplitude: 0.8 });
    const pcm = bytes.subarray(44);
    let peak = 0;
    for (let i = 0; i + 1 < pcm.length; i += 2) {
      const sample = pcm[i]! | (pcm[i + 1]! << 8);
      const signed = sample > 32767 ? sample - 65536 : sample;
      peak = Math.max(peak, Math.abs(signed));
    }
    expect(peak).toBeGreaterThan(8000);
  });
});

describe('runAndroidPlaybackSelfTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns Android-only message on web', async () => {
    const result = await runAndroidPlaybackSelfTest();
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Android-only');
  });

  it('is not auto-invoked on app mount (user taps tester button only)', () => {
    const layer3 = readFileSync(join(import.meta.dirname, 'sandboxLayer3.tsx'), 'utf8');
    expect(layer3).not.toMatch(/runAndroidPlaybackSelfTest\s*\(/);
  });
});
