import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Disc3,
  Heart,
  Loader2,
  MoreHorizontal,
  Play,
  Plus,
  Radio,
  Share2,
  Shuffle,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import type {
  ArtistDiscography,
  CatalogAlbum,
  CatalogArtist,
  CatalogTrack,
} from '../searchCatalog';
import {
  catalogAlbumVersionLabel,
  catalogDisplayArtistName,
  fetchArtistDiscography,
  fetchArtistTopTracks,
  resolveCatalogArtistByName,
} from '../searchCatalog';
import { useTranslation } from '../i18n';
import { logE2e } from '../e2eDevAction';
import CatalogDownloadMenu from '../components/CatalogDownloadMenu';
import CatalogArtThumb from '../components/CatalogArtThumb';
import MobileShellBackButton from '../components/MobileShellBackButton';
import OfflineStatusBanner from '../components/OfflineStatusBanner';
import {
  findTrackDownloadJob,
  subscribeDownloadQueue,
  type DownloadJob,
  type DownloadMode,
  type TrackDownloadState,
} from '../downloadQueue';
import { fetchArtistProfile } from '../artistImage';
import { findAlbumCover } from '../albumCover';
import {
  followArtist,
  isFollowingArtist,
  subscribeFollowedArtists,
  unfollowArtist,
} from '../followedArtists';
import { loadSearchSortOrder, sortByReleaseYear } from '../searchSettings';
import type { MediaEnvelope } from '../sandboxLayer1';
import { canResolveFullStreams } from '../catalogDirect';
import {
  isCatalogCdnUrl,
  proxiedArtworkUrl,
  displayTrackTitle,
  displayLockerTrackTitle,
  displayTransportLabel,
  catalogPreviewDurationSeconds,
} from '../displaySanitize';
import { themeBadgeOutlineClass } from './theme';
import { formatTime } from './theme';
import { seedGradient, handleArtImgError } from '../seedGradient';
import { useMobileShell } from '../hooks/useMobileShell';
import {
  getTrackTasteFeedback,
  recordTasteFeedback,
  subscribeTasteFeedback,
} from '../tasteFeedback';

export interface ArtistDetailViewProps {
  artist: CatalogArtist;
  onBack: () => void;
  onPlayTrack: (env: MediaEnvelope) => void;
  onPlayTracks?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  /** Mobile: tap track title → play (if needed) and open full-screen now playing. */
  onTrackTitleTap?: (env: MediaEnvelope) => void;
  /** Mobile: open full-screen now playing without changing playback. */
  onOpenNowPlaying?: () => void;
  onPlayError?: (message: string) => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onSearchAlbum: (album: CatalogAlbum) => void;
  onDownloadAlbum?: (album: CatalogAlbum, mode: DownloadMode) => void;
  onDownloadTrack?: (track: CatalogTrack, mode: DownloadMode) => void;
  onCacheTrack?: (track: CatalogTrack) => void;
  activeEnvelopeId?: string | null;
  playingEnvelope?: MediaEnvelope | null;
}

type DiscographyTab = 'singles' | 'albums';

const BIO_PREVIEW_CHARS = 180;

function isMissingArtistPhoto(url?: string): boolean {
  return !url || isCatalogCdnUrl(url);
}

function playableEnvelopes(tracks: CatalogTrack[]): MediaEnvelope[] {
  return tracks.map((t) => t.envelope).filter((e): e is MediaEnvelope => Boolean(e));
}

function formatTrackDuration(track: CatalogTrack): string {
  const seconds = catalogPreviewDurationSeconds(
    track.durationSeconds ?? track.envelope?.durationSeconds,
    {
      previewUrl: track.previewUrl,
      playUrl: track.envelope?.url,
      fullStreamAvailable: canResolveFullStreams(),
    },
  );
  return seconds && seconds > 0 ? formatTime(seconds) : '—';
}

function normalizeTrackTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function resolveTrackDownloadState(
  job: DownloadJob | undefined,
  track: CatalogTrack,
): TrackDownloadState | undefined {
  if (!job || Object.keys(job.tracks).length === 0) return undefined;
  if (job.tracks[track.id]) return job.tracks[track.id];
  const titleKey = normalizeTrackTitle(track.title);
  return Object.values(job.tracks).find(
    (state) => normalizeTrackTitle(state.title) === titleKey,
  );
}

