import { describe, expect, it, vi } from 'vitest';
import { needsTravelPrefetch } from './prepareForTravel';
import type { MediaEnvelope } from './sandboxLayer1';

const env = (
  partial: Partial<MediaEnvelope> & Pick<MediaEnvelope, 'envelopeId'>,
): MediaEnvelope => ({
  title: 'Track',
  artist: 'Artist',
  url: 'https://example.com/a.mp3',
  durationSeconds: 200,
  provider: 'https',
  transport: 'element-src',
  sourceId: partial.envelopeId,
  ...partial,
});

describe('needsTravelPrefetch', () => {
  it('skips locker and stream-cache tracks', () => {
    expect(needsTravelPrefetch(env({ envelopeId: 'a', provider: 'local-vault' }))).toBe(false);
    expect(needsTravelPrefetch(env({ envelopeId: 'b', provider: 'stream-cache' }))).toBe(false);
  });

  it('includes remote catalog tracks', () => {
    expect(needsTravelPrefetch(env({ envelopeId: 'c', provider: 'https' }))).toBe(true);
  });
});

describe('prepareTracksForTravel', () => {
  it('blocks on cellular network', async () => {
    vi.stubGlobal('navigator', {
      onLine: true,
      connection: { type: 'cellular', saveData: false },
    });
    const { prepareTracksForTravel } = await import('./prepareForTravel');
    const result = await prepareTracksForTravel([
      env({ envelopeId: 'x', provider: 'https' }),
    ]);
    expect(result.blockedReason).toBe('cellular');
    vi.unstubAllGlobals();
  });
});
