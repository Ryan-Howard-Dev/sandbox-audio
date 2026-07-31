import { describe, expect, it } from 'vitest';
import { resolvedIsUnrequestedRendition } from './playbackPipeline';

/*
 * Reported from a phone: Donda played a live cut instead of the studio recording, and a track on
 * Vultures 1 played an unrelated cover. Duration abstained (a live cut runs about the same length)
 * and containment waved it through, because the live title contains the studio title.
 */
describe('resolvedIsUnrequestedRendition', () => {
  it('rejects a live cut when the catalog track is the studio recording', () => {
    expect(resolvedIsUnrequestedRendition('Vultures', 'vultures live at rolling loud')).toBe(true);
    expect(resolvedIsUnrequestedRendition('Hurricane', 'hurricane (live)')).toBe(true);
    expect(resolvedIsUnrequestedRendition('Jail', 'jail - live from madison square garden')).toBe(
      true,
    );
  });

  it('rejects other renditions that reuse the title verbatim', () => {
    expect(resolvedIsUnrequestedRendition('Off The Grid', 'off the grid (remix)')).toBe(true);
    expect(resolvedIsUnrequestedRendition('Moon', 'moon acoustic')).toBe(true);
    expect(resolvedIsUnrequestedRendition('Praise God', 'praise god sped up')).toBe(true);
    expect(resolvedIsUnrequestedRendition('Believe What I Say', 'believe what i say cover')).toBe(
      true,
    );
  });

  it('allows the rendition when the catalog track IS that rendition', () => {
    expect(resolvedIsUnrequestedRendition('Vultures (Live)', 'vultures (live)')).toBe(false);
    expect(resolvedIsUnrequestedRendition('Moon - Acoustic', 'moon acoustic version')).toBe(false);
  });

  it('allows an ordinary decorated hit, which is what containment exists for', () => {
    expect(
      resolvedIsUnrequestedRendition('Vultures', 'kanye west - vultures (official audio)'),
    ).toBe(false);
    expect(resolvedIsUnrequestedRendition('Jail', 'jail official video hd')).toBe(false);
    // 'live' must not be found inside 'deliver', nor 'cover' inside 'discover'.
    expect(resolvedIsUnrequestedRendition('Deliver', 'deliver official audio')).toBe(false);
    expect(resolvedIsUnrequestedRendition('Discover', 'discover official audio')).toBe(false);
  });

  it('abstains when the resolver reported nothing', () => {
    expect(resolvedIsUnrequestedRendition('Vultures', '')).toBe(false);
  });
});
