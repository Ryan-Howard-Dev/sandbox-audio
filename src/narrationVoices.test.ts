import { describe, expect, it } from 'vitest';
import {
  preferLanguage,
  resolvePreferredVoice,
  sortNarrationVoices,
  type NarrationVoice,
} from './narrationVoices';

function voice(partial: Partial<NarrationVoice> & { id: string }): NarrationVoice {
  return {
    label: partial.id,
    language: 'en-GB',
    networkRequired: false,
    ...partial,
  };
}

describe('sortNarrationVoices', () => {
  /*
   * Leading with network voices invites picking one and losing narration when the connection
   * drops — the wrong nudge for an app whose point is working without one.
   */
  it('puts offline voices first', () => {
    const sorted = sortNarrationVoices([
      voice({ id: 'cloud', label: 'Cloud', networkRequired: true }),
      voice({ id: 'local', label: 'Local' }),
    ]);
    expect(sorted.map((v) => v.id)).toEqual(['local', 'cloud']);
  });

  it('sorts by label within each group', () => {
    const sorted = sortNarrationVoices([
      voice({ id: 'b', label: 'Bravo' }),
      voice({ id: 'a', label: 'Alpha' }),
      voice({ id: 'z', label: 'Alpha Cloud', networkRequired: true }),
    ]);
    expect(sorted.map((v) => v.label)).toEqual(['Alpha', 'Bravo', 'Alpha Cloud']);
  });

  it('does not mutate the input', () => {
    const input = [voice({ id: 'b', label: 'B' }), voice({ id: 'a', label: 'A' })];
    sortNarrationVoices(input);
    expect(input.map((v) => v.id)).toEqual(['b', 'a']);
  });
});

describe('preferLanguage', () => {
  const voices = [
    voice({ id: 'de', language: 'de-DE' }),
    voice({ id: 'en', language: 'en-GB' }),
    voice({ id: 'enus', language: 'en-US' }),
  ];

  it('moves matching-language voices to the front', () => {
    expect(preferLanguage(voices, 'en-GB').map((v) => v.id)).toEqual(['en', 'enus', 'de']);
  });

  it('matches on the language subtag, not the whole tag', () => {
    expect(preferLanguage(voices, 'en-AU')[0]!.language.startsWith('en')).toBe(true);
  });

  it('leaves the list alone for an unknown language', () => {
    expect(preferLanguage(voices, 'xx').map((v) => v.id)).toEqual(['de', 'en', 'enus']);
  });
});

describe('resolvePreferredVoice', () => {
  const voices = [
    voice({ id: 'cloud', networkRequired: true }),
    voice({ id: 'local-a' }),
    voice({ id: 'local-b' }),
  ];

  it('uses the stored voice when it still exists', () => {
    expect(resolvePreferredVoice(voices, 'local-b')?.id).toBe('local-b');
  });

  /* Voices can be uninstalled between sessions; falling back beats reading in silence. */
  it('falls back to the first offline voice when the stored one is gone', () => {
    expect(resolvePreferredVoice(voices, 'uninstalled')?.id).toBe('local-a');
  });

  it('falls back to any voice when every voice needs the network', () => {
    const online = [voice({ id: 'only-cloud', networkRequired: true })];
    expect(resolvePreferredVoice(online, null)?.id).toBe('only-cloud');
  });

  it('returns null when the engine has no voices at all', () => {
    expect(resolvePreferredVoice([], 'anything')).toBeNull();
  });
});
