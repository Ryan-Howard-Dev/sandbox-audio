/**
 * Speaks narration chunks aloud.
 *
 * documentNarration.ts turns a document into chunks; nothing consumed them. This is the other
 * half: a sequencer that reads them in order, survives the platform's quirks, and reports its
 * position so a document resumes like any other book.
 *
 * Uses the Web Speech API, which every WebView and desktop browser already has — no model
 * download, no native plugin, works offline once the platform voices are installed. Kokoro can
 * replace the port later for neural quality; the sequencing here does not change, which is the
 * point of keeping the engine behind a port.
 */

import type { NarrationChunk } from './documentNarration';

/** Minimal surface this needs from a speech engine — the seam Kokoro can take over. */
export interface NarrationSpeechPort {
  speak(
    text: string,
    options: {
      rate: number;
      voiceId?: string;
      onEnd: () => void;
      onError: () => void;
      /*
       * Character offsets into the exact string passed to speak(), as the engine voices each word.
       *
       * Optional on purpose. Engines are not obliged to report ranges, and the web fallback has no
       * equivalent, so a reader must never wait on one -- it highlights when told and reads on
       * regardless when not.
       */
      onRange?: (start: number, end: number) => void;
    },
  ): void;
  cancel(): void;
  pause(): void;
  resume(): void;
}

export type NarrationReaderState = 'idle' | 'speaking' | 'paused' | 'finished';

export interface NarrationReaderOptions {
  rate?: number;
  /** Chosen voice, passed straight through to whichever engine is underneath. */
  voiceId?: string;
  /** Resume point, from the per-book progress store. */
  startIndex?: number;
  onChunkChange?: (index: number, chunk: NarrationChunk) => void;
  onStateChange?: (state: NarrationReaderState) => void;
  /**
   * The word being spoken, as character offsets into the current chunk's text.
   *
   * Carries the chunk index because ranges arrive asynchronously: a range from the chunk we have
   * just left would otherwise highlight the wrong word in the new one.
   */
  onRange?: (index: number, start: number, end: number) => void;
}

export interface NarrationReader {
  play(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  /** Jump to a chunk — a heading list is a chapter list. */
  seekToChunk(index: number): void;
  getState(): NarrationReaderState;
  getIndex(): number;
  getChunkCount(): number;
}

export function createNarrationReader(
  chunks: NarrationChunk[],
  port: NarrationSpeechPort,
  options: NarrationReaderOptions = {},
): NarrationReader {
  const rate = options.rate ?? 1;
  const voiceId = options.voiceId;
  let index = clampIndex(options.startIndex ?? 0, chunks.length);
  let state: NarrationReaderState = 'idle';

  function clampIndex(value: number, length: number): number {
    if (!Number.isFinite(value) || value < 0) return 0;
    if (length === 0) return 0;
    return Math.min(Math.floor(value), length - 1);
  }

  function setState(next: NarrationReaderState): void {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  }

  function speakCurrent(): void {
    const chunk = chunks[index];
    if (!chunk) {
      setState('finished');
      return;
    }
    setState('speaking');
    options.onChunkChange?.(index, chunk);
    const spokenIndex = index;
    port.speak(chunk.text, {
      rate,
      voiceId,
      // Bound to the index at the time of speaking, not the live one, for the reason above.
      onRange: options.onRange
        ? (start, end) => options.onRange?.(spokenIndex, start, end)
        : undefined,
      onEnd: () => {
        // A cancel during speech also fires onEnd on some engines. Only advance while we still
        // believe we are speaking, or stopping would silently restart the document.
        if (state !== 'speaking') return;
        if (index >= chunks.length - 1) {
          setState('finished');
          return;
        }
        index += 1;
        speakCurrent();
      },
      /*
       * A chunk that fails to synthesise must not end the document. One unpronounceable fragment
       * — a stray equation, a language the installed voices cannot handle — would otherwise stop
       * a two-hour paper dead at that paragraph.
       */
      onError: () => {
        if (state !== 'speaking') return;
        if (index >= chunks.length - 1) {
          setState('finished');
          return;
        }
        index += 1;
        speakCurrent();
      },
    });
  }

  return {
    play(): void {
      if (chunks.length === 0) {
        setState('finished');
        return;
      }
      port.cancel();
      speakCurrent();
    },
    pause(): void {
      if (state !== 'speaking') return;
      port.pause();
      setState('paused');
    },
    resume(): void {
      if (state !== 'paused') return;
      port.resume();
      setState('speaking');
    },
    stop(): void {
      // Ordered before cancel so the onEnd that cancel triggers cannot be mistaken for a chunk
      // finishing normally and advance the document.
      setState('idle');
      port.cancel();
    },
    seekToChunk(next: number): void {
      const target = clampIndex(next, chunks.length);
      const wasSpeaking = state === 'speaking';
      setState('idle');
      port.cancel();
      index = target;
      if (wasSpeaking) speakCurrent();
      else options.onChunkChange?.(index, chunks[index]!);
    },
    getState: () => state,
    getIndex: () => index,
    getChunkCount: () => chunks.length,
  };
}

/**
 * Web Speech port.
 *
 * Chrome and the Android WebView stop synthesis after roughly fifteen seconds of continuous
 * speech unless `resume()` is called periodically — a decade-old bug that every long-form reader
 * has to work around. The keep-alive ping is that workaround, cleared as soon as the utterance
 * ends so it cannot outlive the document.
 */
export function createWebSpeechPort(
  synth: SpeechSynthesis,
  makeUtterance: (text: string) => SpeechSynthesisUtterance,
): NarrationSpeechPort {
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stopKeepAlive = () => {
    if (keepAlive === null) return;
    clearInterval(keepAlive);
    keepAlive = null;
  };

  return {
    speak(text, { rate, voiceId, onEnd, onError }) {
      const utterance = makeUtterance(text);
      utterance.rate = rate;
      if (voiceId) {
        // A voice can be uninstalled between sessions; leaving the default beats failing.
        const match = synth.getVoices().find((v) => v.voiceURI === voiceId);
        if (match) utterance.voice = match;
      }
      utterance.onend = () => {
        stopKeepAlive();
        onEnd();
      };
      utterance.onerror = () => {
        stopKeepAlive();
        onError();
      };
      stopKeepAlive();
      keepAlive = setInterval(() => {
        if (!synth.speaking) return;
        synth.pause();
        synth.resume();
      }, 10_000);
      synth.speak(utterance);
    },
    cancel() {
      stopKeepAlive();
      synth.cancel();
    },
    pause() {
      stopKeepAlive();
      synth.pause();
    },
    resume() {
      synth.resume();
    },
  };
}

/** True when the platform can speak at all — no voices means no narration, however good the text. */
export function isNarrationSpeechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}
