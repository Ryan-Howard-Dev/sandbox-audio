import { describe, expect, it } from 'vitest';
import { playEventKind } from './listeningAnalytics';

describe('playEventKind', () => {
  it('classifies podcast envelope ids', () => {
    expect(playEventKind({ envelopeId: 'podcast:feed123:ep456' })).toBe('podcast');
  });

  it('classifies audiobook catalog envelope ids', () => {
    expect(
      playEventKind({ envelopeId: 'audiobook-catalog:librivox:253:124135' }),
    ).toBe('audiobook');
  });

  it('treats everything else as music', () => {
    expect(playEventKind({ envelopeId: 'local-abc123' })).toBe('music');
    expect(playEventKind({ envelopeId: 'yt:dQw4w9WgXcQ' })).toBe('music');
  });
});