function TrackDownloadIndicator({ state }: { state: TrackDownloadState }) {
  if (state.status === 'done' || state.status === 'skipped') {
    return (
      <span className="track-download-status track-download-status--done" aria-label="Saved to locker">
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
      </span>
    );
  }

  if (state.status === 'error') {
    return (
      <span
        className="track-download-status track-download-status--error"
        title={state.errorMessage ?? 'Download failed'}
        aria-label={state.errorMessage ?? 'Download failed'}
      >
        <AlertCircle className="w-3.5 h-3.5" />
      </span>
    );
  }

  if (state.status === 'pending') return null;

  return (
    <span className="track-download-status track-download-status--active" aria-label="Downloading">
      <Loader2 className="w-3 h-3 animate-spin" />
      <span className="track-download-percent">{state.percent}%</span>
    </span>
  );
}

function ExplicitBadge() {
  return (
    <span className="font-mono text-[8px] px-1 py-0.5 rounded border border-[var(--border)] text-[var(--text-dim)] uppercase shrink-0">
      E
    </span>
  );
}

function TrackThumb({
  track,
}: {
  track: CatalogTrack;
}) {
  const fallback =
    track.album?.trim() && track.artist?.trim()
      ? { album: track.album.trim(), artist: track.artist.trim() }
      : track.artist?.trim()
        ? { album: track.title, artist: track.artist.trim() }
        : undefined;
  return (
    <CatalogArtThumb
      url={track.artworkUrl ?? track.envelope?.artworkUrl}
      title={track.title}
      fallback={fallback}
      className="artist-track-thumb catalog-art-thumb"
    />
  );
}

function AlbumCover({
  album,
}: {
  album: CatalogAlbum;
}) {
  const [failed, setFailed] = useState(false);
  const [resolved, setResolved] = useState<string | undefined>();
  const effectiveUrl = album.artworkUrl?.trim() || resolved;
  const art = proxiedArtworkUrl(effectiveUrl) ?? effectiveUrl;

  useEffect(() => {
    setFailed(false);
    setResolved(undefined);
  }, [album.id, album.artworkUrl]);

  useEffect(() => {
    if (album.artworkUrl?.trim()) return;
    let cancelled = false;
    void findAlbumCover(album.title, album.artist).then((cover) => {
      if (cancelled || !cover?.url) return;
      setResolved(cover.url);
      setFailed(false);
    });
    return () => {
      cancelled = true;
    };
  }, [album.artworkUrl, album.artist, album.title]);

  if (art && !failed) {
    return (
      <img
        src={art}
        alt=""
        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        onError={(e) => {
          if (!resolved && album.artworkUrl?.trim()) {
            void findAlbumCover(album.title, album.artist).then((cover) => {
              if (cover?.url) {
                setResolved(cover.url);
                setFailed(false);
                return;
              }
              handleArtImgError(e, album.title);
              setFailed(true);
            });
            return;
          }
          handleArtImgError(e, album.title);
          setFailed(true);
        }}
      />
    );
  }
  return (
    <div
      className="w-full h-full flex items-center justify-center"
      style={{ background: seedGradient(album.title) }}
    >
      <Disc3 className="w-8 h-8 text-text-primary/60" />
    </div>
  );
}

