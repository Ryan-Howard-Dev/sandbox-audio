import { describe, expect, it } from 'vitest';
import {
  catalogPlaybackDisplayPosition,
  catalogStreamDurationMismatch,
  catalogTrackPlaybackEndReached,
  resolveCatalogAwareDuration,
} from './catalogPlaybackDuration';

describe('catalogPlaybackDuration', () => {
  it('detects full-album stream vs single track metadata', () => {
    expect(catalogStreamDurationMismatch(3297, 210)).toBe(true);
    expect(catalogStreamDurationMismatch(215, 210)).toBe(false);
  });

  it('shows catalog track length when stream is album-length', () => {
    expect(resolveCatalogAwareDuration(3297, 210)).toBe(210);
    expect(resolveCatalogAwareDuration(218, 210)).toBe(218);
  });

  it('advances at catalog duration for album-length streams', () => {
    expect(catalogTrackPlaybackEndReached(209.6, 3297, 210)).toBe(true);
    expect(catalogTrackPlaybackEndReached(120, 3297, 210)).toBe(false);
    expect(catalogTrackPlaybackEndReached(209.6, 218, 210)).toBe(false);
    // Stale position deep in a shared album file must not re-trigger queue advance.
    expect(catalogTrackPlaybackEndReached(450, 3297, 210)).toBe(false);
  });

  it('clamps UI progress to catalog duration for album-length streams', () => {
    expect(catalogPlaybackDisplayPosition(388, 3297, 210, 210)).toBe(210);
    expect(catalogPlaybackDisplayPosition(120, 3297, 210, 210)).toBe(120);
    expect(catalogPlaybackDisplayPosition(45, 218, 210, 218)).toBe(45);
  });
});
