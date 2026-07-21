import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  HardDriveDownload,
  Loader2,
  Play,
} from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import type { LockerMenuAction } from '../LockerMoreMenu';
import LockerRowActions from '../locker/LockerRowActions';
import { episodeEnvelope } from '../../podcastSearch';
import { formatEpisodeDate } from '../../podcastFormat';
import { stripHtmlText } from '../../playlistImportTypes';
import {
  getEpisodeResumePosition,
  isEpisodeInProgress,
  isEpisodePlayed,
  markEpisodePlayed,
  markEpisodeUnplayed,
  subscribePodcasts,
  type PodcastEpisode,
} from '../../podcastStorage';
import {
  cacheEnvelopeForOffline,
  isEnvelopeStreamCached,
  removeEnvelopeFromStreamCache,
  subscribeStreamCache,
} from '../../streamCache';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { formatTime } from '../../stations/theme';
import { tapHaptic } from '../../uiTapFeedback';
import PodcastShowNotesSheet from './PodcastShowNotesSheet';

export interface PodcastEpisodeRowProps {
  episode: PodcastEpisode;
  feedTitle: string;
  feedArtworkUrl?: string;
  active?: boolean;
  activeEnvelopeId?: string | null;
  onPlay: (env: MediaEnvelope) => void;
  /** Fired on explicit play tap — primes gesture before async resolve. */
  onPrimePlay?: (env: MediaEnvelope) => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onError?: (message: string) => void;
  /** Called after an episode is saved offline or removed from offline storage. */
  onOfflineChange?: () => void;
  /** Compact row for discover show detail */
  variant?: 'library' | 'discover';
}

function formatResume(seconds: number): string {
  if (seconds < 3) return '';
  return `Resume ${formatTime(seconds)}`;
}

