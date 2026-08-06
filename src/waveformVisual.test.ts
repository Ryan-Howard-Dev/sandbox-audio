import { describe, expect, it } from 'vitest';
import {
  WAVE_POINTS,
  advanceWaveShape,
  lineOffsets,
  restingWaveShape,
  waveIsMoving,
  wavePath,
} from './waveformVisual';

const LOUD = new Array<number>(WAVE_POINTS).fill(255);
const SILENT = new Array<number>(WAVE_POINTS).fill(0);

describe('following the audio', () => {
  it('rises towards a loud reading', () => {
    const shape = advanceWaveShape(restingWaveShape(), LOUD);
    expect(shape[0]!).toBeGreaterThan(0.4);
  });

  it('rises faster than it falls', () => {
    /*
     * The whole reason attack and release are separate numbers. A symmetric filter makes a kick
     * drum and a sustained pad look identical, because what distinguishes them is the shape of the
     * decay rather than the peak.
     */
    const up = advanceWaveShape(restingWaveShape(), LOUD)[0]!;
    const down = advanceWaveShape(new Array(WAVE_POINTS).fill(1), SILENT)[0]!;
    expect(up).toBeGreaterThan(1 - down);
  });

  it('settles rather than snapping when the music stops', () => {
    let shape = new Array<number>(WAVE_POINTS).fill(1);
    shape = advanceWaveShape(shape, SILENT);
    expect(shape[0]!).toBeLessThan(1);
    expect(shape[0]!).toBeGreaterThan(0.5);
  });

  it('reaches the floor eventually and stops there', () => {
    let shape = new Array<number>(WAVE_POINTS).fill(1);
    for (let i = 0; i < 200; i += 1) shape = advanceWaveShape(shape, SILENT);
    expect(shape.every((v) => v >= 0)).toBe(true);
    expect(Math.max(...shape)).toBeLessThan(0.06);
  });

  it('never leaves the drawable range whatever it is fed', () => {
    const wild = new Array<number>(WAVE_POINTS).fill(0).map((_, i) => (i % 2 ? 100_000 : -50_000));
    const shape = advanceWaveShape(restingWaveShape(), wild);
    expect(shape.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('when the tap says nothing', () => {
  it('falls to silence rather than freezing the last frame', () => {
    /*
     * A frozen waveform over playing audio is a worse lie than a flat one: it looks like it is
     * working. If the native side stops answering, this has to visibly stop.
     */
    let shape = new Array<number>(WAVE_POINTS).fill(1);
    for (let i = 0; i < 100; i += 1) shape = advanceWaveShape(shape, null);
    expect(Math.max(...shape)).toBeLessThan(0.06);
  });

  it('treats a short or malformed reading as silence at those points', () => {
    const shape = advanceWaveShape(restingWaveShape(), [255, Number.NaN, undefined as never]);
    expect(shape[0]!).toBeGreaterThan(0.4);
    expect(shape[1]!).toBeLessThan(0.1);
    expect(shape).toHaveLength(WAVE_POINTS);
  });

  it('starts from rest when handed a previous frame of the wrong size', () => {
    // A stale shape from a different configuration would otherwise be blended into the new one.
    const shape = advanceWaveShape([1, 1, 1], LOUD);
    expect(shape).toHaveLength(WAVE_POINTS);
  });
});

describe('saying whether it is alive', () => {
  it('knows a resting shape is not moving', () => {
    expect(waveIsMoving(restingWaveShape())).toBe(false);
  });

  it('knows a shape following audio is moving', () => {
    expect(waveIsMoving(advanceWaveShape(restingWaveShape(), LOUD))).toBe(true);
  });
});

describe('drawing', () => {
  it('spans the full width with a point per reading', () => {
    const pts = wavePath(restingWaveShape(), 320, 100);
    expect(pts).toHaveLength(WAVE_POINTS);
    expect(pts[0]!.x).toBe(0);
    expect(pts[pts.length - 1]!.x).toBeCloseTo(320);
  });

  it('keeps a loud shape inside the canvas', () => {
    const shape = new Array<number>(WAVE_POINTS).fill(1);
    const pts = wavePath(shape, 320, 100);
    expect(pts.every((p) => p.y >= 0 && p.y <= 100)).toBe(true);
  });

  it('draws a quiet passage near the middle', () => {
    const pts = wavePath(restingWaveShape(), 320, 100);
    expect(pts[0]!.y).toBeGreaterThan(45);
    expect(pts[0]!.y).toBeLessThan(50);
  });

  it('survives a canvas with no size rather than dividing by zero', () => {
    expect(wavePath(restingWaveShape(), 0, 0)).toEqual([]);
  });

  it('separates stacked lines so they do not overlap', () => {
    const shape = restingWaveShape();
    const middle = lineOffsets(shape, 0, 1)[0]!;
    const outer = lineOffsets(shape, 0.18, 1)[0]!;
    expect(outer).toBeGreaterThan(middle);
  });
});
