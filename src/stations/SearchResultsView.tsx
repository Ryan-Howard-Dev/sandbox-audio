import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  Disc3,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Play,
  Podcast,
  RotateCcw,
  Shuffle,
  HardDriveDownload,
} from 'lucide-react';
import CatalogDownloadMenu from '../components/CatalogDownloadMenu';
import { buildAlbumPlayQueueEnvelopes } from '../play/albumPlayQueue';
import CatalogArtThumb from '../components/CatalogArtThumb';
import AlbumArtistCreditsSection from '../components/AlbumArtistCreditsSection';
import LockerMoreMenu, { type LockerMenuAction } from '../components/LockerMoreMenu';
import MobileShellBackButton from '../components/MobileShellBackButton';
import MobileTrackActionSheet from '../mobile/MobileTrackActionSheet';
import TrackRowSources from '../components/TrackRowSources';
import { useMobileShell } from '../hooks/useMobileShell';
import {
  computeAlbumDownloadProgress,
  findAlbumDownloadJob,
  findTrackDownloadJob,
  trackTitleKeysMatch,
  getDownloadJobs,
  subscribeDownloadQueue,
  type DownloadJob,
  type DownloadMode,
  type TrackDownloadState,
} from '../downloadQueue';
import { useLockerVault } from '../LockerVaultContext';
import { lockerArtistMatches, lockerTitleMatches } from '../lockerStorage';
import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { resolveMediaEnvelope } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import { canResolveFullStreams } from '../catalogDirect';
import { catalogTrackIdFromEnvelope, parseCatalogTrackId } from '../catalogTrackId';
import { resolvedStreamMatchesCatalog } from '../playbackPipeline';
import { resolveArtistRowArtwork } from '../artistImage';
import { resolveAlbumRowArtwork } from '../albumCover';
import type { CatalogAlbum, CatalogArtist, CatalogTrack } from '../searchCatalog';
import {
  collectAlbumArtistCredits,
  collectAlbumGuestArtists,
  catalogAlbumVersionLabel,
  fetchCatalogAlbumEditionVariants,
  formatCappedArtistLine,
  mergeAlbumArtistCreditLists,
  parseCatalogArtistBilling,
  groupCatalogTracksByDisc,
  needsWebTrackSupplement,
  catalogSatisfiesTrackQuery,
} from '../searchCatalog';
import { fetchCatalogSupplementalArtistCredits } from '../albumCredits';
import { isAirGapEnabled } from '../airGapMode';
import type { UnifiedPlaylistResult, UnifiedSearchResult, UnifiedSearchSection } from '../unifiedSearch';
import {
  coalesceArtworkUrl,
  displayTrackTitle,
  displayLockerTrackTitle,
  displayTransportLabel,
  catalogPreviewDurationSeconds,
  isCatalogPreviewUrl,
  proxiedArtworkUrl,
} from '../displaySanitize';
import { isEnvelopeStreamCached, subscribeStreamCache } from '../streamCache';
import { formatTime, themeBadgeOutlineClass } from './theme';
import { seedGradient } from '../seedGradient';
import type { PodcastSearchHit } from '../podcastSearch';
import type { PodcastCatalogEpisodeHit } from '../podcastCatalog';
import { useTranslation } from '../i18n';

const SEARCH_RESULTS_TEXT = '#E6E8EE';

const searchResultsRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  minWidth: 0,
  listStyle: 'none',
};

const searchResultsRowInnerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  width: '100%',
  gap: '12px',
  padding: '8px 0',
  minWidth: 0,
};

const searchResultsIndexStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '1.75rem',
  textAlign: 'right',
};

const searchResultsThumbStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 48,
  height: 48,
  borderRadius: 4,
  objectFit: 'cover',
};

const searchResultsMainButtonStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  flex: '1 1 auto',
  minWidth: 0,
  overflow: 'hidden',
  textAlign: 'left',
  background: 'none',
  border: 'none',
  color: SEARCH_RESULTS_TEXT,
  cursor: 'pointer',
  padding: 0,
};

const searchResultsArtistTextStyle: React.CSSProperties = {
  color: '#888',
  fontSize: '0.85em',
};

const searchResultsDurationCellStyle: React.CSSProperties = {
  flexShrink: 0,
  width: '2.75rem',
  textAlign: 'right',
};

const searchResultsActionsStyle: React.CSSProperties = {
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

export interface SearchResultsViewProps {
  query: string;
  loading: boolean;
  fromCache: boolean;
  hits: ResolvedSearchHit[];
  unified?: UnifiedSearchResult | null;
  unifiedLoading?: boolean;
  webSupplementLoading?: boolean;
  webSupplementError?: string | null;
  activeSection?: UnifiedSearchSection;
  onSectionChange?: (section: UnifiedSearchSection) => void;
  albumContext?: CatalogAlbum | null;
  albumTracks?: CatalogTrack[];
  activeEnvelopeId: string | null;
  playingEnvelope?: MediaEnvelope | null;
  onBack: () => void;
  onPlay: (env: MediaEnvelope, candidates?: CandidateSource[]) => void;
  /** Mobile: tap track title → play (if needed) and open full-screen now playing. */
  onTrackTitleTap?: (env: MediaEnvelope, candidates?: CandidateSource[]) => void;
  onPlaySource: (source: CandidateSource, hit: ResolvedSearchHit) => void;
  onAddToQueue?: (env: MediaEnvelope) => void;
  onDownloadHit?: (hit: ResolvedSearchHit, mode: DownloadMode) => void;
  /** One tap: acquire → play preview → locker when done. */
  onAcquireAndPlay?: (hit: ResolvedSearchHit) => void;
  onDownloadAlbum?: (album: CatalogAlbum, mode: DownloadMode) => void;
  onStreamHit?: (hit: ResolvedSearchHit) => void;
  onCacheHit?: (hit: ResolvedSearchHit) => void;
  onSelectArtist?: (artist: CatalogArtist) => void;
  onSelectAlbum?: (album: CatalogAlbum) => void;
  onSelectPlaylist?: (playlist: UnifiedPlaylistResult) => void;
  onPlayCatalogTrack?: (track: CatalogTrack) => void;
  onRetryTrack?: (jobId: string, trackId: string) => void;
  onPlayAlbum?: (tracks: MediaEnvelope[], shuffle?: boolean) => void;
  onGoToArtistByName?: (name: string) => void;
  onGoToAlbumByName?: (artist: string, album: string) => void;
  onAnalyzeStems?: (trackId: string) => void;
  onRemoveLockerEntry?: (entry: { id: string; title: string }) => void;
  podcastHits?: PodcastSearchHit[];
  podcastCatalogHits?: PodcastCatalogEpisodeHit[];
  onPlayPodcast?: (env: MediaEnvelope) => void;
}

function resolveHitArtistCredits(hit: ResolvedSearchHit, albumTracks?: CatalogTrack[]): string {
  const catalogTrack = albumTracks?.find((track) => trackTitleKeysMatch(track.title, hit.title));
  return (catalogTrack?.artist ?? hit.artist ?? '').trim();
}

function catalogTrackToResolvedHit(track: CatalogTrack): ResolvedSearchHit {
  const catalogId = track.id.match(/^track-(\d+)$/)?.[1];
  const envelope: MediaEnvelope = track.envelope ?? {
    envelopeId: catalogId ? `catalog-${catalogId}` : track.id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    url: '',
    durationSeconds: track.durationSeconds ?? 0,
    provider: 'unknown',
    transport: 'element-src',
    sourceId: catalogId ?? track.id,
    artworkUrl: track.artworkUrl,
  };
  const source: CandidateSource = {
    id: catalogId ? `catalog-${catalogId}` : track.id,
    priority: 1,
    provider: envelope.provider,
    transport: envelope.transport,
    uri: envelope.url,
    metadata: {
      title: track.title,
      artist: track.artist,
      album: track.album,
      durationSeconds: track.durationSeconds,
    },
  };
  return {
    identityId: catalogId ? `catalog-${catalogId}` : track.id,
    title: track.title,
    artist: track.artist,
    artworkUrl: track.artworkUrl ?? envelope.artworkUrl,
    sources: [source],
    primaryEnvelope: envelope,
  };
}

type AlbumRenderRow =
  | { kind: 'disc-header'; key: string; label: string }
  | { kind: 'track'; key: string; hit: ResolvedSearchHit; displayIndex: number };

function buildAlbumRenderRows(
  displayHits: ResolvedSearchHit[],
  albumTracks: CatalogTrack[] | undefined,
  albumTitle?: string,
  expectedTrackCount?: number,
): AlbumRenderRow[] {
  if (!albumTracks?.length) {
    return [];
  }

  const sections = groupCatalogTracksByDisc(albumTracks, albumTitle);
  if (sections.length <= 1 && !sections[0]?.label) {
    const usedHits = new Set<string>();
    const rows = albumTracks.map((track, index) => {
      const hit =
        displayHits.find(
          (candidate) =>
            !usedHits.has(candidate.identityId) &&
            trackTitleKeysMatch(candidate.title, track.title),
        ) ??
        displayHits.find((candidate) => {
          if (usedHits.has(candidate.identityId)) return false;
          const catalogId = parseCatalogTrackId(candidate.primaryEnvelope.sourceId ?? '');
          return Boolean(catalogId && track.id === `track-${catalogId}`);
        }) ??
        catalogTrackToResolvedHit(track);
      usedHits.add(hit.identityId);
      return {
        kind: 'track' as const,
        key: hit.identityId,
        hit,
        displayIndex: track.trackNumber ?? index + 1,
      };
    });
    return finalizeAlbumRenderRows(rows, albumTracks, expectedTrackCount);
  }

  const rows: AlbumRenderRow[] = [];
  const usedHits = new Set<string>();

  for (const section of sections) {
    if (section.label) {
      rows.push({ kind: 'disc-header', key: `disc-${section.discNumber}`, label: section.label });
    }
    section.tracks.forEach((track, idx) => {
      const hit =
        displayHits.find(
          (candidate) =>
            !usedHits.has(candidate.identityId) &&
            trackTitleKeysMatch(candidate.title, track.title),
        ) ??
        displayHits.find((candidate) => {
          if (usedHits.has(candidate.identityId)) return false;
          const catalogId = parseCatalogTrackId(candidate.primaryEnvelope.sourceId ?? '');
          return Boolean(catalogId && track.id === `track-${catalogId}`);
        }) ??
        catalogTrackToResolvedHit(track);
      usedHits.add(hit.identityId);
      rows.push({
        kind: 'track',
        key: hit.identityId,
        hit,
        displayIndex: track.trackNumber ?? idx + 1,
      });
    });
  }

  return finalizeAlbumRenderRows(rows, albumTracks, expectedTrackCount);
}

/** @internal test hook — exported for album render regression tests. */
export { buildAlbumRenderRows };

function albumTracksHaveDisplayGaps(tracks: CatalogTrack[], expectedCount?: number): boolean {
  const nums = tracks
    .map((track) => track.trackNumber)
    .filter((n): n is number => n != null && n > 0);
  if (nums.length < 2) {
    return Boolean(expectedCount && expectedCount > tracks.length);
  }
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  const maxNum = unique[unique.length - 1] ?? 0;
  if (expectedCount && unique.length < expectedCount * 0.75) return true;
  if (maxNum > unique.length + 1) return true;
  for (let i = 1; i < unique.length; i += 1) {
    if (unique[i]! - unique[i - 1]! > 1) return true;
  }
  return false;
}

function renumberAlbumRenderRows(rows: AlbumRenderRow[]): AlbumRenderRow[] {
  let seq = 0;
  return rows.map((row) => {
    if (row.kind === 'disc-header') {
      seq = 0;
      return row;
    }
    seq += 1;
    return { ...row, displayIndex: seq };
  });
}

function finalizeAlbumRenderRows(
  rows: AlbumRenderRow[],
  albumTracks: CatalogTrack[] | undefined,
  expectedTrackCount?: number,
): AlbumRenderRow[] {
  if (!albumTracks?.length) return rows;
  if (!albumTracksHaveDisplayGaps(albumTracks, expectedTrackCount)) return rows;
  return renumberAlbumRenderRows(rows);
}

function normalizeTrackTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, ' ');
}

