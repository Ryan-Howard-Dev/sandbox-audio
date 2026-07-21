import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight, Disc3, Play } from 'lucide-react';
import LockerRowActions from './LockerRowActions';
import type { LockerMenuAction } from '../LockerMoreMenu';
import { useMobileShell } from '../../hooks/useMobileShell';
import type { MediaEnvelope } from '../../sandboxLayer1';
import {
  refreshLockerEntryAlbumArt,
  resolveLockerTrackArtistLine,
  lockerAlbumDisplayArtist,
  lockerAlbumGroupKey,
  type LockerEntry,
} from '../../lockerStorage';
import { rememberKnownGoodAlbumArt, resolveLockerTrackThumbArt } from '../../albumArtCache';
import {
  editionToAlbumGroup,
  isLockerSingleCollection,
  type AlbumCollection,
  type CollectionAlbumGroup,
} from '../../collectionIntelligence';
import {
  aggregateLockerArtistCredits,
  buildLockerArtistPopularTopTracks,
  lockerArtistCreditsHasContent,
  lockerCarouselHasMore,
  previewLockerArtistTopTracks,
  previewLockerCarouselItems,
} from '../../lockerArtistHub';
import { fetchArtistTopTracks } from '../../searchCatalog';
import { displayLockerTrackTitle, canonicalArtworkSrc, proxiedArtworkUrl } from '../../displaySanitize';
import { formatTime } from '../../stations/theme';
import { seedGradient } from '../../seedGradient';
import { useTranslation } from '../../i18n';
import LockerArtistProfile from './LockerArtistProfile';

type ExpandedSection = 'topTracks' | 'singles' | 'appearsOn' | null;

function siblingTracks(track: LockerEntry, pool: LockerEntry[]): LockerEntry[] {
  const groupKey = lockerAlbumGroupKey(track);
  if (!groupKey) return [track];
  const siblings = pool.filter((row) => lockerAlbumGroupKey(row) === groupKey);
  return siblings.length > 0 ? siblings : [track];
}

function trackToAlbumGroup(track: LockerEntry, pool: LockerEntry[]): CollectionAlbumGroup | null {
  const groupKey = lockerAlbumGroupKey(track);
  if (!groupKey) return null;
  const siblings = siblingTracks(track, pool);
  const name = track.albumName?.trim() ?? track.title;
  return {
    key: groupKey,
    name,
    displayName: name,
    artist: lockerAlbumDisplayArtist(track, siblings),
    tracks: siblings,
    collectionKey: groupKey,
    releaseGroupId: null,
    editionKind: 'other',
  };
}

function resolveTrackThumbArt(
  track: LockerEntry,
  pool: LockerEntry[],
  trackArtSrc?: (entry: LockerEntry) => string | undefined,
  albumArtSrc?: (album: CollectionAlbumGroup) => string | undefined,
  catalogArtworkUrl?: string,
): string | undefined {
  const fromTrack = trackArtSrc?.(track);
  if (fromTrack) return fromTrack;

  const catalogArt = catalogArtworkUrl?.trim();
  if (catalogArt) return catalogArt;

  const albumGroup = trackToAlbumGroup(track, pool);
  if (albumArtSrc && albumGroup) {
    const fromAlbum = albumArtSrc(albumGroup);
    if (fromAlbum) return fromAlbum;
  }

  const groupKey = lockerAlbumGroupKey(track);
  return resolveLockerTrackThumbArt(
    track,
    groupKey,
    albumGroup?.tracks ?? siblingTracks(track, pool),
    catalogArt,
    undefined,
  );
}

