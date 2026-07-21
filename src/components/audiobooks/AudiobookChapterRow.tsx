import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, HardDriveDownload, Loader2, Play } from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import {
  cacheEnvelopeForOffline,
  isEnvelopeStreamCached,
  removeEnvelopeFromStreamCache,
  subscribeStreamCache,
} from '../../streamCache';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { formatTime } from '../../stations/theme';
import { tapHaptic } from '../../uiTapFeedback';
import type { AudiobookCatalogChapter } from '../../audiobookCatalog';

export interface AudiobookChapterRowProps {
  chapter: AudiobookCatalogChapter;
  bookTitle: string;
  bookAuthor: string;
  bookArtworkUrl?: string;
  envelope: MediaEnvelope;
  active?: boolean;
  activeEnvelopeId?: string | null;
  onPlay: (env: MediaEnvelope) => void;
  onPrimePlay?: (env: MediaEnvelope) => void;
  onError?: (message: string) => void;
  onOfflineChange?: () => void;
}

function AudiobookChapterRow({
  chapter,
  bookTitle,
  envelope,
  active,
  activeEnvelopeId,
  onPlay,
  onPrimePlay,
  onError,
  onOfflineChange,
}: AudiobookChapterRowProps) {
  const isActive = active ?? (activeEnvelopeId != null && envelope.envelopeId === activeEnvelopeId);
  const [downloading, setDownloading] = useState(false);
  const [cached, setCached] = useState(() => isEnvelopeStreamCached(envelope));
  const [tapPending, setTapPending] = useState(false);

  useEffect(() => subscribeStreamCache(() => setCached(isEnvelopeStreamCached(envelope))), [envelope]);
  useEffect(() => {
    if (isActive) setTapPending(false);
  }, [isActive]);

  const handlePlay = useCallback(() => {
    tapHaptic();
    setTapPending(true);
    onPrimePlay?.(envelope);
    onPlay(envelope);
  }, [envelope, onPlay, onPrimePlay]);

  const handleOffline = useCallback(async () => {
    tapHaptic();
    if (cached) {
      await removeEnvelopeFromStreamCache(envelope);
      setCached(false);
      onOfflineChange?.();
      return;
    }
    setDownloading(true);
    try {
      await cacheEnvelopeForOffline(envelope);
      setCached(true);
      onOfflineChange?.();
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  }, [cached, envelope, onError, onOfflineChange]);

  const showActive = isActive || tapPending;
  const duration =
    chapter.durationSeconds && chapter.durationSeconds > 0
      ? formatTime(chapter.durationSeconds)
      : '';

  return (
    <li className={`podcasts-show-episode-row${showActive ? ' podcasts-show-episode-row--active' : ''}`}>
      <button
        type="button"
        className="podcasts-show-episode-copy touch-manipulation text-left flex-1 min-w-0 py-3"
        onClick={handlePlay}
        aria-label={`Play ${chapter.title}`}
      >
        <p className="podcasts-show-episode-title">{chapter.title}</p>
        <p className="podcasts-show-episode-meta">
          {bookTitle}
          {duration ? ` · ${duration}` : ''}
        </p>
      </button>
      <div className="podcasts-show-episode-actions flex items-center gap-1 shrink-0 pr-2">
        <button
          type="button"
          className={`podcasts-episode-offline-btn touch-manipulation${cached ? ' podcasts-episode-offline-btn--cached' : ''}`}
          onClick={() => void handleOffline()}
          disabled={downloading}
          aria-label={cached ? 'Remove offline download' : 'Download for offline'}
          title={cached ? 'Saved offline' : 'Download for offline'}
        >
          {downloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : cached ? (
            <Check className="w-4 h-4" />
          ) : (
            <HardDriveDownload className="w-4 h-4" />
          )}
        </button>
        <button
          type="button"
          className="podcasts-episode-play-btn touch-manipulation"
          onClick={handlePlay}
          aria-label={`Play ${chapter.title}`}
        >
          <Play className="w-4 h-4" />
        </button>
      </div>
    </li>
  );
}

export default memo(AudiobookChapterRow);
