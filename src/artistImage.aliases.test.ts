import { describe, expect, it } from 'vitest';
import { artistLookupCandidates } from './artistImage';

describe('artistLookupCandidates', () => {
  it('disambiguates Malice toward No Malice / Clipse', () => {
    const candidates = artistLookupCandidates('Malice').map((c) => c.toLowerCase());
    expect(candidates.some((c) => c.includes('no malice'))).toBe(true);
    expect(candidates.some((c) => c.includes('clipse'))).toBe(true);
  });
});
