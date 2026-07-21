/**
 * Android playback self-test — verifies ExoPlayer + content:// locker bridge on first launch.
 */

import { Capacitor } from '@capacitor/core';
import {
  getNativeExoPlaybackStatus,
  nativeExoPlayUrl,
  nativeExoStop,
  prepareNativeExoPlayback,
} from './androidNativePlayback';
import { NativeExoPlayback } from './androidNativePlayback';
import { configureAndroidAudioSession } from './backgroundMedia';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const ANDROID_PLAYBACK_SELF_TEST_KEY = 'sandbox_android_playback_self_test_done';

const TEST_BLOB_ID = '__playback_self_test__';

/** Duration users should hear during onboarding / diagnostics. */
export const ANDROID_PLAYBACK_SELF_TEST_TONE_SEC = 1;

export type AudibleTestToneOptions = {
  sampleRate?: number;
  frequencyHz?: number;
  durationSec?: number;
  /** Peak amplitude 0–1 (before int16 conversion). */
  amplitude?: number;
};

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i)!);
  }
}

/**
 * Build a short PCM WAV with a sine tone — clearly audible on phone speakers.
 * (The previous self-test reused sandboxLayer1's silent prime WAV, so ExoPlayer
 * reported success but users heard nothing.)
 */
export function buildAudibleTestToneWavBytes(options: AudibleTestToneOptions = {}): Uint8Array {
  const sampleRate = options.sampleRate ?? 44100;
  const frequencyHz = options.frequencyHz ?? 440;
  const durationSec = options.durationSec ?? ANDROID_PLAYBACK_SELF_TEST_TONE_SEC;
  const amplitude = options.amplitude ?? 0.75;

  const numSamples = Math.max(1, Math.floor(sampleRate * durationSec));
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  const fadeSamples = Math.min(Math.floor(sampleRate * 0.02), Math.floor(numSamples / 4));
  for (let i = 0; i < numSamples; i++) {
    let envelope = 1;
    if (i < fadeSamples) envelope = i / fadeSamples;
    else if (i >= numSamples - fadeSamples) envelope = (numSamples - i) / fadeSamples;

    const sample =
      Math.sin((2 * Math.PI * frequencyHz * i) / sampleRate) * amplitude * envelope;
    const int16 = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)));
    view.setInt16(44 + i * 2, int16, true);
  }

  return new Uint8Array(buffer);
}

export function loadAndroidPlaybackSelfTestDone(): boolean {
  return prefsGetItem(ANDROID_PLAYBACK_SELF_TEST_KEY) === 'true';
}

export function saveAndroidPlaybackSelfTestDone(done: boolean): void {
  prefsSetItem(ANDROID_PLAYBACK_SELF_TEST_KEY, String(done));
}


async function registerTestToneContentUri(): Promise<string> {
  const bytes = buildAudibleTestToneWavBytes();
  await NativeExoPlayback.beginLockerBlob({ id: TEST_BLOB_ID, mimeType: 'audio/wav' });
  try {
    let offset = 0;
    const chunkSize = 4096;
    while (offset < bytes.length) {
      const slice = bytes.subarray(offset, offset + chunkSize);
      let binary = '';
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i]!);
      }
      await NativeExoPlayback.appendLockerBlobChunk({
        id: TEST_BLOB_ID,
        chunkBase64: btoa(binary),
      });
      offset += chunkSize;
    }
    const result = await NativeExoPlayback.finishLockerBlob({ id: TEST_BLOB_ID });
    if (!result.contentUri?.trim()) {
      throw new Error('Self-test tone produced no content URI.');
    }
    return result.contentUri.trim();
  } catch (err) {
    try {
      await NativeExoPlayback.abortLockerBlob({ id: TEST_BLOB_ID });
    } catch {
      /* cleanup best-effort */
    }
    throw err;
  }
}

export interface AndroidPlaybackSelfTestResult {
  ok: boolean;
  message: string;
  exoState?: string;
}

/**
 * Play a short test tone through ExoPlayer + content:// bridge.
 * User-triggered only (onboarding "Play test tone" button) — do not auto-run on app/guide mount.
 */
export async function runAndroidPlaybackSelfTest(): Promise<AndroidPlaybackSelfTestResult> {
  if (Capacitor.getPlatform() !== 'android') {
    return { ok: false, message: 'Playback self-test is Android-only.' };
  }

  try {
    await configureAndroidAudioSession();
    const prep = await prepareNativeExoPlayback();
    if (!prep.ok) {
      return { ok: false, message: prep.message };
    }

    const contentUri = await registerTestToneContentUri();
    await nativeExoStop();
    await nativeExoPlayUrl(contentUri, { autoPlay: true, resetQueue: true });

    await new Promise((r) =>
      window.setTimeout(r, Math.ceil(ANDROID_PLAYBACK_SELF_TEST_TONE_SEC * 1000) + 400),
    );
    const status = await getNativeExoPlaybackStatus();
    const playing = status.state === 'playing' || status.state === 'paused' || status.state === 'loading';
    if (!playing && status.state === 'error') {
      return {
        ok: false,
        message: status.error ?? 'ExoPlayer failed to start test tone.',
        exoState: status.state,
      };
    }

    saveAndroidPlaybackSelfTestDone(true);
    return {
      ok: true,
      message: 'ExoPlayer test tone played — audio output is working.',
      exoState: status.state,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
