import { describe, expect, it } from 'vitest';
import { chooseNarrationEngine, type EngineAvailability } from './narrationEngine';

const none: EngineAvailability = { piper: false, platform: false, web: false };

describe('chooseNarrationEngine', () => {
  it('prefers the neural voice, which is the reason it exists', () => {
    expect(chooseNarrationEngine({ piper: true, platform: true, web: true })).toBe('piper');
  });

  /*
   * Every step degrades rather than fails. A build without the engine, a device with no voice
   * installed, or a platform with no speech at all must still read — a reader that refuses because
   * the best engine is missing is worse than a robotic one.
   */
  it('falls back to the platform engine when the neural voice is absent', () => {
    expect(chooseNarrationEngine({ ...none, platform: true, web: true })).toBe('platform');
  });

  it('falls back to web speech when there is no platform engine', () => {
    expect(chooseNarrationEngine({ ...none, web: true })).toBe('web');
  });

  it('says none rather than pretending, when nothing can speak', () => {
    expect(chooseNarrationEngine(none)).toBe('none');
  });

  it('never picks an engine that is unavailable', () => {
    const combinations: EngineAvailability[] = [
      { piper: true, platform: false, web: false },
      { piper: false, platform: true, web: false },
      { piper: false, platform: false, web: true },
      { piper: true, platform: false, web: true },
      { piper: false, platform: true, web: true },
    ];
    for (const available of combinations) {
      const chosen = chooseNarrationEngine(available);
      if (chosen === 'none') continue;
      expect(available[chosen]).toBe(true);
    }
  });
});
