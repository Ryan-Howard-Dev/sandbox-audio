import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowLeft,
  Globe,
  Loader2,
  Play,
  Plus,
  Podcast,
  Search,
  TrendingUp,
} from 'lucide-react';
import type { MediaEnvelope } from '../../sandboxLayer1';
import {
  fetchCatalogShowEpisodes,
  fetchTrendingPodcastShows,
  isSubscribedToFeed,
  PODCAST_DISCOVER_CATEGORIES,
  searchPodcastCatalogShows,
  subscribeFromCatalogShow,
  type PodcastCatalogShow,
} from '../../podcastCatalog';
import { episodeEnvelope } from '../../podcastSearch';
import type { PodcastEpisode } from '../../podcastStorage';
import { proxiedArtworkUrl } from '../../displaySanitize';
import { seedGradient } from '../../seedGradient';
import PodcastEpisodeRow from './PodcastEpisodeRow';

export interface PodcastDiscoverPanelProps {
  onPlay: (env: MediaEnvelope) => void;
  onPrimePlay?: (env: MediaEnvelope) => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onSubscribed?: () => void;
  onError?: (message: string) => void;
  activeEnvelopeId?: string | null;
}

function ShowCard({
  show,
  subscribing,
  onOpen,
  onSubscribe,
  onPlayLatest,
}: {
  show: PodcastCatalogShow;
  subscribing: boolean;
  onOpen: () => void;
  onSubscribe: () => void;
  onPlayLatest: () => void;
}) {
  const subscribed = isSubscribedToFeed(show.feedUrl);
  const art = proxiedArtworkUrl(show.artworkUrl);

  return (
    <article
      className="podcasts-discover-card podcasts-discover-card--clickable touch-manipulation"
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`View episodes for ${show.title}`}
    >
      <div className="podcasts-discover-card-art">
        {art ? (
          <img src={art} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full" style={{ background: seedGradient(show.title) }} />
        )}
      </div>
      <div className="podcasts-discover-card-body">
        <h3 className="podcasts-discover-card-title">{show.title}</h3>
        <p className="podcasts-discover-card-author">{show.author}</p>
        {show.description ? (
          <p className="podcasts-discover-card-desc">{show.description}</p>
        ) : null}
        <div className="podcasts-discover-card-actions">
          <button
            type="button"
            className="podcasts-discover-btn touch-manipulation"
            onClick={(e) => {
              e.stopPropagation();
              onSubscribe();
            }}
            disabled={subscribing || subscribed}
          >
            {subscribing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : subscribed ? (
              'Subscribed'
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" aria-hidden />
                Subscribe
              </>
            )}
          </button>
        </div>
      </div>
    </article>
  );
}