function PodcastEpisodeRow({
  episode,
  feedTitle,
  feedArtworkUrl,
  active,
  activeEnvelopeId,
  onPlay,
  onPrimePlay,
  onAddToQueue,
  onError,
  onOfflineChange,
  variant = 'library',
}: PodcastEpisodeRowProps) {
  const envelope = useMemo(
    () => episodeEnvelope(episode, feedTitle, feedArtworkUrl),
    [episode, feedTitle, feedArtworkUrl],
  );
  const isActive =
    active ??
    (activeEnvelopeId != null && envelope.envelopeId === activeEnvelopeId);
  const [downloading, setDownloading] = useState(false);
  const [cached, setCached] = useState(() => isEnvelopeStreamCached(envelope));
  const [openMenuKey, setOpenMenuKey] = useState<string | null>(null);
  const [showNotesOpen, setShowNotesOpen] = useState(false);
  const [resumeTick, setResumeTick] = useState(0);
  const [playbackTick, setPlaybackTick] = useState(0);
  const [tapPending, setTapPending] = useState(false);

  const menuKey = `podcast-ep:${episode.id}`;

  useEffect(() => subscribeStreamCache(() => setCached(isEnvelopeStreamCached(envelope))), [envelope]);
  useEffect(() => subscribePodcasts(() => setPlaybackTick((n) => n + 1)), []);

  useEffect(() => {
    if (isActive) setTapPending(false);
  }, [isActive]);

  const played = isEpisodePlayed(episode.id);
  void playbackTick;

  const resume = getEpisodeResumePosition(episode.id);
  const art = proxiedArtworkUrl(episode.artworkUrl ?? feedArtworkUrl);
  const showActive = isActive || tapPending;

  const handlePlay = useCallback(() => {
    setTapPending(true);
    tapHaptic();
    onPrimePlay?.(envelope);
    onPlay(envelope);
  }, [envelope, onPlay, onPrimePlay]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    onError?.('');
    try {
      await cacheEnvelopeForOffline(envelope);
      setCached(true);
      onOfflineChange?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Save offline failed');
    } finally {
      setDownloading(false);
    }
  }, [envelope, onError, onOfflineChange]);

  const handleRemoveDownload = useCallback(async () => {
    setDownloading(true);
    try {
      await removeEnvelopeFromStreamCache(envelope);
      setCached(false);
      onOfflineChange?.();
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Remove offline save failed');
    } finally {
      setDownloading(false);
    }
  }, [envelope, onError, onOfflineChange]);

  const handleShare = useCallback(async () => {
    const text = `${episode.title} — ${feedTitle}`;
    const url = episode.audioUrl?.trim();
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: episode.title, text, url: url || undefined });
        return;
      }
    } catch {
      /* user cancelled */
    }
    if (url && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
      onError?.('Episode link copied');
    }
  }, [episode.title, episode.audioUrl, feedTitle, onError]);

  const menuActions = useMemo((): LockerMenuAction[] => {
    const actions: LockerMenuAction[] = [
      {
        id: 'play',
        label: isEpisodeInProgress(episode.id) ? 'Resume episode' : 'Play episode',
        onClick: handlePlay,
      },
    ];
    if (onAddToQueue) {
      actions.push({
        id: 'queue',
        label: 'Add to queue',
        onClick: () => onAddToQueue(envelope),
      });
    }
    actions.push({
      id: 'download',
      label: cached ? 'Remove offline save' : 'Save offline',
      subtitle: cached ? 'Stored for offline playback' : 'Keep on this device for offline listening',
      onClick: () => void (cached ? handleRemoveDownload() : handleDownload()),
      disabled: downloading,
    });
    if (episode.description?.trim()) {
      actions.push({
        id: 'notes',
        label: 'Show notes',
        onClick: () => setShowNotesOpen(true),
        deferSheetClose: true,
      });
    }
    actions.push({
      id: 'mark-played',
      label: played ? 'Mark as unplayed' : 'Mark as played',
      onClick: () => {
        if (played) {
          markEpisodeUnplayed(episode.id);
        } else {
          markEpisodePlayed(episode.id);
        }
        setResumeTick((n) => n + 1);
        setPlaybackTick((n) => n + 1);
      },
      divider: true,
    });
    actions.push({
      id: 'share',
      label: 'Share episode',
      onClick: () => void handleShare(),
    });
    return actions;
  }, [
    cached,
    downloading,
    envelope,
    episode.description,
    episode.id,
    played,
    handleDownload,
    handlePlay,
    handleRemoveDownload,
    handleShare,
    onAddToQueue,
    resumeTick,
  ]);

  const metaParts = [
    formatEpisodeDate(episode.publishedAt),
    episode.durationSeconds ? formatTime(episode.durationSeconds) : null,
    played ? 'Played' : null,
    !played && resume > 3 ? formatResume(resume) : null,
  ].filter(Boolean);

  const descriptionPreview = useMemo(() => {
    const raw = episode.description?.trim();
    if (!raw) return '';
    const plain = stripHtmlText(raw);
    if (!plain) return '';
    const titlePlain = stripHtmlText(episode.title);
    if (plain === titlePlain) return '';
    if (titlePlain && plain.startsWith(titlePlain) && plain.length - titlePlain.length < 24) {
      return '';
    }
    return plain;
  }, [episode.description, episode.title]);

  const useCardLayout = variant === 'library';

  const rowClass = useCardLayout
    ? `podcasts-library-episode-card touch-manipulation${showActive ? ' is-active' : ''}${played ? ' podcasts-episode-row--played' : ''}`
    : variant === 'discover'
      ? `podcasts-show-episode-row podcasts-episode-row--actions touch-manipulation${showActive ? ' is-active' : ''}${played ? ' podcasts-episode-row--played' : ''}`
      : `podcasts-show-episode-row podcasts-library-episode-row podcasts-episode-row--actions touch-manipulation${showActive ? ' is-active' : ''}${played ? ' podcasts-episode-row--played' : ''}`;

  return (
    <>
      <div className={rowClass}>
        {useCardLayout && art ? (
          <img src={art} alt="" className="podcasts-library-episode-art shrink-0" />
        ) : null}

        <button
          type="button"
          onClick={handlePlay}
          className={
            useCardLayout
              ? 'podcasts-library-episode-main min-w-0 text-left touch-manipulation'
              : 'podcasts-show-episode-copy min-w-0 flex-1 text-left touch-manipulation'
          }
        >
          <span className="podcasts-show-episode-title">{episode.title}</span>
          <span className="podcasts-show-episode-meta">{metaParts.join(' · ')}</span>
          {!useCardLayout && descriptionPreview ? (
            <span className="podcasts-show-episode-desc">{descriptionPreview}</span>
          ) : null}
        </button>

        <span
          className={
            useCardLayout
              ? 'podcasts-library-episode-actions shrink-0 flex items-center gap-0.5'
              : 'podcasts-episode-actions shrink-0 flex items-center gap-0.5 self-start mt-0.5'
          }
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handlePlay();
            }}
            className={`search-results-action search-results-action--play touch-manipulation podcasts-episode-play-btn${tapPending ? ' is-tap-pending' : ''}`}
            aria-label={tapPending ? 'Connecting episode' : 'Play episode'}
            aria-busy={tapPending}
          >
            {tapPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void (cached ? handleRemoveDownload() : handleDownload())}
            disabled={downloading}
            className="search-results-action touch-manipulation disabled:opacity-40"
            aria-label={cached ? 'Remove offline save' : 'Save offline'}
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : cached ? (
              <Check className="w-4 h-4 text-accent" />
            ) : (
              <HardDriveDownload className="w-4 h-4" />
            )}
          </button>
          <LockerRowActions
            menuKey={menuKey}
            openMenuKey={openMenuKey}
            onOpenMenuKeyChange={setOpenMenuKey}
            actions={menuActions}
            ariaLabel={`Episode options: ${episode.title}`}
            sheetTitle={episode.title}
            sheetSubtitle={feedTitle}
            alwaysVisible
            align="right"
          />
        </span>

        {useCardLayout && descriptionPreview ? (
          <button
            type="button"
            onClick={handlePlay}
            className="podcasts-library-episode-desc-btn touch-manipulation"
          >
            <span className="podcasts-show-episode-desc podcasts-library-episode-desc">
              {descriptionPreview}
            </span>
          </button>
        ) : null}
      </div>

      <PodcastShowNotesSheet
        open={showNotesOpen}
        onClose={() => setShowNotesOpen(false)}
        title={episode.title}
        feedTitle={feedTitle}
        description={episode.description ?? ''}
        publishedAt={episode.publishedAt}
      />

    </>
  );
}

export default memo(PodcastEpisodeRow);
