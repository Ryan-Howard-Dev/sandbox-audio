import { describe, expect, it } from 'vitest';
import { isNewMusicQuery, newMusicSearchLabel } from './newMusicQuery';

describe('newMusicQuery', () => {
  it('detects new music queries with optional year', () => {
    expect(isNewMusicQuery('new music 2026')).toBe(true);
    expect(isNewMusicQuery('New Music')).toBe(true);
    expect(isNewMusicQuery('top hits')).toBe(false);
  });

  it('uses the current calendar year', () => {
    expect(newMusicSearchLabel(2026)).toBe('new music 2026');
  });
});