function ShowEpisodesView({
  show,
  episodes,
  loading,
  busy,
  activeEnvelopeId,
  onBack,
  onPlayEpisode,
  onPrimePlayEpisode,
  onSubscribe,
  onPlayLatest,
  onAddToQueue,
  onError,
}: {
  show: PodcastCatalogShow;
  episodes: PodcastEpisode[];
  loading: boolean;
  busy: boolean;
  activeEnvelopeId?: string | null;
  onBack: () => void;
  onPlayEpisode: (episode: PodcastEpisode) => void;
  onPrimePlayEpisode?: (episode: PodcastEpisode) => void;
  onSubscribe: () => void;
  onPlayLatest: () => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onError?: (message: string) => void;
}) {
  const subscribed = isSubscribedToFeed(show.feedUrl);
  const art = proxiedArtworkUrl(show.artworkUrl);

  return (
    <div className="podcasts-show-detail">
      <button type="button" className="podcasts-show-detail-back touch-manipulation" onClick={onBack}>
        <ArrowLeft className="w-4 h-4" />
        Back to results
      </button>

      <header className="podcasts-show-detail-head">
        <div className="podcasts-show-detail-art">
          {art ? (
            <img src={art} alt="" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full" style={{ background: seedGradient(show.title) }} />
          )}
        </div>
        <div className="podcasts-show-detail-copy min-w-0">
          <h2 className="podcasts-show-detail-title">{show.title}</h2>
          <p className="podcasts-show-detail-author">{show.author}</p>
          {show.description ? (
            <p className="podcasts-show-detail-desc">{show.description}</p>
          ) : null}
          <div className="podcasts-show-detail-actions">
            <button
              type="button"
              className="podcasts-discover-btn podcasts-discover-btn--primary touch-manipulation"
              onClick={onPlayLatest}
              disabled={busy || episodes.length === 0}
            >
              <Play className="w-3.5 h-3.5" aria-hidden />
              Play latest
            </button>
            <button
              type="button"
              className="podcasts-discover-btn touch-manipulation"
              onClick={onSubscribe}
              disabled={busy || subscribed}
            >
              {busy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : subscribed ? (
                'Subscribed'
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" aria-hidden />
                  Subscribe
                </>
              )}
            </button>
          </div>
        </div>
      </header>

      <h3 className="podcasts-show-detail-episodes-label">
        Episodes
        {episodes.length > 0 ? ` (${episodes.length})` : ''}
      </h3>

      {loading ? (
        <div className="podcasts-show-detail-loading">
          <Loader2 className="w-5 h-5 animate-spin text-accent" />
          <span>Loading episodes…</span>
        </div>
      ) : episodes.length === 0 ? (
        <p className="podcasts-discover-empty font-mono text-xs text-[var(--text-dim)]">
          No episodes found in this feed yet.
        </p>
      ) : (
        <ul className="podcasts-show-detail-list divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--bg-card)]/40 overflow-hidden">
          {episodes.map((episode) => (
            <li key={episode.id}>
              <PodcastEpisodeRow
                episode={episode}
                feedTitle={show.title}
                feedArtworkUrl={show.artworkUrl}
                activeEnvelopeId={activeEnvelopeId}
                onPlay={() => onPlayEpisode(episode)}
                onPrimePlay={
                  onPrimePlayEpisode
                    ? () => onPrimePlayEpisode(episode)
                    : undefined
                }
                onAddToQueue={onAddToQueue}
                onError={onError}
                variant="discover"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function PodcastDiscoverPanel({
  onPlay,
  onPrimePlay,
  onAddToQueue,
  onSubscribed,
  onError,
  activeEnvelopeId,
}: PodcastDiscoverPanelProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [trending, setTrending] = useState<PodcastCatalogShow[]>([]);
  const [results, setResults] = useState<PodcastCatalogShow[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [loadingTrending, setLoadingTrending] = useState(true);
  const [busyShowId, setBusyShowId] = useState<string | null>(null);
  const [selectedShow, setSelectedShow] = useState<PodcastCatalogShow | null>(null);
  const [showEpisodes, setShowEpisodes] = useState<PodcastEpisode[]>([]);
  const [loadingEpisodes, setLoadingEpisodes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadingTrending(true);
    void fetchTrendingPodcastShows(16).then((shows) => {
      if (!cancelled) {
        setTrending(shows);
        setLoadingTrending(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const shows = await searchPodcastCatalogShows(trimmed, 24);
      setResults(shows);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [onError]);

  const handleSubscribeAndPlay = useCallback(
    async (show: PodcastCatalogShow, playOnly = false) => {
      setBusyShowId(show.id);
      try {
        const { subscription, episodes } = await subscribeFromCatalogShow(show);
        onSubscribed?.();
        setShowEpisodes(episodes);
        if (episodes.length > 0) {
          const ep = episodes[0]!;
          onPlay(
            episodeEnvelope(ep, subscription.title, subscription.artworkUrl ?? show.artworkUrl),
          );
        } else if (!playOnly) {
          onError?.('No episodes found in this feed yet.');
        }
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Could not subscribe');
      } finally {
        setBusyShowId(null);
      }
    },
    [onPlay, onSubscribed, onError],
  );

  const openShow = useCallback(
    async (show: PodcastCatalogShow) => {
      setSelectedShow(show);
      setShowEpisodes([]);
      setLoadingEpisodes(true);
      try {
        const episodes = await fetchCatalogShowEpisodes(show);
        setShowEpisodes(episodes);
      } catch (e) {
        onError?.(e instanceof Error ? e.message : 'Could not load episodes');
        setShowEpisodes([]);
      } finally {
        setLoadingEpisodes(false);
      }
    },
    [onError],
  );

  const handleCategory = (categoryId: string, categoryQuery: string) => {
    setActiveCategory(categoryId);
    setQuery(categoryQuery);
    setSelectedShow(null);
    void runSearch(categoryQuery);
  };

  const displayShows = results.length > 0 ? results : trending;
  const sectionTitle =
    results.length > 0
      ? `Results for “${query.trim()}”`
      : loadingTrending
        ? 'Loading…'
        : 'Trending worldwide';

  if (selectedShow) {
    return (
      <ShowEpisodesView
        show={selectedShow}
        episodes={showEpisodes}
        loading={loadingEpisodes}
        busy={busyShowId === selectedShow.id}
        activeEnvelopeId={activeEnvelopeId}
        onBack={() => {
          setSelectedShow(null);
          setShowEpisodes([]);
        }}
        onPlayEpisode={(episode) =>
          onPlay(episodeEnvelope(episode, selectedShow.title, selectedShow.artworkUrl))
        }
        onPrimePlayEpisode={
          onPrimePlay
            ? (episode) =>
                onPrimePlay(
                  episodeEnvelope(episode, selectedShow.title, selectedShow.artworkUrl),
                )
            : undefined
        }
        onSubscribe={() => void handleSubscribeAndPlay(selectedShow, true)}
        onPlayLatest={() => void handleSubscribeAndPlay(selectedShow, false)}
        onAddToQueue={onAddToQueue}
        onError={onError}
      />
    );
  }

  return (
    <div className="podcasts-discover">
      <div className="podcasts-discover-hero">
        <Globe className="w-5 h-5 text-accent shrink-0" aria-hidden />
        <div>
          <p className="podcasts-discover-hero-title">Discover podcasts worldwide</p>
          <p className="podcasts-discover-hero-lead">
            Search millions of shows across open podcast directories and the global catalog. Tap a show to browse episodes.
          </p>
        </div>
      </div>

      <form
        className="podcasts-discover-search"
        onSubmit={(e) => {
          e.preventDefault();
          void runSearch(query);
        }}
      >
        <Search className="w-4 h-4 text-[var(--text-dim)] shrink-0" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search podcasts, hosts, topics…"
          className="podcasts-discover-search-input"
          aria-label="Search global podcasts"
        />
        <button
          type="submit"
          className="podcasts-discover-search-btn touch-manipulation"
          disabled={searching || query.trim().length < 2}
        >
          {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
        </button>
      </form>

      <div className="podcasts-discover-categories hide-scrollbar">
        {PODCAST_DISCOVER_CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            className={`podcasts-discover-chip touch-manipulation${activeCategory === cat.id ? ' podcasts-discover-chip--active' : ''}`}
            onClick={() => handleCategory(cat.id, cat.query)}
          >
            {cat.label}
          </button>
        ))}
      </div>

      <div className="podcasts-discover-section-head">
        {results.length === 0 ? (
          <TrendingUp className="w-4 h-4 text-accent" aria-hidden />
        ) : (
          <Podcast className="w-4 h-4 text-accent" aria-hidden />
        )}
        <h2 className="podcasts-discover-section-title">{sectionTitle}</h2>
        {(searching || loadingTrending) && results.length === 0 ? (
          <Loader2 className="w-4 h-4 animate-spin text-accent ml-auto" />
        ) : null}
      </div>

      {displayShows.length === 0 && !searching && !loadingTrending ? (
        <p className="podcasts-discover-empty font-mono text-xs text-[var(--text-dim)]">
          No podcasts found. Try another search or connect Sandbox Server for episode-level search.
        </p>
      ) : (
        <div className="podcasts-discover-grid">
          {displayShows.map((show) => (
            <div key={show.id}>
              <ShowCard
                show={show}
                subscribing={busyShowId === show.id}
                onOpen={() => void openShow(show)}
                onSubscribe={() => void handleSubscribeAndPlay(show, true)}
                onPlayLatest={() => void handleSubscribeAndPlay(show, false)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
