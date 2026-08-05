/**
 * Download job wiring for the shell — queue-revision subscription, tier/album/track/search-hit/
 * imported-playlist/mix download handlers, the imported-playlist stub rematch effect, and the
 * player-bar "download current track" helper. Extracted from sandboxLayer3 with no JSX; the
 * download sheets that render this state stay in the shell for now.
 *
 * Four call sites, none contiguous with each other:
 *
 *   1. useShellDownloadQueueBadge — where the `subscribeDownloadQueue` effect used to sit,
 *      right after `mobileNavBadges` (which reads `downloadQueueRevision` as a dependency) and
 *      before the `mobileDownloadBadge` / `podcastDownloadBadge` / `audiobookDownloadBadge`
 *      reads. Those reads stay in the shell — they call `getDownloadJobs()` directly and don't
 *      need anything from this hook.
 *   2. useShellDownloadHandlers — where `handleDownloadTierChange` used to start. Covers
 *      `handleDownloadAlbum`, `handleDownloadTrack`, `handleDownloadSearchHit`, the
 *      playlist-stub rematch effect (locker-driven, no external deps — it just needed to keep
 *      its place between the search-hit and imported-playlist handlers), and
 *      `handleDownloadImportedPlaylist`. Call this at the original `handleDownloadTierChange`
 *      position; nothing between these five declarations reads state that would create a
 *      temporal-dead-zone problem if they moved as a block.
 *   3. useShellDownloadMix — where `handleDownloadMix` used to start, immediately before
 *      `handleShareMix` (which stays — it shares the mix via `shareOrDownloadPlaylist`, not the
 *      download-job pipeline, so it isn't part of this slice). `handlePrepareForTravel` is
 *      threaded in rather than reimplemented here: it already lives in the shell and is shared
 *      with the "prepare for travel" flow.
 *   4. useShellDownloadCurrentTrack — where `downloadCurrentTrack` used to be declared, after
 *      `playerDownloadEnabled`. Needs `handleDownloadTrack` from call site 2, so it must be
 *      called after that hook's return is destructured — moving it earlier would read
 *      `handleDownloadTrack` before it exists.
 *
 * `downloadTierPreference` / `setDownloadTierPreference` and `downloadQueueRevision` /
 * `setDownloadQueueRevision` stay declared as state in the shell: `downloadTierPreference` is
 * read by several non-download call sites (search-hit acquisition, the E2E download handlers,
 * mix-radio save) and `downloadQueueRevision` only exists to retrigger `mobileNavBadges`. Both
 * are passed in rather than duplicated here.
 */

