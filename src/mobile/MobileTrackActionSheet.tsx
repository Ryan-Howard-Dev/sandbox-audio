import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import type { LockerMenuAction } from '../components/LockerMoreMenu';

export interface MobileTrackActionSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  actions: LockerMenuAction[];
  ariaLabel?: string;
}

export default function MobileTrackActionSheet({
  open,
  onClose,
  title,
  subtitle,
  actions,
  ariaLabel = 'Track options',
}: MobileTrackActionSheetProps) {
  useDismissableOverlay(open, onClose);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mobile-track-sheet-overlay" role="presentation" data-testid="mobile-track-action-sheet">
      <button
        type="button"
        className="mobile-track-sheet-backdrop"
        aria-label="Close track menu"
        onClick={onClose}
      />
      <div
        className="mobile-track-sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mobile-track-sheet-header">
          <div className="mobile-track-sheet-heading min-w-0">
            <p className="mobile-track-sheet-title truncate">{title}</p>
            {subtitle ? (
              <p className="mobile-track-sheet-subtitle truncate">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            className="mobile-track-sheet-close touch-manipulation"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="w-5 h-5" strokeWidth={2} />
          </button>
        </header>
        <ul className="mobile-track-sheet-actions">
          {actions.map((action) => (
            <li key={action.id}>
              {action.divider ? <hr className="mobile-track-sheet-divider" /> : null}
              <button
                type="button"
                disabled={action.disabled}
                className={`mobile-track-sheet-action touch-manipulation${
                  action.danger ? ' mobile-track-sheet-action--danger' : ''
                }${action.active ? ' mobile-track-sheet-action--active' : ''}`}
                onClick={() => {
                  if (action.disabled || action.info) return;
                  action.onClick();
                  if (action.deferSheetClose) {
                    queueMicrotask(() => onClose());
                  } else {
                    onClose();
                  }
                }}
              >
                <span className="mobile-track-sheet-action-label">{action.label}</span>
                {action.subtitle ? (
                  <span className="mobile-track-sheet-action-sub">{action.subtitle}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
