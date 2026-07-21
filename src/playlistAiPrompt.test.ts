import { describe, expect, it } from 'vitest';
import { buildSmartRulesFromAiPrompt, matchesAiPrompt, scoreAiPromptMatch } from './playlistAiPrompt';
import type { SmartTrackContext } from './smartPlaylistEngine';

function ctx(partial: Partial<SmartTrackContext> & Pick<SmartTrackContext, 'envelopeId' | 'lockerId'>): SmartTrackContext {
  return {
    title: 'Track',
    artist: 'Artist',
    album: 'Album',
    genre: '',
    year: '2020',
    dateAdded: 0,
    playCount: 0,
    lastPlayedAt: 0,
    rating: 0,
    entry: {
      id: partial.lockerId,
      title: 'Track',
      artist: 'Artist',
      url: 'x',
      albumName: 'Album',
      genre: partial.genre ?? '',
      durationSeconds: 210,
      addedAt: 0,
    },
    ...partial,
  };
}

describe('playlistAiPrompt', () => {
  it('builds smart rules with aiPrompt extension', () => {
    const rules = buildSmartRulesFromAiPrompt('chill jazz sunset');
    expect(rules.extensions?.aiPrompt).toBe('chill jazz sunset');
    expect(rules.limit).toBe(80);
  });

  it('matches genre and mood tokens in metadata', () => {
    const jazz = ctx({
      envelopeId: 'local-1',
      lockerId: '1',
      title: 'Blue Note',
      genre: 'jazz',
    });
    expect(matchesAiPrompt(jazz, 'chill jazz')).toBe(true);
    expect(scoreAiPromptMatch(jazz, 'metal')).toBeLessThan(0.35);
  });
});
