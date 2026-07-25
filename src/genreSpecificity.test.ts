import { describe, expect, it } from 'vitest';
import {
  isGenericGenreLabel,
  pickMostSpecificGenre,
  splitGenreTags,
} from './genreSpecificity';

describe('isGenericGenreLabel', () => {
  it('flags umbrella genres', () => {
    expect(isGenericGenreLabel('hip hop')).toBe(true);
    expect(isGenericGenreLabel('Rock')).toBe(true);
    expect(isGenericGenreLabel('R&B')).toBe(true);
  });

  it('does not flag sub-genres', () => {
    expect(isGenericGenreLabel('trap')).toBe(false);
    expect(isGenericGenreLabel('nu metal')).toBe(false);
    expect(isGenericGenreLabel('cloud rap')).toBe(false);
  });
});

describe('pickMostSpecificGenre', () => {
  it('prefers a sub-genre over the more popular umbrella tag', () => {
    // Real MusicBrainz ordering for Denzel Curry — "hip hop" outranks "trap".
    expect(pickMostSpecificGenre(['hip hop', 'trap', 'conscious hip hop'])).toBe('trap');
    // A$AP Rocky
    expect(pickMostSpecificGenre(['hip hop', 'east coast hip hop', 'cloud rap'])).toBe(
      'east coast hip hop',
    );
  });

  it('keeps the top tag when it is already specific', () => {
    expect(pickMostSpecificGenre(['nu metal', 'rapcore', 'rap metal'])).toBe('nu metal');
  });

  it('falls back to the umbrella tag when nothing specific exists', () => {
    expect(pickMostSpecificGenre(['rock', 'pop'])).toBe('rock');
  });

  it('ignores blank entries and returns null when empty', () => {
    expect(pickMostSpecificGenre(['', '  ', undefined, null])).toBeNull();
    expect(pickMostSpecificGenre([])).toBeNull();
  });
});

describe('splitGenreTags', () => {
  it('splits umbrella + specific tags', () => {
    expect(splitGenreTags(['hip hop', 'trap', 'conscious hip hop'])).toEqual({
      genre: 'hip hop',
      subGenre: 'trap',
    });
  });

  it('uses the specific tag as the genre when no umbrella exists', () => {
    expect(splitGenreTags(['nu metal', 'rapcore'])).toEqual({ genre: 'nu metal' });
  });

  it('returns only the umbrella when nothing specific exists', () => {
    expect(splitGenreTags(['rock', 'pop'])).toEqual({ genre: 'rock' });
  });

  it('returns null when empty', () => {
    expect(splitGenreTags([])).toBeNull();
  });
});
