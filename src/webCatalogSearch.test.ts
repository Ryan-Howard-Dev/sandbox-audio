import { describe, expect, it } from 'vitest';
import { buildWebSearchQueries, parseYoutubeMusicTitleForTest } from './webCatalogSearch';

describe('buildWebSearchQueries', () => {
  it('expands dollar sign phrasing for Melrose-style queries', () => {
    const queries = buildWebSearchQueries('ye dollar sign melrose');
    expect(queries[0]).toBe('ye dollar sign melrose');
    expect(queries.some((q) => q.includes('$'))).toBe(true);
    expect(queries.some((q) => /melrose/i.test(q) && /kanye|ye/i.test(q))).toBe(true);
    expect(queries.every((q) => !/\bdress\b/i.test(q))).toBe(true);
  });

  it('expands Ye / Ty Dolla billing for Melrose-style queries', () => {
    const queries = buildWebSearchQueries('¥$, Ye, Ty Dolla $ign - Melrose');
    expect(queries.some((q) => /melrose/i.test(q) && /ty dolla/i.test(q))).toBe(true);
    expect(queries).toContain('Kanye West Melrose');
    expect(queries.some((q) => /melrose/i.test(q) && /kany|ye/i.test(q))).toBe(true);
    expect(queries.every((q) => !/\bdress\b/i.test(q))).toBe(true);
  });

  it('handles simple artist title queries', () => {
    const queries = buildWebSearchQueries('Radiohead Creep');
    expect(queries[0]).toBe('Radiohead Creep');
  });

  it('expands Kanye Backstreet Boys cover queries for YouTube', () => {
    const queries = buildWebSearchQueries('kanye backstreet');
    expect(queries.some((q) => /want it that way/i.test(q))).toBe(true);
    expect(queries.some((q) => /kanye/i.test(q) && /backstreet/i.test(q))).toBe(true);

    const cover = buildWebSearchQueries('backstreet boys kanye cover');
    expect(cover.some((q) => /karaoke|cover/i.test(q))).toBe(true);

    const title = buildWebSearchQueries('i want it that way kanye');
    expect(title.some((q) => /want it that way/i.test(q) && /kanye|ye/i.test(q))).toBe(true);
  });

  it('expands Take Off Your Dress leak queries without inventing titles', () => {
    const queries = buildWebSearchQueries('Kanye take off your dress');
    expect(queries[0]).toBe('Kanye take off your dress');
    expect(queries).toContain('Kanye West Take Off Your Dress');
    expect(queries.some((q) => /take off your dress/i.test(q) && /kanye|ye/i.test(q))).toBe(true);
    expect(queries.every((q) => !/\bdrip\b/i.test(q))).toBe(true);
    expect(queries.every((q) => !/\bmelrose\b/i.test(q))).toBe(true);
  });

  it('never substitutes drip for dress in web queries', () => {
    const dress = buildWebSearchQueries('take off your dress kanye');
    const drip = buildWebSearchQueries('take off your drip kanye');
    expect(dress.every((q) => !/\bdrip\b/i.test(q))).toBe(true);
    expect(drip.every((q) => !/\bdress\b/i.test(q))).toBe(true);
    expect(drip[0]).toBe('take off your drip kanye');
    expect(drip.some((q) => /\bdrip\b/i.test(q))).toBe(true);
  });

  it('parses YouTube title-first leak billing', () => {
    const parsed = parseYoutubeMusicTitleForTest(
      'TAKE OFF YOUR DRESS - ¥$, Kanye West, Ty Dolla $ign',
    );
    expect(parsed.title.toLowerCase()).toContain('take off your dress');
    expect(parsed.artist.toLowerCase()).toMatch(/kanye|ye/);
  });
});
