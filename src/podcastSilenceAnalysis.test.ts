/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest';
import {
  detectSilenceRegionsInChannel,
  findSilenceRegionAt,
} from './podcastSilenceAnalysis';

describe('detectSilenceRegionsInChannel', () => {
  it('finds a long quiet gap between speech blocks', () => {
    const sampleRate = 44100;
    const samples = new Float32Array(44100 * 5);
    for (let i = 0; i < 44100; i++) samples[i] = 0.25;
    for (let i = 44100; i < 44100 * 2.5; i++) samples[i] = 0.0005;
    for (let i = 44100 * 2.5; i < 44100 * 3.5; i++) samples[i] = 0.2;
    const regions = detectSilenceRegionsInChannel(samples, sampleRate, 0.018, 380);
    expect(regions.length).toBeGreaterThanOrEqual(1);
    expect(regions[0]!.startSeconds).toBeCloseTo(1, 0);
    expect(regions[0]!.endSeconds).toBeCloseTo(2.5, 0);
  });
});

describe('findSilenceRegionAt', () => {
  it('returns an active region inside a silence window', () => {
    const region = findSilenceRegionAt(
      [{ startSeconds: 10, endSeconds: 14 }],
      12,
    );
    expect(region?.endSeconds).toBe(14);
  });
});
