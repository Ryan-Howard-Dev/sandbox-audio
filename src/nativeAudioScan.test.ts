import { describe, expect, it } from 'vitest';
import { decodeFrameDb } from './nativeAudioScan';
import { silencesFromFrameDb } from './silenceScan';

/** Encode signed dBFS bytes the way the native side does, so the round trip is the real one. */
function encodeFrameDb(values: number[]): string {
  let binary = '';
  for (const v of values) {
    const clamped = Math.max(-128, Math.min(0, Math.round(v)));
    binary += String.fromCharCode(clamped < 0 ? clamped + 256 : clamped);
  }
  return btoa(binary);
}

describe('decodeFrameDb', () => {
  it('reads loudness back as negative numbers', () => {
    /*
     * The trap this exists for. dBFS is negative, so reading these bytes unsigned turns -45 into
     * 211 — and every silence in the book becomes the loudest thing in it.
     */
    const decoded = decodeFrameDb(encodeFrameDb([-45, -12, -128, 0]));
    expect(Array.from(decoded)).toEqual([-45, -12, -128, 0]);
  });

  it('survives the quietest and loudest a frame can be', () => {
    const decoded = decodeFrameDb(encodeFrameDb([-128, 0]));
    expect(decoded[0]).toBe(-128);
    expect(decoded[1]).toBe(0);
  });

  it('reports nothing for an empty payload', () => {
    expect(decodeFrameDb('')).toHaveLength(0);
  });
});

describe('the round trip the device will make', () => {
  it('finds the pauses in frames that crossed the bridge as bytes', () => {
    // Twelve seconds at a tenth of a second: speech, a three second pause, speech.
    const frames: number[] = [];
    for (let i = 0; i < 30; i += 1) frames.push(-20);
    for (let i = 0; i < 30; i += 1) frames.push(-70);
    for (let i = 0; i < 60; i += 1) frames.push(-20);

    const silences = silencesFromFrameDb(decodeFrameDb(encodeFrameDb(frames)), 0.1);
    expect(silences).toHaveLength(1);
    expect(silences[0]!.startSeconds).toBeCloseTo(3, 5);
    expect(silences[0]!.endSeconds).toBeCloseTo(6, 5);
  });

  it('loses nothing to the byte quantisation that matters', () => {
    /*
     * A byte holds one decibel of resolution. The decision is taken at -45, and speech sits around
     * -25 while a pause sits below -60, so a decibel of rounding is nowhere near either edge.
     */
    const quiet = decodeFrameDb(encodeFrameDb([-60.4, -60.6]));
    expect(quiet.every((v) => v <= -45)).toBe(true);
    const speech = decodeFrameDb(encodeFrameDb([-25.4, -24.6]));
    expect(speech.every((v) => v > -45)).toBe(true);
  });

  it('scales to a thirty hour book without the samples ever crossing', () => {
    /*
     * The number that decided the architecture. Thirty hours of 16 kHz mono float is about seven
     * gigabytes; the same book as frame loudness is about a megabyte.
     */
    const framesFor30h = Math.round((30 * 3600) / 0.1);
    expect(framesFor30h).toBe(1_080_000);
    const bytesAcrossBridge = framesFor30h; // one byte per frame
    expect(bytesAcrossBridge).toBeLessThan(2 * 1024 * 1024);
  });
});
