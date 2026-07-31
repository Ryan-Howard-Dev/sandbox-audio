import { describe, expect, it } from 'vitest';
import { isAnyAudiobookEnvelopeId, usesIntervalSeekTransport } from './spokenWordPlayback';

describe('isAnyAudiobookEnvelopeId', () => {
  it('covers both audiobook id shapes', () => {
    expect(isAnyAudiobookEnvelopeId('audiobook:local-42')).toBe(true);
    expect(isAnyAudiobookEnvelopeId('audiobook-catalog:librivox:19037:601981')).toBe(true);
  });

  it('rejects music and podcasts', () => {
    expect(isAnyAudiobookEnvelopeId('local-1')).toBe(false);
    expect(isAnyAudiobookEnvelopeId('podcast:feed:ep-1')).toBe(false);
    expect(isAnyAudiobookEnvelopeId('')).toBe(false);
    expect(isAnyAudiobookEnvelopeId(null)).toBe(false);
  });

  /*
   * `audiobook-catalog:` does not start with `audiobook:` — the hyphen breaks the prefix — so a
   * single startsWith check misses every Discover book.
   */
  it('does not rely on one prefix covering the other', () => {
    expect('audiobook-catalog:x'.startsWith('audiobook:')).toBe(false);
    expect(isAnyAudiobookEnvelopeId('audiobook-catalog:x')).toBe(true);
  });
});

describe('usesIntervalSeekTransport', () => {
  /*
   * Audiobooks were classified as music, so a twelve-hour book got music's transport: prev/next
   * jumped whole chapters, and shuffle/repeat sat there meaning nothing.
   */
  it('gives audiobooks the same interval seek podcasts already had', () => {
    expect(usesIntervalSeekTransport('podcast:feed:ep-1')).toBe(true);
    expect(usesIntervalSeekTransport('audiobook:local-42')).toBe(true);
    expect(usesIntervalSeekTransport('audiobook-catalog:librivox:19037:601981')).toBe(true);
  });

  it('leaves music on track-to-track transport', () => {
    expect(usesIntervalSeekTransport('local-1')).toBe(false);
    expect(usesIntervalSeekTransport('mix-radio-abc')).toBe(false);
    expect(usesIntervalSeekTransport('radio-xyz')).toBe(false);
  });

  it('is false for a missing id rather than throwing', () => {
    expect(usesIntervalSeekTransport(undefined)).toBe(false);
    expect(usesIntervalSeekTransport('   ')).toBe(false);
  });
});