function TrackThumb({
  entry,
  pool,
  trackArtSrc,
  albumArtSrc,
  catalogArtworkUrl,
}: {
  entry: LockerEntry;
  pool: LockerEntry[];
  trackArtSrc?: (entry: LockerEntry) => string | undefined;
  albumArtSrc?: (album: CollectionAlbumGroup) => string | undefined;
  catalogArtworkUrl?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const [src, setSrc] = React.useState<string | undefined>(() => {
    const raw = resolveTrackThumbArt(entry, pool, trackArtSrc, albumArtSrc, catalogArtworkUrl);
    return raw ? (proxiedArtworkUrl(raw) ?? raw) : undefined;
  });

  React.useEffect(() => {
    const raw = resolveTrackThumbArt(entry, pool, trackArtSrc, albumArtSrc, catalogArtworkUrl);
    setSrc(raw ? (proxiedArtworkUrl(raw) ?? raw) : undefined);
    setFailed(false);
  }, [entry.id, entry.albumArt, entry.albumName, pool, trackArtSrc, albumArtSrc, catalogArtworkUrl]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt=""
        className="artist-track-thumb"
        onLoad={() => {
          const groupKey = lockerAlbumGroupKey(entry);
          if (groupKey) rememberKnownGoodAlbumArt(groupKey, src);
        }}
        onError={() => {
          const failedSrc = src;
          setFailed(true);
          void refreshLockerEntryAlbumArt(entry.id).then((fresh) => {
            const next = fresh ? (proxiedArtworkUrl(fresh) ?? fresh) : undefined;
            if (
              next &&
              canonicalArtworkSrc(next) !== canonicalArtworkSrc(failedSrc)
            ) {
              setSrc(next);
              setFailed(false);
            }
          });
        }}
      />
    );
  }
  return (
    <div
      className="artist-track-thumb artist-track-thumb--placeholder"
      style={{ background: seedGradient(entry.title) }}
    >
      <Disc3 className="w-4 h-4 text-text-primary/70" />
    </div>
  );
}

