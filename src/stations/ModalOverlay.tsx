import React from 'react';
import { createPortal } from 'react-dom';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';

export default function ModalOverlay({
  open,
  onClose,
  title,
  children,
  maxWidth = 'max-w-md',
  borderAccent = false,
  overlayClassName = '',
  panelClassName = '',
  contentClassName = '',
  contentPadding = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  maxWidth?: string;
  borderAccent?: boolean;
  overlayClassName?: string;
  panelClassName?: string;
  contentClassName?: string;
  contentPadding?: boolean;
}) {
  useDismissableOverlay(open, onClose);

  if (!open) return null;

  const contentClasses = [
    contentPadding ? 'overflow-y-auto music-scrollbar p-4 sm:p-6' : '',
    contentClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return createPortal(
    <div
      className={`fixed inset-0 flex items-center justify-center p-4 ${overlayClassName}`.trim()}
      style={{ zIndex: 'var(--z-overlay)' }}
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-md cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className={`relative w-full ${maxWidth} rounded-sm shadow-2xl max-h-[90vh] overflow-hidden flex flex-col ${
          borderAccent ? 'panel-accent-border' : 'border'
        } ${panelClassName}`.trim()}
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: borderAccent ? undefined : 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 4) onClose();
        }}
      >
        {title && (
          <div
            className="px-4 py-3 border-b shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <h2
              id="modal-title"
              className="font-bold uppercase tracking-widest text-accent text-sm"
            >
              {title}
            </h2>
          </div>
        )}
        <div className={contentClasses || undefined}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
