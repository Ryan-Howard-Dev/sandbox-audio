/**
 * The installed narration voices, and which one this device is set to use.
 *
 * Lifted out of DocumentShelf when the Ebooks shelf needed the same thing. Two copies of this would
 * have drifted immediately: the Web Speech quirk below is the sort of workaround that gets fixed in
 * one place and stays broken in the other, and a book read in a different voice from a document —
 * because one shelf forgot to read the saved preference — is a bug nobody would think to look for.
 */

import { useEffect, useState } from 'react';
import { isNarrationSpeechAvailable } from '../../narrationReader';
import { isNativeTextToSpeechAvailable, listNativeVoices } from '../../nativeTextToSpeech';
import {
  loadPreferredVoiceId,
  preferLanguage,
  resolvePreferredVoice,
  savePreferredVoiceId,
  sortNarrationVoices,
  webSpeechVoiceToNarrationVoice,
  type NarrationVoice,
} from '../../narrationVoices';

export interface NarrationVoiceChoice {
  /** Offline voices first — see below. */
  voices: NarrationVoice[];
  voiceId: string;
  chooseVoice: (id: string) => void;
  /**
   * Undefined until the check has finished. A shelf must not disable its import on a maybe, so the
   * three states are kept distinct rather than collapsed into a boolean that starts false.
   */
  speechAvailable: boolean | undefined;
}

export function useNarrationVoices(): NarrationVoiceChoice {
  const [speechAvailable, setSpeechAvailable] = useState<boolean | undefined>(undefined);
  const [voices, setVoices] = useState<NarrationVoice[]>([]);
  const [voiceId, setVoiceId] = useState('');

  useEffect(() => {
    let cancelled = false;
    void isNativeTextToSpeechAvailable().then(async (native) => {
      if (cancelled) return;
      setSpeechAvailable(native || isNarrationSpeechAvailable());

      /*
       * Web Speech populates its voice list asynchronously and returns an empty array on the first
       * call in most engines, so the `voiceschanged` event is the only reliable read. The native
       * engine answers directly once it has initialised.
       */
      const load = async () => {
        const found = native
          ? await listNativeVoices()
          : isNarrationSpeechAvailable()
            ? window.speechSynthesis.getVoices().map(webSpeechVoiceToNarrationVoice)
            : [];
        if (cancelled || found.length === 0) return;
        /*
         * Offline voices are listed first and win the default. The better-sounding ones are usually
         * network voices, and those stop working exactly where a long book gets listened to.
         */
        const ordered = sortNarrationVoices(preferLanguage(found, navigator.language ?? 'en'));
        setVoices(ordered);
        setVoiceId(resolvePreferredVoice(ordered, loadPreferredVoiceId())?.id ?? '');
      };
      await load();
      if (!native && isNarrationSpeechAvailable()) {
        window.speechSynthesis.addEventListener('voiceschanged', () => void load(), { once: true });
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    voices,
    voiceId,
    // Saved as well as set: the choice belongs to the device, not to whichever shelf was open.
    chooseVoice: (id: string) => {
      setVoiceId(id);
      savePreferredVoiceId(id);
    },
    speechAvailable,
  };
}
