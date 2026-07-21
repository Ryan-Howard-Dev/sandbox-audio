import { describe, expect, it } from 'vitest';

/** Mirrors HomeView idle detection — welcome tagline only when truly idle. */
function isHomeIdle(
  hasLoadedTrack: boolean,
  isPlaying: boolean,
  state: string,
): boolean {
  return (
    !hasLoadedTrack &&
    !isPlaying &&
    state !== 'Ready' &&
    state !== 'Connecting' &&
    state !== 'Resolving'
  );
}

describe('HomeView idle welcome gate', () => {
  it('hides welcome while playing even without envelope metadata', () => {
    expect(isHomeIdle(false, true, 'Playing')).toBe(false);
  });

  it('hides welcome during connecting/resolving playback bootstrap', () => {
    expect(isHomeIdle(false, false, 'Connecting')).toBe(false);
    expect(isHomeIdle(false, false, 'Resolving')).toBe(false);
    expect(isHomeIdle(false, false, 'Ready')).toBe(false);
  });

  it('shows welcome only on idle home with no loaded track', () => {
    expect(isHomeIdle(false, false, 'Idle')).toBe(true);
    expect(isHomeIdle(true, false, 'Idle')).toBe(false);
  });
});
