import { describe, expect, it } from 'vitest';
import {
  isCalibreArtefact,
  parseCalibreBookPath,
  planCalibreImport,
  readableCalibreBooks,
  unreadableCalibreFormats,
} from './calibreLibrary';

/*
 * A Calibre library is Author/Title (id)/File.epub with a cover and metadata.opf beside each book.
 * These read the tree rather than metadata.db on purpose: the folder carries the same facts, needs
 * no SQLite on every platform, and a half-copied library still imports the books that are there.
 */

const library = [
  'Calibre Library/metadata.db',
  'Calibre Library/Denzel Curry/Melt My Eyez (12)/Melt My Eyez - Denzel Curry.epub',
  'Calibre Library/Denzel Curry/Melt My Eyez (12)/cover.jpg',
  'Calibre Library/Denzel Curry/Melt My Eyez (12)/metadata.opf',
  'Calibre Library/A A Milne/The Red House Mystery (7)/The Red House Myst - A A Milne.epub',
  'Calibre Library/A A Milne/The Red House Mystery (7)/cover.jpg',
];

describe('parseCalibreBookPath', () => {
  it('reads author and title from the folders, and Calibre’s id', () => {
    expect(
      parseCalibreBookPath('Library/A A Milne/The Red House Mystery (7)/x.epub'),
    ).toEqual({ author: 'A A Milne', title: 'The Red House Mystery', calibreId: 7 });
  });

  /*
   * The filename is truncated by Calibre to keep paths short, so it can carry a clipped title.
   * Reading the folder instead is what stops books importing under half a name.
   */
  it('prefers the folder title over a truncated filename', () => {
    const parsed = parseCalibreBookPath(
      'Library/A A Milne/The Red House Mystery (7)/The Red House Myst - A A Milne.epub',
    );
    expect(parsed.title).toBe('The Red House Mystery');
  });

  it('handles a folder with no Calibre id', () => {
    expect(parseCalibreBookPath('Library/Author/Some Book/x.epub')).toEqual({
      author: 'Author',
      title: 'Some Book',
      calibreId: undefined,
    });
  });

  it('handles Windows separators', () => {
    expect(parseCalibreBookPath('Library\\Author\\Book (3)\\x.epub').title).toBe('Book');
  });

  it('returns nothing usable for a bare filename', () => {
    expect(parseCalibreBookPath('x.epub')).toEqual({});
  });
});

describe('planCalibreImport', () => {
  it('produces one candidate per book with its cover and opf', () => {
    const plan = planCalibreImport(library);
    expect(plan).toHaveLength(2);
    const milne = plan.find((b) => b.author === 'A A Milne')!;
    expect(milne.title).toBe('The Red House Mystery');
    expect(milne.coverPath).toContain('cover.jpg');
    const curry = plan.find((b) => b.author === 'Denzel Curry')!;
    expect(curry.opfPath).toContain('metadata.opf');
  });

  /*
   * Calibre keeps several formats of one book side by side. One entry per *folder* is what stops a
   * library importing every title twice.
   */
  it('keeps one entry per book when several formats exist', () => {
    const plan = planCalibreImport([
      'Lib/Author/Book (1)/Book - Author.epub',
      'Lib/Author/Book (1)/Book - Author.mobi',
      'Lib/Author/Book (1)/Book - Author.pdf',
    ]);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.format).toBe('epub');
  });

  it('prefers the epub regardless of listing order', () => {
    const plan = planCalibreImport([
      'Lib/Author/Book (1)/Book.mobi',
      'Lib/Author/Book (1)/Book.epub',
    ]);
    expect(plan[0]?.format).toBe('epub');
  });

  it('records a book that has no readable format rather than dropping it', () => {
    const plan = planCalibreImport(['Lib/Author/Book (1)/Book.mobi']);
    expect(plan).toHaveLength(1);
    expect(plan[0]?.format).toBe('other');
  });

  it('ignores covers, opf files and the database', () => {
    const plan = planCalibreImport([
      'Lib/metadata.db',
      'Lib/Author/Book (1)/cover.jpg',
      'Lib/Author/Book (1)/metadata.opf',
    ]);
    expect(plan).toEqual([]);
  });

  it('sorts by author then title so an import reads predictably', () => {
    const plan = planCalibreImport([
      'Lib/Zed/B Book (2)/x.epub',
      'Lib/Alice/Z Book (3)/x.epub',
      'Lib/Alice/A Book (4)/x.epub',
    ]);
    expect(plan.map((b) => `${b.author}/${b.title}`)).toEqual([
      'Alice/A Book',
      'Alice/Z Book',
      'Zed/B Book',
    ]);
  });

  it('ignores blanks and stray files', () => {
    expect(planCalibreImport(['', '   ', 'loose.epub'])).toEqual([]);
  });
});

describe('reporting what cannot be read', () => {
  it('separates readable books from the rest', () => {
    const plan = planCalibreImport([
      'Lib/A/One (1)/One.epub',
      'Lib/A/Two (2)/Two.mobi',
      'Lib/A/Three (3)/Three.pdf',
    ]);
    expect(readableCalibreBooks(plan).map((b) => b.title)).toEqual(['One']);
  });

  /*
   * An import that silently lands a third fewer books than the listener can see in Calibre is
   * worse than one that refuses: they have no way to tell it went wrong.
   */
  it('counts the formats it had to skip so the import can say so', () => {
    const plan = planCalibreImport([
      'Lib/A/One (1)/One.epub',
      'Lib/A/Two (2)/Two.mobi',
      'Lib/A/Three (3)/Three.pdf',
      'Lib/A/Four (4)/Four.pdf',
    ]);
    expect(unreadableCalibreFormats(plan)).toEqual({ mobi: 1, pdf: 2 });
  });

  it('reports nothing to skip for an all-epub library', () => {
    expect(unreadableCalibreFormats(planCalibreImport(['Lib/A/One (1)/One.epub']))).toEqual({});
  });
});

describe('isCalibreArtefact', () => {
  it('recognises Calibre’s own bookkeeping', () => {
    expect(isCalibreArtefact('Lib/metadata.db')).toBe(true);
    expect(isCalibreArtefact('Lib/.caltrash/Author/Book/x.epub')).toBe(true);
    expect(isCalibreArtefact('Lib/metadata_db_prefs_backup.json')).toBe(true);
  });

  it('leaves real books alone', () => {
    expect(isCalibreArtefact('Lib/Author/Book (1)/Book.epub')).toBe(false);
  });
});
