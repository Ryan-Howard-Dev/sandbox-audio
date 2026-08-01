import { describe, expect, it } from 'vitest';
import { controlsForPillar, resolveMediaPillar, type MediaPillar } from './mediaPillar';

describe('resolveMediaPillar', () => {
  it('reads narration first, because it has no envelope to test', () => {
    expect(resolveMediaPillar({ narrating: true })).toBe('spoken-text');
    // Even mid-track: a document being read wins over whatever was loaded before it.
    expect(resolveMediaPillar({ envelopeId: 'track:abc', narrating: true })).toBe('spoken-text');
  });

  it('identifies podcasts and audiobooks by envelope', () => {
    expect(resolveMediaPillar({ envelopeId: 'podcast:ep-1' })).toBe('podcast');
    expect(resolveMediaPillar({ envelopeId: 'audiobook:book-1' })).toBe('audiobook');
  });

  it('falls back to music for anything else, including nothing at all', () => {
    expect(resolveMediaPillar({ envelopeId: 'track:abc' })).toBe('music');
    expect(resolveMediaPillar({})).toBe('music');
    expect(resolveMediaPillar({ envelopeId: null })).toBe('music');
    expect(resolveMediaPillar({ envelopeId: '   ' })).toBe('music');
  });
});

describe('controlsForPillar', () => {
  const spokenWord: MediaPillar[] = ['podcast', 'audiobook', 'spoken-text'];

  it('offers shuffle and repeat to music alone', () => {
    expect(controlsForPillar('music').shuffle).toBe(true);
    expect(controlsForPillar('music').repeat).toBe(true);
    for (const pillar of spokenWord) {
      expect(controlsForPillar(pillar).shuffle).toBe(false);
      expect(controlsForPillar(pillar).repeat).toBe(false);
    }
  });

  it('gives the vinyl to music alone', () => {
    expect(controlsForPillar('music').vinyl).toBe(true);
    for (const pillar of spokenWord) {
      expect(controlsForPillar(pillar).vinyl).toBe(false);
    }
  });

  it('drops thumbs for books and documents but keeps them for podcasts', () => {
    expect(controlsForPillar('podcast').thumbs).toBe(true);
    expect(controlsForPillar('audiobook').thumbs).toBe(false);
    expect(controlsForPillar('spoken-text').thumbs).toBe(false);
  });

  it('withholds the seek bar only where there is no timeline', () => {
    expect(controlsForPillar('spoken-text').seekBar).toBe(false);
    for (const pillar of ['music', 'podcast', 'audiobook'] as MediaPillar[]) {
      expect(controlsForPillar(pillar).seekBar).toBe(true);
    }
  });

  it('never offers both kinds of skip at once', () => {
    for (const pillar of ['music', 'podcast', 'audiobook', 'spoken-text'] as MediaPillar[]) {
      const c = controlsForPillar(pillar);
      expect(c.trackSkip && c.intervalSkip).toBe(false);
    }
  });

  it('keeps speed off music and on everything spoken', () => {
    expect(controlsForPillar('music').speedControl).toBe(false);
    for (const pillar of spokenWord) {
      expect(controlsForPillar(pillar).speedControl).toBe(true);
    }
  });

  it('offers a queue only where there is a next thing to play', () => {
    expect(controlsForPillar('music').queue).toBe(true);
    expect(controlsForPillar('podcast').queue).toBe(true);
    expect(controlsForPillar('audiobook').queue).toBe(false);
    expect(controlsForPillar('spoken-text').queue).toBe(false);
  });
});
