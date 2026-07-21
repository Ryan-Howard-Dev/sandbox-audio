import React, { useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  Download,
  Loader2,
  Play,
  RefreshCw,
} from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import type { PodcastEpisode, PodcastSubscription } from '../../podcastStorage';
import { updateSubscriptionMeta } from '../../podcastStorage';
import {
  PODCAST_AUTO_SAVE_COUNTS,
  PODCAST_DELETE_PLAYED_DAYS_OPTIONS,
  effectiveAutoDownloadWifiOnly,
  formatDeletePlayedLabel,
} from '../../podcastShowRules';
import { stripHtmlText } from '../../playlistImportTypes';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { seedGradient } from '../../seedGradient';
import PodcastEpisodeRow from './PodcastEpisodeRow';
import type { PodcastEpisodeFilter } from '../../stations/PodcastsView';

export interface PodcastLibraryShowDetailProps {
  feed: PodcastSubscription;
  episodes: PodcastEpisode[];
  visibleEpisodes: PodcastEpisode[];
  pagedVisibleEpisodes: PodcastEpisode[];
  episodeFilter: PodcastEpisodeFilter;
  unplayedCount: number;
  downloadedCount: number;
  refreshing: boolean;
  activeEnvelopeId: string | null;
  onBack: () => void;
  onPlay: (env: MediaEnvelope) => void;
  onPrimePlay?: (env: MediaEnvelope) => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onError: (message: string) => void;
  onOfflineChange: () => void;
  onEpisodeFilterChange: (filter: PodcastEpisodeFilter) => void;
  onPlayNextUnplayed: () => void;
  onQueueShowUnplayed?: (feedId: string) => void;
  onRefresh: () => void;
  onShowMore: () => void;
  hasMoreEpisodes: boolean;
  remainingEpisodeCount: number;
  onToggleAutoDownload: (feed: PodcastSubscription) => void;
  onUpdateShowRules: (
    feedId: string,
    patch: Parameters<typeof updateSubscriptionMeta>[1],
  ) => void;
}

