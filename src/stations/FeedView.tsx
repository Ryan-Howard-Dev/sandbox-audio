import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronRight, Disc3, Info, Loader2, X } from 'lucide-react';
import type { MediaEnvelope } from '../sandboxLayer1';
import { proxiedArtworkUrl } from '../displaySanitize';
import { seedGradient } from '../seedGradient';
import OfflineStatusBanner from '../components/OfflineStatusBanner';
import { invalidateMadeForYouCache, type DiscoveryMix } from '../discoveryMixes';
import FeedDiscoverHomeSection from './FeedDiscoverHomeSection';
import FeedDiscoverTrackActions from '../components/discovery/FeedDiscoverTrackActions';
import { TASTE_SUPPRESSIONS_CHANGE } from '../tasteSuppressions';
import { TASTE_FEEDBACK_CHANGE_EVENT } from '../tasteFeedback';
import { useTranslation } from '../i18n';
import {
  fetchFollowedArtistFeed,
  getFollowedArtistFeedCache,
  groupFollowedFeedByArtist,
  type FollowedArtistFeedGroup,
  type FollowedFeedAnnouncement,
  type FollowedFeedEvent,
  type FollowedFeedRelease,
} from '../followedArtistFeed';
import {
  getFollowedArtists,
  subscribeFollowedArtists,
  unfollowArtist,
  type FollowedArtist,
} from '../followedArtists';
import {
  loadLockerAutoFollowEnabled,
  LOCKER_AUTO_FOLLOW_CHANGE_EVENT,
} from '../lockerAutoFollowSettings';
import {
  markFollowedReleasesSeen,
  processFollowedReleases,
} from '../followedReleaseNotifications';
import { getLockerEntriesSnapshot } from '../lockerStorage';
import { feedOfflineMessage, useOfflineStatus } from '../offlineStatus';
import { fetchChartCatalogTracks } from '../searchCatalog';
import { lockerEntryToEnvelope } from '../smartPlaylistEngine';
import {
  CACHE_KEYS,
  formatCacheTimestamp,
  readResponseCache,
  writeResponseCache,
} from '../responseCache';
import {
  getTier34BaseUrl,
  readTier34FeedCache,
  tier34FetchFeedResult,
  type FeedItem,
} from '../tier34/client';

export interface FeedViewProps {
  onPlay?: (env: MediaEnvelope) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onPlayDiscoveryMix?: (tracks: MediaEnvelope[], mix: DiscoveryMix) => void;
  onGoToExplore?: () => void;
  onPickExploreCategory?: (label: string, group: import('../exploreCatalog').ExploreGroup) => void;
  onSaveInstantPlaylist?: (tracks: MediaEnvelope[], name: string) => void;
  /** Inside Discover station tab (no duplicate page title). */
  embedded?: boolean;
  /** Mobile-native layout: carousels, artist-grouped followed feed. */
  mobile?: boolean;
}

const MOBILE_ARTIST_RELEASE_CAP = 8;

type FeedRowItem = {
  id: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  envelope: MediaEnvelope;
};

type FeedFallbackCache = {
  catalogRows: FeedRowItem[];
  lockerRows: FeedRowItem[];
};

function computeLastUpdatedAt(
  followed: ReturnType<typeof getFollowedArtistFeedCache>,
  meshAt: number,
  fallbackAt: number,
): number | null {
  const times = [followed?.fetchedAt ?? 0, meshAt, fallbackAt].filter((t) => t > 0);
  return times.length > 0 ? Math.max(...times) : null;
}

function feedItemToRow(item: FeedItem): FeedRowItem | null {
  if (!item.url) return null;
  return {
    id: item.id,
    title: item.title,
    artist: item.artist,
    artworkUrl: item.artworkUrl,
    envelope: {
      envelopeId: item.envelopeId ?? item.id,
      title: item.title,
      artist: item.artist,
      url: item.url,
      durationSeconds: 0,
      provider: (item.provider as MediaEnvelope['provider']) ?? 'stream-proxy',
      transport: 'element-src',
      sourceId: item.id,
      artworkUrl: item.artworkUrl,
    },
  };
}

