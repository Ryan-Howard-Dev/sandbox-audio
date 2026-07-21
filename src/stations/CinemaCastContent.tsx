import React, { useEffect, useRef } from 'react';
import type { CinemaCastPayload } from '../cinemaCast';

function drawCastVisualizer(
  canvas: HTMLCanvasElement,
  isPlaying: boolean,
  hue: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#07080c';
  ctx.fillRect(0, 0, w, h);

  const bars = 48;
  const gap = 3;
  const barW = (w - gap * (bars - 1)) / bars;
  const t = Date.now() / 1000;

  for (let i = 0; i < bars; i++) {
    const phase = i * 0.35 + t * (isPlaying ? 2.8 : 0.55);
    const amp = isPlaying
      ? 0.25 + Math.abs(Math.sin(phase)) * 0.55 + Math.abs(Math.sin(phase * 2.1)) * 0.2
      : 0.12 + Math.abs(Math.sin(phase)) * 0.14 + Math.abs(Math.sin(phase * 1.7)) * 0.06;
    const barH = Math.max(4, amp * h * 0.82);
    const x = i * (barW + gap);
    const y = (h - barH) / 2;
    const grad = ctx.createLinearGradient(x, y, x, y + barH);
    grad.addColorStop(0, `hsl(${hue}, 78%, 55%)`);
    grad.addColorStop(1, `hsl(${hue}, 82%, 32%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, barW, barH);
  }
}

export default function CinemaCastContent({
  payload,
}: {
  payload: CinemaCastPayload;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hue =
    typeof document !== 'undefined'
      ? parseInt(
          getComputedStyle(document.documentElement).getPropertyValue('--accent-h') || '23',
          10,
        )
      : 23;

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const canvas = canvasRef.current;
      if (canvas) drawCastVisualizer(canvas, payload.isPlaying, hue);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [payload.isPlaying, hue]);

  const progress =
    payload.durationSeconds > 0
      ? Math.min(100, (payload.currentTimeSeconds / payload.durationSeconds) * 100)
      : 0;

  const statusLabel = payload.isPlaying
    ? 'Live broadcast'
    : payload.durationSeconds > 0
      ? 'Paused'
      : 'Ready to cast';

  return (
    <div className="h-full w-full flex flex-col bg-[var(--bg-void)] text-[var(--text)] overflow-hidden">
      <header className="px-8 pt-8 pb-4 border-b border-[var(--border)]">
        <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-accent mb-2">
          Cinema Cast Projection
        </p>
        <h1 className="font-display text-3xl sm:text-5xl font-black uppercase tracking-tight truncate">
          {payload.title || 'Sovereign Music Console'}
        </h1>
        <p className="font-mono text-sm text-[var(--text-mid)] mt-2 truncate">
          {payload.artist || 'Ready to cast'}
        </p>
      </header>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8 py-6 min-h-0">
        {payload.albumArt ? (
          <img
            src={payload.albumArt}
            alt=""
            className="w-40 h-40 sm:w-56 sm:h-56 rounded-xl object-cover border border-[var(--border)] shadow-lg shrink-0"
          />
        ) : null}
        <canvas
          ref={canvasRef}
          width={960}
          height={200}
          className="w-full max-w-4xl h-32 sm:h-48 rounded-xl border border-[var(--border)]"
          aria-hidden
        />
        <div className="w-full max-w-4xl">
          <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="font-mono text-[10px] uppercase text-[var(--text-dim)] mt-2 text-center">
            {statusLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
