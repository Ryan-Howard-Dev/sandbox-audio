/**
 * Pure builder for the E2E live-handlers object that sandboxLayer3 registers via
 * installE2eLiveHandlers. Moved out because the object literal itself (one playback/search/locker
 * verb per E2E driver action) is ~700 lines of closures with no JSX and no hook calls of its own —
 * every dependency below is either a ref, a setter, or a plain callback the shell already owns.
 *
 * Call buildE2eLiveHandlers(deps) from inside the *same* useEffect that used to contain this
 * object literal, at its original position in sandboxLayer3 (right after playEnvelopeRef is
 * declared, before the queue-restore/playback-heal hooks). Registration — installE2eLiveHandlers,
 * markE2ePlaybackHandlersLive, and the effect's dependency array — stays in the shell so the E2E
 * bridge is wired at exactly the same point in render order as before.
 *
 * A few deps (shortcutCtxRef, lastSkipOutcomeRef, setHeroDisplayMode) are declared later in
 * sandboxLayer3 than the effect's original position. That was already true before this extraction:
 * the effect callback only runs post-commit, by which point every const in the component body has
 * been assigned for that render, so referencing them here via closure is exactly as safe as it was
 * inline. Pass them through deps unchanged; do not try to move this call earlier than those
 * declarations expect.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AudioFsmState, CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { E2eHandlers } from '../e2eDevAction';
import type { CatalogAlbum, CatalogArtist, CatalogTrack } from '../searchCatalog';
import type { StationId } from './shellNav';
import type { DownloadMode, DownloadTierPreference } from '../downloadQueue';
import type { HeroDisplayMode } from '../heroDisplaySettings';
import type { PlaybackDisplayFields } from '../playbackSession';
import type { MixRadioSession } from '../playerMixRadio';
import type { RepeatMode } from '../queuePersistence';
import type { UnifiedSearchResult } from '../unifiedSearch';

import {
  resolveCatalogArtistByName,
  fetchArtistTopTracks,
  fetchAlbumTracks,
  resolveAlbumIntent,
  canonicalizeAlbumHint,
} from '../searchCatalog';
import { runUnifiedSearch } from '../unifiedSearch';
import { isAndroid } from '../platformEnv';
import { hasActiveMobileResolvers, ensureYtDlpMobileReady } from '../mobileResolverRegistry';
import { getYtDlpMobileStatus, waitForYtDlpInit } from '../ytDlpMobile';
import {
  prepareCleanPlaybackStop,
  waitForPlaybackStarted,
  waitForStablePlayback,
  waitForTrackTransition,
} from '../e2ePlaybackWait';
import { preserveTappedEnvelopeIdentity } from '../playbackPipeline';
import {
  findLockerEntryForTrack,
  findPlayableLockerEntryForTrack,
  findLockerEntryForTrackIncludingHollow,
  getLockerArtBlob,
  getLockerEntriesSnapshot,
  lockerTitleMatches,
  resolveLockerEnvelopeForPlayback,
} from '../lockerStorage';
import { ensureLockerPlayable } from '../play/ensureLockerPlayable';
import { attemptDeadLockerReacquire } from '../lockerDeadTrackReacquire';
import {
  loadHeroDisplayMode,
  saveHeroDisplayMode,
  toggleHeroDisplayMode,
} from '../heroDisplaySettings';
import { clickHomeVinylToggleButton, probeHeroVisualFromDom } from '../homeHeroPlayerLogic';
import { loadPlaylists } from '../playlistStorage';
import { enqueueDownloadJob, initJobTracks, trackTitleKeysMatch } from '../downloadQueue';
import { scheduleCatalogAlbumDownload, scheduleCatalogTrackDownload } from '../acquisitionPipeline';
import { filterTracksNeedingDownload } from '../downloadLockerPrecheck';
import { clearLastPlayIntent } from '../lastPlayIntent';

export type E2eLiveHandlersDeps = {
  audio: UseAudioFSMResult;
  playEnvelopeRef: MutableRefObject<
    (
      env: MediaEnvelope,
      candidates?: CandidateSource[],
      options?: {
        autoPlay?: boolean;
        seedSearchQueue?: boolean;
        seedSearchEnvelope?: MediaEnvelope;
        seamless?: boolean;
        preservePlayQueue?: boolean;
      },
    ) => Promise<boolean>
  >;
  setHomeAwaitingUserResume: Dispatch<SetStateAction<boolean>>;
  setSelectedArtist: Dispatch<SetStateAction<CatalogArtist | null>>;
  setStation: Dispatch<SetStateAction<StationId>>;
  setNavOpen: Dispatch<SetStateAction<boolean>>;
  runSearch: (
    q: string,
    options?: { preserveArtist?: boolean; albumHint?: CatalogAlbum; albumDrill?: boolean },
  ) => Promise<number | void>;
  searchLoadingRef: MutableRefObject<boolean>;
  albumDrillTracksRef: MutableRefObject<CatalogTrack[]>;
  unifiedSearchResultRef: MutableRefObject<UnifiedSearchResult>;
  setAlbumDrillTracks: Dispatch<SetStateAction<CatalogTrack[]>>;
  setAlbumDrillAlbum: Dispatch<SetStateAction<CatalogAlbum | null>>;
  setAlbumDrillQuery: Dispatch<SetStateAction<string | null>>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioCurrentTimeRef: MutableRefObject<number>;
  audioDurationRef: MutableRefObject<number>;
  audioStateRef: MutableRefObject<AudioFsmState>;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  navigateSearchQuery: (rawQuery: string) => void;
  nowPlayingDisplayRef: MutableRefObject<PlaybackDisplayFields | null>;
  authoritativeEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  sessionEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndexRef: MutableRefObject<number>;
  /** Only skipForward is called from here — the full shortcut context lives in useShellMediaSessionWiring. */
  shortcutCtxRef: MutableRefObject<{ skipForward: () => void }>;
  lastSkipOutcomeRef: MutableRefObject<
    '' | 'remote' | 'seek' | 'none' | 'no-track' | 'in-place' | 'advance'
  >;
  handleThumbUp: () => void;
  handleThumbDown: () => void;
  setHeroDisplayMode: Dispatch<SetStateAction<HeroDisplayMode>>;
  handleShellBackRef: MutableRefObject<() => boolean>;
  setMobileNowPlayingOpen: Dispatch<SetStateAction<boolean>>;
  downloadTierPreference: DownloadTierPreference;
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  logLockerQueueInstrumentation: (
    phase: string,
    selectedSourceId: string | undefined,
    selectedIndex: number,
    envs: MediaEnvelope[],
  ) => void;
  primeLockerNativeQueueFrom: (tracks: MediaEnvelope[], fromIndex: number) => Promise<void>;
  persistLockerPlayRepair: (tapped: MediaEnvelope, playable: MediaEnvelope) => void;
  setMobilePlayerPending: Dispatch<SetStateAction<boolean>>;
};

