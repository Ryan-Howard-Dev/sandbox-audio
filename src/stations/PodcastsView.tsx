import React, { useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import {
  Download,
  Loader2,
  Podcast,
  Search,
} from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import { fetchPodcastFeed } from '../podcastRss';
import {
  fetchPodcastMirrorStatus,
  requestPodcastMirrorPull,
  syncPodcastSubscriptionsToMirror,
  type PodcastMirrorStatus,
} from '../podcastMirrorSync';
import {
  fetchPodcastTranscriptStatus,
  type PodcastTranscriptStatus,
} from '../podcastTranscriptSearch';
import {
  findNextUnplayedEpisode,
  getUnplayedCountsByFeed,
  isEpisodeUnplayed,
  loadEpisodesForFeed,
  loadSubscriptions,
  removeSubscription,
  saveEpisodesForFeed,
  subscribePodcasts,
  updateSubscriptionMeta,
  type PodcastEpisode,
  type PodcastSubscription,
} from '../podcastStorage';
import { onPodcastEpisodesUpdated } from '../podcastEpisodeSync';
import { markPodcastEpisodesSeen } from '../podcastEpisodeNotifications';
import {
  loadPodcastNotifEnabled,
  PODCAST_SETTINGS_CHANGE_EVENT,
  savePodcastNotifEnabled,
} from '../podcastSettings';
import LockerMoreMenu, { type LockerMenuAction } from '../components/LockerMoreMenu';
import NotificationBellButton from '../components/NotificationBellButton';
import { syncPodcastRulesToTier34 } from '../podcastRulesSync';
import {
  loadOfflinePodcastEpisodes,
  type OfflinePodcastEpisode,
} from '../podcastOfflineEpisodes';
import { episodeEnvelope } from '../podcastSearch';
import {
  isEnvelopeStreamCached,
  subscribeStreamCache,
  warmStreamCacheIndex,
} from '../streamCache';

import PodcastDiscoverPanel from '../components/podcasts/PodcastDiscoverPanel';
import PodcastManualSubscribeSection from '../components/podcasts/PodcastManualSubscribeSection';
import PodcastLibraryShowGrid from '../components/podcasts/PodcastLibraryShowGrid';
import PodcastLibraryShowDetail from '../components/podcasts/PodcastLibraryShowDetail';
import PodcastEpisodeRow from '../components/podcasts/PodcastEpisodeRow';

function deferPodcastPrefSave(save: (value: boolean) => void, value: boolean): void {
  queueMicrotask(() => save(value));
}

const EPISODE_PAGE_SIZE = 40;

export type PodcastEpisodeFilter = 'all' | 'unplayed' | 'downloaded';

export interface PodcastsViewProps {
  activeEnvelopeId: string | null;
  onPlay: (env: MediaEnvelope) => void;
  /** touchstart — prime native gesture + optimistic mini player before async resolve */
  onPrimePlay?: (env: MediaEnvelope) => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onQueueShowUnplayed?: (feedId: string) => void;
  drillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  /** Unseen new-episode count from followed shows (mobile bell). */
  episodeNotifCount?: number;
}

export default function PodcastsView({
  activeEnvelopeId,
  onPlay,
  onPrimePlay,
  onAddToQueue,
  onQueueShowUnplayed,
  drillBackRef,
  episodeNotifCount = 0,
}: PodcastsViewProps) {
  const [tab, setTab] = useState<'discover' | 'library'>('discover');
  const [libraryMounted, setLibraryMounted] = useState(false);
  const [tabPending, startTabTransition] = useTransition();
  const [libraryView, setLibraryView] = useState<'shows' | 'downloaded'>('shows');
  const [offlineEpisodes, setOfflineEpisodes] = useState<OfflinePodcastEpisode[]>(
    loadOfflinePodcastEpisodes,
  );
  const [subscriptions, setSubscriptions] = useState(loadSubscriptions);
  const [openFeedId, setOpenFeedId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<PodcastEpisode[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [notifEnabled, setNotifEnabled] = useState(loadPodcastNotifEnabled);
  const [pageMenuOpen, setPageMenuOpen] = useState(false);
  const [episodeFilter, setEpisodeFilter] = useState<PodcastEpisodeFilter>('all');
  const [playbackTick, setPlaybackTick] = useState(0);
  const [mirrorStatus, setMirrorStatus] = useState<PodcastMirrorStatus | null>(null);
  const [transcriptStatus, setTranscriptStatus] = useState<PodcastTranscriptStatus | null>(null);
  const [mirrorPulling, setMirrorPulling] = useState(false);
  const [episodeLimit, setEpisodeLimit] = useState(EPISODE_PAGE_SIZE);

  useEffect(() => {
    const onSettingsChange = () => setNotifEnabled(loadPodcastNotifEnabled());
    window.addEventListener(PODCAST_SETTINGS_CHANGE_EVENT, onSettingsChange);
    return () => window.removeEventListener(PODCAST_SETTINGS_CHANGE_EVENT, onSettingsChange);
  }, []);

  const pageMenuActions = useMemo((): LockerMenuAction[] => {
    return [
      {
        id: 'podcast-episode-alerts',
        section: 'Notifications',
        label: 'New episode alerts',
        active: notifEnabled,
        subtitle: notifEnabled
          ? 'On — notify when subscribed shows publish'
          : 'Off — tap to enable',
        onClick: () => {
          const next = !notifEnabled;
          setNotifEnabled(next);
          deferPodcastPrefSave(savePodcastNotifEnabled, next);
        },
      },
    ];
  }, [notifEnabled]);

  const selectTab = useCallback((next: 'discover' | 'library') => {
    startTabTransition(() => {
      setTab(next);
      if (next === 'library') {
        setLibraryMounted(true);
      } else {
        setLibraryMounted(false);
        setOpenFeedId(null);
      }
    });
  }, []);

  const goToDownloaded = useCallback(() => {
    startTabTransition(() => {
      setTab('library');
      setLibraryMounted(true);
      setLibraryView('downloaded');
      setOpenFeedId(null);
      setEpisodes([]);
      setEpisodeFilter('all');
      setError('');
    });
  }, []);

  const focusEpisodeNotifs = useCallback(() => {
    startTabTransition(() => {
      setTab('library');
      setLibraryMounted(true);
      setLibraryView('shows');
      setOpenFeedId(null);
      setEpisodeFilter('unplayed');
      setError('');
    });
  }, []);

  const refreshMirrorStatus = useCallback(async () => {
    const [mirror, transcripts] = await Promise.all([
      fetchPodcastMirrorStatus(),
      fetchPodcastTranscriptStatus(),
    ]);
    setMirrorStatus(mirror);
    setTranscriptStatus(transcripts);
  }, []);

  useEffect(() => {
    if (tab !== 'library') return;
    const id = window.setTimeout(() => void refreshMirrorStatus(), 150);
    return () => window.clearTimeout(id);
  }, [tab, subscriptions.length, refreshMirrorStatus]);

  const pushMirrorSync = useCallback(async (feedId?: string) => {
    await syncPodcastSubscriptionsToMirror();
    await requestPodcastMirrorPull(feedId);
    await refreshMirrorStatus();
  }, [refreshMirrorStatus]);

  const sync = useCallback(() => {
    const subs = loadSubscriptions();
    setSubscriptions(subs);
    if (openFeedId && !subs.some((s) => s.id === openFeedId)) {
      setOpenFeedId(null);
    }
  }, [openFeedId]);

  useEffect(() => subscribePodcasts(sync), [sync]);
  useEffect(() => subscribePodcasts(() => setPlaybackTick((t) => t + 1)), []);

  const refreshOfflineEpisodes = useCallback(() => {
    setOfflineEpisodes(loadOfflinePodcastEpisodes());
  }, []);

  useEffect(() => subscribeStreamCache(refreshOfflineEpisodes), [refreshOfflineEpisodes]);

  useEffect(() => {
    if (tab !== 'library') return;
    void warmStreamCacheIndex().then(() => refreshOfflineEpisodes());
  }, [tab, refreshOfflineEpisodes]);

  useEffect(() => {
    if (tab === 'library' && libraryView === 'downloaded') {
      refreshOfflineEpisodes();
    }
  }, [tab, libraryView, refreshOfflineEpisodes]);

  useEffect(() => {
    if (!openFeedId) {
      setEpisodes([]);
      return;
    }
    setEpisodes(loadEpisodesForFeed(openFeedId));
  }, [openFeedId, subscriptions]);

  const openFeed = useMemo(
    () => subscriptions.find((s) => s.id === openFeedId) ?? null,
    [subscriptions, openFeedId],
  );

  const episodeCountByFeed = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sub of subscriptions) {
      counts[sub.id] = loadEpisodesForFeed(sub.id).length;
    }
    return counts;
  }, [subscriptions]);

  useEffect(() => {
    setEpisodeLimit(EPISODE_PAGE_SIZE);
  }, [openFeedId, episodeFilter]);

  const unplayedByFeed = useMemo(() => {
    void playbackTick;
    return getUnplayedCountsByFeed();
  }, [subscriptions, playbackTick]);

  const downloadedCount = useMemo(() => {
    if (!openFeed) return 0;
    return episodes.filter((ep) =>
      isEnvelopeStreamCached(episodeEnvelope(ep, openFeed.title, openFeed.artworkUrl)),
    ).length;
  }, [episodes, openFeed]);

  const offlineEpisodeCount = offlineEpisodes.length;

  const unplayedCount = useMemo(() => {
    if (!openFeedId) return 0;
    return unplayedByFeed[openFeedId] ?? 0;
  }, [openFeedId, unplayedByFeed]);

  const visibleEpisodes = useMemo(() => {
    void playbackTick;
    if (episodeFilter === 'all') return episodes;
    if (episodeFilter === 'downloaded') {
      if (!openFeed) return [];
      return episodes.filter((ep) =>
        isEnvelopeStreamCached(episodeEnvelope(ep, openFeed.title, openFeed.artworkUrl)),
      );
    }
    return episodes.filter((ep) => isEpisodeUnplayed(ep.id));
  }, [episodes, episodeFilter, playbackTick, openFeed]);

  const pagedVisibleEpisodes = useMemo(
    () => visibleEpisodes.slice(0, episodeLimit),
    [visibleEpisodes, episodeLimit],
  );

  const handlePlayNextUnplayed = useCallback(() => {
    if (!openFeed) return;
    const next = findNextUnplayedEpisode(openFeed.id, episodes);
    if (!next) {
      setError('No unplayed episodes in this show.');
      return;
    }
    setError('');
    onPlay(episodeEnvelope(next, openFeed.title, openFeed.artworkUrl));
  }, [openFeed, episodes, onPlay]);

  useEffect(() => {
    if (tab !== 'library' && tab !== 'discover') return;
    const run = () => markPodcastEpisodesSeen();
    const idle =
      typeof requestIdleCallback !== 'undefined'
        ? requestIdleCallback(run, { timeout: 2000 })
        : window.setTimeout(run, 300);
    return () => {
      if (typeof cancelIdleCallback !== 'undefined' && typeof idle === 'number') {
        cancelIdleCallback(idle);
      } else {
        window.clearTimeout(idle as number);
      }
    };
  }, [tab]);

  const refreshFeed = useCallback(async (feed: PodcastSubscription) => {
    setRefreshing(true);
    setError('');
    try {
      const parsed = await fetchPodcastFeed(feed.feedUrl);
      updateSubscriptionMeta(feed.id, {
        title: parsed.subscription.title,
        description: parsed.subscription.description,
        artworkUrl: parsed.subscription.artworkUrl,
        source: parsed.subscription.source,
        lastFetchedAt: Date.now(),
      });
      saveEpisodesForFeed(feed.id, parsed.episodes);
      onPodcastEpisodesUpdated(feed.id, parsed.episodes);
      sync();
      void pushMirrorSync(feed.id);
      if (openFeedId === feed.id) {
        setEpisodes(parsed.episodes);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh feed');
    } finally {
      setRefreshing(false);
    }
  }, [openFeedId, sync, pushMirrorSync]);

  const handleManualSubscribed = useCallback(
    (feedId: string) => {
      sync();
      setOpenFeedId(feedId);
      setEpisodes(loadEpisodesForFeed(feedId));
      setError('');
      selectTab('library');
    },
    [sync, selectTab],
  );

  const openShow = useCallback((feedId: string) => {
    setOpenFeedId(feedId);
    setEpisodeFilter('unplayed');
    setError('');
  }, []);

  const closeShow = useCallback(() => {
    setOpenFeedId(null);
    setEpisodes([]);
    setEpisodeFilter('all');
  }, []);

  useEffect(() => {
    const onDrill = (event: Event) => {
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
      if (phase === 'open-first-show') {
        selectTab('library');
        const feed = subscriptions[0];
        if (feed) openShow(feed.id);
      } else if (phase === 'downloaded-tab') {
        goToDownloaded();
      } else if (phase === 'discover-tab') {
        selectTab('discover');
      }
    };
    window.addEventListener('sandbox-e2e-podcast-drill', onDrill);
    return () => window.removeEventListener('sandbox-e2e-podcast-drill', onDrill);
  }, [subscriptions, openShow, selectTab, goToDownloaded]);

  useEffect(() => {
    if (!drillBackRef) return;
    drillBackRef.current = () => {
      if (openFeedId) {
        closeShow();
        return true;
      }
      if (tab === 'library' && libraryView === 'downloaded') {
        setLibraryView('shows');
        return true;
      }
      if (tab === 'discover') {
        selectTab('library');
        return true;
      }
      return false;
    };
    return () => {
      drillBackRef.current = null;
    };
  }, [drillBackRef, openFeedId, tab, libraryView, closeShow, selectTab]);

  const handleUnsubscribe = useCallback(
    (feedId: string) => {
      removeSubscription(feedId);
      sync();
    },
    [sync],
  );

  const toggleAutoDownload = useCallback((feed: PodcastSubscription) => {
    updateSubscriptionMeta(feed.id, {
      autoDownload: !feed.autoDownload,
      autoDownloadCount: feed.autoDownloadCount ?? 3,
    });
    sync();
    void syncPodcastRulesToTier34();
    if (!feed.autoDownload) {
      void onPodcastEpisodesUpdated(feed.id, loadEpisodesForFeed(feed.id));
    }
  }, [sync]);

  const updateShowRules = useCallback(
    (feedId: string, patch: Parameters<typeof updateSubscriptionMeta>[1]) => {
      updateSubscriptionMeta(feedId, patch);
      sync();
      void syncPodcastRulesToTier34();
      const sub = loadSubscriptions().find((s) => s.id === feedId);
      if (sub?.autoDownload) {
        void onPodcastEpisodesUpdated(feedId, loadEpisodesForFeed(feedId));
      }
    },
    [sync],
  );

  return (
    <div className="locker-page podcasts-view">
      <header className="page-header-row mb-0">
        <div className="min-w-0 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-accent mb-1">
              Global discovery
            </p>
            <h1 className="font-display text-[1.75rem] font-bold tracking-tight leading-none text-[var(--text)]">
              Podcasts
            </h1>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <NotificationBellButton
                count={episodeNotifCount}
                onClick={focusEpisodeNotifs}
                ariaLabel={`${episodeNotifCount} new podcast episodes`}
              />
            <LockerMoreMenu
          open={pageMenuOpen}
          onOpenChange={setPageMenuOpen}
          actions={pageMenuActions}
          ariaLabel="Podcast options"
          alwaysVisible
          align="right"
          portaled
          panelClassName="podcasts-page-more-menu sandbox-menu-panel-sections"
        />
          </div>
        </div>
      </header>

      <div className="podcasts-station-toolbar">
        <div className="podcasts-tabs-row">
        <nav className="podcasts-tabs" aria-label="Podcast sections">
          <button
            type="button"
            className={`podcasts-tab touch-manipulation${tab === 'discover' ? ' podcasts-tab--active' : ''}`}
            onClick={() => selectTab('discover')}
          >
            Discover
          </button>
          <button
            type="button"
            className={`podcasts-tab touch-manipulation${tab === 'library' && libraryView === 'shows' ? ' podcasts-tab--active' : ''}${tabPending && tab === 'library' ? ' podcasts-tab--pending' : ''}`}
            onClick={() => {
              selectTab('library');
              setLibraryView('shows');
              setOpenFeedId(null);
            }}
          >
            Library{subscriptions.length > 0 ? ` (${subscriptions.length})` : ''}
          </button>
          <button
            type="button"
            className={`podcasts-tab podcasts-tab--downloaded touch-manipulation${tab === 'library' && libraryView === 'downloaded' ? ' podcasts-tab--active' : ''}`}
            onClick={goToDownloaded}
            aria-current={tab === 'library' && libraryView === 'downloaded' ? 'page' : undefined}
            aria-label={`Offline episodes${offlineEpisodeCount > 0 ? `, ${offlineEpisodeCount}` : ''}`}
          >
            <Download className="w-3.5 h-3.5 shrink-0" aria-hidden />
            <span className="podcasts-tab-label" aria-hidden>Offline</span>
            <span
              className={`podcasts-count-badge${offlineEpisodeCount === 0 ? ' podcasts-count-badge--empty' : ''}`}
              aria-hidden
            >
              {offlineEpisodeCount}
            </span>
          </button>
        </nav>
        </div>
      </div>

      {tab === 'discover' ? (
        <>
          {error ? (
            <p className="mt-3 font-mono text-[10px] text-red-400 uppercase">{error}</p>
          ) : null}
          <PodcastDiscoverPanel
            onPlay={onPlay}
            onPrimePlay={onPrimePlay}
            onAddToQueue={onAddToQueue}
            onSubscribed={sync}
            onError={setError}
            activeEnvelopeId={activeEnvelopeId}
          />
          <PodcastManualSubscribeSection
            onSubscribed={handleManualSubscribed}
            onError={setError}
          />
        </>
      ) : null}

      {tab === 'library' && !libraryMounted ? (
        <div className="podcasts-library-loading" aria-busy="true" aria-label="Loading Library">
          <Loader2 className="w-6 h-6 animate-spin text-accent mx-auto mt-8" />
        </div>
      ) : null}

      {tab === 'library' && libraryMounted ? (
        <>
      {mirrorStatus?.enabled && subscriptions.length > 0 ? (
        <div className="podcasts-mirror-banner font-mono text-[10px] text-[var(--text-dim)] flex flex-wrap items-center gap-3 mb-3 px-1">
          <span>
            LAN feed mirror: {mirrorStatus.mirroredEpisodeCount} episode
            {mirrorStatus.mirroredEpisodeCount === 1 ? '' : 's'} on NAS
            {mirrorStatus.pendingEpisodeCount > 0
              ? ` · ${mirrorStatus.pendingEpisodeCount} pending`
              : ''}
            {transcriptStatus?.transcriptCount
              ? ` · ${transcriptStatus.transcriptCount} transcribed`
              : ''}
          </span>
          <button
            type="button"
            className="podcasts-mirror-pull touch-manipulation uppercase tracking-wider text-accent"
            disabled={mirrorPulling}
            onClick={() => {
              setMirrorPulling(true);
              void pushMirrorSync()
                .catch(() => setError('Mirror pull failed'))
                .finally(() => setMirrorPulling(false));
            }}
          >
            {mirrorPulling ? 'Pulling…' : 'Pull now'}
          </button>
        </div>
      ) : null}
      {libraryView === 'downloaded' ? (
        <section className="podcasts-downloaded pt-4" aria-label="Downloaded episodes">
          <header className="podcasts-downloaded-header mb-4">
            <p className="font-mono text-[10px] uppercase tracking-widest text-accent inline-flex items-center gap-2">
              <Download className="w-3.5 h-3.5" aria-hidden />
              Downloaded
              <span className="podcasts-count-badge podcasts-count-badge--inline">
                {offlineEpisodeCount}
              </span>
            </p>
            <p className="font-mono text-[9px] text-[var(--text-dim)] mt-1 max-w-lg">
              All episodes saved on this device for offline listening. They stay in Podcasts — not
              in Locker.
            </p>
          </header>
          {error ? (
            <p className="mb-4 font-mono text-[10px] text-red-400 uppercase">{error}</p>
          ) : null}
          {offlineEpisodes.length === 0 ? (
            <div className="podcasts-empty-state podcasts-empty-state--compact">
              <p className="font-mono text-xs text-[var(--text-dim)]">
                No offline episodes yet. Open a show and tap Save offline on any episode.
              </p>
            </div>
          ) : (
            <ul className="podcasts-episode-list divide-y divide-[var(--border)]">
              {offlineEpisodes.map(({ episode, feedTitle, feedArtworkUrl }) => (
                <li key={`${episode.feedId}:${episode.id}`}>
                  <PodcastEpisodeRow
                    episode={episode}
                    feedTitle={feedTitle}
                    feedArtworkUrl={feedArtworkUrl}
                    activeEnvelopeId={activeEnvelopeId}
                    onPlay={onPlay}
                    onPrimePlay={onPrimePlay}
                    onAddToQueue={onAddToQueue}
                    onError={setError}
                    onOfflineChange={refreshOfflineEpisodes}
                    variant="library"
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <>
          {error ? (
            <p className="mt-3 font-mono text-[10px] text-red-400 uppercase">{error}</p>
          ) : null}

          {subscriptions.length === 0 ? (
            <div className="podcasts-empty-state">
              <Podcast className="w-10 h-10 mx-auto mb-3 text-accent opacity-40" />
              <p className="font-mono text-xs text-[var(--text-dim)] max-w-md mx-auto mb-4">
                Search millions of shows in Discover, then they appear here.
              </p>
              <button
                type="button"
                className="inline-flex items-center gap-2 h-10 px-5 rounded-lg btn-accent font-mono text-[10px] font-bold uppercase touch-manipulation"
                onClick={() => selectTab('discover')}
              >
                <Search className="w-4 h-4" />
                Discover podcasts
              </button>
            </div>
          ) : openFeed && openFeedId ? (
            <PodcastLibraryShowDetail
              feed={openFeed}
              episodes={episodes}
              visibleEpisodes={visibleEpisodes}
              pagedVisibleEpisodes={pagedVisibleEpisodes}
              episodeFilter={episodeFilter}
              unplayedCount={unplayedCount}
              downloadedCount={downloadedCount}
              refreshing={refreshing}
              activeEnvelopeId={activeEnvelopeId}
              onBack={closeShow}
              onPlay={onPlay}
              onPrimePlay={onPrimePlay}
              onAddToQueue={onAddToQueue}
              onError={setError}
              onOfflineChange={refreshOfflineEpisodes}
              onEpisodeFilterChange={setEpisodeFilter}
              onPlayNextUnplayed={handlePlayNextUnplayed}
              onQueueShowUnplayed={onQueueShowUnplayed}
              onRefresh={() => void refreshFeed(openFeed)}
              onShowMore={() => setEpisodeLimit((n) => n + EPISODE_PAGE_SIZE)}
              hasMoreEpisodes={visibleEpisodes.length > pagedVisibleEpisodes.length}
              remainingEpisodeCount={visibleEpisodes.length - pagedVisibleEpisodes.length}
              onToggleAutoDownload={toggleAutoDownload}
              onUpdateShowRules={updateShowRules}
            />
          ) : (
            <div className="podcasts-content pt-4">
              <PodcastLibraryShowGrid
                subscriptions={subscriptions}
                unplayedByFeed={unplayedByFeed}
                episodeCountByFeed={episodeCountByFeed}
                onOpenShow={openShow}
                onDiscoverMore={() => selectTab('discover')}
                onUnsubscribe={handleUnsubscribe}
              />
            </div>
          )}
        </>
      )}
        </>
      ) : null}
    </div>
  );
}
