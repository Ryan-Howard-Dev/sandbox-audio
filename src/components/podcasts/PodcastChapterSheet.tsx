import React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useDismissableOverlay } from '../../hooks/useDismissableOverlay';
import { isAdTaggedChapter } from '../../podcastAdSkip';
import type { PodcastChapter } from '../../podcastChapters';
import { findActiveChapterIndex } from '../../podcastChapters';
import { formatTime } from '../../stations/theme';

export interface PodcastChapterSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  feedTitle: string;
  chapters: PodcastChapter[];
  currentTimeSeconds: number;
  onSeek: (seconds: number) => void;
}

export default function PodcastChapterSheet({
  open,
  onClose,
  title,
  feedTitle,
  chapters,
  currentTimeSeconds,
  onSeek,
}: PodcastChapterSheetProps) {
  useDismissableOverlay(open, onClose);
  const activeIdx = findActiveChapterIndex(chapters, currentTimeSeconds);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="mobile-track-sheet-overlay" role="presentation" data-testid="podcast-chapter-sheet">
      <button
        type="button"
        className="mobile-track-sheet-backdrop"
        aria-label="Close chapters"
        onClick={onClose}
      />
      <div
        className="mobile-track-sheet-panel podcasts-show-notes-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Chapters"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mobile-track-sheet-header">
          <div className="mobile-track-sheet-heading min-w-0">
            <p className="mobile-track-sheet-title truncate">{title}</p>
            <p className="mobile-track-sheet-subtitle truncate">{feedTitle}</p>
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
        {chapters.length === 0 ? (
          <p className="podcasts-show-notes-body font-mono text-xs text-[var(--text-dim)]">
            No chapters for this episode. Use Skip Ad during playback to jump forward manually.
          </p>
        ) : (
          <ul className="podcasts-chapter-list">
            {chapters.map((chapter, idx) => {
              const isAd = isAdTaggedChapter(chapter.title);
              return (
                <li key={`${chapter.startSeconds}-${chapter.title}`}>
                  <button
                    type="button"
                    className={`podcasts-chapter-row touch-manipulation${idx === activeIdx ? ' is-active' : ''}${isAd ? ' is-ad' : ''}`}
                    onClick={() => {
                      onSeek(chapter.startSeconds);
                      onClose();
                    }}
                  >
                    <span className="podcasts-chapter-time font-mono tabular-nums">
                      {formatTime(chapter.startSeconds)}
                    </span>
                    <span className="podcasts-chapter-title">
                      {isAd ? (
                        <span className="podcasts-chapter-ad-badge" aria-hidden>
                          Ad
                        </span>
                      ) : null}
                      {chapter.title}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}
