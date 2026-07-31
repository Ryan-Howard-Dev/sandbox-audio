import { describe, expect, it } from 'vitest';
import {
  buildLibrivoxSearchUrl,
  librivoxAuthorName,
  librivoxSectionsToChapters,
  normaliseBookKey,
  parseLibrivoxBooks,
  pickLibrivoxMatch,
  type LibrivoxBook,
} from './librivoxCrossRef';

function book(partial: Partial<LibrivoxBook> = {}): LibrivoxBook {
  return {
    id: 1,
    title: 'The Red House Mystery',
    authors: [{ first_name: 'A. A.', last_name: 'Milne' }],
    sections: [
      { section_number: '1', title: 'Chapter One', listen_url: 'https://x/1.mp3', playtime: '600' },
      { section_number: '2', title: 'Chapter Two', listen_url: 'https://x/2.mp3', playtime: '540' },
    ],
    ...partial,
  };
}

describe('normaliseBookKey', () => {
  it('ignores punctuation, case and a leading article', () => {
    expect(normaliseBookKey('The Red House Mystery')).toBe('red house mystery');
    expect(normaliseBookKey('red house mystery')).toBe('red house mystery');
    expect(normaliseBookKey("A Child's Garden")).toBe('childs garden');
  });

  it('is empty for nothing', () => {
    expect(normaliseBookKey(undefined)).toBe('');
  });
});

describe('pickLibrivoxMatch', () => {
  it('finds the recording of the same work', () => {
    const match = pickLibrivoxMatch([book()], 'The Red House Mystery', 'Milne, A. A.');
    expect(match?.id).toBe(1);
  });

  it('matches across article and punctuation differences', () => {
    const match = pickLibrivoxMatch(
      [book({ title: 'Red House Mystery, The' })],
      'The Red House Mystery',
      'Milne',
    );
    expect(match).toBeNull();
    const direct = pickLibrivoxMatch([book()], 'red house mystery', 'Milne');
    expect(direct?.id).toBe(1);
  });

  /*
   * The failure this guards against. "The Adventures of Sherlock Holmes" contains "Sherlock
   * Holmes", so substring matching would silently swap one book's chapters for another's —
   * far worse than leaving the sample warning in place.
   */
  it('refuses a substring match', () => {
    const candidates = [book({ id: 9, title: 'The Adventures of Sherlock Holmes' })];
    expect(pickLibrivoxMatch(candidates, 'Sherlock Holmes', 'Doyle')).toBeNull();
  });

  it('rejects a candidate with no sections, which repairs nothing', () => {
    expect(pickLibrivoxMatch([book({ sections: [] })], 'The Red House Mystery', 'Milne')).toBeNull();
  });

  it('returns null when nothing matches', () => {
    expect(pickLibrivoxMatch([book()], 'Moby Dick', 'Melville')).toBeNull();
    expect(pickLibrivoxMatch([], 'Anything', 'Anyone')).toBeNull();
  });

  /* Several volunteers record the same public-domain work. */
  it('prefers the matching author among duplicate recordings', () => {
    const wrong = book({ id: 2, authors: [{ first_name: 'Someone', last_name: 'Else' }] });
    const right = book({ id: 3, authors: [{ first_name: 'A. A.', last_name: 'Milne' }] });
    expect(pickLibrivoxMatch([wrong, right], 'The Red House Mystery', 'Milne, A. A.')?.id).toBe(3);
  });

  it('falls back to the most complete reading when no author matches', () => {
    const short = book({ id: 4, authors: [], sections: [book().sections![0]!] });
    const long = book({ id: 5, authors: [] });
    expect(pickLibrivoxMatch([short, long], 'The Red House Mystery', 'Unknown')?.id).toBe(5);
  });

  it('does not require the author, since catalogs credit editors and archives', () => {
    const anon = book({ id: 6, authors: [] });
    expect(pickLibrivoxMatch([anon], 'The Red House Mystery', 'Project Gutenberg')?.id).toBe(6);
  });
});

describe('librivoxSectionsToChapters', () => {
  it('converts sections into playable chapters', () => {
    const chapters = librivoxSectionsToChapters(book());
    expect(chapters).toHaveLength(2);
    expect(chapters[0]).toEqual({
      title: 'Chapter One',
      audioUrl: 'https://x/1.mp3',
      durationSeconds: 600,
      chapterNumber: 1,
    });
  });

  it('drops sections with no audio, which cannot be played', () => {
    const partial = book({
      sections: [{ section_number: '1', title: 'Broken' }, book().sections![1]!],
    });
    expect(librivoxSectionsToChapters(partial)).toHaveLength(1);
  });

  it('survives a missing title, number or playtime', () => {
    const messy = book({ sections: [{ listen_url: 'https://x/only.mp3' }] });
    const [chapter] = librivoxSectionsToChapters(messy);
    expect(chapter!.title).toBe('Chapter 1');
    expect(chapter!.chapterNumber).toBe(1);
    expect(chapter!.durationSeconds).toBeUndefined();
  });

  it('ignores a non-numeric playtime rather than emitting NaN', () => {
    const messy = book({ sections: [{ listen_url: 'https://x/1.mp3', playtime: 'unknown' }] });
    expect(librivoxSectionsToChapters(messy)[0]!.durationSeconds).toBeUndefined();
  });
});

describe('buildLibrivoxSearchUrl', () => {
  it('asks for JSON with sections included', () => {
    const url = buildLibrivoxSearchUrl('The Red House Mystery');
    expect(url).toContain('format=json');
    expect(url).toContain('extended=1');
    expect(url).toContain('title=The%20Red%20House%20Mystery');
  });

  /* Subtitles after a colon rarely match between catalogs and only narrow the search. */
  it('drops a subtitle to widen the search', () => {
    expect(buildLibrivoxSearchUrl('Frankenstein: or, The Modern Prometheus')).toContain(
      'title=Frankenstein',
    );
  });
});

describe('parseLibrivoxBooks', () => {
  it('reads the books array', () => {
    expect(parseLibrivoxBooks({ books: [book()] })).toHaveLength(1);
  });

  it('returns empty for junk rather than throwing', () => {
    expect(parseLibrivoxBooks(null)).toEqual([]);
    expect(parseLibrivoxBooks({})).toEqual([]);
    expect(parseLibrivoxBooks({ books: 'nope' })).toEqual([]);
  });
});

describe('librivoxAuthorName', () => {
  it('joins the name parts', () => {
    expect(librivoxAuthorName(book())).toBe('A. A. Milne');
  });

  it('is empty when the recording credits nobody', () => {
    expect(librivoxAuthorName(book({ authors: [] }))).toBe('');
  });
});
