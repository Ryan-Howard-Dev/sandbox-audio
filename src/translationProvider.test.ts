import { describe, expect, it, vi } from 'vitest';
import {
  describeTranslationResult,
  isRetryable,
  languagePair,
  normalizeLanguage,
  translatePassages,
  type TranslationEngine,
} from './translationProvider';

function engine(over: Partial<TranslationEngine> = {}): TranslationEngine {
  return {
    id: 'test',
    supportedPairs: async () => ['en-fr', 'fr-en'],
    installedPairs: async () => ['en-fr'],
    translate: async ({ texts }) => texts.map((t) => `[fr] ${t}`),
    ...over,
  };
}

describe('normalizeLanguage', () => {
  it('reduces a locale to the language a model is published for', () => {
    // EPUBs declare whatever they like; models are per language, and an unreduced locale looks
    // like an unsupported pair.
    expect(normalizeLanguage('en-GB')).toBe('en');
    expect(normalizeLanguage('pt_BR')).toBe('pt');
    expect(normalizeLanguage('  FR  ')).toBe('fr');
  });

  it('survives nothing at all', () => {
    expect(normalizeLanguage(undefined)).toBe('');
    expect(normalizeLanguage('')).toBe('');
  });

  it('builds a pair from two locales', () => {
    expect(languagePair('en-GB', 'FR')).toBe('en-fr');
  });
});

describe('translatePassages short circuits', () => {
  it('does not wake the engine for a passage already in the right language', async () => {
    const translate = vi.fn();
    const result = await translatePassages(
      { texts: ['hello'], from: 'en-GB', to: 'en' },
      engine({ translate }),
    );
    expect(result.status).toBe('sameLanguage');
    expect(translate).not.toHaveBeenCalled();
  });

  it('does not wake the engine for blank passages', async () => {
    const translate = vi.fn();
    const result = await translatePassages(
      { texts: ['   ', ''], from: 'en', to: 'fr' },
      engine({ translate }),
    );
    expect(result.status).toBe('empty');
    expect(translate).not.toHaveBeenCalled();
  });

  it('reports no engine rather than throwing', async () => {
    const result = await translatePassages({ texts: ['hi'], from: 'en', to: 'fr' }, null);
    expect(result.status).toBe('unavailable');
  });

  it('reports a missing language rather than guessing one', async () => {
    const result = await translatePassages({ texts: ['hi'], from: '', to: 'fr' }, engine());
    expect(result.status).toBe('unavailable');
  });
});

describe('translatePassages and models', () => {
  it('translates through an installed pair', async () => {
    const result = await translatePassages({ texts: ['one', 'two'], from: 'en', to: 'fr' }, engine());
    expect(result).toEqual({ status: 'translated', texts: ['[fr] one', '[fr] two'] });
  });

  it('separates a model that is not downloaded from one that does not exist', async () => {
    // Install something, versus give up: two different instructions for the reader.
    const notInstalled = await translatePassages(
      { texts: ['hi'], from: 'fr', to: 'en' },
      engine({ installedPairs: async () => [] }),
    );
    expect(notInstalled).toEqual({ status: 'modelMissing', pair: 'fr-en' });

    const noSuchModel = await translatePassages(
      { texts: ['hi'], from: 'en', to: 'ja' },
      engine({ installedPairs: async () => [] }),
    );
    expect(noSuchModel).toEqual({ status: 'unsupported', pair: 'en-ja' });
  });

  it('turns an engine that throws into an answer, not an exception', async () => {
    const result = await translatePassages(
      { texts: ['hi'], from: 'en', to: 'fr' },
      engine({
        translate: async () => {
          throw new Error('model failed to load');
        },
      }),
    );
    expect(result).toEqual({ status: 'unavailable', reason: 'model failed to load' });
  });

  it('refuses a reply that has lost the alignment', async () => {
    /*
     * A pane pairing passage 4 with translation 5 is worse than one that says it could not
     * translate: it is wrong in a way that looks right.
     */
    const result = await translatePassages(
      { texts: ['one', 'two', 'three'], from: 'en', to: 'fr' },
      engine({ translate: async () => ['only one'] }),
    );
    expect(result.status).toBe('unavailable');
    if (result.status === 'unavailable') {
      expect(result.reason).toContain('different number');
    }
  });

  it('passes the reduced languages to the engine, not the raw locales', async () => {
    const translate = vi.fn(async ({ texts }: { texts: readonly string[] }) => [...texts]);
    await translatePassages({ texts: ['hi'], from: 'en-GB', to: 'fr-CA' }, engine({ translate }));
    expect(translate).toHaveBeenCalledWith(expect.objectContaining({ from: 'en', to: 'fr' }));
  });
});

describe('reporting', () => {
  it('says nothing when there is nothing wrong', () => {
    expect(describeTranslationResult({ status: 'translated', texts: [] })).toBeNull();
    expect(describeTranslationResult({ status: 'empty' })).toBeNull();
  });

  it('gives each failure its own sentence', () => {
    const messages = [
      describeTranslationResult({ status: 'sameLanguage' }),
      describeTranslationResult({ status: 'modelMissing', pair: 'en-fr' }),
      describeTranslationResult({ status: 'unsupported', pair: 'en-ja' }),
      describeTranslationResult({ status: 'unavailable' }),
    ];
    expect(new Set(messages).size).toBe(4);
    expect(messages.every((m) => m && m.length > 0)).toBe(true);
  });

  it('knows which failures are worth retrying', () => {
    // A broken engine may work next time; a model that does not exist never will.
    expect(isRetryable({ status: 'unavailable' })).toBe(true);
    expect(isRetryable({ status: 'unsupported', pair: 'en-ja' })).toBe(false);
    expect(isRetryable({ status: 'modelMissing', pair: 'en-fr' })).toBe(false);
  });
});
