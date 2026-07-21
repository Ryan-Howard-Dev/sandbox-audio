import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import {
  isLosslessEnvelope,
  losslessBadgeLabel,
  resolvePlaybackFidelityLabel,
} from './trackFidelityLabel';

const t = (key: string, params?: Record<string, string | number>) => {
  if (key === 'player.fidelity.losslessFormat' && params?.format) {
    return `Lossless · ${params.format}`;
  }
  if (key === 'player.fidelity.losslessDefault') return 'Lossless · 24/44.1';
  if (key === 'player.menu.bitDepthStandard') return '16-bit · standard';
  return key;
};

function env(partial: Partial<MediaEnvelope> & Pick<MediaEnvelope, 'envelopeId'>): MediaEnvelope {
  return {
    title: 'Track',
    artist: 'Artist',
    url: '',
    durationSeconds: 200,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: '1',
    ...partial,
  };
}

describe('trackFidelityLabel', () => {
  it('detects FLAC locker paths', () => {
    const flac = env({
      envelopeId: 'local-1',
      url: 'blob:https://x/y/track.flac',
    });
    expect(isLosslessEnvelope(flac)).toBe(true);
    expect(losslessBadgeLabel(flac, t)).toBe('Lossless · FLAC');
  });

  it('shows default lossless badge when format unknown', () => {
    const debrid = env({
      envelopeId: 'd-1',
      provider: 'debrid',
      url: 'https://cdn.example/stream',
    });
    expect(isLosslessEnvelope(debrid)).toBe(true);
    expect(losslessBadgeLabel(debrid, t)).toBe('Lossless · 24/44.1');
  });

  it('combines stream label with policy for lossy streams', () => {
    const stream = env({
      envelopeId: 's-1',
      provider: 'proxy',
      transport: 'proxy',
      url: 'https://cdn.example/track.m4a',
      mimeType: 'audio/mp4',
    });
    expect(isLosslessEnvelope(stream)).toBe(false);
    expect(
      resolvePlaybackFidelityLabel(stream, {
        streamLabel: 'YT',
        t,
        policy: 'STANDARD',
      }),
    ).toBe('YT · 16-bit · standard');
  });
});