export default function ArtistDetailView({
  artist,
  onBack,
  onPlayTrack,
  onPlayTracks,
  onTrackTitleTap,
  onOpenNowPlaying,
  onPlayError,
  onAddToQueue,
  onSearchAlbum,
  onDownloadAlbum,
  onDownloadTrack,
  onCacheTrack,
  activeEnvelopeId,
  playingEnvelope,
}: ArtistDetailViewProps) {
  const { t } = useTranslation();
  const isMobileShell = useMobileShell();
  const displayName = catalogDisplayArtistName(artist.name);
  const [heroName, setHeroName] = useState(displayName);
  const [catalogArtistId, setCatalogArtistId] = useState(artist.id);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [topLoading, setTopLoading] = useState(true);
  const [albums, setAlbums] = useState<CatalogAlbum[]>([]);
  const [catalogPartial, setCatalogPartial] = useState(false);
  const [catalogSupplemented, setCatalogSupplemented] = useState(false);
  const [catalogUnreachable, setCatalogUnreachable] = useState(false);
  const [singles, setSingles] = useState<CatalogTrack[]>([]);
  const [topTracks, setTopTracks] = useState<CatalogTrack[]>([]);
  const [artworkUrl, setArtworkUrl] = useState(
    isMissingArtistPhoto(artist.artworkUrl) ? undefined : artist.artworkUrl,
  );
  const [artworkFailed, setArtworkFailed] = useState(false);
  const [bio, setBio] = useState<string | undefined>();
  const [bioExpanded, setBioExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<DiscographyTab>('albums');
  const [sortOrder, setSortOrder] = useState(loadSearchSortOrder);
  const [, setDownloadRevision] = useState(0);
  const [following, setFollowing] = useState(() => isFollowingArtist(artist.name));
  const [followBusy, setFollowBusy] = useState(false);
  const [, setTasteRevision] = useState(0);

  useEffect(() => {
    logE2e('artist-mount', true, `artist=${artist.name} id=${artist.id} ts=${Date.now()}`);
  }, [artist.id, artist.name]);

  useEffect(
    () => subscribeDownloadQueue(() => setDownloadRevision((revision) => revision + 1)),
    [],
  );

  useEffect(() => {
    setFollowing(isFollowingArtist(artist.name));
    return subscribeFollowedArtists(() => setFollowing(isFollowingArtist(artist.name)));
  }, [artist.id, artist.name]);

  useEffect(() => subscribeTasteFeedback(() => setTasteRevision((n) => n + 1)), []);

  const handleFollowToggle = () => {
    if (followBusy) return;
    if (following) {
      unfollowArtist(artist.name);
      return;
    }
    setFollowBusy(true);
    void followArtist({
      name: artist.name,
      catalogArtistId: artist.id,
    }).finally(() => setFollowBusy(false));
  };

  useEffect(() => {
    const sync = () => setSortOrder(loadSearchSortOrder());
    window.addEventListener('storage', sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  useEffect(() => {
    setArtworkUrl(isMissingArtistPhoto(artist.artworkUrl) ? undefined : artist.artworkUrl);
    setArtworkFailed(false);
    setBio(undefined);
    setBioExpanded(false);
  }, [artist.artworkUrl, artist.id, artist.name]);

  useEffect(() => {
    setHeroName(displayName);
    setCatalogArtistId(artist.id);
  }, [artist.id, artist.name, displayName]);

  useEffect(() => {
    let cancelled = false;
    const discT0 = Date.now();
    setLoading(true);
    setCatalogPartial(false);
    setCatalogSupplemented(false);
    setCatalogUnreachable(false);

    const loadDiscography = async () => {
      let nameForFetch = displayName;
      let idForFetch = artist.id;
      const needsResolve =
        catalogDisplayArtistName(artist.name) !== artist.name.trim() ||
        (!/^artist-\d+$/.test(artist.id) && displayName.trim().split(/\s+/).length >= 2);
      if (needsResolve) {
        const resolved = await resolveCatalogArtistByName(displayName);
        nameForFetch = catalogDisplayArtistName(resolved.name);
        idForFetch = resolved.id;
        if (!cancelled) {
          setHeroName(nameForFetch);
          setCatalogArtistId(idForFetch);
        }
      }

      const applyDisco = (disc: ArtistDiscography) => {
        if (cancelled) return;
        setAlbums(disc.albums);
        setCatalogPartial(Boolean(disc.catalogPartial));
        setCatalogSupplemented(Boolean(disc.catalogSupplemented));
        setCatalogUnreachable(Boolean(disc.catalogUnreachable));
        setSingles(disc.singles);
        if (isMissingArtistPhoto(artist.artworkUrl)) {
          const resolved = disc.artworkUrl ?? disc.albums.find((a) => a.artworkUrl)?.artworkUrl;
          if (resolved) {
            setArtworkUrl(resolved);
            setArtworkFailed(false);
          }
        }
      };

      try {
        const disc = await fetchArtistDiscography(nameForFetch, idForFetch, applyDisco);
        if (cancelled) return;
        logE2e(
          'artist-disco',
          true,
          `artist=${nameForFetch} albums=${disc.albums.length} ms=${Date.now() - discT0}`,
        );
        applyDisco(disc);
      } catch {
        if (!cancelled) setCatalogUnreachable(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadDiscography();
    return () => {
      cancelled = true;
    };
  }, [displayName, artist.id, artist.artworkUrl]);

  useEffect(() => {
    let cancelled = false;
    setTopLoading(true);
    void fetchArtistTopTracks(heroName, catalogArtistId, 10)
      .then((tracks) => {
        if (!cancelled) setTopTracks(tracks);
      })
      .finally(() => {
        if (!cancelled) setTopLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [heroName, catalogArtistId]);

  useEffect(() => {
    let cancelled = false;
    void fetchArtistProfile(displayName).then((profile) => {
      if (cancelled) return;
      if (profile.bio) setBio(profile.bio);
      const heroImage = profile.wideImageUrl ?? profile.imageUrl;
      if (heroImage && isMissingArtistPhoto(artist.artworkUrl)) {
        setArtworkUrl(heroImage);
        setArtworkFailed(false);
      } else if (heroImage && artist.artworkUrl) {
        setArtworkUrl((current) => current ?? heroImage);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [displayName, artist.artworkUrl]);

  const heroImage = proxiedArtworkUrl(artworkUrl) ?? artworkUrl;
  const sortLabel = sortOrder === 'newest' ? 'Newest first' : 'Oldest first';
  const sortedAlbums = useMemo(
    () => sortByReleaseYear(albums, sortOrder),
    [albums, sortOrder],
  );
  const sortedSingles = useMemo(
    () => sortByReleaseYear(singles, sortOrder),
    [singles, sortOrder],
  );
  const playableTop = useMemo(() => playableEnvelopes(topTracks), [topTracks]);

  const bioPreview =
    bio && !bioExpanded && bio.length > BIO_PREVIEW_CHARS
      ? `${bio.slice(0, BIO_PREVIEW_CHARS).trim()}…`
      : bio;

  const reportPlaybackUnavailable = () => {
    onPlayError?.(t('artist.playbackUnavailable'));
  };

  const playTopTrackAt = (index: number) => {
    const track = topTracks[index];
    const env = track?.envelope;
    if (!env) {
      reportPlaybackUnavailable();
      return;
    }
    const queue = playableEnvelopes(topTracks.slice(index));
    if (queue.length === 0) {
      reportPlaybackUnavailable();
      return;
    }
    if (onPlayTracks) onPlayTracks(queue, false);
    else onPlayTrack(queue[0]);
  };

  const handlePlayAll = () => {
    if (playableTop.length === 0) {
      reportPlaybackUnavailable();
      return;
    }
    if (onPlayTracks) onPlayTracks(playableTop, false);
    else onPlayTrack(playableTop[0]);
  };

  const handleShuffle = () => {
    if (playableTop.length === 0) {
      reportPlaybackUnavailable();
      return;
    }
    if (onPlayTracks) onPlayTracks(playableTop, true);
    else onPlayTrack(playableTop[Math.floor(Math.random() * playableTop.length)]);
  };

  const handleTrackPlay = (index: number) => {
    const track = topTracks[index];
    if (!track?.envelope) {
      reportPlaybackUnavailable();
      return;
    }
    playTopTrackAt(index);
  };

  const handleTitleTap = (env: MediaEnvelope) => {
    if (onTrackTitleTap) onTrackTitleTap(env);
    else onPlayTrack(env);
  };

  const handleTopTrackTitleTap = (index: number) => {
    const track = topTracks[index];
    if (!track?.envelope) {
      reportPlaybackUnavailable();
      return;
    }
    if (onTrackTitleTap) {
      onTrackTitleTap(track.envelope);
      return;
    }
    const sameTrack =
      track.envelope.envelopeId === activeEnvelopeId &&
      Boolean(playingEnvelope?.envelopeId);
    if (onOpenNowPlaying) {
      if (!sameTrack) playTopTrackAt(index);
      onOpenNowPlaying();
      return;
    }
    handleTitleTap(track.envelope);
  };

  return (
    <div className="artist-page">
      <section className="artist-hero" aria-label={`${heroName} artist`}>
        {heroImage && !artworkFailed ? (
          <>
            <div className="artist-hero-bg artist-hero-bg--left" aria-hidden>
              <img src={heroImage} alt="" />
            </div>
            <div className="artist-hero-bg artist-hero-bg--center" aria-hidden>
              <img src={heroImage} alt="" />
            </div>
            <div className="artist-hero-bg artist-hero-bg--right" aria-hidden>
              <img src={heroImage} alt="" />
            </div>
          </>
        ) : (
          <div
            className="artist-hero-bg artist-hero-bg--placeholder"
            style={{ background: seedGradient(heroName) }}
            aria-hidden
          />
        )}
        <div className="artist-hero-overlay" aria-hidden />

        {isMobileShell ? (
          <MobileShellBackButton
            onClick={onBack}
            variant="on-dark"
            className="artist-hero-back"
          />
        ) : (
          <button
            type="button"
            onClick={onBack}
            className="artist-hero-back locker-album-back touch-manipulation"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}

        <div className="artist-hero-content">
          <h1 className="artist-hero-title">{heroName}</h1>
          <p className="artist-hero-stats">
            {albums.length} {albums.length === 1 ? 'album' : 'albums'}
            {topTracks.length > 0 ? ` · ${topTracks.length} top tracks` : ''}
            {loading ? '' : ` · ${sortLabel}`}
          </p>

          {bioPreview ? (
            <p className="artist-hero-bio">
              {bioPreview}
              {bio && bio.length > BIO_PREVIEW_CHARS ? (
                <button
                  type="button"
                  className="artist-hero-bio-more"
                  onClick={() => setBioExpanded((v) => !v)}
                >
                  {bioExpanded ? ' Show less' : ' Read more'}
                </button>
              ) : null}
            </p>
          ) : null}

          <div className="artist-hero-actions">
            <button
              type="button"
              className="artist-btn artist-btn-primary"
              onClick={handlePlayAll}
              disabled={playableTop.length === 0}
            >
              <Play className="w-4 h-4 fill-current" />
              Play
            </button>
            <button
              type="button"
              className="artist-btn artist-btn-primary"
              onClick={handleShuffle}
              disabled={playableTop.length === 0}
            >
              <Shuffle className="w-4 h-4" />
              Shuffle
            </button>
            <button
              type="button"
              className={`artist-btn artist-btn-secondary ${following ? 'artist-btn--active' : ''}`}
              onClick={handleFollowToggle}
              disabled={followBusy}
              aria-pressed={following}
            >
              {followBusy ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : following ? (
                <UserCheck className="w-4 h-4" />
              ) : (
                <UserPlus className="w-4 h-4" />
              )}
              {following ? t('artist.following') : t('artist.follow')}
            </button>
            <button type="button" className="artist-btn artist-btn-secondary" disabled title="Coming soon">
              <Radio className="w-4 h-4" />
              Artist radio
            </button>
            <button type="button" className="artist-btn artist-btn-icon" disabled title="Coming soon">
              <Share2 className="w-4 h-4" />
            </button>
            <button type="button" className="artist-btn artist-btn-icon" disabled title="Coming soon">
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>
      </section>

      <div className="artist-page-body">
        <section className="artist-top-tracks" aria-label="Top tracks">
          <h2 className="artist-section-title">Top Tracks</h2>

          {topLoading && (
            <div className="flex items-center gap-2 font-mono text-xs text-accent py-6">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading tracks…
            </div>
          )}

          {!topLoading && topTracks.length === 0 && (
            <p className="font-mono text-xs text-[var(--text-dim)] py-6 uppercase">
              No tracks found for this artist.
            </p>
          )}

          {!topLoading && topTracks.length > 0 && (
            <div className="artist-track-table">
              <div className="artist-track-table-head" aria-hidden>
                <span className="artist-track-col-title">Title</span>
                <span className="artist-track-col-artist">Artist</span>
                <span className="artist-track-col-album">Album</span>
                <span className="artist-track-col-duration">Time</span>
                <span className="artist-track-col-actions" />
              </div>
              <ul className="artist-track-table-body">
                {topTracks.map((track, index) => {
                  const active = track.envelope?.envelopeId === activeEnvelopeId;
                  const trackDownloadJob = findTrackDownloadJob(
                    track.artist,
                    track.title,
                    track.id,
                  );
                  const trackDownloadState = resolveTrackDownloadState(trackDownloadJob, track);
                  const streamLabel =
                    active && playingEnvelope?.envelopeId === track.envelope?.envelopeId
                      ? displayTransportLabel(
                          playingEnvelope.provider,
                          playingEnvelope.transport,
                          playingEnvelope.url,
                        )
                      : track.envelope
                        ? displayTransportLabel(
                            track.envelope.provider,
                            track.envelope.transport,
                            track.envelope.url || track.previewUrl,
                          )
                        : null;
                  return (
                    <li
                      key={track.id}
                      className={`artist-track-row group ${active ? 'is-active' : ''}${track.envelope ? ' artist-track-row--playable' : ''}`}
                    >
                      <div className="artist-track-col-main">
                        <TrackThumb track={track} />
                        {(onTrackTitleTap || onOpenNowPlaying) && track.envelope ? (
                          <button
                            type="button"
                            data-track-action="main"
                            className="artist-track-main-btn touch-manipulation"
                            onClick={() => handleTopTrackTitleTap(index)}
                            aria-label={`Play ${displayLockerTrackTitle(track.title)} and open now playing`}
                          >
                            <span className="artist-track-text">
                              <span className="artist-track-title-line">
                                <span className={`artist-track-title artist-track-title--tap ${active ? 'is-active' : ''}`}>
                                  {displayLockerTrackTitle(track.title)}
                                </span>
                                {track.explicit ? <ExplicitBadge /> : null}
                              </span>
                              <span className="artist-track-mobile-artist artist-track-mobile-artist--full">{track.artist}</span>
                              {streamLabel && !isMobileShell ? (
                                <span
                                  className={`artist-track-stream-badge artist-track-stream-badge--label ${themeBadgeOutlineClass}`}
                                  aria-hidden
                                >
                                  {streamLabel}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            data-track-action="main"
                            className="artist-track-main-btn touch-manipulation"
                            disabled={!track.envelope}
                            onClick={() => handleTrackPlay(index)}
                            aria-label={
                              track.envelope
                                ? `Play ${displayLockerTrackTitle(track.title)} by ${track.artist}`
                                : `${displayLockerTrackTitle(track.title)} — unavailable`
                            }
                          >
                            <span className="artist-track-text">
                              <span className="artist-track-title-line">
                                <span className={`artist-track-title ${active ? 'is-active' : ''}`}>
                                  {displayLockerTrackTitle(track.title)}
                                </span>
                                {track.explicit ? <ExplicitBadge /> : null}
                              </span>
                              <span className="artist-track-mobile-artist artist-track-mobile-artist--full">{track.artist}</span>
                              {streamLabel && !isMobileShell ? (
                                <span
                                  className={`artist-track-stream-badge artist-track-stream-badge--label ${themeBadgeOutlineClass}`}
                                  aria-hidden
                                >
                                  {streamLabel}
                                </span>
                              ) : null}
                            </span>
                          </button>
                        )}
                        {track.envelope ? (
                          <button
                            type="button"
                            data-track-action="play"
                            className="artist-track-play-inline search-results-action search-results-action--play touch-manipulation"
                            aria-label={`Play ${displayLockerTrackTitle(track.title)}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              playTopTrackAt(index);
                            }}
                          >
                            <Play className="w-4 h-4 ml-0.5" />
                          </button>
                        ) : null}
                      </div>
                      <span className="artist-track-col-artist artist-track-col-artist--full">{track.artist}</span>
                      <span className="artist-track-col-album truncate">{track.album ?? '—'}</span>
                      <span className="artist-track-col-duration">
                        {formatTrackDuration(track)}
                      </span>
                      <span
                        className={`artist-track-col-actions${isMobileShell ? ' artist-track-col-actions--visible' : ''}`}
                        data-track-action="actions"
                      >
                        {trackDownloadState ? (
                          <TrackDownloadIndicator state={trackDownloadState} />
                        ) : null}
                        {onDownloadTrack ? (
                          <span data-track-action="menu">
                            <CatalogDownloadMenu
                              label={track.title}
                              open={openMenuId === `top-${track.id}`}
                              onOpenChange={(open) => setOpenMenuId(open ? `top-${track.id}` : null)}
                              showAlbumOptions={false}
                              alwaysVisible={isMobileShell}
                              streamLabel={t('player.play')}
                              onStream={
                                track.envelope ? () => playTopTrackAt(index) : undefined
                              }
                              onCache={
                                onCacheTrack && track.envelope
                                  ? () => onCacheTrack(track)
                                  : undefined
                              }
                              onDownload={(mode) => onDownloadTrack(track, mode)}
                            />
                          </span>
                        ) : null}
                        {onAddToQueue && track.envelope ? (
                          <button
                            type="button"
                            data-track-action="queue"
                            className="artist-track-action touch-manipulation"
                            aria-label={`Add ${displayLockerTrackTitle(track.title)} to queue`}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              onAddToQueue(track.envelope!);
                            }}
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        ) : null}
                        {track.envelope ? (
                          <button
                            type="button"
                            data-track-action="play"
                            className="artist-track-play-col search-results-action search-results-action--play touch-manipulation"
                            aria-label={`Play ${displayLockerTrackTitle(track.title)}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              playTopTrackAt(index);
                            }}
                          >
                            <Play className="w-4 h-4 ml-0.5" />
                          </button>
                        ) : (
                          <span className="artist-track-action artist-track-action--disabled" aria-hidden>
                            <Play className="w-4 h-4" />
                          </span>
                        )}
                        {!isMobileShell && track.envelope?.envelopeId ? (
                          <button
                            type="button"
                            data-track-action="like"
                            className={`artist-track-action touch-manipulation${
                              getTrackTasteFeedback(track.envelope.envelopeId) === 'like'
                                ? ' text-accent'
                                : ''
                            }`}
                            aria-label={
                              getTrackTasteFeedback(track.envelope.envelopeId) === 'like'
                                ? `Unlike ${displayLockerTrackTitle(track.title)}`
                                : `Like ${displayLockerTrackTitle(track.title)}`
                            }
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              const envelopeId = track.envelope?.envelopeId?.trim();
                              if (!envelopeId) return;
                              const liked = getTrackTasteFeedback(envelopeId) === 'like';
                              recordTasteFeedback({
                                envelopeId,
                                artist: track.artist,
                                album: track.album,
                                title: track.title,
                                envelope: track.envelope,
                                kind: liked ? 'clear' : 'like',
                              });
                            }}
                          >
                            <Heart
                              className={`w-4 h-4${
                                getTrackTasteFeedback(track.envelope.envelopeId) === 'like'
                                  ? ' fill-current'
                                  : ''
                              }`}
                            />
                          </button>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>

        <nav className="locker-tabs artist-discography-tabs" aria-label={t('artist.discographyTabsAria')}>
          <button
            type="button"
            onClick={() => setActiveTab('albums')}
            className={`locker-tab touch-manipulation ${activeTab === 'albums' ? 'locker-tab-active' : ''}`}
          >
            {t('artist.albumsTab')}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('singles')}
            className={`locker-tab touch-manipulation ${activeTab === 'singles' ? 'locker-tab-active' : ''}`}
          >
            {t('artist.singlesTab')}
          </button>
        </nav>

        {catalogUnreachable && !loading ? (
          <OfflineStatusBanner
            message={t('artist.catalogUnreachable')}
            className="mb-4"
          />
        ) : null}

        {loading && (
          <div className="flex items-center gap-2 font-mono text-xs text-accent py-8">
            <Loader2 className="w-4 h-4 animate-spin" />
            {t('artist.discographyLoading')}
          </div>
        )}

        {!loading && activeTab === 'singles' && (
          <section>
            {sortedSingles.length === 0 ? (
              <p className="font-mono text-xs text-[var(--text-dim)] py-8 text-center uppercase">
                {t('artist.noSingles')}
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {sortedSingles.map((track) => {
                  const durationLabel = formatTrackDuration(track);
                  return (
                  <div
                    key={track.id}
                    className="artist-catalog-card group flex items-center gap-3 p-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] hover:border-accent/50 text-left"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (!track.envelope) return;
                        handleTitleTap(track.envelope);
                      }}
                      disabled={!track.envelope}
                      className="flex items-center gap-3 min-w-0 flex-1 touch-manipulation disabled:opacity-40"
                    >
                      {track.artworkUrl ? (
                        <img
                          src={proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl}
                          alt=""
                          className="w-12 h-12 rounded-md object-cover shrink-0 border border-[var(--border)]"
                        />
                      ) : (
                        <div
                          className="w-12 h-12 rounded-md shrink-0 border border-[var(--border)]"
                          style={{ background: seedGradient(track.title) }}
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-xs font-bold uppercase truncate text-[var(--text)]">
                          {track.title}
                        </p>
                        <p className="font-mono text-[9px] text-[var(--text-dim)] opacity-50 uppercase truncate">
                          {track.releaseYear ?? 'Unknown year'}
                          {durationLabel !== '—' ? ` · ${durationLabel}` : ''}
                        </p>
                      </div>
                      <Play className="w-4 h-4 text-accent shrink-0" />
                    </button>
                    {onDownloadTrack ? (
                      <CatalogDownloadMenu
                        label={track.title}
                        open={openMenuId === track.id}
                        onOpenChange={(open) => setOpenMenuId(open ? track.id : null)}
                        showAlbumOptions={false}
                        alwaysVisible={isMobileShell}
                        streamLabel={t('player.play')}
                        onStream={
                          track.envelope ? () => onPlayTrack(track.envelope!) : undefined
                        }
                        onCache={
                          onCacheTrack && track.envelope
                            ? () => onCacheTrack(track)
                            : undefined
                        }
                        onDownload={(mode) => onDownloadTrack(track, mode)}
                      />
                    ) : null}
                  </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {!loading && activeTab === 'albums' && catalogSupplemented && (
          <p className="font-mono text-[10px] text-[var(--text-dim)] opacity-70 mb-4 leading-relaxed">
            {t('artist.discographySupplemented')}
          </p>
        )}

        {!loading && activeTab === 'albums' && catalogPartial && !catalogSupplemented && (
          <p className="font-mono text-[10px] text-[var(--text-dim)] opacity-70 mb-4 leading-relaxed">
            {t('artist.discographyPartial')}
          </p>
        )}

        {!loading && activeTab === 'albums' && (
          <section>
            {sortedAlbums.length === 0 ? (
              <p className="font-mono text-xs text-[var(--text-dim)] py-8 text-center uppercase">
                {t('artist.noAlbums')}
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {sortedAlbums.map((album) => {
                  const versionLabel = catalogAlbumVersionLabel(album, sortedAlbums);
                  return (
                  <div key={album.id} className="artist-catalog-card group text-left">
                    <button
                      type="button"
                      onClick={() => onSearchAlbum(album)}
                      className="w-full text-left touch-manipulation"
                    >
                      {album.releaseYear ? (
                        <p className="artist-catalog-year-above">{album.releaseYear}</p>
                      ) : (
                        <p className="artist-catalog-year-above artist-catalog-year-above--unknown">—</p>
                      )}
                      <div className="aspect-square rounded-lg overflow-hidden border border-[var(--border)] group-hover:border-accent/50 mb-2 relative bg-[var(--bg-void)]">
                        <AlbumCover album={album} />
                        {onDownloadAlbum ? (
                          <div
                            className="artist-catalog-card-menu"
                            onClick={(e) => e.stopPropagation()}
                            onKeyDown={(e) => e.stopPropagation()}
                            role="presentation"
                          >
                            <CatalogDownloadMenu
                              label={album.title}
                              open={openMenuId === album.id}
                              onOpenChange={(open) => setOpenMenuId(open ? album.id : null)}
                              alwaysVisible={false}
                              onDownload={(mode) => onDownloadAlbum(album, mode)}
                            />
                          </div>
                        ) : null}
                      </div>
                      <p className="font-mono text-[11px] font-bold uppercase text-[var(--text)] group-hover:text-accent leading-snug">
                        {displayTrackTitle(album.title)}
                      </p>
                      {versionLabel ? (
                        <p className="artist-catalog-version">{versionLabel}</p>
                      ) : null}
                      <p className="font-mono text-[9px] text-[var(--text-mid)] uppercase artist-catalog-year-below">
                        {album.releaseYear ?? '—'}
                        {album.trackCount
                          ? ` · ${album.trackCount} ${album.trackCount === 1 ? 'TRACK' : 'TRACKS'}`
                          : ''}
                      </p>
                    </button>
                  </div>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
