import { describe, expect, it } from 'vitest';
import {
  splitScrapedAuthorTitle,
  stripScrapedTitleSuffix,
} from '../tier34-server/lib/audiobookScrapeCore';

describe('stripScrapedTitleSuffix', () => {
  /*
   * Seen on device after the author split landed: the scrape sites title their posts for search
   * engines, so the tail followed the book onto the card, the player and the lock screen.
   */
  it('drops the SEO tail these sites append', () => {
    expect(stripScrapedTitleSuffix('The War of the Worlds Audiobook')).toBe(
      'The War of the Worlds',
    );
    expect(stripScrapedTitleSuffix('The Big Short Audio Book Online')).toBe('The Big Short');
    expect(stripScrapedTitleSuffix('Children of Time Audiobook')).toBe('Children of Time');
    expect(stripScrapedTitleSuffix('Dune Free Audiobook Download')).toBe('Dune');
  });

  it('only strips a trailing tail, never mid-title text', () => {
    expect(stripScrapedTitleSuffix('The Audiobook Murders')).toBe('The Audiobook Murders');
  });

  it('leaves an ordinary title untouched', () => {
    expect(stripScrapedTitleSuffix('Pride and Prejudice')).toBe('Pride and Prejudice');
  });

  it('never strips a title down to nothing', () => {
    expect(stripScrapedTitleSuffix('Audiobook')).toBe('Audiobook');
  });
});

describe('splitScrapedAuthorTitle', () => {
  /*
   * The case seen on device: the book rendered as "Hans Christian Andersen – Hans Christian
   * Andersen's Fairy Tales" by "Golden Audiobooks", so the author appeared twice inside the title
   * and not at all in the author field, while the site name appeared twice because the source
   * label already prints it.
   */
  it('splits the author out of a WordPress post title', () => {
    expect(
      splitScrapedAuthorTitle(
        "Hans Christian Andersen – Hans Christian Andersen's Fairy Tales",
        'Golden Audiobooks',
      ),
    ).toEqual({
      author: 'Hans Christian Andersen',
      title: "Hans Christian Andersen's Fairy Tales",
    });
  });

  it('accepts hyphen and em dash separators, not just en dash', () => {
    expect(splitScrapedAuthorTitle('Jane Austen - Emma', 'Site')).toEqual({
      author: 'Jane Austen',
      title: 'Emma',
    });
    expect(splitScrapedAuthorTitle('Jane Austen — Emma', 'Site')).toEqual({
      author: 'Jane Austen',
      title: 'Emma',
    });
  });

  it('falls back to the site name when there is no separator', () => {
    expect(splitScrapedAuthorTitle('Great Expectations', 'Golden Audiobooks')).toEqual({
      author: 'Golden Audiobooks',
      title: 'Great Expectations',
    });
  });

  /*
   * A hyphen inside a word is not an author separator. Requiring surrounding whitespace keeps
   * these intact instead of turning the first fragment into an author.
   */
  it('leaves hyphenated words alone', () => {
    expect(splitScrapedAuthorTitle('The Hitch-Hiker', 'Site')).toEqual({
      author: 'Site',
      title: 'The Hitch-Hiker',
    });
  });

  /*
   * A dash in a long leading clause is far more likely to be part of the title than an author, so
   * the whole string stays as the title rather than losing its first clause.
   */
  it('does not treat a long leading clause as an author', () => {
    const long = 'The Complete And Utterly Definitive Collected Works - Volume Two';
    expect(splitScrapedAuthorTitle(long, 'Site')).toEqual({ author: 'Site', title: long });
  });

  it('ignores an empty side rather than producing a blank field', () => {
    expect(splitScrapedAuthorTitle('Jane Austen -', 'Site')).toEqual({
      author: 'Site',
      title: 'Jane Austen -',
    });
    expect(splitScrapedAuthorTitle('- Emma', 'Site')).toEqual({ author: 'Site', title: '- Emma' });
  });

  it('trims surrounding whitespace', () => {
    expect(splitScrapedAuthorTitle('  Jane Austen – Emma  ', 'Site')).toEqual({
      author: 'Jane Austen',
      title: 'Emma',
    });
  });
});
