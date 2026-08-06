/**
 * The device's side of chapter scanning.
 *
 * AudioScanPlugin decodes a recording and measures its loudness frame by frame; this brings the
 * measurement across and hands it to the decision logic in silenceScan.ts. The samples themselves
 * never make the trip — a thirty hour audiobook is about seven gigabytes decoded, and neither the
 * bridge nor the heap will take that.
 *
 * One byte per frame of dBFS. At a tenth of a second that is roughly a megabyte for thirty hours.
 */
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { silencesFromFrameDb, type SilenceSpan, type SilenceScanOptions } from './silenceScan';
import type { KeywordHit } from './spokenChapterDetect';

export interface AudioScanResult {
  /** Signed bytes of dBFS, one per frame, base64 encoded. */
  base64: string;
  frameCount: number;
  frameSeconds: number;
  sampleRate: number;
  channels: number;
  /** From the container, or 0 when it did not say. */
  durationSeconds: number;
}

export interface AudioScanPlugin {
  scanAudioFrames(options: { uri: string; frameSeconds?: number }): Promise<AudioScanResult>;
  /** Whether a keyword model is installed. It is a download, not part of the APK. */
  keywordModelStatus(): Promise<{ installed: boolean; path: string }>;
  spotKeywords(options: {
    uri: string;
    windows: Array<{ startSeconds: number; endSeconds: number }>;
    keywords: string;
  }): Promise<{ hits: Array<{ atSeconds: number; keyword: string; score: number }> }>;
  addListener(
    eventName: 'audioScanProgress',
    listenerFunc: (event: { percent: number }) => void,
  ): Promise<PluginListenerHandle>;
}

const AudioScan = registerPlugin<AudioScanPlugin>('AudioScan');

export function isAudioScanAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * A tenth of a second per frame.
 *
 * Chapter breaks run to seconds, so this is far finer than the decision needs, and it is what
 * keeps the transfer to about a megabyte on the longest books anyone actually has.
 */
export const SCAN_FRAME_SECONDS = 0.1;

/**
 * Decode the base64 frames into signed loudness values.
 *
 * Int8Array rather than Uint8Array is the whole point: the native side writes dBFS, which is
 * negative, and reading those bytes unsigned would turn -45 dB into 211 and every silence into
 * the loudest thing in the file.
 */
export function decodeFrameDb(base64: string): Int8Array {
  if (!base64) return new Int8Array(0);
  const binary = atob(base64);
  const out = new Int8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    const byte = binary.charCodeAt(i);
    out[i] = byte > 127 ? byte - 256 : byte;
  }
  return out;
}

export interface ScannedSilences {
  silences: SilenceSpan[];
  durationSeconds: number;
  frameSeconds: number;
}

/**
 * Where the long pauses are in a recording on this device.
 *
 * Returns null when there is nothing to scan with, which is every platform but Android and every
 * file the decoder cannot open. Callers fall back to whatever chapter table the file carries, or
 * to none.
 */
export async function scanSilences(
  uri: string,
  options: SilenceScanOptions & { frameSeconds?: number } = {},
  onProgress?: (percent: number) => void,
): Promise<ScannedSilences | null> {
  if (!isAudioScanAvailable()) return null;
  const target = uri?.trim() ?? '';
  if (!target) return null;

  const frameSeconds = options.frameSeconds ?? SCAN_FRAME_SECONDS;
  let handle: PluginListenerHandle | null = null;
  try {
    if (onProgress) {
      handle = await AudioScan.addListener('audioScanProgress', (event) => {
        onProgress(event.percent);
      });
    }
    const result = await AudioScan.scanAudioFrames({ uri: target, frameSeconds });
    const frames = decodeFrameDb(result.base64);
    if (frames.length === 0) return null;
    return {
      silences: silencesFromFrameDb(frames, result.frameSeconds || frameSeconds, options),
      /*
       * The container's duration where it gave one, otherwise what was actually measured. A file
       * whose header lies about its length is common enough that trusting it over the decode
       * would put chapter marks past the end of the audio.
       */
      durationSeconds:
        result.durationSeconds > 0
          ? result.durationSeconds
          : frames.length * (result.frameSeconds || frameSeconds),
      frameSeconds: result.frameSeconds || frameSeconds,
    };
  } catch {
    return null;
  } finally {
    await handle?.remove().catch(() => {});
  }
}

/** Is a keyword model installed? False on every platform without the plugin. */
export async function isKeywordModelInstalled(): Promise<boolean> {
  if (!isAudioScanAvailable()) return false;
  try {
    return (await AudioScan.keywordModelStatus()).installed;
  } catch {
    return false;
  }
}

/**
 * Listen for the announcing words at the given windows.
 *
 * Null means nothing was listened to — no plugin, no model, a file that would not decode. An
 * empty array means it listened and heard nothing announced. The two are not the same answer and
 * bookChapterScan depends on telling them apart.
 */
export async function spotChapterKeywords(
  uri: string,
  windows: Array<{ startSeconds: number; endSeconds: number }>,
  keywords: readonly string[],
): Promise<KeywordHit[] | null> {
  if (!isAudioScanAvailable()) return null;
  const target = uri?.trim() ?? '';
  if (!target || windows.length === 0) return null;
  try {
    const result = await AudioScan.spotKeywords({
      uri: target,
      windows,
      // The spotter takes its keywords inline, one per line, so no model-side file is needed and
      // the words can change without touching the download.
      keywords: keywords.join('\n'),
    });
    return result.hits ?? [];
  } catch {
    // Includes the deliberate "no-model" rejection. Null, never an empty list.
    return null;
  }
}

/**
 * Deps for scanBookChapters, wired to this device.
 *
 * The progress callback is the decode's, not the whole scan's, because the decode is all of the
 * time: the keyword pass listens at a few hundred short windows and finishes in seconds. Passing it
 * through matters more here than it looks — at twenty times realtime the thirty hour book this
 * feature exists for takes an hour and a half, and a button that says "scanning" for ninety minutes
 * with nothing moving is indistinguishable from one that has hung.
 */
export function deviceChapterScanDeps(onProgress?: (percent: number) => void) {
  return {
    scanSilences: (uri: string) => scanSilences(uri, {}, onProgress),
    spotKeywords: (
      uri: string,
      windows: Array<{ startSeconds: number; endSeconds: number }>,
      keywords: readonly string[],
    ) => spotChapterKeywords(uri, windows, keywords),
  };
}
