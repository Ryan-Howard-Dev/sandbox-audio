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

/*
 * The badge sits under the track title, where a listener is asking how good this sounds. It was
 * answering "which code path fetched the bytes" — "MOBILE" — which is true and useless on a phone.
 * A measured bitrate is a property of the audio, so it wins whenever the source reports one.
 */
describe('resolvePlaybackFidelityLabel — bitrate over transport', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params?.format ? `${params.format} lossless` : key;

  it('states the bitrate and codec instead of the transport', () => {
    const stream = env({
      envelopeId: 'b-1',
      provider: 'proxy',
      transport: 'proxy',
      url: 'https://cdn.example/track.m4a',
      mimeType: 'audio/mp4',
      bitrateKbps: 256,
    });
    expect(resolvePlaybackFidelityLabel(stream, { streamLabel: 'MOBILE', t })).toBe(
      'AAC · 256 kbps',
    );
  });

  it('states the bitrate alone when the codec is not identifiable', () => {
    const stream = env({
      envelopeId: 'b-2',
      provider: 'proxy',
      url: 'https://cdn.example/stream',
      bitrateKbps: 320,
    });
    expect(resolvePlaybackFidelityLabel(stream, { streamLabel: 'MOBILE', t })).toBe('320 kbps');
  });

  it('falls back to the transport only when no bitrate is known', () => {
    const stream = env({
      envelopeId: 'b-3',
      provider: 'proxy',
      url: 'https://cdn.example/track.mp3',
      mimeType: 'audio/mpeg',
    });
    expect(resolvePlaybackFidelityLabel(stream, { streamLabel: 'MOBILE', t })).toBe('MOBILE');
  });

  /* Lossless still wins — a FLAC is not improved by quoting its bitrate. */
  it('keeps the lossless badge ahead of any bitrate', () => {
    const stream = env({
      envelopeId: 'b-4',
      provider: 'local-vault',
      url: 'file:///music/track.flac',
      mimeType: 'audio/flac',
      bitrateKbps: 1411,
    });
    expect(resolvePlaybackFidelityLabel(stream, { streamLabel: 'LOCKER', t })).toBe(
      'FLAC lossless',
    );
  });
});

/*
 * "Lossless" only says nothing was thrown away, which is equally true of a 16-bit CD rip and a
 * studio master. When the file states its depth and rate — FLAC does, in STREAMINFO — the badge
 * should say what was captured instead.
 */
describe('resolvePlaybackFidelityLabel — depth and rate from the container', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params?.format ? `${params.format} lossless` : key;

  it('states depth and sample rate for a high-resolution FLAC', () => {
    const stream = env({
      envelopeId: 'f-1',
      provider: 'local-vault',
      url: 'file:///music/track.flac',
      mimeType: 'audio/flac',
      bitsPerSample: 24,
      sampleRateHz: 96_000,
    });
    expect(resolvePlaybackFidelityLabel(stream, { streamLabel: 'LOCKER', t })).toBe(
      'FLAC 24-bit 96 kHz',
    );
  });

  it('keeps a non-round rate readable', () => {
    const stream = env({
      envelopeId: 'f-2',
      provider: 'local-vault',
      url: 'file:///music/track.flac',
      mimeType: 'audio/flac',
      bitsPerSample: 24,
      sampleRateHz: 88_200,
    });
    expect(resolvePlaybackFidelityLabel(stream, { t })).toBe('FLAC 24-bit 88.2 kHz');
  });

  /* Without those figures it must not invent them — the older wording still applies. */
  it('falls back to the plain lossless badge when depth and rate are unknown', () => {
    const stream = env({
      envelopeId: 'f-3',
      provider: 'local-vault',
      url: 'file:///music/track.flac',
      mimeType: 'audio/flac',
    });
    expect(resolvePlaybackFidelityLabel(stream, { t })).toBe('FLAC lossless');
  });
});

/**
 * The badge answers two different questions once dynamic range is measured.
 *
 * Depth, rate and codec describe the container: whether anything was thrown away in encoding. DR
 * describes the master: whether anything was squeezed out before encoding ever happened. A 24-bit
 * file crushed to DR5 is losslessly storing something already flattened, and until this the badge
 * could not say so.
 */
describe('resolvePlaybackFidelityLabel — measured dynamic range', () => {
  const t = (key: string, params?: Record<string, string | number>) =>
    params?.format ? `${params.format} lossless` : key;

  const flac = env({
    envelopeId: 'f-dr',
    provider: 'local-vault',
    url: 'file:///music/track.flac',
    mimeType: 'audio/flac',
    bitsPerSample: 24,
    sampleRateHz: 96_000,
  });

  it('appends the measurement to what the container already said', () => {
    expect(resolvePlaybackFidelityLabel(flac, { t, dynamicRange: 12 })).toBe(
      'FLAC 24-bit 96 kHz · DR12',
    );
  });

  it('says nothing about range when nothing measured it', () => {
    // Never estimated, never inferred from bitrate. An unmeasured track is silent on the subject.
    expect(resolvePlaybackFidelityLabel(flac, { t })).toBe('FLAC 24-bit 96 kHz');
    expect(resolvePlaybackFidelityLabel(flac, { t, dynamicRange: null })).toBe(
      'FLAC 24-bit 96 kHz',
    );
  });

  it('exposes a crushed master that the container calls high resolution', () => {
    // The entire reason the number is here: this file is 24-bit and flattened, and both facts
    // now appear together.
    expect(resolvePlaybackFidelityLabel(flac, { t, dynamicRange: 5 })).toBe(
      'FLAC 24-bit 96 kHz · DR5',
    );
  });

  it('ignores a reading that is not a number', () => {
    expect(resolvePlaybackFidelityLabel(flac, { t, dynamicRange: Number.NaN })).toBe(
      'FLAC 24-bit 96 kHz',
    );
    expect(resolvePlaybackFidelityLabel(flac, { t, dynamicRange: -3 })).toBe(
      'FLAC 24-bit 96 kHz',
    );
  });

  it('does not put a range on a lossy stream', () => {
    /*
     * The measurement is only ever taken for lossless files, so a DR arriving alongside a bitrate
     * is a bug upstream. The badge stating it anyway would make that bug look like a feature.
     */
    const mp3 = env({
      envelopeId: 'm-1',
      url: 'https://example.org/a.mp3',
      mimeType: 'audio/mpeg',
      bitrateKbps: 128,
    });
    expect(resolvePlaybackFidelityLabel(mp3, { t, dynamicRange: 9 })).toBe('MP3 · 128 kbps');
  });
});
