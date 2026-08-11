import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BERGAMOT_MODELS_KEY,
  BERGAMOT_PAIRS,
  createBergamotEngine,
  loadInstalledPairs,
  pairsForLanguage,
  saveInstalledPairs,
  targetsForLanguage,
  type BergamotRuntime,
} from './bergamotEngine';
import { translatePassages } from './translationProvider';

function runtime(over: Partial<BergamotRuntime> = {}): BergamotRuntime {
  return {
    load: async () => undefined,
    translate: async (_pair, texts) => texts.map((t) => `>${t}`),
    ...over,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('installed pairs', () => {
  it('remembers what has been downloaded', () => {
    saveInstalledPairs(['en-fr', 'de-en']);
    expect(loadInstalledPairs().sort()).toEqual(['de-en', 'en-fr']);
  });

  it('drops a pair that has no model behind it', () => {
    // A hand-edited pref must not make the app promise a pack that cannot exist.
    localStorage.setItem(BERGAMOT_MODELS_KEY, JSON.stringify(['en-fr', 'en-klingon']));
    expect(loadInstalledPairs()).toEqual(['en-fr']);
  });

  it('survives a corrupt record', () => {
    localStorage.setItem(BERGAMOT_MODELS_KEY, 'not json');
    expect(loadInstalledPairs()).toEqual([]);
  });

  it('does not record a pair twice', () => {
    saveInstalledPairs(['en-fr', 'en-fr']);
    expect(loadInstalledPairs()).toEqual(['en-fr']);
  });
});

describe('what a document can be shown as', () => {
  it('offers the targets published for its language', () => {
    expect(targetsForLanguage('en')).toContain('fr');
    expect(targetsForLanguage('fr')).toContain('en');
  });

  it('reduces a locale before looking', () => {
    expect(targetsForLanguage('en-GB')).toContain('de');
  });

  it('offers nothing for a language with no models', () => {
    expect(pairsForLanguage('klingon')).toEqual([]);
    expect(targetsForLanguage('')).toEqual([]);
  });

  it('never offers a pivot through a third language', () => {
    /*
     * fr to de would have to go through English, and a translation of a translation compounds the
     * first hop's mistakes into sentences that read fluently and say something else.
     */
    expect(pairsForLanguage('fr')).toEqual(['fr-en']);
    expect(BERGAMOT_PAIRS.every((pair) => pair.includes('en'))).toBe(true);
  });
});

describe('the engine', () => {
  it('loads no runtime until a translation is actually asked for', async () => {
    const loadRuntime = vi.fn(async () => runtime());
    const engine = createBergamotEngine({ loadRuntime, readInstalled: () => ['en-fr'] });

    await engine.supportedPairs();
    await engine.installedPairs();
    expect(loadRuntime).not.toHaveBeenCalled();

    await engine.translate({ texts: ['hello'], from: 'en', to: 'fr' });
    expect(loadRuntime).toHaveBeenCalledTimes(1);
  });

  it('loads a model once and reuses it', async () => {
    const load = vi.fn(async () => undefined);
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime({ load }),
      readInstalled: () => ['en-fr'],
    });
    await engine.translate({ texts: ['one'], from: 'en', to: 'fr' });
    await engine.translate({ texts: ['two'], from: 'en', to: 'fr' });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps blank passages out of the batch and puts them back in place', async () => {
    /*
     * Some models answer a blank input with an invented sentence, which then appears beside a
     * blank original as text the book does not contain.
     */
    const translate = vi.fn(async (_pair: string, texts: readonly string[]) =>
      texts.map((t) => `>${t}`),
    );
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime({ translate }),
      readInstalled: () => ['en-fr'],
    });

    const out = await engine.translate({
      texts: ['one', '   ', 'three'],
      from: 'en',
      to: 'fr',
    });

    expect(translate).toHaveBeenCalledWith('en-fr', ['one', 'three']);
    expect(out).toEqual(['>one', '', '>three']);
  });

  it('asks for nothing when every passage is blank', async () => {
    const translate = vi.fn();
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime({ translate }),
      readInstalled: () => ['en-fr'],
    });
    const out = await engine.translate({ texts: ['', '  '], from: 'en', to: 'fr' });
    expect(translate).not.toHaveBeenCalled();
    expect(out).toEqual(['', '']);
  });

  it('refuses a reply that has lost the alignment', async () => {
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime({ translate: async () => ['only one'] }),
      readInstalled: () => ['en-fr'],
    });
    await expect(
      engine.translate({ texts: ['a', 'b'], from: 'en', to: 'fr' }),
    ).rejects.toThrow(/different number/);
  });
});

describe('through the provider', () => {
  it('translates when the pair is installed', async () => {
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime(),
      readInstalled: () => ['en-fr'],
    });
    const result = await translatePassages({ texts: ['hello'], from: 'en-GB', to: 'fr' }, engine);
    expect(result).toEqual({ status: 'translated', texts: ['>hello'] });
  });

  it('asks for a download rather than failing when the pack is absent', async () => {
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime(),
      readInstalled: () => [],
    });
    const result = await translatePassages({ texts: ['hello'], from: 'en', to: 'fr' }, engine);
    expect(result).toEqual({ status: 'modelMissing', pair: 'en-fr' });
  });

  it('says plainly when no pack could ever exist', async () => {
    const engine = createBergamotEngine({
      loadRuntime: async () => runtime(),
      readInstalled: () => [],
    });
    const result = await translatePassages({ texts: ['hello'], from: 'fr', to: 'de' }, engine);
    expect(result).toEqual({ status: 'unsupported', pair: 'fr-de' });
  });

  it('reports a runtime that will not load as retryable', async () => {
    const engine = createBergamotEngine({
      loadRuntime: async () => {
        throw new Error('wasm missing');
      },
      readInstalled: () => ['en-fr'],
    });
    const result = await translatePassages({ texts: ['hello'], from: 'en', to: 'fr' }, engine);
    expect(result.status).toBe('unavailable');
  });
});
