import { describe, expect, it } from 'vitest';
import { isTrackSnoozed, lessLikeArtist, snoozeTrack } from './tasteSuppressions';

describe('tasteSuppressions', () => {
  it('snoozes and detects track', () => {
    snoozeTrack('local-test-1', 30);
    expect(isTrackSnoozed('local-test-1')).toBe(true);
    expect(isTrackSnoozed('local-other')).toBe(false);
  });

  it('less like artist does not throw', () => {
    expect(() => lessLikeArtist('Test Artist')).not.toThrow();
  });
});
