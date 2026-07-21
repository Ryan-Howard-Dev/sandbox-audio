import { describe, expect, it } from 'vitest';
import {
  blendUniverseStyles,
  coverArtPaletteToUniverseStyle,
  resolveTrackUniverseStyle,
} from './coverColorExtract';
import { seedGradientUniverseStyle } from './seedGradient';

describe('coverArtPaletteToUniverseStyle', () => {
  it('maps sampled hues to universe CSS vars', () => {
    const palette = {
      isMonochrome: false,
      primaryHue: 200,
      secondaryHue: 260,
      tertiaryHue: 320,
      accentHue: 20,
      avgLightness: 48,
      glowPrimary: '',
      glowSecondary: '',
      trackGlowA: '',
      trackGlowB: '',
    };
    const style = coverArtPaletteToUniverseStyle(palette);
    expect(style['--universe-a']).toContain('200');
    expect(style['--universe-b']).toContain('260');
    expect(style['--universe-void']).toBe('#07080c');
  });

  it('uses neutral stops for monochrome art', () => {
    const palette = {
      isMonochrome: true,
      primaryHue: 0,
      secondaryHue: 0,
      tertiaryHue: 0,
      accentHue: 0,
      avgLightness: 55,
      glowPrimary: '',
      glowSecondary: '',
      trackGlowA: '',
      trackGlowB: '',
    };
    const style = coverArtPaletteToUniverseStyle(palette);
    expect(style['--universe-a']).toMatch(/hsl\(0 0%/);
  });
});

describe('blendUniverseStyles', () => {
  it('returns seed at blend 0', () => {
    const seed = seedGradientUniverseStyle('Test Track');
    const art = coverArtPaletteToUniverseStyle({
      isMonochrome: false,
      primaryHue: 120,
      secondaryHue: 180,
      tertiaryHue: 240,
      accentHue: 300,
      avgLightness: 40,
      glowPrimary: '',
      glowSecondary: '',
      trackGlowA: '',
      trackGlowB: '',
    });
    const blended = blendUniverseStyles(seed, art, 0);
    expect(blended['--universe-a']).toBe(seed['--universe-a']);
  });

  it('returns art at blend 100', () => {
    const seed = seedGradientUniverseStyle('Test Track');
    const art = coverArtPaletteToUniverseStyle({
      isMonochrome: false,
      primaryHue: 120,
      secondaryHue: 180,
      tertiaryHue: 240,
      accentHue: 300,
      avgLightness: 40,
      glowPrimary: '',
      glowSecondary: '',
      trackGlowA: '',
      trackGlowB: '',
    });
    const blended = blendUniverseStyles(seed, art, 100);
    expect(blended['--universe-a']).toBe(art['--universe-a']);
  });
});

describe('resolveTrackUniverseStyle', () => {
  it('falls back to seed when palette is null', () => {
    const seed = seedGradientUniverseStyle('My Song');
    expect(resolveTrackUniverseStyle('My Song', null, 85)).toEqual(seed);
  });

  it('falls back to seed when artBlend is 0', () => {
    const palette = {
      isMonochrome: false,
      primaryHue: 30,
      secondaryHue: 90,
      tertiaryHue: 150,
      accentHue: 210,
      avgLightness: 50,
      glowPrimary: '',
      glowSecondary: '',
      trackGlowA: '',
      trackGlowB: '',
    };
    const seed = seedGradientUniverseStyle('My Song');
    expect(resolveTrackUniverseStyle('My Song', palette, 0)).toEqual(seed);
  });
});
