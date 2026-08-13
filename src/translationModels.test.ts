import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPROX_PACK_BYTES,
  forgetLanguagePack,
  formatPackSize,
  installLanguagePack,
  listLanguagePacks,
  totalDownloadSize,
} from './translationModels';
import type { LanguagePair } from './translationProvider';

let installed: LanguagePair[] = [];

const deps = (over: Partial<Parameters<typeof installLanguagePack>[1]> = {}) => ({
  download: async () => undefined,
  readInstalled: () => installed,
  writeInstalled: (pairs: LanguagePair[]) => {
    installed = [...pairs];
  },
  ...over,
});

beforeEach(() => {
  installed = [];
});

describe('listing packs', () => {
  it('states a size for every pair, before anything is fetched', () => {
    // A download that reports its size afterwards has already spent the thing it should have
    // asked about.
    const packs = listLanguagePacks([]);
    expect(packs.length).toBeGreaterThan(0);
    expect(packs.every((p) => p.approxBytes > 0)).toBe(true);
  });

  it('marks what is already on the device', () => {
    const packs = listLanguagePacks(['en-fr']);
    expect(packs.find((p) => p.pair === 'en-fr')?.installed).toBe(true);
    expect(packs.find((p) => p.pair === 'en-de')?.installed).toBe(false);
  });
});

describe('formatPackSize', () => {
  it('says megabytes for a pack, because that is the unit of the decision', () => {
    // Measured from a real repository rather than estimated: an encoder, a merged decoder and a
    // tokenizer. Somebody agreeing to this needs the real figure, not a hopeful one.
    expect(formatPackSize(APPROX_PACK_BYTES)).toBe('110 MB');
  });

  it('scales down and up rather than printing a silly number', () => {
    expect(formatPackSize(400 * 1024)).toBe('400 KB');
    expect(formatPackSize(3 * 1024 * 1024 * 1024)).toBe('3.0 GB');
  });
});

describe('installLanguagePack', () => {
  it('downloads and records', async () => {
    const download = vi.fn(async () => undefined);
    const result = await installLanguagePack('en-fr', deps({ download }));
    expect(result).toEqual({ status: 'installed', pair: 'en-fr' });
    expect(download).toHaveBeenCalledOnce();
    expect(installed).toEqual(['en-fr']);
  });

  it('does not fetch something already on the device', async () => {
    installed = ['en-fr'];
    const download = vi.fn();
    const result = await installLanguagePack('en-fr', deps({ download }));
    expect(result.status).toBe('alreadyHave');
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses a pair that is not published, rather than fetching nothing', async () => {
    const download = vi.fn();
    const result = await installLanguagePack('en-klingon', deps({ download }));
    expect(result.status).toBe('unknownPair');
    expect(download).not.toHaveBeenCalled();
  });

  it('records nothing when the download fails', async () => {
    /*
     * A pair marked installed before its bytes land is one the engine tries to load and fails on,
     * and that surfaces as "the engine broke" rather than "the download did not finish" — which
     * sends somebody looking in entirely the wrong place.
     */
    const result = await installLanguagePack(
      'en-fr',
      deps({
        download: async () => {
          throw new Error('connection lost');
        },
      }),
    );
    expect(result).toEqual({ status: 'failed', pair: 'en-fr', reason: 'connection lost' });
    expect(installed).toEqual([]);
  });

  it('keeps what was already installed when a new one fails', async () => {
    installed = ['de-en'];
    await installLanguagePack(
      'en-fr',
      deps({
        download: async () => {
          throw new Error('nope');
        },
      }),
    );
    expect(installed).toEqual(['de-en']);
  });

  it('passes progress through so a download can be watched', async () => {
    const seen: number[] = [];
    await installLanguagePack(
      'en-fr',
      deps({
        download: async (_pair, onProgress) => {
          onProgress?.(0.5);
          onProgress?.(1);
        },
      }),
      (f) => seen.push(f),
    );
    expect(seen).toEqual([0.5, 1]);
  });
});

describe('forgetLanguagePack', () => {
  it('removes only the one asked for', () => {
    installed = ['en-fr', 'de-en'];
    expect(forgetLanguagePack('en-fr', deps())).toEqual(['de-en']);
  });

  it('is harmless for a pack that was never installed', () => {
    installed = ['de-en'];
    expect(forgetLanguagePack('en-fr', deps())).toEqual(['de-en']);
  });
});

describe('totalDownloadSize', () => {
  it('adds packs up, for a confirm step that has to say a number', () => {
    expect(totalDownloadSize(['en-fr', 'de-en'])).toBe(APPROX_PACK_BYTES * 2);
  });

  it('is nothing for nothing', () => {
    expect(totalDownloadSize([])).toBe(0);
  });
});
