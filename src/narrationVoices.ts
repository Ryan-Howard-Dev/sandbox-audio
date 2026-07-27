/**
 * Voice selection for narration, over whichever engine the platform actually has.
 *
 * Android exposes installed TextToSpeech voices; desktop and the PWA expose Web Speech voices.
 * They describe themselves differently, so both are normalised to one shape and the reader never
 * learns which engine it is talking to.
 */

export interface NarrationVoice {
  id: string;
  /** What to show in a picker. */
  label: string;
  /** BCP-47 tag, or empty when the engine did not say. */
  language: string;
  /** Needs a connection — usually the better-sounding ones, and the ones that fail on a train. */
  networkRequired: boolean;
}

export const NARRATION_VOICE_STORAGE_KEY = 'sandbox_narration_voice_v1';

/**
 * Offline voices first, then by label.
 *
 * A picker that leads with network voices invites choosing one and then losing narration the
 * moment the connection drops, which for a local-first app is the wrong default to nudge toward.
 */
export function sortNarrationVoices(voices: NarrationVoice[]): NarrationVoice[] {
  return [...voices].sort((a, b) => {
    if (a.networkRequired !== b.networkRequired) return a.networkRequired ? 1 : -1;
    return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
  });
}

/** Voices matching the UI language first — most listeners want their own locale. */
export function preferLanguage(voices: NarrationVoice[], language: string): NarrationVoice[] {
  const prefix = language.trim().toLowerCase().split('-')[0];
  if (!prefix) return voices;
  const matches = voices.filter((v) => v.language.toLowerCase().startsWith(prefix));
  const rest = voices.filter((v) => !v.language.toLowerCase().startsWith(prefix));
  return [...matches, ...rest];
}

/**
 * The stored voice if it still exists, else the first offline voice, else the first at all.
 *
 * A voice can be uninstalled between sessions. Falling back beats reading in silence, and beats
 * showing a picker with a selection that no longer means anything.
 */
export function resolvePreferredVoice(
  voices: NarrationVoice[],
  preferredId: string | null | undefined,
): NarrationVoice | null {
  if (voices.length === 0) return null;
  const stored = preferredId?.trim();
  if (stored) {
    const match = voices.find((v) => v.id === stored);
    if (match) return match;
  }
  return voices.find((v) => !v.networkRequired) ?? voices[0]!;
}

/** Normalise a Web Speech voice. `default` is not carried — the picker decides, not the engine. */
export function webSpeechVoiceToNarrationVoice(voice: SpeechSynthesisVoice): NarrationVoice {
  return {
    id: voice.voiceURI,
    label: voice.name,
    language: voice.lang ?? '',
    // Web Speech reports `localService`; remote voices are the network-dependent ones.
    networkRequired: voice.localService === false,
  };
}

export function loadPreferredVoiceId(): string | null {
  try {
    return localStorage.getItem(NARRATION_VOICE_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function savePreferredVoiceId(id: string): void {
  try {
    localStorage.setItem(NARRATION_VOICE_STORAGE_KEY, id);
  } catch {
    /* a lost preference must never break narration */
  }
}
