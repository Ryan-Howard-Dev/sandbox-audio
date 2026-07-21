import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  getLastCinemaCastPayload,
  stopCinemaCast,
  subscribeCinemaCast,
  type CinemaCastPayload,
} from '../cinemaCast';
import CinemaCastContent from './CinemaCastContent';

export default function CinemaCastOverlay() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [payload, setPayload] = useState<CinemaCastPayload>(getLastCinemaCastPayload);

  useEffect(() => subscribeCinemaCast(setPayload), []);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    void el.requestFullscreen?.().catch(() => {
      /* fullscreen optional — overlay still covers viewport */
    });
    return () => {
      if (document.fullscreenElement === el) {
        void document.exitFullscreen?.().catch(() => {});
      }
    };
  }, []);

  return createPortal(
    <div
      ref={rootRef}
      className="fixed inset-0 bg-[var(--bg-void)]"
      style={{ zIndex: 'var(--z-overlay)' }}
      role="dialog"
      aria-label="Cinema Cast projection"
    >
      <button
        type="button"
        onClick={() => stopCinemaCast()}
        className="absolute top-4 right-4 z-10 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)]/80 text-[var(--text-mid)] hover:text-[var(--text)] touch-manipulation"
        aria-label="Stop cast"
      >
        <X size={18} />
      </button>
      <CinemaCastContent payload={payload} />
    </div>,
    document.body,
  );
}
