import { describe, expect, it } from 'vitest';
import {
  camelotSimilarity,
  camelotTransitionCost,
  parseMusicalKey,
  toCamelot,
} from './camelot';

describe('camelot', () => {
  it('maps Am to 8A', () => {
    expect(toCamelot(parseMusicalKey('Am'))).toBe('8A');
  });

  it('maps C major to 8B', () => {
    expect(toCamelot(parseMusicalKey('C'))).toBe('8B');
    expect(toCamelot(parseMusicalKey('C major'))).toBe('8B');
  });

  it('parses Camelot codes', () => {
    expect(parseMusicalKey('8A')?.label).toBe('Am');
    expect(parseMusicalKey('9B')?.label).toBe('G');
  });

  it('scores same key as free transition', () => {
    expect(camelotTransitionCost('8A', '8A')).toBe(0);
    expect(camelotSimilarity('8A', '8A')).toBe(1);
  });

  it('scores relative major/minor as low cost', () => {
    expect(camelotTransitionCost('8A', '8B')).toBeLessThan(0.2);
  });

  it('scores adjacent wheel steps lower than distant keys', () => {
    const adjacent = camelotTransitionCost('8A', '9A');
    const distant = camelotTransitionCost('8A', '2B');
    expect(adjacent).toBeLessThan(distant);
  });
});
