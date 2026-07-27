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

/*
 * These assertions changed deliberately. The previous versions encoded three claims the app could
 * not support: that a debrid source is lossless because of its provider, that unknown lossless is
 * "24/44.1", and that a lossy stream carries the bit depth named by the user's fidelity *setting*.
 * The badge now states only what the source actually identifies.
 */
describe('trackFidelityLabel', () => {
  it('detects FLAC locker paths', () => {
    const flac = env({ envelopeId: 'local-1', url: 'blob:https://x/y/track.flac' });
    expect(isLosslessEnvelope(flac)).toBe(true);
    expect(losslessBadgeLabel(flac, t)).toBe('Lossless · FLAC');
  });

  it('detects lossless by mime as well as extension', () => {
    const alac = env({ envelopeId: 'local-2', mimeType: 'audio/alac' });
    expect(isLosslessEnvelope(alac)).toBe(true);
    expect(losslessBadgeLabel(alac, t)).toBe('Lossless · ALAC');
  });

  /*
   * Debrid sources are often lossless rips, but the provider alone is a guess. Claiming lossless
   * from it presented that guess as a measurement.
   */
  it('does not claim lossless from the debrid provider alone', () => {
    const debrid = env({
      envelopeId: 'd-1',
      provider: 'debrid',
      url: 'https://cdn.example/stream',
    });
    expect(isLosslessEnvelope(debrid)).toBe(false);
  });

  it('still detects a debrid source that names a lossless format', () => {
    const debridFlac = env({
      envelopeId: 'd-2',
      provider: 'debrid',
      url: 'https://cdn.example/rip.flac',
    });
    expect(isLosslessEnvelope(debridFlac)).toBe(true);
    expect(losslessBadgeLabel(debridFlac, t)).toBe('Lossless · FLAC');
  });

  /*
   * The regression this exists for: a 64 kbps LibriVox MP3 rendered "MOBILE · 24-BIT · LOSSLESS",
   * because the lossy branch appended the configured fidelity policy. The policy describes a
   * setting, not the audio.
   */
  it('never reports the fidelity policy as a property of a lossy stream', () => {
    const stream = env({
      envelopeId: 's-1',
      provider: 'proxy',
      transport: 'proxy',
      url: 'https://archive.org/download/x/chapter_64kb.mp3',
      mimeType: 'audio/mpeg',
    });
    expect(isLosslessEnvelope(stream)).toBe(false);
    for (const policy of ['STANDARD', 'HIGH', 'LOSSLESS'] as const) {
      expect(resolvePlaybackFidelityLabel(stream, { streamLabel: 'MOBILE', t, policy })).toBe(
        'MOBILE',
      );
    }
  });

  it('shows nothing rather than a guess when the source is unknown', () => {
    const stream = env({ envelopeId: 's-2', provider: 'proxy', url: 'https://cdn.example/a' });
    expect(resolvePlaybackFidelityLabel(stream, { t, policy: 'LOSSLESS' })).toBeNull();
    expect(resolvePlaybackFidelityLabel(stream, { streamLabel: '  ', t })).toBeNull();
  });

  it('prefers the real format over the stream label when both are known', () => {
    const flac = env({ envelopeId: 'f-1', url: 'https://cdn.example/a.flac' });
    expect(resolvePlaybackFidelityLabel(flac, { streamLabel: 'LAN', t })).toBe('Lossless · FLAC');
  });

  it('returns null without an envelope', () => {
    expect(resolvePlaybackFidelityLabel(null, { streamLabel: 'LAN', t })).toBeNull();
  });
});
