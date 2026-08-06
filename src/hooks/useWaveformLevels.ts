import { useEffect, useRef, useState } from 'react';
import { NativeExoPlayback } from '../nativePluginHandles';
import { isAndroid } from '../platformEnv';
import {
  advanceWaveShape,
  restingWaveShape,
  type WaveShapeOptions,
} from '../waveformVisual';

/**
 * The shape of what is playing, updated for as long as somebody is looking at it.
 *
 * Polls the native tap and smooths the result. Not a subscription: the cost of this feature is
 * entirely in how often it runs, so the component that draws it owns that cost by mounting and
 * unmounting the hook. Nothing polls when no visualiser is on screen.
 *
 * The poll is deliberately slower than the redraw. Levels arrive from the audio thread far faster
 * than any screen can show them, so asking thirty times a second and smoothing between answers
 * looks identical to asking sixty times and costs half as much battery — which matters for a view
 * meant to be left running.
 */
export function useWaveformLevels(input: {
  /** False unmounts the polling entirely; the shape settles to rest. */
  enabled: boolean;
  /** Roughly how many times a second to ask. */
  hz?: number;
  shape?: WaveShapeOptions;
}): number[] {
  const { enabled, hz = 30, shape } = input;
  const [levels, setLevels] = useState<number[]>(() => restingWaveShape());
  /*
   * The live shape lives in a ref as well as in state. The poll needs the previous frame to smooth
   * against, and reading it from state inside the interval would capture whatever frame existed
   * when the effect ran and smooth every future frame against that one forever.
   */
  const shapeRef = useRef<number[]>(restingWaveShape());

  useEffect(() => {
    if (!enabled || !isAndroid()) {
      shapeRef.current = restingWaveShape();
      setLevels(shapeRef.current);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    // Guards against a slow bridge answer piling up behind the next tick, which on a busy device
    // turns a thirty-a-second poll into an unbounded queue of them.
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const res = await NativeExoPlayback.getWaveform();
        if (cancelled) return;
        const next = advanceWaveShape(
          shapeRef.current,
          res.available ? res.levels : null,
          shape,
        );
        shapeRef.current = next;
        setLevels(next);
      } catch {
        /*
         * A failed read is silence, not a frozen frame. If the plugin goes away mid-track the line
         * has to visibly settle rather than hold its last shape and keep implying it is listening.
         */
        if (cancelled) return;
        const next = advanceWaveShape(shapeRef.current, null, shape);
        shapeRef.current = next;
        setLevels(next);
      } finally {
        inFlight = false;
      }
    };

    timer = window.setInterval(() => void tick(), Math.max(16, Math.round(1000 / hz)));
    void tick();
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, [enabled, hz, shape]);

  return levels;
}
