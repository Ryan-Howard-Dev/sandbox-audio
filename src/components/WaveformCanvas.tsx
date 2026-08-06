/**
 * Lines of music moving with the song.
 *
 * Three lines rather than one: a bright middle trace and two dimmer, shorter echoes above and
 * below it. One line on a large screen reads as a diagram; the stack reads as sound. They share a
 * single shape, so the echoes always agree with the middle rather than drifting.
 *
 * The drawing itself is deliberately dull — a canvas, no library, no shaders. Everything that could
 * be wrong about it lives in waveformVisual.ts where it can be tested; a canvas will draw whatever
 * it is handed and look convincing doing it.
 */

import { useEffect, useRef } from 'react';
import { WAVE_POINTS, wavePath } from '../waveformVisual';

export interface WaveformCanvasProps {
  /** Smoothed levels, 0 to 1, from useWaveformLevels. */
  shape: readonly number[];
  /** Accent colour; defaults to the theme accent. */
  color?: string;
  className?: string;
  /** Drawn behind other content, so it never takes touches meant for the controls under it. */
  ariaHidden?: boolean;
}

/** Middle line, then the echoes: offset from centre, vertical scale, and opacity. */
const LINES: Array<{ spread: number; scale: number; alpha: number; width: number }> = [
  { spread: 0, scale: 1, alpha: 0.85, width: 2.5 },
  { spread: 0.16, scale: 0.55, alpha: 0.35, width: 1.5 },
  { spread: -0.16, scale: 0.55, alpha: 0.35, width: 1.5 },
];

export function WaveformCanvas({
  shape,
  color,
  className,
  ariaHidden = true,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    /*
     * Sized from the element's own box every frame rather than once on mount. This lives behind a
     * full-screen player that rotates, opens over a mini bar and resizes with the keyboard, and a
     * canvas whose backing store was fixed at mount draws a stretched, blurry line after any of it.
     */
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const themed = getComputedStyle(canvas).getPropertyValue('--accent-brand').trim();
    const stroke = color ?? (themed || '#ff5b1e');

    for (const line of LINES) {
      const points = wavePath(shape, width, height, line.spread, line.scale);
      if (points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(points[0]!.x, points[0]!.y);
      /*
       * Curve through the midpoints. Straight segments between sixty-four points are visibly
       * faceted on a phone, and a bezier anchored on every point overshoots into loops on a sharp
       * transient — which is exactly where the eye is looking.
       */
      for (let i = 1; i < points.length; i += 1) {
        const prev = points[i - 1]!;
        const curr = points[i]!;
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2);
      }
      ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y);
      ctx.globalAlpha = line.alpha;
      ctx.lineWidth = line.width;
      ctx.strokeStyle = stroke;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }, [shape, color]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      aria-hidden={ariaHidden ? 'true' : undefined}
      /* Never intercepts a tap: it sits under the transport controls, full bleed. */
      style={{ pointerEvents: 'none', width: '100%', height: '100%', display: 'block' }}
      data-points={WAVE_POINTS}
    />
  );
}