import { useCallback, useEffect, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { MediaEnvelope } from '../sandboxLayer1';
import { fetchAlbumTracks, type CatalogAlbum, type CatalogTrack } from '../searchCatalog';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { DiscoveryMix } from '../discoveryMixes';
import { loadPlaylists, savePlaylists, type StoredPlaylist } from '../playlistStorage';
import {
  getLockerEntriesSnapshot,
  lockerEntryIsPlayable,
  subscribeLockerCache,
} from '../lockerStorage';
import { lockerEntryToEnvelope } from '../smartPlaylistEngine';
import {
  scheduleCatalogAlbumDownload,
  scheduleCatalogTrackDownload,
  scheduleSearchHitDownload,
} from '../acquisitionPipeline';
import { resolveCatalogLockerCoverage } from '../downloadLockerPrecheck';
import { acquireImportedPlaylist, unmatchedImportStubs } from '../importPlaylistAcquisition';
import { rematchAllPlaylistStubsFromLocker } from '../playlistStubRematch';
import { subscribeDownloadQueue } from '../downloadQueue';
import { notifyAcquireProgress } from '../acquireProgressNotify';
import {
  enqueueDownloadJob,
  findAlbumDownloadJob,
  getActiveDownloadJobs,
  initJobTracks,
  patchDownloadJob,
  saveDownloadTierPreference,
  trackTitleKeysMatch,
  type DownloadMode,
  type DownloadTierPreference,
} from '../downloadQueue';

type Setter<T> = Dispatch<SetStateAction<T>>;

/** ---- 1. Queue-revision subscription ------------------------------------------------------- */

export type ShellDownloadQueueBadgeArgs = {
  setDownloadQueueRevision: Setter<number>;
};

export function useShellDownloadQueueBadge({
  setDownloadQueueRevision,
}: ShellDownloadQueueBadgeArgs) {
  useEffect(
    () => subscribeDownloadQueue(() => setDownloadQueueRevision((n) => n + 1)),
    [],
  );
}

/** ---- 2. Tier / album / track / search-hit / imported-playlist handlers -------------------- */

export type ShellDownloadHandlersArgs = {
  downloadTierPreference: DownloadTierPreference;
  setDownloadTierPreference: Setter<DownloadTierPreference>;
  albumDrillAlbum: CatalogAlbum | null;
  albumDrillAlbumRef: MutableRefObject<CatalogAlbum | null>;
  albumDrillTracksRef: MutableRefObject<CatalogTrack[]>;
  showMobileShell: boolean;
  showAppToast: (msg: string, durationMs?: number) => void;
};

export function useShellDownloadHandlers({
  downloadTierPreference,
  setDownloadTierPreference,
  albumDrillAlbum,
  albumDrillAlbumRef,
  albumDrillTracksRef,
  showMobileShell,
  showAppToast,
}: ShellDownloadHandlersArgs) {
  const handleDownloadTierChange = useCallback((tier: DownloadTierPreference) => {
    setDownloadTierPreference(tier);
    saveDownloadTierPreference(tier);
  }, []);

  const handleDownloadAlbum = useCallback(
    async (album: CatalogAlbum, mode: DownloadMode) => {
      const existing = findAlbumDownloadJob(album.artist, album.title, album.id);
      if (
        existing &&
        existing.status !== 'done' &&
        existing.status !== 'error'
      ) {
        showAppToast('Album already queued or downloading');
        return;
      }

      const drillAlbum = albumDrillAlbumRef.current;
      const drillTracks = albumDrillTracksRef.current;
      const sameDrillAlbum =
        drillAlbum &&
        (drillAlbum.id === album.id ||
          (drillAlbum.title.trim().toLowerCase() === album.title.trim().toLowerCase() &&
            drillAlbum.artist.trim().toLowerCase().includes(album.artist.trim().toLowerCase().split(',')[0] ?? '')));
      const albumWithCount: CatalogAlbum = {
        ...album,
        trackCount: Math.max(
          album.trackCount ?? 0,
          sameDrillAlbum ? (drillAlbum.trackCount ?? drillTracks.length) : 0,
        ),
      };
      let listing = await fetchAlbumTracks(albumWithCount);
      if (sameDrillAlbum && drillTracks.length > listing.length) {
        listing = drillTracks;
      }

      const albumName = mode === 'album' ? album.title : undefined;
      const coverage = await resolveCatalogLockerCoverage(albumWithCount, {
        listing,
        albumName,
      });

      if (coverage.listing.length > 0 && coverage.fullyInLocker) {
        showAppToast(`"${album.title}" is already in your Locker`);
        return;
      }

      if (coverage.needing.length > 0 && coverage.needing.length < coverage.listing.length) {
        showAppToast(
          `Downloading ${coverage.needing.length} missing track${coverage.needing.length === 1 ? '' : 's'}â€¦`,
        );
      }

      const job = enqueueDownloadJob({
        label: album.title,
        artist: album.artist,
        albumTitle: album.title,
        albumId: album.id,
        mode,
        tier: downloadTierPreference,
        totalTracks:
          coverage.needing.length > 0 ? coverage.needing.length : coverage.listing.length,
      });
      if (coverage.needing.length > 0) {
        initJobTracks(
          job.id,
          coverage.needing.map((t) => ({ id: t.id, title: t.title })),
        );
      }
      scheduleCatalogAlbumDownload(albumWithCount, mode, downloadTierPreference, job.id);
    },
    [downloadTierPreference, showAppToast],
  );

  const handleDownloadTrack = useCallback(
    (track: CatalogTrack, mode: DownloadMode) => {
      const job = enqueueDownloadJob({
        label: track.title,
        artist: track.artist,
        albumTitle: mode === 'album' ? track.album : undefined,
        mode,
        tier: downloadTierPreference,
        totalTracks: 1,
      });
      if (mode === 'album' && track.album) {
        const pseudoAlbum: CatalogAlbum = {
          kind: 'album',
          id: track.id,
          title: track.album,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
          releaseYear: track.releaseYear,
        };
        scheduleCatalogTrackDownload(track, downloadTierPreference, job.id, {
          album: pseudoAlbum,
          mode: 'album',
        });
        return;
      }
      scheduleCatalogTrackDownload(track, downloadTierPreference, job.id);
    },
    [downloadTierPreference],
  );

  const handleDownloadSearchHit = useCallback(
    (hit: ResolvedSearchHit, mode: DownloadMode) => {
      void mode;
      const catalogTrack = albumDrillTracksRef.current.find((t) =>
        trackTitleKeysMatch(t.title, hit.title),
      );
      const jobArtist =
        albumDrillAlbum?.artist ?? hit.primaryEnvelope.artist ?? hit.artist;
      if (albumDrillAlbum) {
        const activeAlbumJob = findAlbumDownloadJob(
          albumDrillAlbum.artist,
          albumDrillAlbum.title,
          albumDrillAlbum.id,
        );
        if (
          activeAlbumJob &&
          activeAlbumJob.status !== 'done' &&
          activeAlbumJob.status !== 'error'
        ) {
          showAppToast('Album download already in progress');
          return;
        }
      }
      const duplicateTrackJob = getActiveDownloadJobs().find(
        (j) =>
          j.mode === 'tracks' &&
          j.totalTracks <= 1 &&
          trackTitleKeysMatch(j.label, hit.title) &&
          j.artist.toLowerCase().includes(jobArtist.toLowerCase().split(',')[0] ?? ''),
      );
      if (duplicateTrackJob) {
        showAppToast('Track download already in progress');
        return;
      }
      const job = enqueueDownloadJob({
        label: catalogTrack?.title ?? hit.title,
        artist: jobArtist,
        albumTitle: albumDrillAlbum?.title ?? catalogTrack?.album ?? hit.primaryEnvelope.album,
        mode: 'tracks',
        tier: downloadTierPreference,
        totalTracks: 1,
      });
      notifyAcquireProgress(job);
      if (showMobileShell) {
        showAppToast('Downloading in background â€” tap â†“ for progress');
      }
      if (catalogTrack) {
        scheduleCatalogTrackDownload(catalogTrack, downloadTierPreference, job.id);
      } else {
        scheduleSearchHitDownload(
          hit.primaryEnvelope,
          downloadTierPreference,
          job.id,
          hit.sources,
        );
      }
    },
    [downloadTierPreference, albumDrillAlbum, showMobileShell, showAppToast],
  );

  /**
   * Re-link imported-playlist stubs to real locker entries whenever the locker changes.
   *
   * Importing a playlist creates stubs, then enqueues background downloads. The rematch
   * used to run once, immediately after acquisition returned â€” before those downloads had
   * actually landed â€” so nothing matched and imported playlists stayed permanently full of
   * unplayable stubs. Watching the locker instead links each track as it arrives.
   */
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const relink = () => {
      timer = null;
      void (async () => {
        const playlists = loadPlaylists();
        const hasStubs = playlists.some((pl) => unmatchedImportStubs(pl).length > 0);
        if (!hasStubs || disposed) return;
        const pool: MediaEnvelope[] = [];
        for (const entry of getLockerEntriesSnapshot() ?? []) {
          if (await lockerEntryIsPlayable(entry.id)) {
            pool.push(lockerEntryToEnvelope(entry));
          }
        }
        if (disposed || pool.length === 0) return;
        const { playlists: next, totalMatched } = rematchAllPlaylistStubsFromLocker(
          playlists,
          pool,
        );
        if (totalMatched > 0) savePlaylists(next);
      })();
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      // Debounced: a batch download fires many locker updates in quick succession.
      timer = setTimeout(relink, 1500);
    };

    schedule();
    const unsubscribe = subscribeLockerCache(schedule);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const handleDownloadImportedPlaylist = useCallback(
    (pl: StoredPlaylist) => {
      const remaining = unmatchedImportStubs(pl);
      if (remaining.length === 0) {
        showAppToast('All tracks already in Locker');
        return;
      }
      const job = enqueueDownloadJob({
        label: pl.name,
        artist: pl.importCreator ?? '',
        mode: 'tracks',
        tier: downloadTierPreference,
        totalTracks: remaining.length,
        playlistId: pl.id,
      });
      showAppToast(`Downloading ${remaining.length} tracks in backgroundâ€¦`);
      notifyAcquireProgress(job);
      void (async () => {
        try {
          const result = await acquireImportedPlaylist(
            pl,
            downloadTierPreference,
            job.id,
            (resolved, total) => {
              patchDownloadJob(job.id, {
                completedTracks: resolved,
                progress: Math.min(30, Math.round((resolved / Math.max(total, 1)) * 30)),
                currentTrack: resolved < total ? 'Resolving catalogâ€¦' : undefined,
              });
            },
          );
          const lockerPool: MediaEnvelope[] = [];
          for (const entry of getLockerEntriesSnapshot() ?? []) {
            if (await lockerEntryIsPlayable(entry.id)) {
              lockerPool.push(lockerEntryToEnvelope(entry));
            }
          }
          const rematch = rematchAllPlaylistStubsFromLocker(loadPlaylists(), lockerPool);
          if (rematch.totalMatched > 0) savePlaylists(rematch.playlists);
          const { acquisition, unresolved, tracks } = result;
          if (tracks.length === 0) {
            patchDownloadJob(job.id, {
              status: 'error',
              error: 'No tracks to download',
            });
            showAppToast('No tracks to download');
            return;
          }
          const parts = [
            `${acquisition.saved} saved`,
            acquisition.skipped > 0 ? `${acquisition.skipped} skipped` : '',
            acquisition.failed > 0 ? `${acquisition.failed} failed` : '',
            unresolved.length > 0 ? `${unresolved.length} not found` : '',
            rematch.totalMatched > 0 ? `${rematch.totalMatched} linked to playlist` : '',
          ].filter(Boolean);
          showAppToast(parts.join(' Â· '));
        } catch (err) {
          patchDownloadJob(job.id, { status: 'error', error: String(err) });
          showAppToast(err instanceof Error ? err.message : String(err));
        }
      })();
    },
    [downloadTierPreference, showAppToast],
  );

  return {
    handleDownloadTierChange,
    handleDownloadAlbum,
    handleDownloadTrack,
    handleDownloadSearchHit,
    handleDownloadImportedPlaylist,
  };
}

/** ---- 3. Mix-page download --------------------------------------------------------------- */

export type ShellDownloadMixArgs = {
  handlePrepareForTravel: (tracks: MediaEnvelope[]) => Promise<void>;
};

export function useShellDownloadMix({ handlePrepareForTravel }: ShellDownloadMixArgs) {
  /*
   * Download reuses the travel prefetch â€” "download" on a mix means make it playable offline,
   * not export a file â€” so it inherits the cellular/offline guards and progress toasts rather
   * than growing a second, subtly different caching path.
   */
  const handleDownloadMix = useCallback(
    (mix: DiscoveryMix) => {
      if (mix.tracks.length === 0) return;
      void handlePrepareForTravel(mix.tracks);
    },
    [handlePrepareForTravel],
  );

  return { handleDownloadMix };
}

/** ---- 4. Player-bar "download current track" ----------------------------------------------- */

export type ShellDownloadCurrentTrackArgs = {
  audioEnvelope: MediaEnvelope | null;
  audioTitle: string;
  audioArtist: string;
  homeTitle: string;
  homeArtist: string;
  homeAlbum: string | undefined;
  handleDownloadTrack: (track: CatalogTrack, mode: DownloadMode) => void;
};

export function useShellDownloadCurrentTrack({
  audioEnvelope,
  audioTitle,
  audioArtist,
  homeTitle,
  homeArtist,
  homeAlbum,
  handleDownloadTrack,
}: ShellDownloadCurrentTrackArgs) {
  const downloadCurrentTrack = useCallback(() => {
    const env = audioEnvelope;
    const title = env?.title?.trim() || audioTitle?.trim() || homeTitle.trim();
    if (!title) return;
    const envelopeId = env?.envelopeId || env?.sourceId || `track-${title}`;
    handleDownloadTrack(
      {
        kind: 'track',
        id: env?.sourceId || env?.envelopeId || envelopeId,
        title,
        artist: env?.artist || audioArtist || homeArtist,
        album: env?.album || homeAlbum,
        artworkUrl: env?.artworkUrl,
        durationSeconds: env?.durationSeconds,
        envelope:
          env ??
          ({
            envelopeId,
            title,
            artist: audioArtist || homeArtist,
            album: homeAlbum,
            url: '',
            provider: 'unknown',
            transport: 'element-src',
            sourceId: envelopeId,
            durationSeconds: 0,
          } as const),
      },
      'tracks',
    );
  }, [
    audioEnvelope,
    audioTitle,
    audioArtist,
    homeTitle,
    homeArtist,
    homeAlbum,
    handleDownloadTrack,
  ]);

  return { downloadCurrentTrack };
}