export default function PodcastLibraryShowDetail({
  feed,
  episodes,
  visibleEpisodes,
  pagedVisibleEpisodes,
  episodeFilter,
  unplayedCount,
  downloadedCount,
  refreshing,
  activeEnvelopeId,
  onBack,
  onPlay,
  onPrimePlay,
  onAddToQueue,
  onError,
  onOfflineChange,
  onEpisodeFilterChange,
  onPlayNextUnplayed,
  onQueueShowUnplayed,
  onRefresh,
  onShowMore,
  hasMoreEpisodes,
  remainingEpisodeCount,
  onToggleAutoDownload,
  onUpdateShowRules,
}: PodcastLibraryShowDetailProps) {
  const [rulesOpen, setRulesOpen] = useState(false);
  const art = proxiedArtworkUrl(feed.artworkUrl);
  const description = feed.description ? stripHtmlText(feed.description) : '';

  return (
    <div className="podcasts-show-detail podcasts-library-show-detail">
      <button
        type="button"
        className="podcasts-show-detail-back touch-manipulation"
        onClick={onBack}
      >
        <ArrowLeft className="w-4 h-4" />
        All shows
      </button>

      <header className="podcasts-show-detail-head">
        <div className="podcasts-show-detail-art">
          {art ? (
            <img src={art} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full" style={{ background: seedGradient(feed.title) }} />
          )}
        </div>
        <div className="podcasts-show-detail-copy min-w-0">
          <h2 className="podcasts-show-detail-title">{feed.title}</h2>
          {description ? (
            <p className="podcasts-show-detail-desc">{description}</p>
          ) : null}
          <div className="podcasts-show-detail-actions">
            <button
              type="button"
              className="podcasts-discover-btn podcasts-discover-btn--primary touch-manipulation"
              onClick={onPlayNextUnplayed}
              disabled={unplayedCount === 0}
            >
              <Play className="w-3.5 h-3.5" aria-hidden />
              Play next unplayed
            </button>
            <button
              type="button"
              className="podcasts-discover-btn touch-manipulation"
              onClick={onRefresh}
              disabled={refreshing}
            >
              {refreshing ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <RefreshCw className="w-3.5 h-3.5" />
              )}
              Refresh
            </button>
          </div>
        </div>
      </header>

      <div className="podcasts-show-detail-filters mb-4" role="group" aria-label="Episode filters">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
          <h3 className="podcasts-show-detail-episodes-label mb-0">
            Episodes
            {visibleEpisodes.length > 0 ? ` (${visibleEpisodes.length})` : ''}
          </h3>
          {onQueueShowUnplayed && unplayedCount > 0 ? (
            <button
              type="button"
              onClick={() => onQueueShowUnplayed(feed.id)}
              className="flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border)] font-mono text-[10px] uppercase text-accent touch-manipulation hover:border-accent transition-colors"
            >
              Queue unplayed
            </button>
          ) : null}
        </div>
        <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-dim)] mb-2">
          Filter episodes
        </p>
        <div className="podcasts-show-detail-filter-bar flex items-center rounded-lg border border-[var(--border)] overflow-hidden w-full max-w-full">
          <button
            type="button"
            onClick={() => onEpisodeFilterChange('all')}
            className={`flex-1 min-w-0 h-10 px-3 font-mono text-[10px] uppercase touch-manipulation transition-colors ${
              episodeFilter === 'all'
                ? 'bg-[var(--accent-brand)]/15 text-accent'
                : 'text-[var(--text-mid)] hover:text-accent'
            }`}
          >
            All
          </button>
          <button
            type="button"
            onClick={() => onEpisodeFilterChange('unplayed')}
            className={`flex-1 min-w-0 h-10 px-3 font-mono text-[10px] uppercase touch-manipulation border-l border-[var(--border)] transition-colors ${
              episodeFilter === 'unplayed'
                ? 'bg-[var(--accent-brand)]/15 text-accent'
                : 'text-[var(--text-mid)] hover:text-accent'
            }`}
          >
            Unplayed
            {unplayedCount > 0 ? (
              <span className="podcasts-count-badge podcasts-count-badge--inline ml-1">
                {unplayedCount}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => onEpisodeFilterChange('downloaded')}
            className={`flex-1 min-w-0 h-10 px-3 font-mono text-[10px] uppercase touch-manipulation border-l border-[var(--border)] transition-colors inline-flex items-center justify-center gap-1 ${
              episodeFilter === 'downloaded'
                ? 'bg-[var(--accent-brand)]/15 text-accent'
                : 'text-[var(--text-mid)] hover:text-accent'
            }`}
            aria-current={episodeFilter === 'downloaded' ? 'true' : undefined}
          >
            <Download className="w-3 h-3 shrink-0" aria-hidden />
            Downloaded
            <span
              className={`podcasts-count-badge podcasts-count-badge--inline${downloadedCount === 0 ? ' podcasts-count-badge--empty' : ''}`}
            >
              {downloadedCount}
            </span>
          </button>
        </div>
      </div>

      <button
        type="button"
        className="podcasts-library-rules-toggle touch-manipulation"
        aria-expanded={rulesOpen}
        onClick={() => setRulesOpen((v) => !v)}
      >
        <span className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-dim)]">
          Show rules
        </span>
        <ChevronDown
          className={`w-4 h-4 text-[var(--text-dim)] transition-transform${rulesOpen ? ' rotate-180' : ''}`}
          aria-hidden
        />
      </button>

      {rulesOpen ? (
        <div className="podcasts-show-rules mb-4 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]/40 space-y-3">
          <p className="font-mono text-[9px] uppercase tracking-widest text-[var(--text-dim)]">
            Synced via Sandbox Server
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onToggleAutoDownload(feed)}
              className={`h-8 px-3 rounded-lg border font-mono text-[10px] uppercase touch-manipulation ${
                feed.autoDownload
                  ? 'border-accent text-accent bg-[var(--accent-brand)]/10'
                  : 'border-[var(--border)] text-[var(--text-mid)]'
              }`}
            >
              Auto-save {feed.autoDownload ? 'on' : 'off'}
            </button>
            {feed.autoDownload ? (
              <select
                className="h-8 px-2 rounded-lg border border-[var(--border)] bg-transparent font-mono text-[10px] uppercase text-[var(--text)]"
                value={feed.autoDownloadCount ?? 3}
                onChange={(e) =>
                  onUpdateShowRules(feed.id, {
                    autoDownloadCount: parseInt(e.target.value, 10),
                  })
                }
                aria-label="Episodes to auto-save"
              >
                {PODCAST_AUTO_SAVE_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    Keep {n}
                  </option>
                ))}
              </select>
            ) : null}
            <label className="flex items-center gap-2 font-mono text-[10px] uppercase text-[var(--text-dim)] touch-manipulation">
              <input
                type="checkbox"
                checked={feed.autoDownloadWifiOnly ?? effectiveAutoDownloadWifiOnly(feed)}
                onChange={(e) =>
                  onUpdateShowRules(feed.id, {
                    autoDownloadWifiOnly: e.target.checked,
                  })
                }
                className="accent-[var(--accent-brand)]"
              />
              Wi‑Fi only
            </label>
            <select
              className="h-8 px-2 rounded-lg border border-[var(--border)] bg-transparent font-mono text-[10px] uppercase text-[var(--text)]"
              value={feed.deletePlayedAfterDays ?? 0}
              onChange={(e) =>
                onUpdateShowRules(feed.id, {
                  deletePlayedAfterDays: parseInt(e.target.value, 10),
                })
              }
              aria-label="Delete played episodes after"
            >
              {PODCAST_DELETE_PLAYED_DAYS_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  Delete played: {formatDeletePlayedLabel(days)}
                </option>
              ))}
            </select>
            <select
              className="h-8 px-2 rounded-lg border border-[var(--border)] bg-transparent font-mono text-[10px] uppercase text-[var(--text)]"
              value={
                feed.voiceBoostDefault === undefined
                  ? 'inherit'
                  : feed.voiceBoostDefault
                    ? 'on'
                    : 'off'
              }
              onChange={(e) => {
                const v = e.target.value;
                onUpdateShowRules(feed.id, {
                  voiceBoostDefault: v === 'inherit' ? null : v === 'on',
                });
              }}
              aria-label="Voice Boost default for this show"
            >
              <option value="inherit">Voice Boost: Global</option>
              <option value="on">Voice Boost: On</option>
              <option value="off">Voice Boost: Off</option>
            </select>
          </div>
        </div>
      ) : null}

      {episodes.length === 0 ? (
        <div className="podcasts-empty-state podcasts-empty-state--compact">
          <p className="font-mono text-xs text-[var(--text-dim)]">
            No episodes yet. Tap Refresh to fetch the feed.
          </p>
        </div>
      ) : visibleEpisodes.length === 0 ? (
        <div className="podcasts-empty-state podcasts-empty-state--compact">
          <p className="font-mono text-xs text-[var(--text-dim)]">
            {episodeFilter === 'downloaded'
              ? 'No downloaded episodes for this show — tap Save offline on any episode.'
              : episodeFilter === 'unplayed'
                ? 'No unplayed episodes — you are caught up on this show.'
                : 'No episodes match this filter.'}
          </p>
        </div>
      ) : (
        <ul className="podcasts-show-detail-list divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-card)]/40 overflow-hidden">
          {pagedVisibleEpisodes.map((ep) => (
            <li key={ep.id}>
              <PodcastEpisodeRow
                episode={ep}
                feedTitle={feed.title}
                feedArtworkUrl={feed.artworkUrl}
                activeEnvelopeId={activeEnvelopeId}
                onPlay={onPlay}
                onPrimePlay={onPrimePlay}
                onAddToQueue={onAddToQueue}
                onError={onError}
                onOfflineChange={onOfflineChange}
                variant="library"
              />
            </li>
          ))}
        </ul>
      )}

      {hasMoreEpisodes ? (
        <button
          type="button"
          className="mt-4 w-full h-10 rounded-lg border border-[var(--border)] font-mono text-[10px] uppercase text-accent touch-manipulation hover:border-accent transition-colors"
          onClick={onShowMore}
        >
          Show more ({remainingEpisodeCount} remaining)
        </button>
      ) : null}
    </div>
  );
}
