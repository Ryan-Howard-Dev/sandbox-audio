import { describe, expect, it } from 'vitest';
import {
  findSeriesSiblings,
  parseBookSeries,
  recommendRelatedBooks,
  seriesKey,
  titleWithoutSeries,
} from './bookSeries';

const book = (title: string, author = 'A. Writer') => ({ title, author });

describe('parseBookSeries', () => {
  it('reads the punctuated forms', () => {
    expect(parseBookSeries('Mistborn, Book 2')).toMatchObject({ label: 'Mistborn', index: 2 });
    expect(parseBookSeries('Mistborn - Part 3')).toMatchObject({ label: 'Mistborn', index: 3 });
    expect(parseBookSeries('Mistborn: Volume 4')).toMatchObject({ label: 'Mistborn', index: 4 });
    expect(parseBookSeries('Mistborn Book 5')).toMatchObject({ label: 'Mistborn', index: 5 });
  });

  it('reads a bracketed series name', () => {
    expect(parseBookSeries('The Final Empire (Mistborn #1)')).toMatchObject({
      label: 'Mistborn',
      index: 1,
    });
    expect(parseBookSeries('The Well of Ascension (Mistborn, Book 2)')).toMatchObject({
      label: 'Mistborn',
      index: 2,
    });
  });

  it('reads numbers spelled out, which filenames do constantly', () => {
    expect(parseBookSeries('The Scared Mushroom, Book Two')).toMatchObject({
      label: 'The Scared Mushroom',
      index: 2,
    });
  });

  it('refuses a bare trailing number', () => {
    // "Catch 22" and "1984" are titles, not instalments. Inventing series from these would
    // scatter unrelated books into groups that are visibly wrong — worse than finding none.
    expect(parseBookSeries('Catch 22')).toBeNull();
    expect(parseBookSeries('1984')).toBeNull();
    expect(parseBookSeries('Slaughterhouse 5')).toBeNull();
  });

  it('returns null when there is no series marker at all', () => {
    expect(parseBookSeries('The Hobbit')).toBeNull();
    expect(parseBookSeries('')).toBeNull();
  });

  it('normalises the key so punctuation and a leading article do not split a series', () => {
    expect(seriesKey('The Dark Tower')).toBe(seriesKey('dark tower'));
    expect(seriesKey("Assassin's Apprentice")).toBe(seriesKey('Assassins Apprentice'));
  });
});

describe('titleWithoutSeries', () => {
  it('strips the suffix', () => {
    expect(titleWithoutSeries('Mistborn, Book 2')).toBe('Mistborn');
  });

  it('leaves a plain title alone', () => {
    expect(titleWithoutSeries('The Hobbit')).toBe('The Hobbit');
  });
});

describe('findSeriesSiblings', () => {
  const one = book('The Scared Mushroom, Book One');
  const two = book('The Scared Mushroom, Book Two');
  const three = book('The Scared Mushroom, Book Three');
  const other = book('Something Else');

  it('finds the earlier book from the later one', () => {
    // The reported case: on part 2, part 1 must be reachable.
    expect(findSeriesSiblings(two, [one, two, three, other])).toEqual([one, three]);
  });

  it('returns them in reading order regardless of library order', () => {
    expect(findSeriesSiblings(one, [three, other, two, one])).toEqual([two, three]);
  });

  it('excludes the book itself', () => {
    expect(findSeriesSiblings(two, [two])).toEqual([]);
  });

  it('excludes a duplicate at the same position', () => {
    // Two files both claiming book 2 is a double import, not a series entry.
    const twoAgain = book('The Scared Mushroom, Book 2');
    expect(findSeriesSiblings(two, [twoAgain])).toEqual([]);
  });

  it('returns nothing for a book with no series', () => {
    expect(findSeriesSiblings(other, [one, two, three])).toEqual([]);
  });
});

describe('recommendRelatedBooks', () => {
  const one = book('Dune, Book One', 'Frank Herbert');
  const two = book('Dune, Book Two', 'Frank Herbert');
  const sameAuthor = book('The Dosadi Experiment', 'Frank Herbert');
  const stranger = book('Neuromancer', 'William Gibson');

  it('puts the series ahead of the author', () => {
    // Someone on book two wants book one far more than an unrelated title by the same writer.
    const out = recommendRelatedBooks(two, [one, sameAuthor, stranger]);
    expect(out[0]).toBe(one);
    expect(out).toContain(sameAuthor);
    expect(out).not.toContain(stranger);
  });

  it('falls back to the author when there is no series', () => {
    expect(recommendRelatedBooks(sameAuthor, [one, two, stranger])).toEqual([one, two]);
  });

  it('never recommends a book twice', () => {
    const out = recommendRelatedBooks(two, [one, one, sameAuthor]);
    expect(new Set(out).size).toBe(out.length);
  });

  it('ignores an unknown author rather than grouping every orphan together', () => {
    const orphanA = book('Alpha', 'Unknown author');
    const orphanB = book('Beta', 'Unknown author');
    expect(recommendRelatedBooks(orphanA, [orphanB])).toEqual([]);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 20 }, (_, i) => book(`Title ${i}`, 'Frank Herbert'));
    expect(recommendRelatedBooks(sameAuthor, many, 3)).toHaveLength(3);
  });

  it('is safe on empty input', () => {
    expect(recommendRelatedBooks(null as never, [])).toEqual([]);
    expect(recommendRelatedBooks(one, [])).toEqual([]);
  });
});
