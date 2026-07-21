import { describe, expect, it } from 'vitest';
import { resolveStemTrackId } from './stemTrackId';
import type { MediaEnvelope } from './sandboxLayer1';

describe('resolveStemTrackId', () => {
  it('strips local- prefix from locker envelopes', () => {
    const env = {
      envelopeId: 'local-abc123',
      title: 'T',
      artist: 'A',
      url: 'x',
      durationSeconds: 0,
      provider: 'blob',
      transport: 'element-src',
      sourceId: 'abc123',
    } satisfies MediaEnvelope;
    expect(resolveStemTrackId(env)).toBe('abc123');
  });

  it('uses content hash sourceId when present', () => {
    const hash = 'a'.repeat(64);
    const env = {
      envelopeId: 'stream-1',
      title: 'T',
      artist: 'A',
      url: 'x',
      durationSeconds: 0,
      provider: 'stream-proxy',
      transport: 'element-src',
      sourceId: hash,
    } satisfies MediaEnvelope;
    expect(resolveStemTrackId(env)).toBe(hash);
  });
});
