import { describe, expect, it } from 'vitest';
import { splitCamelCase, splitConcatenatedWords, splitTitleWords } from './titleWordSplit';

describe('splitCamelCase', () => {
  it('splits on a lower-to-upper boundary', () => {
    expect(splitCamelCase('ThescaredMusroom')).toBe('Thescared Musroom');
  });

  it('keeps acronyms together but releases the word after them', () => {
    expect(splitCamelCase('XMLHttpBook')).toBe('XML Http Book');
  });

  it('separates digits from letters', () => {
    expect(splitCamelCase('Part2')).toBe('Part 2');
    expect(splitCamelCase('2Books')).toBe('2 Books');
  });
});

describe('splitConcatenatedWords', () => {
  it('recovers a swallowed article', () => {
    expect(splitConcatenatedWords('thescared')).toEqual(['the', 'scared']);
  });

  it('prefers the fewest words', () => {
    // "theend" could be carved several ways; the shortest cover is the right one.
    expect(splitConcatenatedWords('theend')).toEqual(['the', 'end']);
  });

  it('returns null for a word that is already whole', () => {
    // Splitting a real word invents structure that was never there.
    expect(splitConcatenatedWords('mushroom')).toBeNull();
    expect(splitConcatenatedWords('the')).toBeNull();
  });

  it('returns null when the run is not fully understood', () => {
    // This is the safety rule: "Musroom" is a typo, and a partial split would produce nonsense.
    expect(splitConcatenatedWords('musroom')).toBeNull();
    expect(splitConcatenatedWords('zxqwv')).toBeNull();
  });

  it('does not strand single letters', () => {
    // "scaredd" must not become "scared" + "d".
    expect(splitConcatenatedWords('scaredd')).toBeNull();
  });

  it('ignores anything that is not plain letters', () => {
    expect(splitConcatenatedWords('the-end')).toBeNull();
    expect(splitConcatenatedWords('book2')).toBeNull();
  });
});

describe('splitTitleWords', () => {
  it('handles the reported case', () => {
    // Spaces are recoverable; the missing 'h' in Musroom is not, and is left as the author's.
    expect(splitTitleWords('ThescaredMusroom')).toBe('The scared Musroom');
  });

  it('leaves a properly spaced title alone', () => {
    expect(splitTitleWords('The Hobbit')).toBe('The Hobbit');
    expect(splitTitleWords('A Game of Thrones')).toBe('A Game of Thrones');
  });

  it('still fixes camel case inside an otherwise spaced title', () => {
    expect(splitTitleWords('The LostBoy')).toBe('The Lost Boy');
  });

  it('keeps the leading capital', () => {
    expect(splitTitleWords('Thelastking')).toBe('The last king');
  });

  it('leaves an unrecognised name untouched', () => {
    // A proper noun it cannot parse must survive exactly as it arrived.
    expect(splitTitleWords('Kvothe')).toBe('Kvothe');
    expect(splitTitleWords('Silmarillion')).toBe('Silmarillion');
  });

  it('is safe on empty and junk input', () => {
    expect(splitTitleWords('')).toBe('');
    expect(splitTitleWords('   ')).toBe('');
    expect(splitTitleWords('!!!')).toBe('!!!');
  });

  it('does not touch very long runs, where a wrong guess is expensive', () => {
    const long = 'a'.repeat(40);
    expect(splitTitleWords(long)).toBe(long);
  });
});
