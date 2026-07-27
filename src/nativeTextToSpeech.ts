/**
 * Android narration port over the platform TextToSpeech engine.
 *
 * The Web Speech API is the obvious choice and it is not available here: Chrome for Android
 * implements `speechSynthesis`, the Android System WebView does not, so the check returns false
 * inside this app. Verified on a device — the reader reported no voices. Desktop and the PWA keep
 * using Web Speech; this covers Android.
 *
 * Speech is asynchronous and the plugin reports completion by event, so utterances are correlated
 * by id: a stale `ttsDone` from a chunk that was cancelled must not advance the document.
 */

import { registerPlugin } from '@capacitor/core';
import type { PluginListenerHandle } from '@capacitor/core';
import { isAndroid } from './platformEnv';
import type { NarrationSpeechPort } from './narrationReader';
import type { NarrationVoice } from './narrationVoices';

interface NativeVoice {
  id: string;
  displayName: string;
  language: string;
  networkRequired: boolean;
}

export interface NativeTextToSpeechPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  speak(options: { text: string; utteranceId: string; rate: number; voiceId?: string }): Promise<void>;
  getVoices(): Promise<{ voices: NativeVoice[] }>;
  stop(): Promise<void>;
  addListener(
    eventName: 'ttsDone' | 'ttsError',
    listenerFunc: (event: { utteranceId: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const NativeTextToSpeech = registerPlugin<NativeTextToSpeechPlugin>('NativeTextToSpeech');

export async function isNativeTextToSpeechAvailable(): Promise<boolean> {
  if (!isAndroid()) return false;
  try {
    const { available } = await NativeTextToSpeech.isAvailable();
    return available === true;
  } catch {
    return false;
  }
}

/** Port bound to the native engine. `dispose` detaches the listeners it registered. */
export function createNativeTextToSpeechPort(): NarrationSpeechPort & { dispose: () => void } {
  let counter = 0;
  let currentId = '';
  let onEndCurrent: (() => void) | null = null;
  let onErrorCurrent: (() => void) | null = null;
  const handles: PluginListenerHandle[] = [];

  const settle = (utteranceId: string, kind: 'end' | 'error') => {
    // Ignore anything that is not the utterance we are waiting on — a cancelled chunk can still
    // deliver its event, and acting on it would advance the document a second time.
    if (!utteranceId || utteranceId !== currentId) return;
    const end = onEndCurrent;
    const error = onErrorCurrent;
    currentId = '';
    onEndCurrent = null;
    onErrorCurrent = null;
    if (kind === 'end') end?.();
    else error?.();
  };

  void NativeTextToSpeech.addListener('ttsDone', (e) => settle(e.utteranceId, 'end')).then((h) =>
    handles.push(h),
  );
  void NativeTextToSpeech.addListener('ttsError', (e) => settle(e.utteranceId, 'error')).then((h) =>
    handles.push(h),
  );

  return {
    speak(text, { rate, voiceId, onEnd, onError }) {
      counter += 1;
      currentId = `sandbox-tts-${counter}`;
      onEndCurrent = onEnd;
      onErrorCurrent = onError;
      void NativeTextToSpeech.speak({ text, utteranceId: currentId, rate, voiceId }).catch(() => {
        settle(currentId, 'error');
      });
    },
    cancel() {
      currentId = '';
      onEndCurrent = null;
      onErrorCurrent = null;
      void NativeTextToSpeech.stop().catch(() => undefined);
    },
    /*
     * The platform engine has no pause. Stopping and re-speaking the current chunk from its start
     * is the honest approximation: a listener loses at most one chunk of position, which is why
     * chunks are kept short.
     */
    pause() {
      void NativeTextToSpeech.stop().catch(() => undefined);
    },
    resume() {
      /* handled by the panel re-issuing play from the current chunk */
    },
    dispose() {
      for (const handle of handles) void handle.remove();
      handles.length = 0;
    },
  };
}

/** Installed platform voices, normalised to the shape the picker uses. */
export async function listNativeVoices(): Promise<NarrationVoice[]> {
  if (!isAndroid()) return [];
  try {
    const { voices } = await NativeTextToSpeech.getVoices();
    return (voices ?? []).map((v) => ({
      id: v.id,
      label: v.displayName?.trim() || v.id,
      language: v.language ?? '',
      networkRequired: v.networkRequired === true,
    }));
  } catch {
    return [];
  }
}
