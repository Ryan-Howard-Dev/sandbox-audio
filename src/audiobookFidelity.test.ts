import { describe, expect, it } from 'vitest';
import {
  FIDELITY_SAMPLE_RATIO,
  canFeatureAudiobook,
  classifyAudiobookFidelity,
  estimateWordsFromBytes,
  expectedNarrationSeconds,
  fidelityRatio,
} from './audiobookFidelity';

describe('estimateWordsFromBytes', () => {
  it('estimates words from byte length', () => {
    expect(estimateWordsFromBytes(600_000)).toBe(100_000);
  });

  it('is zero for missing or nonsense sizes', () => {
    expect(estimateWordsFromBytes(0)).toBe(0);
    expect(estimateWordsFromBytes(-5)).toBe(0);
    expect(estimateWordsFromBytes(Number.NaN)).toBe(0);
  });
});

describe('expectedNarrationSeconds', () => {
  /* 850 kB of text is roughly 141k words, which is over fifteen hours of narration. */
  it('projects a novel to a plausible narration length', () => {
    const seconds = expectedNarrationSeconds(850_000);
    const hours = seconds / 3600;
    expect(hours).toBeGreaterThan(14);
    expect(hours).toBeLessThan(17);
  });

  it('honours a caller-supplied narration rate', () => {
    const slow = expectedNarrationSeconds(600_000, 100);
    const fast = expectedNarrationSeconds(600_000, 200);
    expect(slow).toBeGreaterThan(fast);
  });

  it('is zero rather than infinite for a zero rate', () => {
    expect(expectedNarrationSeconds(600_000, 0)).toBe(0);
  });
});

describe('classifyAudiobookFidelity', () => {
  /*
   * The case this module exists for, taken from a real catalog entry: The Red House Mystery
   * presented as "1 chapter · 16:50" for a full novel, because Gutendex mapped audio/mpeg to one
   * file out of a directory.
   */
  it('calls a sixteen-minute file of a five-hour novel a sample', () => {
    expect(
      classifyAudiobookFidelity({ textBytes: 850_000, actualSeconds: 1010, chapterCount: 1 }),
    ).toBe('sample');
  });

  it('accepts audio that plausibly matches the text', () => {
    const expected = expectedNarrationSeconds(850_000);
    expect(
      classifyAudiobookFidelity({ textBytes: 850_000, actualSeconds: expected, chapterCount: 1 }),
    ).toBe('complete');
  });

  /*
   * Abridgements and brisk narrators produce genuinely shorter recordings. Calling a real
   * audiobook a sample hides it; the threshold is deliberately forgiving.
   */
  it('accepts a fast or abridged reading well under the estimate', () => {
    const expected = expectedNarrationSeconds(850_000);
    expect(
      classifyAudiobookFidelity({
        textBytes: 850_000,
        actualSeconds: expected * 0.4,
        chapterCount: 1,
      }),
    ).toBe('complete');
  });

  it('treats the threshold itself as complete', () => {
    const expected = expectedNarrationSeconds(600_000);
    expect(
      classifyAudiobookFidelity({
        textBytes: 600_000,
        actualSeconds: expected * FIDELITY_SAMPLE_RATIO,
        chapterCount: 1,
      }),
    ).toBe('complete');
  });

  /* A real multi-chapter manifest is not the single-file fault this guards against. */
  it('accepts a multi-chapter listing without measuring', () => {
    expect(
      classifyAudiobookFidelity({ textBytes: 850_000, actualSeconds: 60, chapterCount: 37 }),
    ).toBe('complete');
  });

  it('says unverified rather than guessing when the text size is unknown', () => {
    expect(classifyAudiobookFidelity({ actualSeconds: 1010, chapterCount: 1 })).toBe('unverified');
    expect(classifyAudiobookFidelity({ textBytes: null, actualSeconds: 1010 })).toBe('unverified');
  });

  it('says unverified when the duration is unknown', () => {
    expect(classifyAudiobookFidelity({ textBytes: 850_000, chapterCount: 1 })).toBe('unverified');
    expect(classifyAudiobookFidelity({ textBytes: 850_000, actualSeconds: 0 })).toBe('unverified');
  });
});

describe('fidelityRatio', () => {
  it('is measured over expected', () => {
    const expected = expectedNarrationSeconds(600_000);
    expect(fidelityRatio({ textBytes: 600_000, actualSeconds: expected / 2 })).toBeCloseTo(0.5, 2);
  });

  it('is null when either side is missing', () => {
    expect(fidelityRatio({ actualSeconds: 100 })).toBeNull();
    expect(fidelityRatio({ textBytes: 100_000 })).toBeNull();
  });
});

describe('canFeatureAudiobook', () => {
  /* Featured is a recommendation; recommending a fragment as a novel is the whole failure. */
  it('only features entries that pass', () => {
    expect(canFeatureAudiobook('complete')).toBe(true);
    expect(canFeatureAudiobook('sample')).toBe(false);
  });

  it('keeps unchecked entries out of a shelf that promises books', () => {
    expect(canFeatureAudiobook('unverified')).toBe(false);
  });
});
