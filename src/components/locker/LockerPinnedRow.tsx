import React from 'react';
import type { LockerPin } from '../../lockerPins';
import { seedGradient } from '../../seedGradient';

export interface LockerPinnedRowProps {
  pins: LockerPin[];
  onOpen: (pin: LockerPin) => void;
  onUnpin: (key: string) => void;
  title: string;
  artForKey?: (key: string) => string | undefined;
}

/** Up to four pinned albums at top of library (power-user retention). */
export default function LockerPinnedRow({
  pins,
  onOpen,
  onUnpin,
  title,
  artForKey,
}: LockerPinnedRowProps) {
  if (pins.length === 0) return null;

  return (
    <section className="locker-pinned-row" aria-label={title}>
      <p className="locker-pinned-row-title">{title}</p>
      <div className="locker-pinned-scroll">
        {pins.map((pin) => {
          const art = artForKey?.(pin.key);
          return (
            <div key={pin.key} className="locker-pinned-card-wrap">
              <button
                type="button"
                className="locker-pinned-card touch-manipulation"
                onClick={() => onOpen(pin)}
              >
                <span className="locker-pinned-art" aria-hidden>
                  {art ? (
                    <img src={art} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span
                      className="locker-pinned-art-fallback"
                      style={{ background: seedGradient(pin.title) }}
                    />
                  )}
                </span>
                <span className="locker-pinned-meta min-w-0">
                  <span className="locker-pinned-name truncate">{pin.title}</span>
                  <span className="locker-pinned-artist truncate">{pin.artist}</span>
                </span>
              </button>
              <button
                type="button"
                className="locker-pinned-unpin touch-manipulation"
                onClick={() => onUnpin(pin.key)}
                aria-label={`Unpin ${pin.title}`}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