function albumHitsAreDuplicates(a: ResolvedSearchHit, b: ResolvedSearchHit): boolean {
  if (!trackTitleKeysMatch(a.title, b.title)) return false;
  if (/\b(instrumental|karaoke)\b/i.test(a.title) !== /\b(instrumental|karaoke)\b/i.test(b.title)) {
    return false;
  }
  const durA = a.primaryEnvelope.durationSeconds ?? 0;
  const durB = b.primaryEnvelope.durationSeconds ?? 0;
  if (durA > 0 && durB > 0 && Math.abs(durA - durB) > 2) return false;
  return true;
}

/** Collapse duplicate album rows that share the same track title (remasters / multi-source). */
function collapseAlbumHits(hits: ResolvedSearchHit[]): ResolvedSearchHit[] {
  const out: ResolvedSearchHit[] = [];
  for (const hit of hits) {
    const dupIdx = out.findIndex((existing) => albumHitsAreDuplicates(existing, hit));
    if (dupIdx < 0) {
      out.push(hit);
      continue;
    }
    const existing = out[dupIdx]!;
    const mergedSources = [...existing.sources];
    for (const source of hit.sources) {
      if (!mergedSources.some((s) => s.id === source.id)) mergedSources.push(source);
    }

    const catalogSource =
      mergedSources.find((s) => s.priority === 1) ??
      mergedSources.find((s) => isCatalogPreviewUrl(s.uri ?? ''));
    let catalogEnvelope: MediaEnvelope | null = null;
    if (catalogSource) {
      const catalogId = parseCatalogTrackId(catalogSource.id);
      try {
        const resolved = resolveMediaEnvelope([catalogSource], catalogSource.id);
        catalogEnvelope = {
          ...resolved,
          sourceId: catalogId ?? resolved.sourceId,
          envelopeId: catalogId ? `catalog-${catalogId}` : resolved.envelopeId,
        };
      } catch {
        catalogEnvelope = null;
      }
    }

    const fullStreamSource = mergedSources.find(
      (s) => s.uri?.trim() && !isCatalogPreviewUrl(s.uri),
    );
    const catalogMeta = catalogEnvelope ?? existing.primaryEnvelope;
    const fullStreamMatchesCatalog =
      Boolean(fullStreamSource) &&
      Boolean(catalogTrackIdFromEnvelope(catalogMeta)) &&
      resolvedStreamMatchesCatalog(
        catalogMeta,
        (() => {
          try {
            return fullStreamSource
              ? resolveMediaEnvelope([fullStreamSource], fullStreamSource.id)
              : null;
          } catch {
            return null;
          }
        })() ?? catalogMeta,
      );

    const preferredTitle =
      hit.title.length < existing.title.length &&
      !/\b(feat\.?|ft\.?|featuring)\b/i.test(hit.title)
        ? hit.title
        : existing.title;

    let primaryEnvelope = catalogMeta;
    const catalogUrl = catalogMeta.url?.trim() ?? '';
    const preferFullStream =
      Boolean(fullStreamSource) &&
      fullStreamMatchesCatalog &&
      (canResolveFullStreams() || !catalogUrl || isCatalogPreviewUrl(catalogUrl));
    if (preferFullStream && fullStreamSource) {
      try {
        const tierEnv = resolveMediaEnvelope([fullStreamSource], catalogMeta.envelopeId);
        primaryEnvelope = {
          ...tierEnv,
          title: preferredTitle,
          artist: existing.artist,
          album: catalogMeta.album ?? tierEnv.album,
          artworkUrl: existing.artworkUrl ?? hit.artworkUrl ?? catalogMeta.artworkUrl ?? tierEnv.artworkUrl,
          sourceId: catalogMeta.sourceId,
          envelopeId: catalogMeta.envelopeId,
        };
      } catch {
        primaryEnvelope = {
          ...catalogMeta,
          title: preferredTitle,
          artist: existing.artist,
          artworkUrl: existing.artworkUrl ?? hit.artworkUrl ?? catalogMeta.artworkUrl,
        };
      }
    } else {
      primaryEnvelope = {
        ...catalogMeta,
        title: preferredTitle,
        artist: existing.artist,
        artworkUrl: existing.artworkUrl ?? hit.artworkUrl ?? catalogMeta.artworkUrl,
      };
    }

    out[dupIdx] = {
      ...existing,
      title: preferredTitle,
      artworkUrl: coalesceArtworkUrl(
        existing.artworkUrl,
        hit.artworkUrl,
        primaryEnvelope.artworkUrl,
        catalogMeta.artworkUrl,
      ),
      sources: mergedSources,
      primaryEnvelope,
      identityId: existing.identityId,
    };
  }
  return out;
}

function resolveTrackDownloadState(
  job: DownloadJob | undefined,
  hitTitle: string,
  albumTracks?: CatalogTrack[],
): TrackDownloadState | undefined {
  if (!job) return undefined;

  const titleKey = normalizeTrackTitle(hitTitle);

  if (Object.keys(job.tracks).length === 0) {
    if (
      job.mode === 'tracks' &&
      (trackTitleKeysMatch(job.label, hitTitle) ||
        trackTitleKeysMatch(job.currentTrack ?? '', hitTitle))
    ) {
      const status: TrackDownloadState['status'] =
        job.status === 'queued'
          ? 'pending'
          : job.status === 'resolving'
            ? 'resolving'
            : job.status === 'metadata'
              ? 'metadata'
              : job.status === 'downloading'
                ? 'downloading'
                : 'pending';
      return {
        trackId: '',
        title: job.label,
        status,
        percent: job.progress ?? 0,
      };
    }
    return undefined;
  }

  const catalogTrack = albumTracks?.find(
    (track) => trackTitleKeysMatch(track.title, hitTitle),
  );
  if (catalogTrack && job.tracks[catalogTrack.id]) {
    return job.tracks[catalogTrack.id];
  }

  return Object.values(job.tracks).find((track) =>
    trackTitleKeysMatch(track.title, hitTitle),
  );
}

