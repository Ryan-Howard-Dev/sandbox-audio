/**
 * Which voice reads to you.
 *
 * Three engines exist and only one should ever be chosen. Piper is a neural voice that runs on the
 * device and sounds like a person. The Android platform engine is instant and sounds like a
 * machine reading a phone number. Web Speech is what desktop and the PWA have, and the Android
 * WebView does not implement it at all.
 *
 * The order is quality first, because that is the whole reason Piper was built, but every step
 * degrades rather than fails: a build without the engine, a device with no voice installed, or a
 * platform with no speech at all each fall through to the next thing that works. A reader that
 * refuses to read because the best engine is missing would be worse than a robotic one.
 *
 * The choosing is a pure function so it can be tested; the constructing is not, because it touches
 * plugins and the DOM.
 */
import type { NarrationSpeechPort } from './narrationReader';

export type NarrationEngineId = 'piper' | 'platform' | 'web' | 'none';

export interface EngineAvailability {
  /** Neural voice: compiled in and a voice installed. */
  piper: boolean;
  /** Android's own engine. */
  platform: boolean;
  /** speechSynthesis, which the Android WebView does not have. */
  web: boolean;
}

/**
 * Pick the best engine that actually works.
 *
 * Deliberately not configurable here. A preference belongs in settings and would be applied by the
 * caller; this answers what is possible, not what is wanted.
 */
export function chooseNarrationEngine(available: EngineAvailability): NarrationEngineId {
  if (available.piper) return 'piper';
  if (available.platform) return 'platform';
  if (available.web) return 'web';
  return 'none';
}

export interface NarrationEngine {
  id: NarrationEngineId;
  port: NarrationSpeechPort;
  /** Detaches plugin listeners. Absent for engines that register none. */
  dispose?: () => void;
}

/**
 * Build the port for whichever engine is available.
 *
 * Returns null rather than throwing when nothing can speak, because that is a real state on a
 * desktop browser without voices and the shelves already have a message for it.
 */
export async function createNarrationEngine(): Promise<NarrationEngine | null> {
  const [{ isPiperAvailable, createPiperPort }, native, reader] = await Promise.all([
    import('./piperTextToSpeech'),
    import('./nativeTextToSpeech'),
    import('./narrationReader'),
  ]);

  const available: EngineAvailability = {
    piper: await isPiperAvailable(),
    platform: await native.isNativeTextToSpeechAvailable(),
    web: reader.isNarrationSpeechAvailable(),
  };

  switch (chooseNarrationEngine(available)) {
    case 'piper': {
      const port = createPiperPort();
      return { id: 'piper', port, dispose: port.dispose };
    }
    case 'platform': {
      const port = native.createNativeTextToSpeechPort();
      return { id: 'platform', port, dispose: port.dispose };
    }
    case 'web': {
      const port = reader.createWebSpeechPort(
        window.speechSynthesis,
        (text) => new SpeechSynthesisUtterance(text),
      );
      return { id: 'web', port };
    }
    default:
      return null;
  }
}
