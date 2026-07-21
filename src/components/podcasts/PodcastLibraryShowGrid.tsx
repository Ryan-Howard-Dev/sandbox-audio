import React from 'react';
import { Rss, Search, Trash2, Youtube } from 'lucide-react';
import type { PodcastSubscription } from '../../podcastStorage';
import { stripHtmlText } from '../../playlistImportTypes';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { seedGradient } from '../../seedGradient';

export interface PodcastLibraryShowGridProps {
  subscriptions: PodcastSubscription[];
  unplayedByFeed: Record<string, number>;
  episodeCountByFeed: Record<string, number>;
  onOpenShow: (feedId: string) => void;
  onDiscoverMore: () => void;
  onUnsubscribe: (feedId: string) => void;
}

export default function PodcastLibraryShowGrid({
  subscriptions,
  unplayedByFeed,
  episodeCountByFeed,
  onOpenShow,
  onDiscoverMore,
  onUnsubscribe,
}: PodcastLibraryShowGridProps) {
  return (
    <section className="podcasts-library-grid-section">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
          Your shows
        </p>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase text-accent touch-manipulation hover:opacity-80"
          onClick={onDiscoverMore}
        >
          <Search className="w-3.5 h-3.5" />
          Discover more
        </button>
      </div>

      <ul className="podcasts-library-grid" role="list">
        {subscriptions.map((sub) => {
          const art = proxiedArtworkUrl(sub.artworkUrl);
          const unplayed = unplayedByFeed[sub.id] ?? 0;
          const episodeCount = episodeCountByFeed[sub.id] ?? 0;
          const blurb = sub.description
            ? stripHtmlText(sub.description)
            : sub.source === 'youtube'
              ? 'Video channel feed'
              : 'RSS feed';

          return (
            <li key={sub.id}>
              <div className="podcasts-library-tile-wrap">
                <button
                  type="button"
                  className="podcasts-library-tile touch-manipulation"
                  onClick={() => onOpenShow(sub.id)}
                  aria-label={`Open ${sub.title}`}
                >
                  <div className="podcasts-library-tile-art">
                    {art ? (
                      <img src={art} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="w-full h-full"
                        style={{ background: seedGradient(sub.title) }}
                      />
                    )}
                    {unplayed > 0 ? (
                      <span className="podcasts-library-tile-badge font-mono tabular-nums">
                        {unplayed > 999 ? '999+' : unplayed}
                      </span>
                    ) : null}
                  </div>
                  <p className="podcasts-library-tile-title">{sub.title}</p>
                  <p className="podcasts-library-tile-meta line-clamp-2">{blurb}</p>
                  <p className="podcasts-library-tile-count font-mono text-[9px] uppercase text-[var(--text-dim)]">
                    {sub.source === 'youtube' ? (
                      <Youtube className="w-3 h-3 inline-block mr-1 -mt-px" aria-hidden />
                    ) : (
                      <Rss className="w-3 h-3 inline-block mr-1 -mt-px" aria-hidden />
                    )}
                    {episodeCount > 0
                      ? `${episodeCount} episode${episodeCount === 1 ? '' : 's'}`
                      : 'Tap to load'}
                  </p>
                </button>
                <button
                  type="button"
                  className="podcasts-library-tile-unsub touch-manipulation"
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnsubscribe(sub.id);
                  }}
                  aria-label={`Unsubscribe from ${sub.title}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