function TrackDownloadRing({ percent }: { percent: number }) {
  const r = 8;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (percent / 100) * circumference;
  return (
    <span className="track-download-ring" aria-hidden>
      <svg viewBox="0 0 20 20">
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="rgba(255, 255, 255, 0.12)"
          strokeWidth="2"
        />
        <circle
          cx="10"
          cy="10"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function vaultHasPlayableTrack(
  entries: { title: string; artist: string; offlineReady?: boolean }[],
  title: string,
  artist: string,
): boolean {
  return entries.some(
    (e) =>
      e.offlineReady === true &&
      lockerTitleMatches(e.title, title) &&
      lockerArtistMatches(e.artist, artist),
  );
}

function resolveAlbumViewDownload(
  albumJob: DownloadJob | undefined,
  hit: ResolvedSearchHit,
  albumTracks?: CatalogTrack[],
): { job?: DownloadJob; state?: TrackDownloadState } {
  const catalogTrack = albumTracks?.find((track) =>
    trackTitleKeysMatch(track.title, hit.title),
  );
  const fromAlbum = resolveTrackDownloadState(albumJob, hit.title, albumTracks);
  if (fromAlbum && albumJob) return { job: albumJob, state: fromAlbum };
  const trackJob = findTrackDownloadJob(
    albumJob?.artist ?? hit.artist,
    hit.title,
    catalogTrack?.id,
  );
  if (!trackJob) {
    const fallbackJob = findTrackDownloadJob(hit.primaryEnvelope.artist, hit.title, catalogTrack?.id);
    if (fallbackJob) {
      const fromFallback = resolveTrackDownloadState(fallbackJob, hit.title, albumTracks);
      if (fromFallback) return { job: fallbackJob, state: fromFallback };
    }
  }
  const fromTrack = resolveTrackDownloadState(trackJob, hit.title, albumTracks);
  if (fromTrack && trackJob) return { job: trackJob, state: fromTrack };
  return {};
}

function AlbumTrackTimeCell({
  duration,
  state,
  onRetry,
  lockerPlayable,
}: {
  duration: string;
  state?: TrackDownloadState;
  onRetry?: () => void;
  lockerPlayable?: boolean;
}) {
  if (
    state &&
    (state.status === 'downloading' ||
      state.status === 'resolving' ||
      state.status === 'metadata' ||
      state.status === 'pending')
  ) {
    const pct =
      state.status === 'pending'
        ? 0
        : Math.max(state.percent, state.status === 'resolving' ? 5 : 0);
    return (
      <span
        className="search-results-duration search-results-duration--downloading"
        aria-label={`Downloading ${pct}%`}
      >
        <TrackDownloadRing percent={pct} />
        <span className="track-download-percent">{pct}%</span>
      </span>
    );
  }

  if ((state?.status === 'done' || state?.status === 'skipped') && lockerPlayable) {
    return (
      <span
        className="search-results-duration search-results-duration--done"
        aria-label="Saved to locker"
      >
        <Check className="w-3.5 h-3.5" strokeWidth={2.5} />
      </span>
    );
  }

  if (state?.status === 'done' || state?.status === 'skipped') {
    return (
      <span className="search-results-duration" aria-label={duration}>
        {duration}
      </span>
    );
  }

  if (state?.status === 'error') {
    return (
      <span className="search-results-duration search-results-duration--error flex items-center gap-1">
        <span title={state.errorMessage ?? 'Download failed'} aria-label={state.errorMessage ?? 'Download failed'}>
          <AlertCircle className="w-3.5 h-3.5" />
        </span>
        {onRetry ? (
          <button
            type="button"
            className="search-results-action touch-manipulation p-0.5"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
            aria-label="Retry track download"
            title="Retry"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        ) : null}
      </span>
    );
  }

  return (
    <span className="search-results-duration" aria-label="Track length">
      {duration}
    </span>
  );
}

function formatHitDuration(
  hit: ResolvedSearchHit,
  albumTracks?: CatalogTrack[],
): string {
  const fullStream = canResolveFullStreams();
  let best = 0;
  const consider = (seconds?: number, previewUrl?: string | null, playUrl?: string | null) => {
    const value = catalogPreviewDurationSeconds(seconds, {
      previewUrl,
      playUrl,
      fullStreamAvailable: fullStream,
    });
    if (value && value > best) best = value;
  };

  consider(hit.primaryEnvelope.durationSeconds, undefined, hit.primaryEnvelope.url);
  for (const source of hit.sources) {
    consider(source.metadata?.durationSeconds, undefined, source.uri);
  }

  if (albumTracks?.length) {
    const hitTitle = normalizeTrackTitle(hit.title);
    const catalogTrack = albumTracks.find(
      (track) => normalizeTrackTitle(track.title) === hitTitle,
    );
    consider(
      catalogTrack?.durationSeconds,
      catalogTrack?.previewUrl,
      catalogTrack?.envelope?.url,
    );
    consider(
      catalogTrack?.envelope?.durationSeconds,
      catalogTrack?.previewUrl,
      catalogTrack?.envelope?.url,
    );
  }

  return best > 0 ? formatTime(best) : '—';
}

function isLocalId(id: string): boolean {
  return id.startsWith('local-');
}

function resolveSearchHitArtwork(hit: ResolvedSearchHit): string | undefined {
  return coalesceArtworkUrl(
    hit.artworkUrl,
    hit.primaryEnvelope.artworkUrl,
    ...hit.sources.map((source) => source.metadata?.artworkUrl),
  );
}

function searchHitArtFallback(hit: ResolvedSearchHit): { album: string; artist: string } | undefined {
  const artist = hit.artist?.trim() || hit.primaryEnvelope.artist?.trim();
  const album =
    hit.primaryEnvelope.album?.trim() ||
    hit.sources.find((source) => source.metadata?.album?.trim())?.metadata?.album?.trim();
  if (artist && album) return { album, artist };
  if (artist) return { album: hit.title, artist };
  return undefined;
}

function resolveCatalogTrackArtwork(track: CatalogTrack): string | undefined {
  return coalesceArtworkUrl(track.artworkUrl, track.envelope?.artworkUrl);
}

function catalogTrackArtFallback(track: CatalogTrack): { album: string; artist: string } | undefined {
  const artist = track.artist?.trim();
  const album = track.album?.trim();
  if (artist && album) return { album, artist };
  if (artist) return { album: track.title, artist };
  return undefined;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-accent mb-2 mt-6 first:mt-0">
      {label}
    </p>
  );
}

export default function SearchResultsView({
  query,
  loading,
  fromCache,
  hits,
  unified,
  unifiedLoading = false,
  webSupplementLoading = false,
  webSupplementError = null,
  activeSection = 'all',
  onSectionChange,
  albumContext,
  albumTracks,
  activeEnvelopeId,
  playingEnvelope,
  onBack,
  onPlay,
  onTrackTitleTap,
  onPlaySource,
  onAddToQueue,
  onDownloadHit,
  onAcquireAndPlay,
  onDownloadAlbum,
  onStreamHit,
  onCacheHit,
  onSelectArtist,
  onSelectAlbum,
  onSelectPlaylist,
  onPlayCatalogTrack,
  onRetryTrack,
  onPlayAlbum,
  onGoToArtistByName,
  onGoToAlbumByName,
  onAnalyzeStems,
  onRemoveLockerEntry,
  podcastHits = [],
  podcastCatalogHits = [],
  onPlayPodcast,
}: SearchResultsViewProps) {
  const { t } = useTranslation();
  const isMobileShell = useMobileShell();
  const sectionTabs = useMemo(
    (): Array<{ id: UnifiedSearchSection; label: string }> => [
      { id: 'all', label: t('searchResults.sectionAll') },
      { id: 'tracks', label: t('searchResults.sectionTracks') },
      { id: 'albums', label: t('searchResults.sectionAlbums') },
      { id: 'artists', label: t('searchResults.sectionArtists') },
      { id: 'playlists', label: t('searchResults.sectionPlaylists') },
    ],
    [t],
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [albumMenuOpen, setAlbumMenuOpen] = useState(false);
  const [trackSheetHit, setTrackSheetHit] = useState<ResolvedSearchHit | null>(null);
  const [downloadJobs, setDownloadJobs] = useState(() => getDownloadJobs());
  const [streamCacheTick, setStreamCacheTick] = useState(0);
  const { entries: lockerVaultEntries } = useLockerVault();

  useEffect(() => subscribeDownloadQueue(() => setDownloadJobs(getDownloadJobs())), []);
  useEffect(() => subscribeStreamCache(() => setStreamCacheTick((t) => t + 1)), []);
  void streamCacheTick;

  const isAlbumView = Boolean(albumContext);
  const showUnifiedTabs = !isAlbumView && Boolean(unified);
  const availableTabs = useMemo(() => {
    if (!unified) return sectionTabs.filter((tab) => tab.id === 'all' || tab.id === 'tracks');
    const tabs = sectionTabs.filter((tab) => unified.sections.includes(tab.id));
    if (unified.lockerItems.length > 0 && !tabs.some((tab) => tab.id === 'locker')) {
      tabs.splice(1, 0, { id: 'locker', label: t('searchResults.sectionLocker') });
    }
    return tabs;
  }, [unified, sectionTabs, t]);

  const displayHits = useMemo(
    () => (isAlbumView ? collapseAlbumHits(hits) : hits),
    [hits, isAlbumView],
  );

  const [catalogSupplementCredits, setCatalogSupplementCredits] = useState<string[]>([]);

  useEffect(() => {
    if (!isAlbumView || !albumContext) {
      setCatalogSupplementCredits([]);
      return;
    }
    const tracks = albumTracks ?? [];
    if (tracks.length === 0 || isAirGapEnabled()) {
      setCatalogSupplementCredits([]);
      return;
    }
    const guests = collectAlbumGuestArtists(albumContext.artist, tracks);
    if (guests.length > 0) {
      setCatalogSupplementCredits([]);
      return;
    }
    let cancelled = false;
    void fetchCatalogSupplementalArtistCredits(
      albumContext.title,
      albumContext.artist,
      tracks.map((track) => ({ title: track.title, artist: track.artist })),
    )
      .then((names) => {
        if (!cancelled) setCatalogSupplementCredits(names);
      })
      .catch(() => {
        if (!cancelled) setCatalogSupplementCredits([]);
      });
    return () => {
      cancelled = true;
    };
  }, [isAlbumView, albumContext, albumTracks]);

  const albumArtistCredits = useMemo(() => {
    if (!isAlbumView || !albumContext) return [];
    const base = collectAlbumArtistCredits(albumContext.artist, albumTracks ?? []);
    if (catalogSupplementCredits.length === 0) return base;
    return mergeAlbumArtistCreditLists(base, catalogSupplementCredits);
  }, [isAlbumView, albumContext, albumTracks, catalogSupplementCredits]);

  const albumPrimaryArtists = useMemo(() => {
    if (!isAlbumView || !albumContext) return [];
    const parsed = parseCatalogArtistBilling(albumContext.artist);
    return parsed.length > 0 ? parsed : [albumContext.artist];
  }, [isAlbumView, albumContext]);

  const albumArtIdentity = isAlbumView
    ? `${albumContext?.id ?? ''}|${albumContext?.artworkUrl ?? ''}`
    : '';
  const [albumArtFailedIdentity, setAlbumArtFailedIdentity] = useState<string | null>(null);
  const albumArtSrc = useMemo(() => {
    if (!isAlbumView || !albumContext?.artworkUrl) return null;
    if (albumArtFailedIdentity === albumArtIdentity) return null;
    return proxiedArtworkUrl(albumContext.artworkUrl) ?? albumContext.artworkUrl;
  }, [
    isAlbumView,
    albumContext?.artworkUrl,
    albumArtFailedIdentity,
    albumArtIdentity,
  ]);

  const albumDisplayYear = useMemo(() => {
    if (!isAlbumView) return undefined;
    if (albumContext?.releaseYear?.trim()) return albumContext.releaseYear.trim();
    const fromTrack = albumTracks?.find((t) => t.releaseYear?.trim())?.releaseYear?.trim();
    return fromTrack || undefined;
  }, [isAlbumView, albumContext?.releaseYear, albumTracks]);

  const albumRenderRows = useMemo(() => {
    if (!isAlbumView) return null;
    return buildAlbumRenderRows(
      displayHits,
      albumTracks,
      albumContext?.title,
      albumContext?.trackCount,
    );
  }, [isAlbumView, displayHits, albumTracks, albumContext?.title, albumContext?.trackCount]);

  const albumTrackCount = useMemo(() => {
    if (!isAlbumView) return displayHits.length;
    const meta = albumContext?.trackCount ?? 0;
    const listed = albumTracks?.length ?? 0;
    const rendered =
      albumRenderRows?.filter((row) => row.kind === 'track').length ?? displayHits.length;
    return Math.max(meta, listed, rendered);
  }, [isAlbumView, albumContext?.trackCount, albumTracks, albumRenderRows, displayHits.length]);

  const listRows: AlbumRenderRow[] = useMemo(
    () =>
      albumRenderRows ??
      displayHits.map((hit, index) => ({
        kind: 'track' as const,
        key: hit.identityId,
        hit,
        displayIndex: index + 1,
      })),
    [albumRenderRows, displayHits],
  );

  const [albumEditionVariants, setAlbumEditionVariants] = useState<CatalogAlbum[]>([]);
  useEffect(() => {
    if (!isAlbumView || !albumContext) {
      setAlbumEditionVariants([]);
      return;
    }
    let cancelled = false;
    void fetchCatalogAlbumEditionVariants(albumContext).then((variants) => {
      if (!cancelled) {
        setAlbumEditionVariants(variants.length > 1 ? variants : []);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAlbumView, albumContext]);

  const albumDownloadJob = useMemo(() => {
    if (!albumContext) return undefined;
    return findAlbumDownloadJob(albumContext.artist, albumContext.title, albumContext.id);
  }, [albumContext, downloadJobs]);

  const albumDownloadProgress = useMemo(() => {
    if (!albumDownloadJob) return null;
    return computeAlbumDownloadProgress(albumDownloadJob);
  }, [albumDownloadJob]);

  const showAlbumDownloadBar =
    isAlbumView &&
    albumDownloadJob &&
    albumDownloadProgress &&
    albumDownloadJob.status !== 'done' &&
    albumDownloadJob.status !== 'error';

  const toggleExpand = (id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const localCount = hits.filter((h) =>
    h.sources.some((s) => s.provider === 'local-vault'),
  ).length;

  const unifiedTotal =
    (unified?.tracks.length ?? 0) +
    (unified?.albums.length ?? 0) +
    (unified?.artists.length ?? 0) +
    (unified?.playlists.length ?? 0);

  const webSupplementTracks = useMemo(
    () => (unified?.tracks ?? []).filter((t) => t.id.startsWith('youtube-')),
    [unified?.tracks],
  );

  const catalogTrackRows = useMemo(
    () => (unified?.tracks ?? []).filter((t) => !t.id.startsWith('youtube-')),
    [unified?.tracks],
  );

  const streamableMatchesQuery = useMemo(
    () =>
      catalogSatisfiesTrackQuery(
        displayHits.map((h) => ({
          title: h.title,
          artist: h.artist,
          album: h.primaryEnvelope.album,
        })),
        query,
      ),
    [displayHits, query],
  );

  const webSupplementActive = webSupplementLoading || (unifiedLoading && needsWebTrackSupplement(query));

  const showWebSupplementHint =
    !isAlbumView &&
    needsWebTrackSupplement(query) &&
    !streamableMatchesQuery &&
    (webSupplementTracks.length > 0 || webSupplementActive || Boolean(webSupplementError));

  const hasVisibleResults =
    hits.length > 0 ||
    podcastHits.length > 0 ||
    podcastCatalogHits.length > 0 ||
    unifiedTotal > 0;

  const statusLine =
    (loading || unifiedLoading || webSupplementLoading) && !hasVisibleResults
      ? 'Searching…'
      : loading || unifiedLoading || webSupplementLoading
        ? webSupplementActive && webSupplementTracks.length === 0 && !webSupplementError
          ? t('searchResults.catalogReadySearching')
          : `${hits.length} streamable · ${unifiedTotal} indexed`
        : localCount > 0
          ? `${hits.length} streamable · ${unifiedTotal} indexed · ${localCount} on device`
          : `${hits.length} streamable · ${unifiedTotal} indexed`;

  const activateTrack = useCallback(
    (env: MediaEnvelope, candidates?: CandidateSource[]) => {
      if (onTrackTitleTap) onTrackTitleTap(env, candidates);
      else onPlay(env, candidates);
    },
    [onTrackTitleTap, onPlay],
  );

  const albumPlayEnvelopes = useMemo(() => {
    if (!isAlbumView) {
      return displayHits
        .map((hit) => hit.primaryEnvelope)
        .filter((env) => env.url?.trim());
    }
    return buildAlbumPlayQueueEnvelopes(
      displayHits,
      albumTracks,
      albumContext?.title,
      albumContext?.trackCount,
    ).filter((env) => env.url?.trim());
  }, [isAlbumView, displayHits, albumTracks, albumContext?.title, albumContext?.trackCount]);

  const playAlbumFromStart = useCallback(
    (shuffle: boolean) => {
      if (albumPlayEnvelopes.length === 0) return;
      if (onPlayAlbum) onPlayAlbum(albumPlayEnvelopes, shuffle);
      else onPlay(albumPlayEnvelopes[0], displayHits[0]?.sources);
    },
    [albumPlayEnvelopes, displayHits, onPlay, onPlayAlbum],
  );

  const buildTrackSheetActions = useCallback(
    (hit: ResolvedSearchHit): LockerMenuAction[] => {
      const lockerEntry = lockerVaultEntries.find(
        (e) =>
          lockerTitleMatches(e.title, hit.title) && lockerArtistMatches(e.artist, hit.artist),
      );
      const actions: LockerMenuAction[] = [
        {
          id: 'play',
          label: t('player.play'),
          onClick: () => onPlay(hit.primaryEnvelope, hit.sources),
        },
      ];
      if (onAnalyzeStems && lockerEntry) {
        actions.push({
          id: 'analyze-stems',
          label: t('stems.analyze'),
          onClick: () => onAnalyzeStems(lockerEntry.id),
        });
      }
      const hitArtist = (hit.artist ?? '').trim();
      if (onGoToArtistByName && hitArtist) {
        actions.push({
          id: 'go-artist',
          label: t('locker.menu.goToArtist'),
          onClick: () => onGoToArtistByName(hitArtist.split(',')[0]?.trim() || hitArtist),
        });
      }
      const albumTitle = albumContext?.title ?? albumTracks?.find((t) =>
        trackTitleKeysMatch(t.title, hit.title),
      )?.album;
      if (onGoToAlbumByName && albumTitle?.trim() && hitArtist) {
        actions.push({
          id: 'go-album',
          label: t('locker.menu.goToAlbum'),
          onClick: () =>
            onGoToAlbumByName(
              albumContext?.artist ?? hitArtist.split(',')[0]?.trim() ?? hitArtist,
              albumTitle,
            ),
        });
      }
      actions.push({
        id: 'queue',
        label: t('locker.menu.addToQueue'),
        onClick: () => onAddToQueue?.(hit.primaryEnvelope),
      });
      if (onStreamHit) {
        actions.push({
          id: 'stream',
          label: t('player.trackSheet.stream'),
          onClick: () => onStreamHit(hit),
        });
      }
      if (onCacheHit) {
        actions.push({
          id: 'cache',
          label: t('player.trackSheet.cache'),
          onClick: () => onCacheHit(hit),
        });
      }
      if (onDownloadHit) {
        actions.push({
          id: 'download',
          label: t('player.trackSheet.download'),
          onClick: () => onDownloadHit(hit, 'tracks'),
        });
      }
      if (onAcquireAndPlay && !isLocalId(hit.primaryEnvelope.envelopeId)) {
        actions.push({
          id: 'acquire-play',
          label: 'Acquire + play',
          onClick: () => onAcquireAndPlay(hit),
        });
      }
      if (lockerEntry && onRemoveLockerEntry) {
        actions.push({
          id: 'remove-locker',
          label: t('locker.menu.deleteTrack'),
          divider: true,
          danger: true,
          deferSheetClose: true,
          onClick: () =>
            onRemoveLockerEntry({ id: lockerEntry.id, title: lockerEntry.title }),
        });
      }
      actions.push({
        id: 'sources',
        label: t('player.trackSheet.sources'),
        onClick: () => toggleExpand(hit.identityId),
      });
      return actions;
    },
    [
      albumContext,
      albumTracks,
      lockerVaultEntries,
      onAddToQueue,
      onAnalyzeStems,
      onAcquireAndPlay,
      onCacheHit,
      onDownloadHit,
      onGoToAlbumByName,
      onGoToArtistByName,
      onPlay,
      onRemoveLockerEntry,
      onStreamHit,
      t,
    ],
  );

  const playCatalogTrack = useCallback(
    (track: CatalogTrack) => {
      if (!track.envelope) return;
      if (onPlayCatalogTrack) onPlayCatalogTrack(track);
      else activateTrack(track.envelope);
    },
    [activateTrack, onPlayCatalogTrack],
  );

  const renderCatalogTrackRow = (track: CatalogTrack) => {
    const title = displayLockerTrackTitle(track.title);
    if (isMobileShell) {
      return (
        <li key={track.id} className="catalog-list-row" data-testid={`catalog-track-row-${track.id}`}>
          <div className="catalog-track-row catalog-track-row--mobile">
            <button
              type="button"
              onClick={() => playCatalogTrack(track)}
              className="catalog-track-row-main touch-manipulation"
            >
              <CatalogArtThumb
                url={resolveCatalogTrackArtwork(track)}
                title={track.title}
                fallback={catalogTrackArtFallback(track)}
              />
              <div className="catalog-list-row-text">
                <p className="catalog-track-row-title">{title}</p>
                <p className="catalog-track-row-artist catalog-track-row-artist--full">
                  {track.artist}
                  {track.album ? ` · ${displayLockerTrackTitle(track.album)}` : ''}
                  {isLocalId(track.id) ? ' · Locker' : ''}
                </p>
              </div>
            </button>
            <div className="catalog-track-row-actions">
              <button
                type="button"
                data-testid={`catalog-track-play-${track.id}`}
                onClick={(event) => {
                  event.stopPropagation();
                  playCatalogTrack(track);
                }}
                className="search-results-action search-results-action--play touch-manipulation"
                aria-label={`Play ${title}`}
              >
                <Play className="w-4 h-4 ml-0.5" />
              </button>
              <button
                type="button"
                data-testid={`catalog-track-menu-${track.id}`}
                className="search-results-action search-results-action--menu touch-manipulation"
                aria-label={`Options for ${title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setTrackSheetHit(catalogTrackToResolvedHit(track));
                  setOpenMenuId(null);
                  setAlbumMenuOpen(false);
                }}
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          </div>
        </li>
      );
    }

    return (
      <li key={track.id} className="catalog-list-row">
        <button
          type="button"
          onClick={() => playCatalogTrack(track)}
          className="catalog-list-row-btn catalog-track-row touch-manipulation"
        >
          <CatalogArtThumb
            url={resolveCatalogTrackArtwork(track)}
            title={track.title}
            fallback={catalogTrackArtFallback(track)}
          />
          <div className="catalog-list-row-text">
            <p className="catalog-track-row-title">{title}</p>
            <p className="catalog-track-row-artist catalog-track-row-artist--full">
              {track.artist}
              {track.album ? ` · ${displayLockerTrackTitle(track.album)}` : ''}
              {isLocalId(track.id) ? ' · Locker' : ''}
            </p>
          </div>
          <Play className="w-4 h-4 shrink-0 catalog-track-row-play search-results-action--play" />
        </button>
      </li>
    );
  };

  const renderAlbumGridCard = (album: CatalogAlbum) => {
    const versionLabel = catalogAlbumVersionLabel(album, unified?.albums);
    return (
    <button
      key={album.id}
      type="button"
      onClick={() => onSelectAlbum?.(album)}
      className="catalog-album-grid-card touch-manipulation text-left"
    >
      {album.releaseYear ? (
        <p className="catalog-album-grid-year">{album.releaseYear}</p>
      ) : null}
      <div className="catalog-album-grid-art relative">
        <CatalogArtThumb
          url={resolveAlbumRowArtwork(album, unified?.tracks ?? [])}
          title={album.title}
          fallback={{ album: album.title, artist: album.artist }}
          className="catalog-album-grid-thumb"
        />
      </div>
      <p className="catalog-album-grid-title">{displayTrackTitle(album.title)}</p>
      {versionLabel ? (
        <p className="catalog-album-grid-version">{versionLabel}</p>
      ) : null}
      <p className="catalog-album-grid-meta">
        {album.artist}
        {album.releaseYear ? ` · ${album.releaseYear}` : ''}
        {album.trackCount ? ` · ${album.trackCount} tr` : ''}
      </p>
    </button>
    );
  };

  const renderAlbumRow = (album: CatalogAlbum) => (
    <li key={album.id} className="catalog-list-row">
      <button
        type="button"
        onClick={() => onSelectAlbum?.(album)}
        className="catalog-list-row-btn touch-manipulation"
      >
        <CatalogArtThumb
          url={resolveAlbumRowArtwork(album, unified?.tracks ?? [])}
          title={album.title}
          fallback={{ album: album.title, artist: album.artist }}
        />
        <div className="catalog-list-row-text">
          <p className="catalog-list-row-title">
            {displayTrackTitle(album.title)}
          </p>
          <p className="catalog-list-row-meta">
            Album · {album.artist}
            {album.releaseYear ? ` · ${album.releaseYear}` : ''}
            {isLocalId(album.id) ? ' · Locker' : ''}
          </p>
        </div>
      </button>
    </li>
  );

  const renderArtistRow = (artist: CatalogArtist) => (
    <li key={artist.id} className="catalog-list-row">
      <button
        type="button"
        onClick={() => onSelectArtist?.(artist)}
        className="catalog-list-row-btn touch-manipulation"
      >
        <CatalogArtThumb
          url={resolveArtistRowArtwork(
            artist,
            unified?.albums ?? [],
            unified?.tracks ?? [],
          )}
          title={artist.name}
          round
        />
        <div className="catalog-list-row-text">
          <p className="catalog-list-row-title">{artist.name}</p>
          <p className="catalog-list-row-meta">
            Artist{isLocalId(artist.id) ? ' · Locker' : ''}
          </p>
        </div>
      </button>
    </li>
  );

  const renderPlaylistRow = (playlist: UnifiedPlaylistResult) => (
    <li key={playlist.id} className="catalog-list-row">
      <button
        type="button"
        onClick={() => onSelectPlaylist?.(playlist)}
        className="catalog-list-row-btn touch-manipulation"
      >
        <div
          className="catalog-list-row-thumb catalog-list-row-thumb--placeholder"
          style={{ background: seedGradient(playlist.name) }}
        >
          <ListMusic className="w-4 h-4 text-text-primary/80" />
        </div>
        <div className="catalog-list-row-text">
          <p className="catalog-list-row-title">{playlist.name}</p>
          <p className="catalog-list-row-meta">
            Playlist · {playlist.trackCount} tracks
            {playlist.isSmart ? ' · Smart' : ''}
          </p>
        </div>
      </button>
    </li>
  );

  const renderUnifiedSection = () => {
    if (!unified || isAlbumView) return null;

    const showTracks =
      activeSection === 'all' || activeSection === 'tracks' || activeSection === 'locker';
    const showAlbums = activeSection === 'all' || activeSection === 'albums';
    const showArtists = activeSection === 'all' || activeSection === 'artists';
    const showPlaylists = activeSection === 'all' || activeSection === 'playlists';

    const trackList =
      activeSection === 'locker'
        ? unified.lockerItems
        : activeSection === 'tracks' && webSupplementTracks.length > 0
          ? [...webSupplementTracks, ...catalogTrackRows]
          : unified.tracks;

    const tracksSectionLabel =
      webSupplementTracks.length > 0 && catalogTrackRows.length === 0
        ? t('searchResults.sectionMoreResults')
        : webSupplementTracks.length > 0
          ? t('searchResults.sectionTracksMixed')
          : activeSection === 'locker'
            ? 'Locker Tracks'
            : t('searchResults.sectionTracks');

    return (
      <div className="mb-8">
        {showTracks && trackList.length > 0 && (
          <section>
            <SectionHeader label={tracksSectionLabel} />
            <ul className="catalog-list">{trackList.map(renderCatalogTrackRow)}</ul>
          </section>
        )}

        {showAlbums && unified.albums.length > 0 && (
          <section>
            <SectionHeader label="Albums" />
            <div className="catalog-album-grid">
              {unified.albums.map(renderAlbumGridCard)}
            </div>
          </section>
        )}

        {showArtists && unified.artists.length > 0 && (
          <section>
            <SectionHeader label="Artists" />
            <ul className="catalog-list">{unified.artists.map(renderArtistRow)}</ul>
          </section>
        )}

        {showPlaylists && unified.playlists.length > 0 && (
          <section>
            <SectionHeader label="Playlists" />
            <ul className="catalog-list">{unified.playlists.map(renderPlaylistRow)}</ul>
          </section>
        )}
      </div>
    );
  };

  return (
    <div className="search-results-page">
      {isMobileShell ? (
        <header className="mobile-shell-toolbar search-results-mobile-toolbar">
          <MobileShellBackButton onClick={onBack} />
        </header>
      ) : (
        <button
          type="button"
          onClick={onBack}
          className="locker-album-back touch-manipulation"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>
      )}

      <header
        className={`search-results-header${
          isAlbumView ? ' search-results-header--album' : ''
        }`}
      >
        <div className="search-results-header-top">
          <p className="font-mono text-[9px] uppercase tracking-[0.35em] text-accent">
            {isAlbumView ? 'Album' : 'Search Results'}
          </p>
          {isAlbumView && onDownloadAlbum ? (
            <div className="search-results-header-menu">
              <CatalogDownloadMenu
                label={albumContext!.title}
                open={albumMenuOpen}
                onOpenChange={(open) => {
                  setAlbumMenuOpen(open);
                  if (open) setOpenMenuId(null);
                }}
                onStream={
                  hits.length > 0
                    ? () => onPlay(hits[0].primaryEnvelope, hits[0].sources)
                    : undefined
                }
                streamLabel="Play first track"
                onDownload={(mode) => onDownloadAlbum(albumContext!, mode)}
              />
            </div>
          ) : null}
        </div>
        <div className="search-results-header-main">
          {isAlbumView ? (
            <div className="search-results-album-art-slot">
              <div
                className="search-results-album-art search-results-album-art--fallback"
                style={{ background: seedGradient(albumContext?.title ?? query) }}
                aria-hidden
              />
              {albumArtSrc ? (
                <img
                  src={albumArtSrc}
                  alt=""
                  className="search-results-album-art search-results-album-art--photo"
                  onError={() => setAlbumArtFailedIdentity(albumArtIdentity)}
                />
              ) : null}
            </div>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-tight truncate">
              {isAlbumView ? displayTrackTitle(albumContext!.title) : query || 'Awaiting Query'}
            </h1>
            {isAlbumView ? (
              <p className="text-xs text-slate-500 mt-1">
                <span className="search-results-album-byline">
                  {t('searchResults.albumBy', {
                    artists: formatCappedArtistLine(albumPrimaryArtists, undefined, (count) =>
                      t('searchResults.artistsAndMore', { count }),
                    ),
                  })}
                </span>
                {albumDisplayYear ? (
                  <span className="search-results-album-year"> · {albumDisplayYear}</span>
                ) : null}
              </p>
            ) : null}
            {!isAlbumView ? (
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <p
                  className={`font-mono text-[10px] uppercase ${
                    loading ? 'text-accent' : 'text-[var(--text-mid)]'
                  }`}
                >
                  {statusLine}
                </p>
                {fromCache && !loading && (
                  <span
                    className={`font-mono text-[8px] uppercase px-2 py-0.5 rounded border ${themeBadgeOutlineClass}`}
                  >
                    from cache
                  </span>
                )}
              </div>
            ) : null}
          </div>
        </div>
        {isAlbumView ? (
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <p
              className={`font-mono text-[10px] uppercase ${
                loading ? 'text-accent' : 'text-[var(--text-mid)]'
              }`}
            >
              {albumTrackCount} tracks
            </p>
            {fromCache && !loading && (
              <span
                className={`font-mono text-[8px] uppercase px-2 py-0.5 rounded border ${themeBadgeOutlineClass}`}
              >
                from cache
              </span>
            )}
          </div>
        ) : null}
        {isAlbumView && albumEditionVariants.length > 1 ? (
          <div
            className="locker-search-editions search-results-edition-picker"
            role="group"
            aria-label={t('searchResults.editionPickerAria')}
          >
            {albumEditionVariants.map((variant) => {
              const active =
                variant.collectionId != null &&
                albumContext?.collectionId != null &&
                variant.collectionId === albumContext.collectionId
                  ? true
                  : variant.id === albumContext?.id;
              const versionLabel = catalogAlbumVersionLabel(variant, albumEditionVariants);
              return (
                <button
                  key={variant.id}
                  type="button"
                  className={`locker-search-edition-pill touch-manipulation ${active ? 'locker-edition-pill--active' : ''}`}
                  onClick={() => {
                    if (!active) onSelectAlbum?.(variant);
                  }}
                >
                  <span>{displayTrackTitle(variant.title)}</span>
                  {versionLabel ? (
                    <span className="locker-search-edition-pill-meta">{versionLabel}</span>
                  ) : null}
                  {variant.releaseYear ? (
                    <span className="locker-search-edition-pill-meta">{variant.releaseYear}</span>
                  ) : null}
                  {variant.trackCount ? (
                    <span className="locker-search-edition-pill-meta">
                      {variant.trackCount} tr
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
        {showAlbumDownloadBar && albumDownloadProgress ? (
          <div
            className="album-download-progress"
            role="progressbar"
            aria-valuenow={albumDownloadProgress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Album download ${albumDownloadProgress.processed} of ${albumDownloadProgress.total} tracks processed, ${albumDownloadProgress.completed} saved`}
          >
            <div className="album-download-progress-meta">
              <span>
                {albumDownloadJob!.status === 'metadata'
                  ? 'Saving art & credits…'
                  : 'Downloading to locker'}
              </span>
              <span className="album-download-progress-count">
                {albumDownloadProgress.processed}/{albumDownloadProgress.total}
                {albumDownloadProgress.failed > 0
                  ? ` · ${albumDownloadProgress.failed} failed`
                  : ''}
              </span>
            </div>
            <div className="album-download-progress-track">
              <div
                className="album-download-progress-bar"
                style={{ width: `${albumDownloadProgress.percent}%` }}
              />
            </div>
          </div>
        ) : null}
        {isAlbumView && albumArtistCredits.length > 0 ? (
          <AlbumArtistCreditsSection
            artistCredits={albumArtistCredits}
            onGoToArtist={onGoToArtistByName}
          />
        ) : null}
        {isAlbumView && isMobileShell && albumPlayEnvelopes.length > 0 ? (
          <div className="locker-album-banner-actions">
            <button
              type="button"
              className="artist-btn artist-btn-primary touch-manipulation"
              onClick={() => playAlbumFromStart(false)}
            >
              <Play className="w-4 h-4 fill-current" />
              {t('locker.play')}
            </button>
            <button
              type="button"
              className="artist-btn artist-btn-primary touch-manipulation"
              onClick={() => playAlbumFromStart(true)}
            >
              <Shuffle className="w-4 h-4" />
              {t('locker.shuffle')}
            </button>
          </div>
        ) : null}
      </header>

      {showUnifiedTabs && availableTabs.length > 1 ? (
        <nav
          className="flex flex-wrap gap-2 mb-6"
          aria-label="Search result sections"
        >
          {availableTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSectionChange?.(tab.id)}
              className={`font-mono text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-md border touch-manipulation ${
                activeSection === tab.id
                  ? 'border-accent text-accent bg-accent/10'
                  : 'border-[var(--border)] text-[var(--text-mid)] hover:border-accent/40'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      ) : null}

      {renderUnifiedSection()}

      {showWebSupplementHint ? (
        <div
          className="mb-4 rounded-md border border-accent/30 bg-accent/5 px-3 py-2"
          role="status"
        >
          <p className="font-mono text-[10px] uppercase tracking-wide text-accent">
            {webSupplementError
              ? webSupplementError
              : webSupplementTracks.length > 0
                ? t('searchResults.notInCatalogReady')
                : t('searchResults.notInCatalogLoading')}
          </p>
          {query.trim() ? (
            <p className="text-xs text-[var(--text-mid)] mt-1">
              {t('searchResults.lookingForTrack', { title: query.trim() })}
            </p>
          ) : null}
        </div>
      ) : null}

      {!isAlbumView && podcastCatalogHits.length > 0 && (
        <section className="mb-6">
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-accent mb-2 flex items-center gap-1.5">
            <Podcast className="w-3.5 h-3.5" />
            Podcasts worldwide
          </p>
          <ul className="catalog-list">
            {podcastCatalogHits.map((hit) => {
              const active = hit.envelope.envelopeId === activeEnvelopeId;
              const art =
                proxiedArtworkUrl(hit.envelope.artworkUrl) ?? hit.envelope.artworkUrl;
              return (
                <li
                  key={hit.envelope.envelopeId}
                  className={`catalog-list-row${active ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onPlayPodcast?.(hit.envelope)}
                    className="catalog-list-row-btn touch-manipulation"
                  >
                    {art ? (
                      <img src={art} alt="" className="catalog-list-row-thumb" />
                    ) : (
                      <div
                        className="catalog-list-row-thumb catalog-list-row-thumb--placeholder"
                        style={{ background: seedGradient(hit.episode.feedTitle) }}
                      >
                        <Podcast className="w-4 h-4 text-text-primary/80" />
                      </div>
                    )}
                    <div className="catalog-list-row-text">
                      <p className="catalog-list-row-title">{hit.episode.title}</p>
                      <p className="catalog-list-row-meta">{hit.episode.feedTitle}</p>
                    </div>
                    <Play className="w-4 h-4 shrink-0 catalog-track-row-play search-results-action--play" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {!isAlbumView && podcastHits.length > 0 && (
        <section className="mb-6">
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-accent mb-2 flex items-center gap-1.5">
            <Podcast className="w-3.5 h-3.5" />
            Podcasts (your library{podcastHits.some((h) => h.transcriptSnippet) ? ' + transcripts' : ''})
          </p>
          <ul className="catalog-list">
            {podcastHits.map((hit) => {
              const active = hit.envelope.envelopeId === activeEnvelopeId;
              const art =
                proxiedArtworkUrl(hit.envelope.artworkUrl) ?? hit.envelope.artworkUrl;
              return (
                <li
                  key={hit.envelope.envelopeId}
                  className={`catalog-list-row${active ? ' is-active' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => onPlayPodcast?.(hit.envelope)}
                    className="catalog-list-row-btn touch-manipulation"
                  >
                    {art ? (
                      <img src={art} alt="" className="catalog-list-row-thumb" />
                    ) : (
                      <div
                        className="catalog-list-row-thumb catalog-list-row-thumb--placeholder"
                        style={{ background: seedGradient(hit.feedTitle) }}
                      >
                        <Podcast className="w-4 h-4 text-text-primary/80" />
                      </div>
                    )}
                    <div className="catalog-list-row-text">
                      <p className="catalog-list-row-title">{hit.episode.title}</p>
                      <p className="catalog-list-row-meta">
                        {hit.feedTitle}
                        {hit.transcriptSnippet ? (
                          <span className="block text-[10px] text-[var(--text-dim)] mt-0.5 line-clamp-2">
                            {hit.transcriptSnippet}
                          </span>
                        ) : null}
                      </p>
                    </div>
                    <Play className="w-4 h-4 shrink-0 catalog-track-row-play search-results-action--play" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {loading && hits.length === 0 && podcastHits.length === 0 && podcastCatalogHits.length === 0 && !unified?.tracks.length && (
        <div className="flex items-center gap-2 font-mono text-xs text-accent py-8">
          <Loader2 className="w-4 h-4 animate-spin" />
          Tier 1 vault · Tier 2 archive…
        </div>
      )}

      {!loading &&
        !unifiedLoading &&
        !webSupplementLoading &&
        hits.length === 0 &&
        podcastHits.length === 0 &&
        podcastCatalogHits.length === 0 &&
        !unifiedTotal && (
        <div className="py-12 space-y-4">
          <p className="font-mono text-xs text-[var(--text-dim)] text-center uppercase">
            No matches for this query.
          </p>
        </div>
      )}

      {!isAlbumView && hits.length > 0 && (activeSection === 'all' || activeSection === 'tracks') ? (
        <SectionHeader label="Streamable" />
      ) : null}

      {isAlbumView ? (
        <div className="search-results-album-head" aria-hidden>
          <span className="search-results-album-col-index">#</span>
          <span className="search-results-album-col-title">Title</span>
          <span className="search-results-album-col-time">Time</span>
          <span className="search-results-album-col-actions" />
        </div>
      ) : null}

      <ul className="search-results-list">
        {listRows.map((row, index) => {
          if (row.kind === 'disc-header') {
            return (
              <li
                key={row.key}
                className="search-results-disc-header"
                role="presentation"
              >
                <h2 className="search-results-disc-title">{row.label}</h2>
              </li>
            );
          }

          const hit = row.hit;
          const isActive = hit.primaryEnvelope.envelopeId === activeEnvelopeId;
          const isPlayingResolved =
            isActive &&
            playingEnvelope?.envelopeId === hit.primaryEnvelope.envelopeId;
          const isOpen = expanded[hit.identityId];
          const albumLabel =
            hit.primaryEnvelope.album ??
            hit.sources.find((s) => s.metadata?.album)?.metadata?.album;
          const isLocalPrimary = hit.sources.some((s) => s.provider === 'local-vault');
          const primaryTransport = isPlayingResolved
            ? displayTransportLabel(
                playingEnvelope!.provider,
                playingEnvelope!.transport,
                playingEnvelope!.url,
              )
            : displayTransportLabel(
                hit.primaryEnvelope.provider,
                hit.primaryEnvelope.transport,
                hit.primaryEnvelope.url,
              );
          const { job: trackDownloadJob, state: trackDownloadState } = isAlbumView
            ? resolveAlbumViewDownload(albumDownloadJob, hit, albumTracks)
            : {};
          const isTrackDownloading =
            trackDownloadState?.status === 'downloading' ||
            trackDownloadState?.status === 'resolving' ||
            trackDownloadState?.status === 'metadata' ||
            trackDownloadState?.status === 'pending';

          return (
            <li
              key={hit.identityId}
              data-testid={`search-result-row-${index}`}
              className={`search-results-row group ${isActive ? 'is-active' : ''} ${
                isAlbumView ? 'search-results-row--album' : ''
              }`}
              style={searchResultsRowStyle}
            >
              <div className="search-results-row-inner" style={searchResultsRowInnerStyle}>
                <span className="search-results-index" style={searchResultsIndexStyle}>
                  {row.displayIndex}
                </span>

                {!isAlbumView ? (
                  <CatalogArtThumb
                    url={resolveSearchHitArtwork(hit)}
                    title={hit.title}
                    fallback={searchHitArtFallback(hit)}
                    className="search-results-thumb"
                  />
                ) : null}

                <button
                  type="button"
                  onClick={() => activateTrack(hit.primaryEnvelope, hit.sources)}
                  className="search-results-main touch-manipulation"
                  style={searchResultsMainButtonStyle}
                >
                  <span className="search-results-text-stack">
                    <span
                      className={`search-results-title track-list-title ${
                        isActive ? 'is-active' : ''
                      }`}
                      style={{
                        color: isActive ? 'var(--accent-stroke)' : SEARCH_RESULTS_TEXT,
                      }}
                    >
                      {isAlbumView ? displayLockerTrackTitle(hit.title) : displayTrackTitle(hit.title)}
                    </span>
                    {isAlbumView ? (
                      resolveHitArtistCredits(hit, albumTracks) ? (
                        <span
                          className="search-results-artist track-list-meta search-results-artist--album"
                          style={searchResultsArtistTextStyle}
                        >
                          {resolveHitArtistCredits(hit, albumTracks)}
                        </span>
                      ) : null
                    ) : (
                      <span
                        className="search-results-artist track-list-meta"
                        style={searchResultsArtistTextStyle}
                      >
                        {hit.artist}
                        {albumLabel ? ` · ${displayTrackTitle(albumLabel)}` : ''}
                        {isLocalPrimary ? ' · local' : ''}
                      </span>
                    )}
                  </span>
                </button>

                {isAlbumView ? (
                  <div style={searchResultsDurationCellStyle}>
                    <AlbumTrackTimeCell
                      duration={formatHitDuration(hit, albumTracks)}
                      state={trackDownloadState}
                      lockerPlayable={vaultHasPlayableTrack(
                        lockerVaultEntries,
                        hit.title,
                        hit.artist,
                      )}
                      onRetry={
                        trackDownloadState?.status === 'error' &&
                        trackDownloadJob &&
                        onRetryTrack
                          ? () => {
                              const catalogTrack = albumTracks?.find(
                                (t) =>
                                  normalizeTrackTitle(t.title) === normalizeTrackTitle(hit.title),
                              );
                              const jobTrack = (
                                Object.values(trackDownloadJob.tracks) as TrackDownloadState[]
                              ).find(
                                (t) =>
                                  normalizeTrackTitle(t.title) === normalizeTrackTitle(hit.title),
                              );
                              const trackId = catalogTrack?.id ?? jobTrack?.trackId;
                              if (trackId) onRetryTrack(trackDownloadJob.id, trackId);
                            }
                          : undefined
                      }
                    />
                  </div>
                ) : null}

                <div className="search-results-actions" style={searchResultsActionsStyle}>
                  <div className="search-results-badges">
                    <span className="search-results-badge search-results-badge--transport">
                      {primaryTransport}
                    </span>
                    {isEnvelopeStreamCached(hit.primaryEnvelope) ? (
                      <span className={`search-results-badge ${themeBadgeOutlineClass}`}>CACHED</span>
                    ) : null}
                  </div>
                {isAlbumView ? (
                  <>
                    {!isMobileShell ? (
                      <TrackRowSources
                        envelopeId={hit.primaryEnvelope.envelopeId}
                        title={hit.title}
                        candidates={hit.sources}
                        baseEnvelope={hit.primaryEnvelope}
                        onPlay={onPlay}
                        open={openMenuId === `sources:${hit.identityId}`}
                        onOpenChange={(open) => {
                          setOpenMenuId(open ? `sources:${hit.identityId}` : null);
                          if (open) setAlbumMenuOpen(false);
                        }}
                        alwaysVisible={false}
                      />
                    ) : null}
                    {isMobileShell ? (
                      <button
                        type="button"
                        className="search-results-action search-results-action--menu touch-manipulation"
                        aria-label={`Options for ${hit.title}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setTrackSheetHit(hit);
                          setOpenMenuId(null);
                          setAlbumMenuOpen(false);
                        }}
                      >
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                    ) : onDownloadHit ? (
                      <CatalogDownloadMenu
                        label={hit.title}
                        open={openMenuId === hit.identityId}
                        onOpenChange={(open) => {
                          setOpenMenuId(open ? hit.identityId : null);
                          if (open) setAlbumMenuOpen(false);
                        }}
                        showAlbumOptions={false}
                        alwaysVisible={false}
                        onStream={onStreamHit ? () => onStreamHit(hit) : undefined}
                        onCache={onCacheHit ? () => onCacheHit(hit) : undefined}
                        onDownload={() => onDownloadHit(hit, 'tracks')}
                      />
                    ) : null}
                  {!isMobileShell ? (
                    <>
                      <button
                        type="button"
                        onClick={() => onAddToQueue?.(hit.primaryEnvelope)}
                        className="search-results-action touch-manipulation"
                        aria-label="Add to queue"
                      >
                        <ListPlus className="w-4 h-4" />
                      </button>
                      {!(isTrackDownloading) ? (
                        <button
                          type="button"
                          data-testid={`search-play-${index}`}
                          onClick={() => onPlay(hit.primaryEnvelope, hit.sources)}
                          className="search-results-action search-results-action--play touch-manipulation"
                          aria-label="Play"
                        >
                          <Play className="w-4 h-4 ml-0.5" />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggleExpand(hit.identityId)}
                        className="search-results-action touch-manipulation"
                        aria-label="Source breakdown"
                      >
                        {isOpen ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </>
                  ) : !(isTrackDownloading) ? (
                    <button
                      type="button"
                      data-testid={`search-play-${index}`}
                      onClick={() => onPlay(hit.primaryEnvelope, hit.sources)}
                      className="search-results-action search-results-action--play touch-manipulation"
                      aria-label="Play"
                    >
                      <Play className="w-4 h-4 ml-0.5" />
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  {onAcquireAndPlay && !isLocalId(hit.primaryEnvelope.envelopeId) && !isMobileShell ? (
                    <button
                      type="button"
                      data-testid={`search-acquire-play-${index}`}
                      onClick={() => onAcquireAndPlay(hit)}
                      className="search-results-action search-results-action--acquire touch-manipulation"
                      aria-label={`Acquire and play ${hit.title}`}
                      title="Acquire + play (offline when done)"
                    >
                      <HardDriveDownload className="w-4 h-4" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`search-play-${index}`}
                    onClick={() => onPlay(hit.primaryEnvelope, hit.sources)}
                    className="search-results-action search-results-action--play touch-manipulation"
                    aria-label="Play"
                  >
                    <Play className="w-4 h-4 ml-0.5" />
                  </button>
                  {isMobileShell ? (
                    <button
                      type="button"
                      data-testid={`search-result-menu-${index}`}
                      className="search-results-action search-results-action--menu touch-manipulation"
                      aria-label={`Options for ${hit.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        setTrackSheetHit(hit);
                        setOpenMenuId(null);
                        setAlbumMenuOpen(false);
                      }}
                    >
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  ) : (
                    <LockerMoreMenu
                      open={openMenuId === hit.identityId}
                      onOpenChange={(open) => {
                        setOpenMenuId(open ? hit.identityId : null);
                        if (open) setAlbumMenuOpen(false);
                      }}
                      actions={(() => {
                          const actions: LockerMenuAction[] = [
                            {
                              id: 'queue',
                              label: 'Add to queue',
                              onClick: () => onAddToQueue?.(hit.primaryEnvelope),
                            },
                            {
                              id: 'sources',
                              label: 'Alternate sources',
                              onClick: () => toggleExpand(hit.identityId),
                            },
                          ];
                          if (onStreamHit) {
                            actions.push({
                              id: 'stream',
                              label: 'Stream track',
                              onClick: () => onStreamHit(hit),
                            });
                          }
                          if (onCacheHit) {
                            actions.push({
                              id: 'cache',
                              label: 'Cache for offline',
                              onClick: () => onCacheHit(hit),
                            });
                          }
                          if (onDownloadHit) {
                            actions.push({
                              id: 'download',
                              label: 'Download to locker',
                              onClick: () => onDownloadHit(hit, 'tracks'),
                            });
                          }
                          if (onAcquireAndPlay && !isLocalId(hit.primaryEnvelope.envelopeId)) {
                            actions.push({
                              id: 'acquire-play',
                              label: 'Acquire + play',
                              onClick: () => onAcquireAndPlay(hit),
                            });
                          }
                          return actions;
                        })()}
                        ariaLabel={`Actions for ${hit.title}`}
                        align="right"
                        portaled
                        alwaysVisible
                        panelClassName="search-results-more-menu"
                      />
                  )}
                </>
              )}
                </div>
              </div>

              {isOpen && (
                <div className="search-results-sources">
                  {hit.sources.map((source) => {
                    const tLabel = displayTransportLabel(
                      source.provider,
                      source.transport,
                      source.uri,
                    );
                    let env: MediaEnvelope;
                    try {
                      env = resolveMediaEnvelope([source], source.id);
                    } catch {
                      return null;
                    }
                    return (
                      <div key={source.id} className="search-results-source-row">
                        <span
                          className={`search-results-source-label px-1.5 py-0.5 rounded border font-mono text-[9px] font-bold uppercase ${themeBadgeOutlineClass}`}
                        >
                          {tLabel}
                        </span>
                        <button
                          type="button"
                          onClick={() => onPlaySource(source, hit)}
                          className="search-results-source-play touch-manipulation"
                          aria-label={`Play via ${tLabel}`}
                        >
                          <Play className="w-3.5 h-3.5 ml-0.5" />
                          Play
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <MobileTrackActionSheet
        open={Boolean(trackSheetHit)}
        onClose={() => setTrackSheetHit(null)}
        title={
          trackSheetHit
            ? displayLockerTrackTitle(trackSheetHit.title)
            : ''
        }
        subtitle={trackSheetHit?.artist}
        actions={trackSheetHit ? buildTrackSheetActions(trackSheetHit) : []}
        ariaLabel={
          trackSheetHit
            ? `Options for ${displayLockerTrackTitle(trackSheetHit.title)}`
            : 'Track options'
        }
      />
    </div>
  );
}
