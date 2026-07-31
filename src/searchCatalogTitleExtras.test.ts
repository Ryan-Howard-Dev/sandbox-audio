import { describe, expect, it } from 'vitest';
import { titleTokensBeyondQuery } from './searchCatalog';

describe('titleTokensBeyondQuery', () => {
  const query = 'Kendrick Lamar HUMBLE';

  it('finds nothing extra in the recording that was asked for', () => {
    expect(titleTokensBeyondQuery('HUMBLE.', query, 'Kendrick Lamar')).toBe(0);
  });

  it('counts the words that make a remix a different recording', () => {
    // These are exactly the rows that outranked the album version on device: every token the
    // query can match is present, plus three the listener never asked for.
    expect(
      titleTokensBeyondQuery('HUMBLE. (Bassjackers Remix) [Mixed]', query, 'Kendrick Lamar'),
    ).toBe(3);
    expect(
      titleTokensBeyondQuery('HUMBLE. (The Caracal Project Remix) [Mixed]', query, 'Kendrick Lamar'),
      // caracal, project, remix, mixed — "the" is a stop word.
    ).toBe(4);
    expect(titleTokensBeyondQuery('HUMBLE. (Mixed)', query, 'Kendrick Lamar')).toBe(1);
  });

  it('counts karaoke and instrumental padding', () => {
    expect(
      titleTokensBeyondQuery(
        'Humble (Originally Performed by Kendrick Lamar) [Instrumental Version]',
        query,
        'Karaoke Freaks',
      ),
      // originally, performed, by, instrumental, version — "by" is not in the stop-word set.
    ).toBe(5);
  });

  it('counts a featured performer the query did not name', () => {
    expect(titleTokensBeyondQuery('HUMBLE (feat. Karen Briggs)', query, 'Unwrapped')).toBe(3);
  });

  it('does not punish a title for repeating its own artist', () => {
    // Billing restated in the title is not a different recording.
    expect(titleTokensBeyondQuery('HUMBLE. (Kendrick Lamar)', 'HUMBLE', 'Kendrick Lamar')).toBe(0);
  });

  it('stops penalising once the listener asks for the remix', () => {
    // The penalty has to fall away on its own, or searching for a remix by name could never
    // surface it. Those words are now in the query, so they are no longer extra.
    expect(
      titleTokensBeyondQuery(
        'HUMBLE. (Bassjackers Remix) [Mixed]',
        'Kendrick Lamar HUMBLE Bassjackers Remix Mixed',
        'Kendrick Lamar',
      ),
    ).toBe(0);
  });

  it('ignores stop words', () => {
    expect(titleTokensBeyondQuery('HUMBLE. (The Mix)', query, 'Kendrick Lamar')).toBe(1);
  });

  it('handles empty inputs', () => {
    expect(titleTokensBeyondQuery('', query)).toBe(0);
    expect(titleTokensBeyondQuery('HUMBLE.', '')).toBe(1);
  });
});