function SectionHeader({
  title,
  onViewAll,
  showViewAll,
  viewAllLabel,
}: {
  title: string;
  onViewAll?: () => void;
  showViewAll?: boolean;
  viewAllLabel: string;
}) {
  return (
    <div className="locker-artist-section-head">
      <h2 className="artist-section-title locker-artist-section-title">{title}</h2>
      {showViewAll && onViewAll ? (
        <button type="button" className="locker-artist-view-all touch-manipulation" onClick={onViewAll}>
          {viewAllLabel}
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function AlbumCarouselCard({
  collection,
  art,
  tracks,
  artistLine,
  onClick,
  onArtError,
  overflowMenu,
}: {
  collection: AlbumCollection;
  art?: string;
  tracks: LockerEntry[];
  artistLine: string;
  onClick: () => void;
  onArtError?: (failedSrc: string) => void;
  overflowMenu?: React.ReactNode;
}) {
  const isMobileShell = useMobileShell();
  const edition = collection.editions[0];
  const trackCount = edition?.trackCount ?? collection.editions[0]?.tracks.length ?? 0;
  const [displaySrc, setDisplaySrc] = React.useState<string | undefined>();
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    const raw = art?.trim();
    setDisplaySrc(raw ? (proxiedArtworkUrl(raw) ?? raw) : undefined);
    setFailed(false);
  }, [art, collection.key]);

  const handleArtError = () => {
    const failedSrc = displaySrc ?? art ?? '';
    const entryId = tracks[0]?.id;
    setFailed(true);
    if (entryId) {
      void refreshLockerEntryAlbumArt(entryId).then((fresh) => {
        const next = fresh ? (proxiedArtworkUrl(fresh) ?? fresh) : undefined;
        if (next && canonicalArtworkSrc(next) !== canonicalArtworkSrc(failedSrc)) {
          setDisplaySrc(next);
          setFailed(false);
          return;
        }
        onArtError?.(failedSrc);
      });
      return;
    }
    onArtError?.(failedSrc);
  };

  const showArt = Boolean(displaySrc) && !failed;

  return (
    <div className="locker-artist-carousel-card-wrap group relative">
      <button type="button" className="locker-artist-carousel-card touch-manipulation" onClick={onClick}>
        <span className="locker-artist-carousel-art" aria-hidden>
          {showArt ? (
            <img
              src={displaySrc}
              alt=""
              className="w-full h-full object-cover"
              onError={handleArtError}
            />
          ) : (
            <span
              className="locker-artist-carousel-art-fallback"
              style={{ background: seedGradient(collection.displayName) }}
            />
          )}
        </span>
        <span className="locker-artist-carousel-meta">
          <span className="locker-artist-carousel-title">{collection.displayName}</span>
          <span className="locker-artist-carousel-sub">{artistLine || '\u00A0'}</span>
          {trackCount > 0 ? (
            <span className="locker-artist-carousel-count">
              {trackCount} {trackCount === 1 ? 'song' : 'songs'}
            </span>
          ) : null}
        </span>
      </button>
      {overflowMenu ? (
        <div
          className={`absolute top-1 right-1 z-10 transition-opacity ${
            isMobileShell ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'
          }`}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          role="presentation"
        >
          {overflowMenu}
        </div>
      ) : null}
    </div>
  );
}

export interface LockerArtistHubProps {
  artistName: string;
  tracks: LockerEntry[];
  albumCollections: AlbumCollection[];
  appearsOnCollections?: AlbumCollection[];
  singleCollections: AlbumCollection[];
  initialArtworkUrl?: string;
  activeEnvelopeId?: string;
  onBack: () => void;
  onPlayAll?: () => void;
  onShuffle?: () => void;
  onPlayTrack: (envelope: MediaEnvelope) => void;
  onPlayTracks: (envelopes: MediaEnvelope[], shuffle?: boolean) => void;
  onOpenCollection: (collection: AlbumCollection) => void;
  onPlayCollection: (album: CollectionAlbumGroup) => void;
  albumArtSrc: (album: CollectionAlbumGroup) => string | undefined;
  trackArtSrc?: (entry: LockerEntry) => string | undefined;
  onAlbumArtError?: (album: CollectionAlbumGroup, failedSrc?: string) => void;
  formatArtistLine: (artist: string | undefined, year?: string, albumName?: string) => string;
  preferredEdition: (collection: AlbumCollection) => AlbumCollection['editions'][number];
  onOpenCredits?: () => void;
  overflowMenu?: React.ReactNode;
  openMenuKey?: string | null;
  onOpenMenuKeyChange?: (key: string | null) => void;
  buildTrackMenu?: (entry: LockerEntry) => LockerMenuAction[];
}

function entryToEnvelope(entry: LockerEntry): MediaEnvelope {
  return {
    envelopeId: `local-${entry.id}`,
    title: entry.title,
    artist: entry.artist,
    album: entry.albumName,
    url: '',
    durationSeconds: entry.durationSeconds,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: entry.id,
    artworkUrl: entry.albumArt,
  };
}

export default function LockerArtistHub({
  artistName,
  tracks,
  albumCollections,
  appearsOnCollections = [],
  singleCollections,
  initialArtworkUrl,
  activeEnvelopeId,
  onBack,
  onPlayAll,
  onShuffle,
  onPlayTrack,
  onPlayTracks,
  onOpenCollection,
  onPlayCollection,
  albumArtSrc,
  trackArtSrc,
  onAlbumArtError,
  formatArtistLine,
  preferredEdition,
  onOpenCredits,
  overflowMenu,
  openMenuKey = null,
  onOpenMenuKeyChange,
  buildTrackMenu,
}: LockerArtistHubProps) {
  const { t } = useTranslation();
  const isMobileShell = useMobileShell();
  const [expandedSection, setExpandedSection] = useState<ExpandedSection>(null);
  const [catalogTopRefs, setCatalogTopRefs] = useState<
    Array<{ title: string; artworkUrl?: string }>
  >([]);

  useEffect(() => {
    let cancelled = false;
    void fetchArtistTopTracks(artistName, undefined, 50)
      .then((tracks) => {
        if (cancelled) return;
        setCatalogTopRefs(
          tracks.map((track) => ({
            title: track.title,
            artworkUrl: track.artworkUrl,
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setCatalogTopRefs([]);
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const topTracks = useMemo(
    () => buildLockerArtistPopularTopTracks(tracks, catalogTopRefs),
    [tracks, catalogTopRefs],
  );

  const creditsSummary = useMemo(() => aggregateLockerArtistCredits(tracks), [tracks]);

  const visibleTopTracks =
    expandedSection === 'topTracks' ? topTracks : previewLockerArtistTopTracks(topTracks);

  /**
   * Albums use the expanded 2-col grid — the horizontal carousel only fits 2 cards
   * with a hidden scrollbar, which buried Mr. Morale / untitled behind GKMC+GNX.
   */
  const visibleAlbums = albumCollections;

  const visibleSingles =
    expandedSection === 'singles' ? singleCollections : previewLockerCarouselItems(singleCollections);

  const visibleAppearsOn =
    expandedSection === 'appearsOn'
      ? appearsOnCollections
      : previewLockerCarouselItems(appearsOnCollections);

  const albumCount = albumCollections.length;
  const trackCount = tracks.length;

  const playTopTrackAt = (index: number) => {
    const envs = topTracks.slice(index).map((row) => entryToEnvelope(row.entry));
    if (envs.length === 0) return;
    onPlayTracks(envs, false);
  };

  const toggleSection = (section: ExpandedSection) => {
    setExpandedSection((current) => (current === section ? null : section));
  };

  return (
    <>
      <LockerArtistProfile
        artistName={artistName}
        albumCount={albumCount}
        trackCount={trackCount}
        initialArtworkUrl={initialArtworkUrl}
        onBack={onBack}
        onPlayAll={onPlayAll}
        onShuffle={onShuffle}
        onRadio={onShuffle}
        overflowMenu={overflowMenu}
      />

      <div className="artist-page-body locker-artist-hub-body">
        <section className="artist-top-tracks" aria-label={t('locker.artistHubTopTracks')}>
          <SectionHeader
            title={t('locker.artistHubTopTracks')}
            showViewAll={lockerCarouselHasMore(topTracks) && expandedSection !== 'topTracks'}
            onViewAll={() => toggleSection('topTracks')}
            viewAllLabel={t('locker.artistHubViewAll')}
          />
          {catalogTopRefs.length > 0 ? (
            <p className="locker-artist-top-tracks-hint font-mono text-[10px] uppercase tracking-wide text-[var(--text-dim)] -mt-2 mb-2">
              {t('locker.artistHubPopularTracksHint')}
            </p>
          ) : null}

          {visibleTopTracks.length === 0 ? (
            <p className="font-mono text-xs text-[var(--text-dim)] py-6 uppercase">
              {t('locker.artistHubNoTracks')}
            </p>
          ) : (
            <ul className="artist-track-table-body locker-artist-top-tracks">
              {visibleTopTracks.map((row, index) => {
                const track = row.entry;
                const env = entryToEnvelope(track);
                const active = env.envelopeId === activeEnvelopeId;
                const artistLine = resolveLockerTrackArtistLine(track, artistName);
                const albumLine = track.albumName?.trim();
                return (
                  <li
                    key={track.id}
                    className={`artist-track-row group artist-track-row--playable${active ? ' is-active' : ''}`}
                  >
                    <div className="artist-track-col-main">
                      <TrackThumb
                        entry={track}
                        pool={tracks}
                        trackArtSrc={trackArtSrc}
                        albumArtSrc={albumArtSrc}
                        catalogArtworkUrl={row.catalogArtworkUrl}
                      />
                      <button
                        type="button"
                        className="artist-track-main-btn touch-manipulation"
                        onClick={() => playTopTrackAt(index)}
                        aria-label={`Play ${displayLockerTrackTitle(track.title)}`}
                      >
                        <span className="artist-track-text">
                          <span className="artist-track-title-line">
                            <span className={`artist-track-title ${active ? 'is-active' : ''}`}>
                              {displayLockerTrackTitle(track.title)}
                            </span>
                          </span>
                          <span className="artist-track-mobile-artist truncate">
                            {albumLine || artistLine || artistName}
                          </span>
                          {albumLine && artistLine && artistLine.toLowerCase() !== albumLine.toLowerCase() ? (
                            <span className="artist-track-mobile-sub truncate">{artistLine}</span>
                          ) : null}
                          {row.source === 'locker-only' ? (
                            <span className="locker-artist-track-source font-mono text-[9px] uppercase tracking-wide text-[var(--text-dim)]">
                              {t('locker.artistHubInYourLocker')}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="artist-track-play-col search-results-action search-results-action--play touch-manipulation"
                        aria-label={`Play ${displayLockerTrackTitle(track.title)}`}
                        onClick={() => onPlayTrack(env)}
                      >
                        <Play className="w-4 h-4 ml-0.5" />
                      </button>
                    </div>
                    <span className="artist-track-col-duration">{formatTime(track.durationSeconds || 0)}</span>
                    <span
                      className={`artist-track-col-actions${
                        isMobileShell ? ' artist-track-col-actions--visible' : ''
                      }`}
                      data-track-action="actions"
                    >
                      {buildTrackMenu && onOpenMenuKeyChange ? (
                        <span data-track-action="menu">
                          <LockerRowActions
                            menuKey={`artist-hub-track:${track.id}`}
                            openMenuKey={openMenuKey}
                            onOpenMenuKeyChange={onOpenMenuKeyChange}
                            actions={buildTrackMenu(track)}
                            ariaLabel={t('locker.menu.trackOptionsAria', {
                              defaultValue: `Options for ${displayLockerTrackTitle(track.title)}`,
                              title: displayLockerTrackTitle(track.title),
                            })}
                            sheetTitle={displayLockerTrackTitle(track.title)}
                            sheetSubtitle={albumLine || artistLine || artistName}
                            portaled
                            alwaysVisible={isMobileShell}
                          />
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {albumCollections.length > 0 ? (
          <section className="locker-artist-carousel-section" aria-label={t('locker.artistHubAlbumsSection')}>
            <SectionHeader
              title={t('locker.artistHubAlbumsSection')}
              showViewAll={false}
              viewAllLabel={t('locker.artistHubViewAll')}
            />
            <div className="locker-artist-carousel-scroll locker-artist-carousel-scroll--expanded">
              {visibleAlbums.map((collection) => {
                const edition = preferredEdition(collection);
                const album = editionToAlbumGroup(collection, edition);
                const art = albumArtSrc(album);
                const year = edition.year ?? album.tracks.find((tr) => tr.releaseYear)?.releaseYear;
                const artistLine = formatArtistLine(collection.artist, year, collection.displayName);
                return (
                  <React.Fragment key={collection.key}>
                    <AlbumCarouselCard
                      collection={collection}
                      art={art}
                      tracks={edition.tracks}
                      artistLine={artistLine}
                      onClick={() => onOpenCollection(collection)}
                      onArtError={(failedSrc) => onAlbumArtError?.(album, failedSrc)}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        ) : null}

        {singleCollections.length > 0 ? (
          <section className="locker-artist-carousel-section" aria-label={t('locker.artistHubSinglesSection')}>
            <SectionHeader
              title={t('locker.artistHubSinglesSection')}
              showViewAll={
                lockerCarouselHasMore(singleCollections) && expandedSection !== 'singles'
              }
              onViewAll={() => toggleSection('singles')}
              viewAllLabel={t('locker.artistHubViewAll')}
            />
            <div
              className={`locker-artist-carousel-scroll hide-scrollbar${
                expandedSection === 'singles' ? ' locker-artist-carousel-scroll--expanded' : ''
              }`}
            >
              {visibleSingles.map((collection) => {
                const edition = preferredEdition(collection);
                const album = editionToAlbumGroup(collection, edition);
                const art = albumArtSrc(album);
                const year = edition.year ?? album.tracks.find((tr) => tr.releaseYear)?.releaseYear;
                const artistLine = formatArtistLine(collection.artist, year, collection.displayName);
                const primaryTrack = album.tracks[0];
                return (
                  <React.Fragment key={collection.key}>
                    <AlbumCarouselCard
                      collection={collection}
                      art={art}
                      tracks={edition.tracks}
                      artistLine={artistLine}
                      onArtError={(failedSrc) => onAlbumArtError?.(album, failedSrc)}
                      onClick={() => {
                        if (isLockerSingleCollection(collection)) {
                          onPlayCollection(album);
                        } else {
                          onOpenCollection(collection);
                        }
                      }}
                      overflowMenu={
                        buildTrackMenu && onOpenMenuKeyChange && primaryTrack ? (
                          <LockerRowActions
                            menuKey={`artist-hub-single:${primaryTrack.id}`}
                            openMenuKey={openMenuKey}
                            onOpenMenuKeyChange={onOpenMenuKeyChange}
                            actions={buildTrackMenu(primaryTrack)}
                            ariaLabel={t('locker.menu.trackOptionsAria', {
                              defaultValue: `Options for ${displayLockerTrackTitle(primaryTrack.title)}`,
                              title: displayLockerTrackTitle(primaryTrack.title),
                            })}
                            sheetTitle={displayLockerTrackTitle(primaryTrack.title)}
                            sheetSubtitle={primaryTrack.artist || artistLine || artistName}
                            portaled
                            alwaysVisible={isMobileShell}
                          />
                        ) : undefined
                      }
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        ) : null}

        {appearsOnCollections.length > 0 ? (
          <section
            className="locker-artist-carousel-section"
            aria-label={t('locker.artistHubAppearsOnSection')}
          >
            <SectionHeader
              title={t('locker.artistHubAppearsOnSection')}
              showViewAll={
                lockerCarouselHasMore(appearsOnCollections) && expandedSection !== 'appearsOn'
              }
              onViewAll={() => toggleSection('appearsOn')}
              viewAllLabel={t('locker.artistHubViewAll')}
            />
            <div
              className={`locker-artist-carousel-scroll hide-scrollbar${
                expandedSection === 'appearsOn' ? ' locker-artist-carousel-scroll--expanded' : ''
              }`}
            >
              {visibleAppearsOn.map((collection) => {
                const edition = preferredEdition(collection);
                const album = editionToAlbumGroup(collection, edition);
                const art = albumArtSrc(album);
                const year = edition.year ?? album.tracks.find((tr) => tr.releaseYear)?.releaseYear;
                const artistLine = formatArtistLine(collection.artist, year, collection.displayName);
                return (
                  <React.Fragment key={collection.key}>
                    <AlbumCarouselCard
                      collection={collection}
                      art={art}
                      tracks={edition.tracks}
                      artistLine={artistLine}
                      onClick={() => onOpenCollection(collection)}
                      onArtError={(failedSrc) => onAlbumArtError?.(album, failedSrc)}
                    />
                  </React.Fragment>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="locker-artist-credits" aria-label={t('locker.artistHubCredits')}>
          <SectionHeader title={t('locker.artistHubCredits')} showViewAll={false} viewAllLabel="" />
          {lockerArtistCreditsHasContent(creditsSummary) ? (
            <div className="locker-artist-credits-body">
              {creditsSummary.producers.length > 0 ? (
                <p className="locker-artist-credits-line">
                  <span className="locker-artist-credits-label">{t('locker.artistHubProducers')}</span>
                  {creditsSummary.producers.join(', ')}
                </p>
              ) : null}
              {creditsSummary.performers.length > 0 ? (
                <p className="locker-artist-credits-line">
                  <span className="locker-artist-credits-label">{t('locker.artistHubPerformers')}</span>
                  {creditsSummary.performers.join(', ')}
                </p>
              ) : null}
              {creditsSummary.composers.length > 0 ? (
                <p className="locker-artist-credits-line">
                  <span className="locker-artist-credits-label">{t('locker.artistHubComposers')}</span>
                  {creditsSummary.composers.join(', ')}
                </p>
              ) : null}
              {creditsSummary.featuredArtists.length > 0 ? (
                <p className="locker-artist-credits-line">
                  <span className="locker-artist-credits-label">{t('locker.artistHubFeatured')}</span>
                  {creditsSummary.featuredArtists.join(', ')}
                </p>
              ) : null}
              {onOpenCredits ? (
                <button
                  type="button"
                  className="locker-artist-credits-more touch-manipulation"
                  onClick={onOpenCredits}
                >
                  {t('locker.menu.viewCredits')}
                </button>
              ) : null}
            </div>
          ) : (
            <p className="font-mono text-xs text-[var(--text-dim)] py-4 uppercase">
              {t('locker.artistHubNoCredits')}
            </p>
          )}
        </section>
      </div>
    </>
  );
}
