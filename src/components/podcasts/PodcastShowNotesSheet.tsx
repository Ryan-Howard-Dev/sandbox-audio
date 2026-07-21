import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismissableOverlay } from '../../hooks/useDismissableOverlay';
import { formatEpisodeDate } from '../../podcastFormat';

export interface PodcastShowNotesSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  feedTitle: string;
  description: string;
  publishedAt?: number;
}

export default function PodcastShowNotesSheet({
  open,
  onClose,
  title,
  feedTitle,
  description,
  publishedAt,
}: PodcastShowNotesSheetProps) {
  useDismissableOverlay(open, onClose);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mobile-track-sheet-overlay" role="presentation" data-testid="podcast-show-notes-sheet">
      <button
        type="button"
        className="mobile-track-sheet-backdrop"
        aria-label="Close show notes"
        onClick={onClose}
      />
      <div
        className="mobile-track-sheet-panel podcasts-show-notes-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Show notes"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mobile-track-sheet-header">
          <div className="mobile-track-sheet-heading min-w-0">
            <p className="mobile-track-sheet-title truncate">{title}</p>
            <p className="mobile-track-sheet-subtitle truncate">
              {feedTitle}
              {publishedAt ? ` · ${formatEpisodeDate(publishedAt)}` : ''}
            </p>
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
        <div className="podcasts-show-notes-body font-mono text-xs text-[var(--text-mid)] leading-relaxed whitespace-pre-wrap">
          {description.trim() || 'No show notes for this episode.'}
        </div>
      </div>
    </div>,
    document.body,
  );
}
