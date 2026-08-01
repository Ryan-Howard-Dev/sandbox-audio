/**
 * Narration port for a neural voice running on the device.
 *
 * The platform engine works and sounds like a machine reading a phone number. Piper is a small
 * VITS model that sounds like a person, runs on an ARM CPU at roughly a tenth of real time, and
 * needs no network. Its cost is that it is a native library and a voice file, not an npm install.
 *
 * This is the JavaScript half, and it exists before the native half deliberately. NarrationSpeechPort
 * was built as a seam for exactly this: the reader sequences passages, handles the pause quirks and
 * tracks position, and none of that changes when the engine underneath does. Writing the port first
 * means the native plugin has a contract to satisfy rather than a shape to invent.
 *
 * Word timing is the part that does not come free. The platform engine reports onRangeStart, and a
 * VITS model does not: its duration predictor emits per-token frame counts inside the graph, which
 * the native side must convert to milliseconds and align against the audio actually played. Until
 * it does, this port simply reports no ranges, and ReadAlongText already handles that — it renders
 * the passage without a marked word rather than breaking.
 */

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid } from './platformEnv';
import type { NarrationSpeechPort } from './narrationReader';

export interface PiperVoice {
  id: string;
  displayName: string;
  /** Where the voice came from, so the picker can say what is installed rather than what exists. */
  installed: boolean;
  sizeBytes?: number;
}

/**
 * The contract the native plugin has to meet.
 *
 * Deliberately the same shape as NativeTextToSpeech: utterances correlated by id, completion by
 * event, stop by name. A second engine with a second protocol would mean the reader learning both.
 */
export interface PiperTtsPlugin {
  /** False until the library and at least one voice are present, so the app can fall back quietly. */
  isAvailable(): Promise<{ available: boolean }>;
  listVoices(): Promise<{ voices: PiperVoice[] }>;
  speak(options: {
    text: string;
    utteranceId: string;
    rate: number;
    voiceId?: string;
  }): Promise<void>;
  stop(): Promise<void>;
  addListener(
    eventName: 'piperDone' | 'piperError' | 'piperRange',
    /*
     * start/end are character offsets into the text handed to speak(), matching the platform
     * engine's onRangeStart. Optional because a voice whose duration tensor was stripped during
     * export cannot report them, and read-along has to degrade rather than fail.
     */
    listenerFunc: (event: { utteranceId: string; start?: number; end?: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const PiperTts = registerPlugin<PiperTtsPlugin>('PiperTts');

/**
 * True only where the native library and a voice are both present.
 *
 * Two reasons this is not just a platform check. The native side may be absent entirely, on a
 * build without it; and it may be present with no voice installed, which sounds identical to
 * broken if the app tries to speak anyway.
 */
export async function isPiperAvailable(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    const { available } = await PiperTts.isAvailable();
    return available === true;
  } catch {
    return false;
  }
}

export async function listPiperVoices(): Promise<PiperVoice[]> {
  if (!isAndroid()) return [];
  try {
    const { voices } = await PiperTts.listVoices();
    return (voices ?? []).filter((v) => v.installed);
  } catch {
    return [];
  }
}

/** Port bound to the neural engine. `dispose` detaches the listeners it registered. */
export function createPiperPort(): NarrationSpeechPort & { dispose: () => void } {
  let counter = 0;
  let currentId = '';
  let onEndCurrent: (() => void) | null = null;
  let onErrorCurrent: (() => void) | null = null;
  let onRangeCurrent: ((start: number, end: number) => void) | null = null;
  const handles: PluginListenerHandle[] = [];

  const settle = (utteranceId: string, kind: 'end' | 'error') => {
    // A cancelled passage can still deliver its completion, and acting on it would advance the
    // document a second time.
    if (!utteranceId || utteranceId !== currentId) return;
    const end = onEndCurrent;
    const error = onErrorCurrent;
    currentId = '';
    onEndCurrent = null;
    onErrorCurrent = null;
    onRangeCurrent = null;
    if (kind === 'end') end?.();
    else error?.();
  };

  void PiperTts.addListener('piperDone', (e) => settle(e.utteranceId, 'end')).then((h) =>
    handles.push(h),
  );
  void PiperTts.addListener('piperError', (e) => settle(e.utteranceId, 'error')).then((h) =>
    handles.push(h),
  );
  void PiperTts.addListener('piperRange', (e) => {
    if (!e.utteranceId || e.utteranceId !== currentId) return;
    if (typeof e.start !== 'number' || typeof e.end !== 'number') return;
    onRangeCurrent?.(e.start, e.end);
  }).then((h) => handles.push(h));

  return {
    speak(text, { rate, voiceId, onEnd, onError, onRange }) {
      counter += 1;
      currentId = `piper-${counter}`;
      onEndCurrent = onEnd;
      onErrorCurrent = onError;
      onRangeCurrent = onRange ?? null;
      void PiperTts.speak({ text, utteranceId: currentId, rate, voiceId }).catch(() => {
        settle(currentId, 'error');
      });
    },
    cancel() {
      currentId = '';
      onEndCurrent = null;
      onErrorCurrent = null;
      onRangeCurrent = null;
      void PiperTts.stop().catch(() => undefined);
    },
    /*
     * Same compromise the platform port makes: there is no pause in a synthesiser that generates
     * as it speaks, so stopping and re-speaking the passage from its start is the honest
     * approximation. A listener loses at most one passage of position, which is why passages are
     * kept short.
     */
    pause() {
      void PiperTts.stop().catch(() => undefined);
    },
    resume() {
      /* handled by the panel re-issuing play from the current passage */
    },
    dispose() {
      for (const handle of handles) void handle.remove();
      handles.length = 0;
    },
  };
}
