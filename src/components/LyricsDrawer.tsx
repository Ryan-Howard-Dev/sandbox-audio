import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, ChevronLeft, List, Loader2, RefreshCw, ScrollText, X } from 'lucide-react';
import type { ResolvedLyrics } from '../resolveTrackLyrics';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { useLyricsPlaybackClock } from '../hooks/useLyricsPlaybackClock';
import { findActiveLineIndex } from '../lyricsSync';

export type LyricsViewMode = 'plain' | 'scroll';

export interface LyricsDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  artist: string;
  lyrics: ResolvedLyrics;
  /** Authoritative playback position in seconds (host audio or remote mirror). */
  currentTimeSeconds?: number;
  isPlaying?: boolean;
  onSeek?: (seconds: number) => void;
  onRetry?: () => void;
  showPlayerBarOffset?: boolean;
  isMobile?: boolean;
}

function LyricsLoadingSkeleton() {
  return (
    <div className="lyrics-drawer-skeleton" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="lyrics-drawer-skeleton-line"
          style={{ width: `${55 + ((i * 17) % 35)}%` }}
        />
      ))}
    </div>
  );
}

export default function LyricsDrawer({
  open,
  onClose,
  title,
  artist,
  lyrics,
  currentTimeSeconds = 0,
  isPlaying = false,
  onSeek,
  onRetry,
  showPlayerBarOffset = true,
  isMobile = false,
}: LyricsDrawerProps) {
  useDismissableOverlay(open, onClose);
  const [viewMode, setViewMode] = useState<LyricsViewMode>('scroll');
  const lineRefs = useRef<(HTMLLIElement | null)[]>([]);
  const lastScrolledIndexRef = useRef(-1);

  const playbackMs = useLyricsPlaybackClock(currentTimeSeconds, isPlaying);

  const offsetClass =
    showPlayerBarOffset && !isMobile ? 'lyrics-drawer--above-player' : '';
  const panelClass = isMobile
    ? 'lyrics-drawer-panel--mobile'
    : 'lyrics-drawer-panel--desktop';

  const hasLyrics = Boolean(lyrics.text?.trim());
  const canSync = lyrics.synced && lyrics.lines.length > 0;
  const showRetry = !lyrics.loading && !hasLyrics && Boolean(onRetry);

  useEffect(() => {
    if (!open) return;
    setViewMode(canSync ? 'scroll' : 'plain');
    lastScrolledIndexRef.current = -1;
  }, [open, canSync, lyrics.text, lyrics.source]);

  const activeLineIndex = useMemo(() => {
    if (!canSync || viewMode !== 'scroll') return -1;
    return findActiveLineIndex(lyrics.lines, playbackMs);
  }, [canSync, viewMode, lyrics.lines, playbackMs]);

  useEffect(() => {
    if (!open || viewMode !== 'scroll' || activeLineIndex < 0) return;
    if (lastScrolledIndexRef.current === activeLineIndex) return;
    lastScrolledIndexRef.current = activeLineIndex;
    const el = lineRefs.current[activeLineIndex];
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [open, viewMode, activeLineIndex]);

  const handleLineClick = useCallback(
    (timeMs: number | undefined) => {
      if (!onSeek || timeMs == null || viewMode !== 'scroll' || !canSync) return;
      onSeek(timeMs / 1000);
    },
    [onSeek, viewMode, canSync],
  );

  if (!open) return null;

  const emptyMessage =
    lyrics.hint ??
    (lyrics.status === 'blocked'
      ? 'Lyrics lookup is off while Air-Gap Mode is enabled.'
      : lyrics.status === 'offline'
        ? 'Could not reach the lyrics service. Check your connection and try again.'
        : 'No lyrics available for this track.');

  return (
    <>
      <button
        type="button"
        className={`lyrics-drawer-backdrop ${offsetClass}`}
        aria-label="Close lyrics"
        onClick={onClose}
      />
      <aside
        className={`lyrics-drawer-panel ${panelClass} ${offsetClass} lyrics-drawer-panel--open`}
        role="dialog"
        aria-modal="true"
        aria-label="Track lyrics"
      >
        <header className="lyrics-drawer-header">
          {isMobile ? (
            <button
              type="button"
              onClick={onClose}
              className="lyrics-drawer-back touch-manipulation"
              aria-label="Back to player"
            >
              <ChevronLeft className="w-5 h-5 shrink-0" strokeWidth={2} />
              <span>Back</span>
            </button>
          ) : (
            <div className="flex items-center gap-2 min-w-0">
              <ScrollText className="w-4 h-4 shrink-0 text-accent" strokeWidth={2} />
              <span className="lyrics-drawer-heading">Lyrics</span>
            </div>
          )}
          {isMobile ? (
            <span className="lyrics-drawer-heading lyrics-drawer-heading--mobile">Lyrics</span>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="lyrics-drawer-close touch-manipulation"
              aria-label="Close lyrics drawer"
            >
              <X className="w-4 h-4" strokeWidth={2} />
            </button>
          )}
          {isMobile ? <span className="w-10 shrink-0" aria-hidden /> : null}
        </header>

        <div className="lyrics-drawer-track min-w-0">
          <p className="lyrics-drawer-track-title truncate">{title || 'No Track'}</p>
          <p className="lyrics-drawer-track-artist truncate">{artist || '—'}</p>
        </div>

        <div className="lyrics-drawer-mode-bar">
          <button
            type="button"
            onClick={() => setViewMode('plain')}
            className={`lyrics-drawer-mode-btn touch-manipulation ${
              viewMode === 'plain' ? 'lyrics-drawer-mode-btn--active' : ''
            }`}
            aria-pressed={viewMode === 'plain'}
          >
            <AlignLeft className="w-3.5 h-3.5" strokeWidth={2} />
            Plain
          </button>
          <button
            type="button"
            onClick={() => setViewMode('scroll')}
            disabled={!canSync}
            className={`lyrics-drawer-mode-btn touch-manipulation ${
              viewMode === 'scroll' ? 'lyrics-drawer-mode-btn--active' : ''
            } ${!canSync ? 'lyrics-drawer-mode-btn--disabled' : ''}`}
            aria-pressed={viewMode === 'scroll'}
            title={!canSync ? 'Synced lyrics not available for this track' : undefined}
          >
            <List className="w-3.5 h-3.5" strokeWidth={2} />
            Scroll
          </button>
        </div>

        <div
          className={`lyrics-drawer-body music-scrollbar ${
            viewMode === 'scroll' ? 'lyrics-drawer-body--scroll' : 'lyrics-drawer-body--plain'
          }`}
          data-synced={lyrics.synced ? 'true' : 'false'}
        >
          {lyrics.loading ? (
            <div className="lyrics-drawer-loading" role="status">
              <Loader2 className="lyrics-drawer-spinner" strokeWidth={2} aria-hidden="true" />
              <p className="lyrics-drawer-status">Looking up lyrics…</p>
              <LyricsLoadingSkeleton />
            </div>
          ) : hasLyrics ? (
            <div className="lyrics-drawer-content">
              {viewMode === 'plain' || !canSync ? (
                <p className="lyrics-drawer-text whitespace-pre-line select-text">
                  {lyrics.text}
                </p>
              ) : (
                <ul className="lyrics-drawer-synced-list" aria-live="polite">
                  {lyrics.lines.map((line, i) => {
                    const state =
                      i === activeLineIndex
                        ? 'active'
                        : activeLineIndex >= 0 && i < activeLineIndex
                          ? 'past'
                          : 'upcoming';
                    const seekable = onSeek && line.timeMs != null;
                    return (
                      <li
                        key={`${line.timeMs ?? 'x'}-${i}`}
                        ref={(el) => {
                          lineRefs.current[i] = el;
                        }}
                        className={`lyrics-drawer-line lyrics-drawer-line--${state}${
                          seekable ? ' lyrics-drawer-line--seekable' : ''
                        }`}
                        data-time-ms={line.timeMs ?? undefined}
                        data-active={state === 'active' ? 'true' : undefined}
                        onClick={() => handleLineClick(line.timeMs)}
                        onKeyDown={(e) => {
                          if (seekable && (e.key === 'Enter' || e.key === ' ')) {
                            e.preventDefault();
                            handleLineClick(line.timeMs);
                          }
                        }}
                        role={seekable ? 'button' : undefined}
                        tabIndex={seekable ? 0 : undefined}
                      >
                        {line.text}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ) : (
            <div className="lyrics-drawer-empty-wrap">
              <p className="lyrics-drawer-empty">{emptyMessage}</p>
              {showRetry ? (
                <button
                  type="button"
                  className="lyrics-drawer-retry touch-manipulation"
                  onClick={onRetry}
                >
                  <RefreshCw className="w-3.5 h-3.5" strokeWidth={2} />
                  Try again
                </button>
              ) : null}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