export function buildE2eLiveHandlers(deps: E2eLiveHandlersDeps): E2eHandlers {
  const {
    audio,
    playEnvelopeRef,
    setHomeAwaitingUserResume,
    setSelectedArtist,
    setStation,
    setNavOpen,
    runSearch,
    searchLoadingRef,
    albumDrillTracksRef,
    unifiedSearchResultRef,
    setAlbumDrillTracks,
    setAlbumDrillAlbum,
    setAlbumDrillQuery,
    audioEnvelopeRef,
    audioCurrentTimeRef,
    audioDurationRef,
    audioStateRef,
    setPlayQueue,
    setQueueIndex,
    navigateSearchQuery,
    nowPlayingDisplayRef,
    authoritativeEnvelopeRef,
    sessionEnvelopeRef,
    playQueueRef,
    queueIndexRef,
    shortcutCtxRef,
    lastSkipOutcomeRef,
    handleThumbUp,
    handleThumbDown,
    setHeroDisplayMode,
    handleShellBackRef,
    setMobileNowPlayingOpen,
    downloadTierPreference,
    setMixRadioSession,
    setShuffleOn,
    setRepeatMode,
    autoSimilarRadioSeedRef,
    logLockerQueueInstrumentation,
    primeLockerNativeQueueFrom,
    persistLockerPlayRepair,
    setMobilePlayerPending,
  } = deps;

  const matchTrackTitle = (tracks: CatalogTrack[], title: string) =>
    tracks.find((t) => t.title.trim().toLowerCase() === title.trim().toLowerCase());

  const playViaMobileFallback = async (
    artistName: string,
    trackTitle: string,
    albumTitle?: string,
  ): Promise<boolean> => {
    ensureYtDlpMobileReady();
    const ready = await waitForYtDlpInit(90_000);
    if (!ready) return false;
    const env: MediaEnvelope = {
      envelopeId: `e2e-mobile-${Date.now()}`,
      title: trackTitle,
      artist: artistName,
      album: albumTitle,
      url: '',
      durationSeconds: 0,
      provider: 'https',
      transport: 'element-src',
      sourceId: `e2e-${trackTitle}`,
    };
    console.warn(
      `[E2E mobile-fallback] play ${JSON.stringify({
        artist: artistName,
        album: albumTitle ?? '',
        track: trackTitle,
      })}`,
    );
    return playEnvelopeRef.current(env, undefined, { autoPlay: true });
  };

  const resolveAlbumTracksForE2e = async (
    artistName: string,
    albumTitle: string,
    album: CatalogAlbum,
  ): Promise<CatalogTrack[]> => {
    const intent = await resolveAlbumIntent(`${artistName} ${albumTitle}`);
    const hinted = intent?.album ?? album;
    const canonical = await canonicalizeAlbumHint(hinted);
    setAlbumDrillAlbum(canonical);
    setAlbumDrillQuery(`${artistName} ${albumTitle}`);

    await runSearch(`${artistName} ${albumTitle}`, {
      albumHint: canonical,
      preserveArtist: true,
      albumDrill: true,
    });
    const searchDeadline = Date.now() + 120_000;
    while (Date.now() < searchDeadline) {
      if (!searchLoadingRef.current) {
        const fromDrill = albumDrillTracksRef.current;
        if (fromDrill.length > 0) {
          setAlbumDrillTracks(fromDrill);
          return fromDrill;
        }
        const fromUnified = unifiedSearchResultRef.current.tracks.filter(
          (t) =>
            t.album &&
            (t.album.trim().toLowerCase() === albumTitle.trim().toLowerCase() ||
              t.album.trim().toLowerCase().includes(albumTitle.trim().toLowerCase())),
        );
        if (fromUnified.length > 0) {
          setAlbumDrillTracks(fromUnified);
          return fromUnified;
        }
      }
      await new Promise((r) => window.setTimeout(r, 500));
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const fetched = await fetchAlbumTracks(canonical);
      if (fetched.length > 0) {
        setAlbumDrillTracks(fetched);
        return fetched;
      }
      if (attempt < 2) {
        await new Promise((r) => window.setTimeout(r, 2000 * (attempt + 1)));
      }
    }
    return albumDrillTracksRef.current;
  };

  const playAlbumTrackImpl = async (
    artistName: string,
    albumTitle: string,
    trackTitle: string,
  ): Promise<boolean> => {
    setHomeAwaitingUserResume(false);
    const album: CatalogAlbum = {
      kind: 'album',
      id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      title: albumTitle,
      artist: artistName,
    };
    setSelectedArtist(null);
    setAlbumDrillAlbum(album);
    setStation('search');
    setNavOpen(false);
    const canonical = await canonicalizeAlbumHint(album);
    setAlbumDrillAlbum(canonical);
    let tracks = await fetchAlbumTracks(canonical);
    if (tracks.length === 0) {
      tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, canonical);
    } else {
      setAlbumDrillTracks(tracks);
    }
    let hit = matchTrackTitle(tracks, trackTitle);
    if (!hit?.envelope) {
      const top = await fetchArtistTopTracks(artistName, undefined, 80);
      const albumKey = albumTitle.trim().toLowerCase();
      hit = top.find(
        (t) =>
          t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase() &&
          (t.album?.trim().toLowerCase().includes(albumKey) ?? false),
      );
    }
    if (!hit?.envelope) {
      const searchResult = await runUnifiedSearch(`${artistName} ${albumTitle} ${trackTitle}`, {
        limit: 16,
      });
      hit = searchResult.tracks.find(
        (t) => t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase(),
      );
    }
    if (hit?.envelope) {
      if (isAndroid() && hasActiveMobileResolvers()) {
        ensureYtDlpMobileReady();
        await waitForYtDlpInit();
      }
      const tapped: MediaEnvelope = {
        ...hit.envelope,
        title: hit.title,
        artist: artistName,
        album: albumTitle,
      };
      return playEnvelopeRef.current(tapped, undefined, {
        autoPlay: true,
        seedSearchQueue: true,
      });
    }
    return playViaMobileFallback(artistName, trackTitle, albumTitle);
  };

  return {
    playArtistTrack: async (artistName, trackTitle) => {
      setHomeAwaitingUserResume(false);
      const artist = await resolveCatalogArtistByName(artistName);
      setSelectedArtist(artist);
      setStation('search');
      setNavOpen(false);
      const topTracks = await fetchArtistTopTracks(artist.name, artist.id, 50);
      let hit = matchTrackTitle(topTracks, trackTitle);
      if (!hit?.envelope) {
        const searchResult = await runUnifiedSearch(`${artistName} ${trackTitle}`, { limit: 16 });
        hit = searchResult.tracks.find(
          (t) => t.title.trim().toLowerCase() === trackTitle.trim().toLowerCase(),
        );
      }
      if (hit?.envelope) {
        if (isAndroid() && hasActiveMobileResolvers()) {
          ensureYtDlpMobileReady();
          const ytdlp = await getYtDlpMobileStatus();
          if (!ytdlp.initialized) await waitForYtDlpInit();
        }
        const tapped: MediaEnvelope = {
          ...hit.envelope,
          title: hit.title,
          artist: artistName,
        };
        return playEnvelopeRef.current(tapped, undefined, {
          autoPlay: true,
          seedSearchQueue: true,
        });
      }
      return playViaMobileFallback(artistName, trackTitle);
    },
    playAlbumTrack: playAlbumTrackImpl,
    playAlbumSequence: async (artistName, albumTitle, count) => {
      await prepareCleanPlaybackStop(() => audio.stop());

      const album: CatalogAlbum = {
        kind: 'album',
        id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: albumTitle,
        artist: artistName,
      };
      const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
      const slice = tracks.slice(0, count);
      if (slice.length < count) {
        console.warn(
          `[album-sequence] insufficient tracks want=${count} got=${slice.length}`,
          slice.map((t) => t.title),
        );
        return false;
      }

      if (isAndroid() && hasActiveMobileResolvers()) {
        ensureYtDlpMobileReady();
        await waitForYtDlpInit(90_000);
      }

      const queueEnvelopes: MediaEnvelope[] = slice.map((t, i) => {
        if (t.envelope) {
          return preserveTappedEnvelopeIdentity(
            {
              ...t.envelope,
              title: t.title,
              artist: artistName,
              album: albumTitle,
            },
            t.envelope,
          );
        }
        return {
          envelopeId: `seq-${albumTitle}-${i}-${t.id ?? t.title}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: t.title,
          artist: artistName,
          album: albumTitle,
          url: '',
          durationSeconds: t.durationSeconds ?? 0,
          provider: 'https',
          transport: 'element-src',
          sourceId: t.id ?? t.title,
        };
      });
      setPlayQueue(queueEnvelopes);

      for (let i = 0; i < slice.length; i += 1) {
        const expectedTitle = slice[i]!.title;
        const queueEnv = queueEnvelopes[i]!;
        if (i > 0) {
          await prepareCleanPlaybackStop(() => audio.stop());
        }
        setQueueIndex(i);
        setHomeAwaitingUserResume(false);
        const started = await playEnvelopeRef.current(queueEnv, undefined, { autoPlay: true });
        if (!started) {
          console.warn(`[album-sequence] play failed index=${i} title=${expectedTitle}`);
          return false;
        }
        const nudgePlayback = async () => {
          audio.primePlaybackGesture();
          await audio.play();
        };
        const playing = await waitForPlaybackStarted({
          expectedTitle,
          getProbeTitle: () => audioEnvelopeRef.current?.title,
          getProbePosition: () => audioCurrentTimeRef.current,
          getProbeDuration: () => audioDurationRef.current,
          getProbeState: () => audioStateRef.current,
          timeoutMs: 240_000,
          onStuck: nudgePlayback,
        });
        if (!playing) {
          console.warn(`[album-sequence] start failed index=${i} title=${expectedTitle}`);
          return false;
        }
        const stable = await waitForStablePlayback({
          expectedTitle,
          getProbeTitle: () => audioEnvelopeRef.current?.title,
          getUiPosition: () => audioCurrentTimeRef.current,
          getUiState: () => audioStateRef.current,
          minAdvanceSecs: 1.5,
          timeoutMs: 120_000,
          onStuck: nudgePlayback,
        });
        if (!stable) {
          console.warn(`[album-sequence] unstable index=${i} title=${expectedTitle}`);
          return false;
        }
      }
      return true;
    },
    openAlbum: async (artistName, albumTitle) => {
      setHomeAwaitingUserResume(false);
      const album: CatalogAlbum = {
        kind: 'album',
        id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: albumTitle,
        artist: artistName,
      };
      setSelectedArtist(null);
      setAlbumDrillQuery(`${artistName} ${albumTitle}`);
      setAlbumDrillAlbum(album);
      setStation('search');
      setNavOpen(false);
      const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
      return tracks.length > 0;
    },
    openSearchArtist: (name) => {
      navigateSearchQuery(name);
      return true;
    },
    listAlbumTracks: () =>
      albumDrillTracksRef.current.map((t) => ({ title: t.title, id: t.id })),
    getPlaybackProbe: () => {
      // Report the identity the screen is showing, not the one being resolved: this probe exists
      // to catch the two drifting apart, and reading audio.envelope here made it agree with the
      // bug instead of detecting it.
      const shown = nowPlayingDisplayRef.current;
      const env =
        authoritativeEnvelopeRef.current ??
        audio.envelope ??
        audioEnvelopeRef.current ??
        sessionEnvelopeRef.current;
      return {
        title: shown?.title?.trim() || env?.title?.trim() || audio.title?.trim() || '',
        artist: shown?.artist?.trim() || env?.artist?.trim() || audio.artist?.trim() || '',
        album: shown?.album || env?.album,
        envelopeId: shown?.envelopeId || env?.envelopeId,
        state: audioStateRef.current,
        positionSecs: audioCurrentTimeRef.current,
        durationSecs: audioDurationRef.current,
        artworkUrl: shown?.artworkUrl || env?.artworkUrl,
        bitrateKbps: env?.bitrateKbps,
        nativeState:
          audio.nativeExoActive && audio.nativeExoEffectivePlaying
            ? 'playing'
            : audio.nativeExoActive
              ? 'active'
              : undefined,
      };
    },
    getQueueProbe: () => {
      const queue = playQueueRef.current ?? [];
      return {
        index: queueIndexRef.current,
        length: queue.length,
        envelopeIds: queue.map((t) => t?.envelopeId ?? ''),
      };
    },
    // The same action the player button, car mode and media shortcuts call — routed through
    // shortcutCtxRef like those do, so this probe cannot drift from what a user's tap does.
    skipNext: () => {
      const queue = playQueueRef.current ?? [];
      if (queue.length < 2) return { ok: false, outcome: 'queue-too-short' };
      shortcutCtxRef.current.skipForward();
      const outcome = lastSkipOutcomeRef.current;
      return { ok: outcome === 'advance' || outcome === 'in-place', outcome };
    },
    thumbUpCurrent: () => {
      const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
      if (!env?.envelopeId?.trim()) return false;
      handleThumbUp();
      return true;
    },
    thumbDownCurrent: () => {
      const env = audio.envelope ?? audioEnvelopeRef.current ?? sessionEnvelopeRef.current;
      if (!env?.envelopeId?.trim()) return false;
      handleThumbDown();
      return true;
    },
    toggleVinylMode: () => {
      const next = toggleHeroDisplayMode();
      setHeroDisplayMode(next);
      return next;
    },
    setHeroDisplayMode: (mode) => {
      saveHeroDisplayMode(mode);
      setHeroDisplayMode(mode);
    },
    getHeroDisplayMode: () => loadHeroDisplayMode(),
    getHeroVisualProbe: () => probeHeroVisualFromDom(),
    clickHomeVinylToggle: () => clickHomeVinylToggleButton(),
    pausePlayback: () => audio.pause(),
    resumePlayback: async () => {
      audio.primePlaybackGesture();
      await audio.play({ userGesture: true });
    },
    shellBack: () => handleShellBackRef.current(),
    openMobileNowPlaying: () => setMobileNowPlayingOpen(true),
    closeMobileNowPlaying: () => setMobileNowPlayingOpen(false),
    openVinylSettingsSheet: () => {
      const btn = document.querySelector('[data-testid="home-vinyl-settings-btn"]');
      if (!btn) return false;
      btn.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      return true;
    },
    downloadTrack: async (artistName, trackTitle, mode = 'tracks', albumTitle) => {
      let track: CatalogTrack | undefined;
      const matchTitle = (tracks: CatalogTrack[], title: string) =>
        tracks.find((t) => trackTitleKeysMatch(t.title, title));

      if (albumTitle) {
        const album: CatalogAlbum = {
          kind: 'album',
          id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          title: albumTitle,
          artist: artistName,
        };
        const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
        track = matchTitle(tracks, trackTitle);
      }
      if (!track) {
        const artist = await resolveCatalogArtistByName(artistName);
        const topTracks = await fetchArtistTopTracks(artist.name, artist.id, 80);
        track = matchTitle(topTracks, trackTitle);
      }
      if (!track) {
        const searchResult = await runUnifiedSearch(`${artistName} ${trackTitle}`, { limit: 12 });
        track = searchResult.tracks.find((t) => trackTitleKeysMatch(t.title, trackTitle));
      }
      if (!track) return false;
      const downloadMode: DownloadMode = mode === 'album' && albumTitle ? 'album' : 'tracks';
      const job = enqueueDownloadJob({
        label: track.title,
        artist: track.artist,
        albumTitle: downloadMode === 'album' ? albumTitle : undefined,
        mode: downloadMode,
        tier: downloadTierPreference,
        totalTracks: downloadMode === 'album' ? 0 : 1,
      });
      initJobTracks(job.id, [{ id: track.id, title: track.title }]);
      if (downloadMode === 'album' && albumTitle) {
        const pseudoAlbum: CatalogAlbum = {
          kind: 'album',
          id: track.id,
          title: albumTitle,
          artist: track.artist,
          artworkUrl: track.artworkUrl,
          releaseYear: track.releaseYear,
        };
        scheduleCatalogTrackDownload(track, downloadTierPreference, job.id, {
          album: pseudoAlbum,
          mode: 'album',
        });
      } else {
        scheduleCatalogTrackDownload(track, downloadTierPreference, job.id);
      }
      return true;
    },
    downloadAlbum: async (artistName, albumTitle) => {
      const album: CatalogAlbum = {
        kind: 'album',
        id: `album-${artistName}-${albumTitle}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: albumTitle,
        artist: artistName,
      };
      const tracks = await resolveAlbumTracksForE2e(artistName, albumTitle, album);
      if (tracks.length === 0) return false;
      const precheck = await filterTracksNeedingDownload(tracks, album.title);
      if (precheck.needing.length === 0) {
        console.log(
          `[SandboxE2E] AREA=download-album RESULT=PASS artist=${artistName} album=${albumTitle} skipped=all-in-locker tracks=${precheck.total}`,
        );
        return true;
      }
      const job = enqueueDownloadJob({
        label: album.title,
        artist: album.artist,
        albumTitle: album.title,
        albumId: album.id,
        mode: 'album',
        tier: downloadTierPreference,
        totalTracks: precheck.needing.length,
      });
      initJobTracks(
        job.id,
        precheck.needing.map((t) => ({ id: t.id, title: t.title })),
      );
      scheduleCatalogAlbumDownload(album, 'album', downloadTierPreference, job.id);
      return true;
    },
    playLockerTrack: async (artistName, trackTitle, albumTitle) => {
      setHomeAwaitingUserResume(false);
      const snapshot = getLockerEntriesSnapshot() ?? [];
      let entry =
        (albumTitle?.trim()
          ? findLockerEntryForTrack(trackTitle, artistName, albumTitle, snapshot)
          : undefined) ?? null;
      if (!entry) {
        entry = await findPlayableLockerEntryForTrack(trackTitle, artistName, albumTitle, snapshot);
      }
      if (!entry) {
        entry =
          findLockerEntryForTrackIncludingHollow(trackTitle, artistName, albumTitle, snapshot) ??
          null;
      }
      const seed = {
        envelopeId: entry ? `local-${entry.id}` : '',
        title: trackTitle,
        artist: artistName,
        album: albumTitle ?? entry?.albumName,
        durationSeconds: entry?.durationSeconds ?? 0,
        provider: 'local-vault' as const,
        transport: 'element-src' as const,
        sourceId: entry?.id ?? '',
        url: entry?.url ?? '',
      };
      const locker = await ensureLockerPlayable(seed);
      if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) {
        await attemptDeadLockerReacquire(trackTitle, artistName, albumTitle);
        return false;
      }
      const playable = preserveTappedEnvelopeIdentity(
        {
          ...seed,
          url: locker.envelope.url,
          artworkUrl: locker.envelope.artworkUrl,
        },
        locker.envelope,
      );
      return playEnvelopeRef.current(playable, undefined, {
        autoPlay: true,
        seedSearchQueue: true,
      });
    },
    playPlaylistTrack: async (playlistName, trackTitle) => {
      setHomeAwaitingUserResume(false);
      const pl = loadPlaylists().find((p) =>
        p.name.toLowerCase().includes(playlistName.toLowerCase()),
      );
      if (!pl) return false;
      const track = pl.tracks.find((t) => lockerTitleMatches(t.title, trackTitle));
      if (!track) return false;
      const entry = await findPlayableLockerEntryForTrack(
        track.title,
        track.artist,
        track.album,
        getLockerEntriesSnapshot(),
      );
      const resolved = await resolveLockerEnvelopeForPlayback({
        ...track,
        provider: 'local-vault',
        url: '',
        sourceId: entry?.id ?? track.sourceId,
      });
      if (!resolved?.url?.trim()) return false;
      const playable = preserveTappedEnvelopeIdentity(track, resolved);
      persistLockerPlayRepair(track, playable);
      return playEnvelopeRef.current(playable, undefined, {
        autoPlay: true,
        seedSearchQueue: true,
      });
    },
    probePlaylistTrack: async (playlistName, trackTitle) => {
      const pl = loadPlaylists().find((p) =>
        p.name.toLowerCase().includes(playlistName.toLowerCase()),
      );
      if (!pl) return { found: false };
      const track = pl.tracks.find((t) => lockerTitleMatches(t.title, trackTitle));
      if (!track) return { found: false };
      const locker = findLockerEntryForTrack(
        track.title,
        track.artist,
        track.album,
        getLockerEntriesSnapshot(),
      );
      const resolved = await resolveLockerEnvelopeForPlayback({
        ...track,
        provider: 'local-vault',
        sourceId: locker?.id ?? track.sourceId,
      });
      const lockerPlayable = Boolean(resolved?.url?.trim());
      return {
        found: true,
        provider: track.provider,
        sourceId: track.sourceId,
        lockerEntryId: resolved?.sourceId ?? locker?.id,
        lockerPlayable,
        envelopeId: track.envelopeId,
      };
    },
    playLockerSequence: async (artistName, trackTitles, albumTitle) => {
      setHomeAwaitingUserResume(false);
      const snapshot = getLockerEntriesSnapshot();

      if (albumTitle?.trim() && trackTitles.length >= 2) {
        const envs: MediaEnvelope[] = [];
        for (const title of trackTitles) {
          const entry = findLockerEntryForTrack(title, artistName, albumTitle, snapshot ?? undefined);
          if (!entry) return false;
          const resolved = await resolveLockerEnvelopeForPlayback({
            envelopeId: `local-${entry.id}`,
            title: entry.title,
            artist: artistName,
            album: albumTitle,
            durationSeconds: entry.durationSeconds || 210,
            provider: 'local-vault',
            transport: 'element-src',
            sourceId: entry.id,
            artworkUrl: entry.albumArt,
          });
          if (!resolved?.url?.trim()) return false;
          envs.push(
            preserveTappedEnvelopeIdentity(
              {
                envelopeId: `local-${entry.id}`,
                title: entry.title,
                artist: artistName,
                album: albumTitle,
                url: resolved.url,
                durationSeconds: entry.durationSeconds || 210,
                provider: 'local-vault',
                transport: 'element-src',
                sourceId: entry.id,
                artworkUrl: entry.albumArt,
              },
              resolved,
            ),
          );
        }
        await prepareCleanPlaybackStop(() => audio.stop());
        setPlayQueue(envs);
        setQueueIndex(0);
        playQueueRef.current = envs;
        queueIndexRef.current = 0;
        setShuffleOn(false);
        setRepeatMode('none');
        setMixRadioSession(null);
        autoSimilarRadioSeedRef.current = null;
        logLockerQueueInstrumentation('sequence-start', envs[0]?.sourceId, 0, envs);
        const started = await playEnvelopeRef.current(envs[0]!, undefined, {
          autoPlay: true,
          preservePlayQueue: true,
        });
        if (!started) return false;
        await primeLockerNativeQueueFrom(envs, 0);
        await audio.flushNativeExoEnqueueChain();
        const firstStable = await waitForStablePlayback({
          expectedTitle: trackTitles[0]!,
          getProbeTitle: () => audioEnvelopeRef.current?.title,
          getUiPosition: () => audioCurrentTimeRef.current,
          minAdvanceSecs: 2,
          timeoutMs: 90_000,
        });
        if (!firstStable) return false;
        for (let i = 1; i < trackTitles.length; i += 1) {
          const expected = trackTitles[i]!;
          const previous = trackTitles[i - 1]!;
          const transitioned = await waitForTrackTransition({
            expectedTitle: expected,
            previousTitle: previous,
            getProbeTitle: () => audioEnvelopeRef.current?.title,
            timeoutMs: 420_000,
          });
          if (!transitioned) return false;
          const stable = await waitForStablePlayback({
            expectedTitle: expected,
            getProbeTitle: () => audioEnvelopeRef.current?.title,
            getUiPosition: () => audioCurrentTimeRef.current,
            minAdvanceSecs: 2,
            timeoutMs: 120_000,
          });
          if (!stable) return false;
        }
        return true;
      }

      await prepareCleanPlaybackStop(() => audio.stop());
      let playedOk = 0;
      for (let i = 0; i < trackTitles.length; i += 1) {
        const expected = trackTitles[i]!;
        if (i > 0) {
          await prepareCleanPlaybackStop(() => audio.stop());
        }
        const entry = findLockerEntryForTrack(expected, artistName, albumTitle, snapshot ?? undefined);
        const env = await resolveLockerEnvelopeForPlayback({
          envelopeId: entry ? `local-${entry.id}` : '',
          title: expected,
          artist: artistName,
          album: albumTitle,
          durationSeconds: entry?.durationSeconds ?? 0,
          sourceId: entry?.id,
        });
        if (!env?.url?.trim()) return false;
        const started = await playEnvelopeRef.current(env, undefined, { autoPlay: true });
        if (!started) return false;
        const stable = await waitForStablePlayback({
          expectedTitle: expected,
          getProbeTitle: () => audioEnvelopeRef.current?.title,
          getUiPosition: () => audioCurrentTimeRef.current,
          minAdvanceSecs: 3,
          timeoutMs: 90_000,
        });
        if (!stable) return false;
        playedOk += 1;
      }
      return playedOk >= trackTitles.length;
    },
    probeLockerArt: async (artistName, trackTitle, albumTitle) => {
      const entry = findLockerEntryForTrack(
        trackTitle,
        artistName,
        albumTitle,
        getLockerEntriesSnapshot() ?? undefined,
      );
      if (!entry) return false;
      const blob = await getLockerArtBlob(entry.id);
      return Boolean(blob && blob.size > 0);
    },
    reconcileFromNativePlayback: () => audio.reconcileFromNativeExo(),
    resetPlaybackState: async () => {
      autoSimilarRadioSeedRef.current = null;
      setMixRadioSession(null);
      setPlayQueue([]);
      setQueueIndex(0);
      setRepeatMode('none');
      setShuffleOn(false);
      clearLastPlayIntent();
      await prepareCleanPlaybackStop(() => audio.stop());
      // No new play attempt follows this stop — unlike the other prepareCleanPlaybackStop
      // call sites — so nothing else will clear a mobile loading spinner left over from an
      // in-flight play that this just invalidated.
      setMobilePlayerPending(false);
    },
  };
}
