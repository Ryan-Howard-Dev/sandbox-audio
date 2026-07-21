import { describe, expect, it } from 'vitest';
import {
  canonicalizeTastePayload,
  parseTasteManifestJson,
  signTasteRecipe,
  verifyTasteManifest,
  type TasteRecipePayload,
} from './tasteManifest';

function samplePayload(stationName = 'Test Station'): TasteRecipePayload {
  return {
    version: 1,
    stationName,
    createdAt: 1_700_000_000_000,
    seeds: { artistNames: ['Artist A'], genres: ['electronic'] },
    weights: { genreAffinity: { electronic: 2 }, artistAffinity: {} },
    sonicPrefs: { targetBpm: 120 },
    stationMix: { kind: 'sonic-locker' },
  };
}

describe('parseTasteManifestJson', () => {
  it('rejects invalid JSON', () => {
    expect(() => parseTasteManifestJson('not-json')).toThrow(/Invalid JSON/);
  });

  it('rejects unknown manifest kind', () => {
    expect(() =>
      parseTasteManifestJson(JSON.stringify({ kind: 'other', payload: {} })),
    ).toThrow(/Unknown manifest kind/);
  });

  it('parses a minimal signed manifest structure', async () => {
    const signed = await signTasteRecipe(samplePayload());
    const raw = JSON.stringify(signed);
    const parsed = parseTasteManifestJson(raw);
    expect(parsed.kind).toBe('sandbox-taste-recipe');
    expect(parsed.payload.stationName).toBe('Test Station');
    expect(parsed.contentHash).toBe(signed.contentHash);
  }, 15_000);
});

describe('verifyTasteManifest', () => {
  it('validates a freshly signed manifest', async () => {
    const signed = await signTasteRecipe(samplePayload());
    const result = await verifyTasteManifest(signed);
    expect(result.valid).toBe(true);
    expect(result.contentHashOk).toBe(true);
    expect(result.signatureOk).toBe(true);
    expect(result.provenanceLabel).toBeTruthy();
  });

  it('fails when payload is tampered after signing', async () => {
    const signed = await signTasteRecipe(samplePayload());
    signed.payload.stationName = 'Tampered';
    const result = await verifyTasteManifest(signed);
    expect(result.valid).toBe(false);
    expect(result.contentHashOk).toBe(false);
  });
});

describe('canonicalizeTastePayload', () => {
  it('sorts keys for stable hashing', () => {
    const a = canonicalizeTastePayload(samplePayload('A'));
    const b = canonicalizeTastePayload({
      ...samplePayload('A'),
      seeds: { genres: ['electronic'], artistNames: ['Artist A'] },
    });
    expect(a).toBe(b);
  });
});
