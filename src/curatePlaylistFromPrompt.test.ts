import { describe, expect, it } from 'vitest';
import { curatePlaylistFromPromptLocal } from './curatePlaylistFromPrompt';
import type { LockerEntry } from './lockerStorage';

function entry(partial: Partial<LockerEntry> & Pick<LockerEntry, 'id' | 'title' | 'artist'>): LockerEntry {
  return {
    genre: '',
    durationSeconds: 200,
    url: 'blob:test',
    addedAt: 0,
    ...partial,
  };
}

describe('curatePlaylistFromPromptLocal', () => {
  it('ranks jazz tracks above unrelated rock for a jazz prompt', () => {
    const locker = [
      entry({ id: '1', title: 'Blue Note', artist: 'Quartet', genre: 'jazz' }),
      entry({ id: '2', title: 'Metal Storm', artist: 'Forge', genre: 'metal' }),
    ];
    const tracks = curatePlaylistFromPromptLocal('chill jazz evening', locker, 10);
    expect(tracks[0]?.envelopeId).toBe('local-1');
  });

  it('returns empty when prompt is blank', () => {
    expect(curatePlaylistFromPromptLocal('  ', [entry({ id: '1', title: 'A', artist: 'B' })], 10)).toEqual([]);
  });
});