function FeedRowArt({
  item,
}: {
  item: {
    id: string;
    title: string;
    artist: string;
    artworkUrl?: string;
    envelope?: MediaEnvelope;
  };
}) {
  const [artFailed, setArtFailed] = useState(false);
  const art =
    proxiedArtworkUrl(item.artworkUrl) ??
    proxiedArtworkUrl(item.envelope?.artworkUrl) ??
    item.artworkUrl ??
    item.envelope?.artworkUrl;
  const seed = `${item.title}|${item.artist}|${item.id}`;

  useEffect(() => {
    setArtFailed(false);
  }, [art, item.id]);

  if (art && !artFailed) {
    return (
      <img
        key={`${item.id}:${art}`}
        src={art}
        alt=""
        className="feed-row-art object-cover"
        onError={() => setArtFailed(true)}
      />
    );
  }

  return (
    <div
      className="feed-row-art"
      style={{ background: seedGradient(seed) }}
      aria-hidden
    />
  );
}

function FeedTrackList({
  items,
  onPlay,
  showDiscoverActions = false,
  onDiscoverAction,
}: {
  items: FeedRowItem[];
  onPlay?: (env: MediaEnvelope) => void;
  showDiscoverActions?: boolean;
  onDiscoverAction?: () => void;
}) {
  return (
    <ul className="feed-list">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className="feed-row w-full text-left touch-manipulation"
            onClick={() => onPlay?.(item.envelope)}
          >
            <FeedRowArt item={item} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-[var(--text)] truncate">{item.title}</p>
              <p className="text-sm text-[var(--text-mid)] truncate">{item.artist}</p>
            </div>
            {showDiscoverActions && item.envelope ? (
              <FeedDiscoverTrackActions envelope={item.envelope} onAction={onDiscoverAction} />
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function FollowedReleaseList({
  items,
  onPlay,
}: {
  items: FollowedFeedRelease[];
  onPlay?: (env: MediaEnvelope) => void;
}) {
  const playable = items.filter((i) => i.envelope?.url);
  const infoOnly = items.filter((i) => !i.envelope?.url);

  return (
    <>
      {playable.length > 0 ? (
        <ul className="feed-list">
          {playable.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="feed-row w-full text-left touch-manipulation"
                onClick={() => item.envelope && onPlay?.(item.envelope)}
              >
                <FeedRowArt item={item} />
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--text)] truncate">{item.title}</p>
                  <p className="text-sm text-[var(--text-mid)] truncate">
                    {item.artist} · {item.detail}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {infoOnly.length > 0 ? (
        <ul className="feed-list">
          {infoOnly.map((item) => (
            <li key={item.id}>
              <div className="feed-row feed-row--info">
                <div className="feed-row-art feed-row-art--icon" aria-hidden>
                  <Disc3 className="w-5 h-5 text-accent" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-[var(--text)] truncate">{item.title}</p>
                  <p className="text-sm text-[var(--text-mid)] truncate">
                    {item.artist} · {item.detail}
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function FeedInfoList({
  events,
  announcements,
}: {
  events: FollowedFeedEvent[];
  announcements: FollowedFeedAnnouncement[];
}) {
  const rows = [
    ...announcements.map((a) => ({
      id: a.id,
      title: a.title,
      subtitle: `${a.artist} · ${a.detail}`,
      icon: 'disc' as const,
    })),
    ...events.map((e) => ({
      id: e.id,
      title: e.title,
      subtitle: e.detail,
      icon: 'calendar' as const,
    })),
  ];

  if (rows.length === 0) return null;

  return (
    <ul className="feed-list">
      {rows.map((row) => (
        <li key={row.id}>
          <div className="feed-row feed-row--info">
            <div className="feed-row-art feed-row-art--icon" aria-hidden>
              {row.icon === 'calendar' ? (
                <Calendar className="w-5 h-5 text-accent" />
              ) : (
                <Disc3 className="w-5 h-5 text-accent" />
              )}
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-[var(--text)] truncate">{row.title}</p>
              <p className="text-sm text-[var(--text-mid)] truncate">{row.subtitle}</p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FeedBlock({
  title,
  items,
  onPlay,
  showDiscoverActions = false,
  onDiscoverAction,
}: {
  title: string;
  items: FeedRowItem[];
  onPlay?: (env: MediaEnvelope) => void;
  showDiscoverActions?: boolean;
  onDiscoverAction?: () => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="feed-block">
      <h2 className="feed-block-title">{title}</h2>
      <FeedTrackList
        items={items}
        onPlay={onPlay}
        showDiscoverActions={showDiscoverActions}
        onDiscoverAction={onDiscoverAction}
      />
    </section>
  );
}

function MobileReleaseCard({
  item,
  onPlay,
}: {
  item: FollowedFeedRelease;
  onPlay?: (env: MediaEnvelope) => void;
}) {
  const playable = Boolean(item.envelope?.url);
  return (
    <button
      type="button"
      className="feed-mobile-release-card touch-manipulation"
      onClick={() => item.envelope && onPlay?.(item.envelope)}
      disabled={!playable}
    >
      <FeedRowArt item={item} />
      <span className="feed-mobile-release-title">{item.title}</span>
      <span className="feed-mobile-release-detail">{item.detail}</span>
    </button>
  );
}

function MobileActivityCard({
  item,
  onPlay,
  onDiscoverAction,
}: {
  item: FeedRowItem;
  onPlay?: (env: MediaEnvelope) => void;
  onDiscoverAction?: () => void;
}) {
  return (
    <div className="feed-mobile-activity-card-wrap">
      <button
        type="button"
        className="feed-mobile-activity-card touch-manipulation"
        onClick={() => onPlay?.(item.envelope)}
      >
        <FeedRowArt item={item} />
        <span className="feed-mobile-activity-title">{item.title}</span>
        <span className="feed-mobile-activity-artist">{item.artist}</span>
      </button>
      <FeedDiscoverTrackActions envelope={item.envelope} onAction={onDiscoverAction} />
    </div>
  );
}

function MobileArtistFeedSection({
  group,
  onPlay,
  onSeeAll,
}: {
  group: FollowedArtistFeedGroup;
  onPlay?: (env: MediaEnvelope) => void;
  onSeeAll?: (artist: string) => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const visibleReleases = expanded
    ? group.releases
    : group.releases.slice(0, MOBILE_ARTIST_RELEASE_CAP);
  const hasMore = group.releases.length > MOBILE_ARTIST_RELEASE_CAP;

  if (
    group.releases.length === 0 &&
    group.events.length === 0 &&
    group.announcements.length === 0
  ) {
    return null;
  }

  return (
    <section className="feed-mobile-artist-section">
      <div className="feed-mobile-artist-head">
        <div className="feed-mobile-artist-avatar" aria-hidden>
          <span>{group.artist.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="feed-mobile-artist-name">{group.artist}</h3>
          <p className="feed-mobile-artist-meta">
            {group.releases.length > 0
              ? t('feed.mobile.releaseCount', { count: group.releases.length })
              : t('feed.follow.sectionComing')}
          </p>
        </div>
        {hasMore && !expanded ? (
          <button
            type="button"
            className="feed-mobile-see-all touch-manipulation"
            onClick={() => (onSeeAll ? onSeeAll(group.artist) : setExpanded(true))}
          >
            {t('feed.mobile.seeAll')}
            <ChevronRight className="w-4 h-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {group.releases.length > 0 ? (
        <div className="feed-mobile-carousel hide-scrollbar">
          {visibleReleases.map((release) => (
            <div key={release.id} className="feed-mobile-carousel-item">
              <MobileReleaseCard item={release} onPlay={onPlay} />
            </div>
          ))}
        </div>
      ) : null}

      {group.announcements.length > 0 || group.events.length > 0 ? (
        <ul className="feed-mobile-info-list">
          {[...group.announcements, ...group.events].slice(0, 3).map((row) => (
            <li key={row.id} className="feed-mobile-info-row">
              {row.kind === 'event' ? (
                <Calendar className="w-4 h-4 text-accent shrink-0" aria-hidden />
              ) : (
                <Disc3 className="w-4 h-4 text-accent shrink-0" aria-hidden />
              )}
              <div className="min-w-0">
                <p className="feed-mobile-info-title">{row.title}</p>
                <p className="feed-mobile-info-detail">{row.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export default function FeedView({
  onPlay,
  onPlayAlbum,
  onPlayDiscoveryMix,
  onGoToExplore,
  onPickExploreCategory,
  onSaveInstantPlaylist,
  embedded = false,
  mobile = false,
}: FeedViewProps) {
  const { t, lang } = useTranslation();
  const initialFollowedArtists = getFollowedArtists();
  const initialFollowedFeed = getFollowedArtistFeedCache(initialFollowedArtists);
  const initialMeshCache = readTier34FeedCache();
  const initialFallbackCache = readResponseCache<FeedFallbackCache>(CACHE_KEYS.FEED_FALLBACK);

  const [meshItems, setMeshItems] = useState<FeedItem[]>(() => initialMeshCache?.data.items ?? []);
  const [catalogItems, setCatalogItems] = useState<FeedRowItem[]>(
    () => initialFallbackCache?.data.catalogRows ?? [],
  );
  const [lockerItems, setLockerItems] = useState<FeedRowItem[]>(
    () => initialFallbackCache?.data.lockerRows ?? [],
  );
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>(initialFollowedArtists);
  const [followedFeed, setFollowedFeed] = useState(initialFollowedFeed);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchUrl, setFetchUrl] = useState(() => getTier34BaseUrl());
  const [reloadKey, setReloadKey] = useState(0);
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [followingPanelOpen, setFollowingPanelOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [expandedArtist, setExpandedArtist] = useState<string | null>(null);
  const [lockerAutoFollowEnabled, setLockerAutoFollowEnabled] = useState(loadLockerAutoFollowEnabled);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() =>
    computeLastUpdatedAt(
      initialFollowedFeed,
      initialMeshCache?.fetchedAt ?? 0,
      initialFallbackCache?.fetchedAt ?? 0,
    ),
  );
  const [mfyReloadKey, setMfyReloadKey] = useState(0);
  const offlineStatus = useOfflineStatus();

  const handleDiscoverAction = useCallback(() => {
    invalidateMadeForYouCache();
    setMfyReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const onSuppress = () => handleDiscoverAction();
    window.addEventListener(TASTE_SUPPRESSIONS_CHANGE, onSuppress);
    window.addEventListener(TASTE_FEEDBACK_CHANGE_EVENT, onSuppress);
    return () => {
      window.removeEventListener(TASTE_SUPPRESSIONS_CHANGE, onSuppress);
      window.removeEventListener(TASTE_FEEDBACK_CHANGE_EVENT, onSuppress);
    };
  }, [handleDiscoverAction]);

  const handlePlayDiscoveryMix = useCallback(
    (tracks: MediaEnvelope[], mix: DiscoveryMix) => {
      if (tracks.length === 0) return;
      if (onPlayDiscoveryMix) {
        onPlayDiscoveryMix(tracks, mix);
        return;
      }
      if (onPlayAlbum) onPlayAlbum(tracks, false);
      else onPlay?.(tracks[0]!);
    },
    [onPlayDiscoveryMix, onPlayAlbum, onPlay],
  );

  const handleSaveMix = useCallback(
    (mix: DiscoveryMix) => {
      if (mix.tracks.length === 0) return;
      onSaveInstantPlaylist?.(mix.tracks, mix.title);
    },
    [onSaveInstantPlaylist],
  );

  useEffect(() => subscribeFollowedArtists(() => setFollowedArtists(getFollowedArtists())), []);

  useEffect(() => {
    const sync = () => setLockerAutoFollowEnabled(loadLockerAutoFollowEnabled());
    window.addEventListener(LOCKER_AUTO_FOLLOW_CHANGE_EVENT, sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener(LOCKER_AUTO_FOLLOW_CHANGE_EVENT, sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  const showLibraryFollowHint = useMemo(
    () =>
      lockerAutoFollowEnabled &&
      followedArtists.some((artist) => artist.source === 'locker'),
    [lockerAutoFollowEnabled, followedArtists],
  );

  const fetchFallbackData = useCallback(async () => {
    const [charts, lockerSnap] = await Promise.all([
      fetchChartCatalogTracks(12),
      Promise.resolve(getLockerEntriesSnapshot()),
    ]);

    const catalogRows: FeedRowItem[] = [];
    for (const track of charts) {
      const env = track.envelope;
      if (!env?.url) continue;
      catalogRows.push({
        id: track.id,
        title: track.title,
        artist: track.artist,
        artworkUrl: track.artworkUrl ?? env.artworkUrl,
        envelope: env,
      });
    }

    const lockerRows: FeedRowItem[] = [];
    const locker = lockerSnap ?? [];
    for (const entry of [...locker].sort((a, b) => b.addedAt - a.addedAt).slice(0, 8)) {
      if (!entry.url) continue;
      lockerRows.push({
        id: entry.id,
        title: entry.title,
        artist: entry.artist,
        artworkUrl: entry.albumArt,
        envelope: lockerEntryToEnvelope(entry),
      });
    }

    return { catalogRows, lockerRows };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setRefreshing(true);
    setFetchError(null);
    setFetchUrl(getTier34BaseUrl());

    void (async () => {
      const fallbackPromise = fetchFallbackData().then(({ catalogRows, lockerRows }) => {
        if (cancelled) return;
        setCatalogItems(catalogRows);
        setLockerItems(lockerRows);
        writeResponseCache(CACHE_KEYS.FEED_FALLBACK, { catalogRows, lockerRows });
      });

      const meshPromise = tier34FetchFeedResult().then((result) => {
        if (cancelled) return;
        if (result.ok === false) {
          const meshCache = readTier34FeedCache();
          if (!meshCache) {
            setMeshItems([]);
            setFetchError(result.error);
            setFetchUrl(result.url);
          }
        } else {
          setMeshItems(result.items);
          setFetchError(null);
        }
      });

      const followedPromise =
        followedArtists.length > 0
          ? fetchFollowedArtistFeed(followedArtists).then((feed) => {
              if (cancelled) return;
              setFollowedFeed(feed);
              processFollowedReleases(
                feed.releases.map((r) => ({
                  id: r.id,
                  title: r.title,
                  artist: r.artist,
                })),
              );
            })
          : Promise.resolve();

      await Promise.all([fallbackPromise, meshPromise, followedPromise]);

      if (!cancelled) {
        const meshAt = readTier34FeedCache()?.fetchedAt ?? 0;
        const fallbackAt = readResponseCache<FeedFallbackCache>(CACHE_KEYS.FEED_FALLBACK)?.fetchedAt ?? 0;
        const followedAt = getFollowedArtistFeedCache(followedArtists)?.fetchedAt ?? 0;
        setLastUpdatedAt(computeLastUpdatedAt(
          getFollowedArtistFeedCache(followedArtists),
          meshAt,
          fallbackAt,
        ) ?? (followedAt || meshAt || fallbackAt || null));
        setRefreshing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    fetchFallbackData,
    followedArtists,
    offlineStatus.airGap,
    offlineStatus.browserOnline,
    offlineStatus.tier34Ok,
    reloadKey,
  ]);

  useEffect(() => {
    if (followedArtists.length === 0) {
      setFollowedFeed(null);
    }
  }, [followedArtists]);

  const markedFeedKeyRef = React.useRef('');
  useEffect(() => {
    if (!followedFeed?.releases.length) return;
    const key = `${followedFeed.fetchedAt}:${followedFeed.releases.map((r) => r.id).join('|')}`;
    if (markedFeedKeyRef.current === key) return;
    markedFeedKeyRef.current = key;
    markFollowedReleasesSeen(followedFeed.releases.map((r) => r.id));
  }, [followedFeed]);

  const sectionLabels = useMemo(
    (): Record<FeedItem['section'], string> => ({
      new: t('feed.sections.new'),
      week: t('feed.sections.week'),
      month: t('feed.sections.month'),
    }),
    [t],
  );

  const meshGrouped = useMemo(() => {
    const map = new Map<FeedItem['section'], FeedRowItem[]>();
    for (const item of meshItems) {
      const row = feedItemToRow(item);
      if (!row) continue;
      const list = map.get(item.section) ?? [];
      list.push(row);
      map.set(item.section, list);
    }
    return (['new', 'week', 'month'] as const).map((section) => ({
      section,
      title: sectionLabels[section],
      items: map.get(section) ?? [],
    }));
  }, [meshItems, sectionLabels]);

  const connectivityBlocksFeed =
    offlineStatus.airGap ||
    offlineStatus.tier34Ok === false ||
    (!offlineStatus.browserOnline && offlineStatus.tier34Ok !== true);

  const hasMeshContent = meshItems.length > 0;
  const hasFollowedContent =
    (followedFeed?.releases.length ?? 0) > 0 ||
    (followedFeed?.events.length ?? 0) > 0 ||
    (followedFeed?.announcements.length ?? 0) > 0;
  const hasFallbackContent = catalogItems.length > 0 || lockerItems.length > 0;
  const hasAnyContent = hasMeshContent || hasFallbackContent || hasFollowedContent;

  const offlineMessage =
    connectivityBlocksFeed && !fetchError && !hasAnyContent ? feedOfflineMessage(offlineStatus, lang) : null;

  const showOfflineBanner = Boolean(offlineMessage);

  const showFullFetchError =
    Boolean(fetchError) && !refreshing && !hasFallbackContent && !showOfflineBanner && !hasFollowedContent;

  const showInitialLoading = refreshing && !hasAnyContent;

  const showRefreshIndicator = refreshing && hasAnyContent;

  const showEmptyState =
    !refreshing &&
    !hasAnyContent &&
    !showOfflineBanner &&
    followedArtists.length === 0;

  const showMeshEmptyHint =
    !refreshing &&
    !hasMeshContent &&
    hasFallbackContent &&
    offlineStatus.tier34Ok === true &&
    !fetchError;

  const showLastUpdated = lastUpdatedAt != null && hasAnyContent;

  const fetchErrorSummary = fetchError?.includes('timed out')
    ? t('feed.error.timeout')
    : t('feed.error.failed');

  const handleUnfollow = (name: string) => {
    unfollowArtist(name);
    if (getFollowedArtists().length === 0) setFollowingPanelOpen(false);
  };

  const followedByArtist = useMemo(
    () => groupFollowedFeedByArtist(followedFeed, followedArtists),
    [followedFeed, followedArtists],
  );

  const recentActivity = useMemo(() => {
    const seen = new Set<string>();
    const rows: FeedRowItem[] = [];
    for (const item of [...lockerItems, ...catalogItems]) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      rows.push(item);
      if (rows.length >= 12) break;
    }
    return rows;
  }, [lockerItems, catalogItems]);

  const expandedGroup = useMemo(
    () =>
      expandedArtist
        ? followedByArtist.find((g) => g.artist === expandedArtist) ?? null
        : null,
    [expandedArtist, followedByArtist],
  );

  if (mobile && expandedGroup) {
    return (
      <div className="feed-mobile feed-embedded">
        <header className="feed-mobile-expanded-head">
          <button
            type="button"
            className="feed-mobile-back touch-manipulation"
            onClick={() => setExpandedArtist(null)}
          >
            {t('common.back')}
          </button>
          <h2 className="feed-mobile-expanded-title">{expandedGroup.artist}</h2>
        </header>
        <div className="feed-mobile-expanded-grid">
          {expandedGroup.releases.map((release) => (
            <div key={release.id} className="feed-mobile-expanded-item">
              <MobileReleaseCard item={release} onPlay={onPlay} />
            </div>
          ))}
        </div>
        {expandedGroup.announcements.length > 0 || expandedGroup.events.length > 0 ? (
          <ul className="feed-mobile-info-list feed-mobile-info-list--expanded">
            {[...expandedGroup.announcements, ...expandedGroup.events].map((row) => (
              <li key={row.id} className="feed-mobile-info-row">
                {row.kind === 'event' ? (
                  <Calendar className="w-4 h-4 text-accent shrink-0" aria-hidden />
                ) : (
                  <Disc3 className="w-4 h-4 text-accent shrink-0" aria-hidden />
                )}
                <div className="min-w-0">
                  <p className="feed-mobile-info-title">{row.title}</p>
                  <p className="feed-mobile-info-detail">{row.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={
        mobile ? 'feed-mobile feed-embedded' : embedded ? 'feed-embedded' : 'feed-page'
      }
    >
      {!embedded && !mobile ? (
        <header className="feed-header">
          <h1 className="font-display text-[1.75rem] font-bold tracking-tight text-[var(--text)]">
            {t('feed.title')}
          </h1>
          <p className="text-sm text-[var(--text-mid)] mt-1">{t('feed.subtitle')}</p>
        </header>
      ) : null}
      {embedded && !mobile ? (
        <p className="text-sm text-[var(--text-mid)] mb-4">{t('feed.subtitle')}</p>
      ) : null}
      {mobile ? (
        <div className="feed-mobile-about-row">
          <button
            type="button"
            className="feed-mobile-about-btn touch-manipulation"
            aria-expanded={aboutOpen}
            onClick={() => setAboutOpen((open) => !open)}
          >
            <Info className="w-4 h-4" aria-hidden />
            <span>{t('feed.mobile.about')}</span>
          </button>
          {aboutOpen ? (
            <p className="feed-mobile-about-text">{t('feed.subtitle')}</p>
          ) : null}
        </div>
      ) : null}

      <FeedDiscoverHomeSection
        releases={followedFeed?.releases ?? []}
        followedArtists={followedArtists}
        showLibraryFollowHint={showLibraryFollowHint}
        followingPanelOpen={followingPanelOpen}
        onFollowingPanelOpenChange={setFollowingPanelOpen}
        onUnfollow={handleUnfollow}
        lastUpdatedAt={lastUpdatedAt}
        showLastUpdated={showLastUpdated}
        showRefreshIndicator={showRefreshIndicator}
        mfyReloadKey={mfyReloadKey}
        mobile={mobile}
        lang={lang}
        onPlayDiscoveryMix={handlePlayDiscoveryMix}
        onSaveMix={onSaveInstantPlaylist ? handleSaveMix : undefined}
        onPlayTrack={onPlay}
        onGoToExplore={onGoToExplore}
        onPickExploreCategory={onPickExploreCategory}
      />

      {showInitialLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-dim)]">
          <Loader2 className="w-4 h-4 animate-spin text-accent" />
          {t('feed.loading')}
        </div>
      ) : null}

      {showOfflineBanner ? (
        <OfflineStatusBanner
          message={offlineMessage!}
          label={t('feed.offlineLabel')}
          className="mb-4"
        />
      ) : null}

      {mobile && lockerItems.length > 0 ? (
        <section className="feed-mobile-section">
          <h2 className="feed-mobile-section-title">{t('feed.sections.locker')}</h2>
          <div className="feed-mobile-carousel feed-mobile-carousel--activity hide-scrollbar">
            {lockerItems.map((item) => (
              <div key={item.id} className="feed-mobile-carousel-item">
                <MobileActivityCard
                  item={item}
                  onPlay={onPlay}
                  onDiscoverAction={handleDiscoverAction}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {mobile && recentActivity.length > 0 ? (
        <section className="feed-mobile-section">
          <h2 className="feed-mobile-section-title">{t('feed.mobile.recentActivity')}</h2>
          <div className="feed-mobile-carousel feed-mobile-carousel--activity hide-scrollbar">
            {recentActivity.map((item) => (
              <div key={item.id} className="feed-mobile-carousel-item">
                <MobileActivityCard
                  item={item}
                  onPlay={onPlay}
                  onDiscoverAction={handleDiscoverAction}
                />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {mobile && followedByArtist.length > 0 ? (
        <section className="feed-mobile-section">
          <h2 className="feed-mobile-section-title">{t('feed.follow.sectionReleases')}</h2>
          {followedByArtist.map((group) => (
            <div key={group.artist}>
              <MobileArtistFeedSection
                group={group}
                onPlay={onPlay}
                onSeeAll={setExpandedArtist}
              />
            </div>
          ))}
        </section>
      ) : null}

      {!mobile && lockerItems.length > 0 ? (
        <FeedBlock
          title={t('feed.sections.locker')}
          items={lockerItems}
          onPlay={onPlay}
          showDiscoverActions
          onDiscoverAction={handleDiscoverAction}
        />
      ) : null}

      {!mobile && followedFeed && followedFeed.releases.length > 0 ? (
        <section className="feed-block">
          <h2 className="feed-block-title">{t('feed.follow.sectionReleases')}</h2>
          <FollowedReleaseList items={followedFeed.releases} onPlay={onPlay} />
        </section>
      ) : null}

      {!mobile &&
      followedFeed &&
      (followedFeed.announcements.length > 0 || followedFeed.events.length > 0) ? (
        <section className="feed-block">
          <h2 className="feed-block-title">{t('feed.follow.sectionComing')}</h2>
          <FeedInfoList
            events={followedFeed.events}
            announcements={followedFeed.announcements}
          />
        </section>
      ) : null}

      {meshGrouped.map((block) =>
        block.items.length > 0 ? (
          <section
            key={block.section}
            className={mobile ? 'feed-mobile-section' : 'feed-block'}
          >
            <h2 className={mobile ? 'feed-mobile-section-title' : 'feed-block-title'}>
              {block.title}
            </h2>
            {mobile ? (
              <div className="feed-mobile-carousel hide-scrollbar">
                {block.items.map((item) => (
                  <div key={item.id} className="feed-mobile-carousel-item">
                    <MobileActivityCard
                      item={item}
                      onPlay={onPlay}
                      onDiscoverAction={handleDiscoverAction}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <FeedTrackList
                items={block.items}
                onPlay={onPlay}
                showDiscoverActions
                onDiscoverAction={handleDiscoverAction}
              />
            )}
          </section>
        ) : null,
      )}

      {!hasMeshContent ? (
        <>
          {mobile ? (
            <>
              {catalogItems.length > 0 ? (
                <section className="feed-mobile-section">
                  <h2 className="feed-mobile-section-title">{t('feed.sections.catalog')}</h2>
                  <div className="feed-mobile-carousel hide-scrollbar">
                    {catalogItems.map((item) => (
                      <div key={item.id} className="feed-mobile-carousel-item">
                        <MobileActivityCard item={item} onPlay={onPlay} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
              {lockerItems.length > 0 ? (
                <section className="feed-mobile-section">
                  <h2 className="feed-mobile-section-title">{t('feed.sections.locker')}</h2>
                  <div className="feed-mobile-carousel hide-scrollbar">
                    {lockerItems.map((item) => (
                      <div key={item.id} className="feed-mobile-carousel-item">
                        <MobileActivityCard item={item} onPlay={onPlay} />
                      </div>
                    ))}
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <>
              <FeedBlock title={t('feed.sections.catalog')} items={catalogItems} onPlay={onPlay} />
              <FeedBlock title={t('feed.sections.locker')} items={lockerItems} onPlay={onPlay} />
            </>
          )}
        </>
      ) : null}

      {showMeshEmptyHint ? (
        <p className="text-sm text-[var(--text-mid)] mt-4">{t('feed.meshEmptyHint')}</p>
      ) : null}

      {showFullFetchError ? (
        <div
          className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          role="alert"
        >
          <p className="text-sm font-medium text-[var(--text)]">{t('feed.error.title')}</p>
          <p className="text-sm text-[var(--text-mid)] mt-1">{fetchErrorSummary}</p>
          {errorDetailsOpen ? (
            <div className="mt-2 space-y-1">
              <p className="font-mono text-xs text-[var(--text-dim)] break-all">{fetchUrl}</p>
              {fetchError ? (
                <p className="font-mono text-xs text-[var(--text-dim)] break-all">{fetchError}</p>
              ) : null}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="text-sm text-accent touch-manipulation"
              onClick={() => setReloadKey((k) => k + 1)}
            >
              {t('feed.error.retry')}
            </button>
            <button
              type="button"
              className="text-sm text-[var(--text-dim)] hover:text-[var(--text-mid)] touch-manipulation"
              onClick={() => setErrorDetailsOpen((open) => !open)}
            >
              {errorDetailsOpen ? t('feed.error.hideDetails') : t('feed.error.details')}
            </button>
          </div>
        </div>
      ) : null}

      {showEmptyState ? (
        <div className="feed-empty-state" role="status">
          <p className="text-sm font-medium text-[var(--text)] mb-2">{t('feed.empty.title')}</p>
          <p className="text-sm text-[var(--text-mid)] mb-4">{t('feed.empty.message')}</p>
          {onGoToExplore ? (
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-accent text-[var(--bg)] text-sm font-medium touch-manipulation"
              onClick={onGoToExplore}
            >
              {t('feed.empty.explore')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
