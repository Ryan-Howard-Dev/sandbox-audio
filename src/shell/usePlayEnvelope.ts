/**
 * The play-envelope handler for the shell — tap-to-play, locker/instant/mobile-resolve fast
 * paths, Connect-remote forwarding, and the full resolve/execute/load fallback. Extracted from
 * sandboxLayer3 with no JSX. Also carries the small helpers declared directly above it that only
 * this path uses: display-seed/artwork sync, in-place queue adoption, search-queue seeding, and
 * the locker-repair persist.
 *
 * Call this hook at the same position in SandboxShell where handlePlayEnvelope used to be
 * declared: after useShellConnect and the playGenerationRef/audio-ref setup, before
 * scheduleAutoSimilarRadio and the wrapper callbacks that consume handlePlayEnvelope. Those
 * wrappers, plus several later effects and handlers, read handlePlayEnvelope, adoptInPlaceQueueTrack,
 * and persistLockerPlayRepair by closing over the destructured return of this call — moving the
 * call earlier or later changes what is and isn't defined yet at those sites.
 *
 * scheduleAutoSimilarRadio is declared right after this hook and is invoked from inside
 * handlePlayEnvelope, so it is threaded through via scheduleAutoSimilarRadioRef (set by the
 * shell once scheduleAutoSimilarRadio exists) rather than passed in directly — a plain reference
 * would be a temporal dead zone at the point this hook is called.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { CatalogAlbum, CatalogTrack } from '../searchCatalog';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { MixRadioSession } from '../playerMixRadio';
import type { ConnectCommand, ConnectRolePref, SyncStatePayload } from '../tier34/connectProtocol';
import type { SettingsTab } from '../stations/SettingsView';
import {
  findLockerEntryForTrack,
  findPlayableLockerEntryForTrack,
  getLockerEntriesSnapshot,
  resolveLockerEnvelopeForPlayback,
  adoptPlaybackLockerArtwork,
  enrichEnvelopeWithPlaybackLockerArt,
  withMeasuredBitrate,
} from '../lockerStorage';
import {
  resolveLockerEntryAlbumArt,
  resolvePlaybackCoverArt,
} from '../playerBarTrackMeta';
import { runDeferredPlaySideEffects } from '../play/deferredPlaySideEffects';
import { resolveActivePlayQueue } from '../play/queueAdvanceGate';
import {
  needsMobileResolveEarly as needsMobileResolveEarlyPath,
  readSyncCachedFastPath,
  tryQueueInPlaceSeek,
} from '../play/playTapFastPath';
import { computePlayQueueSeed } from '../play/albumPlayQueue';
import { ensureLockerPlayable } from '../play/ensureLockerPlayable';
import { attemptDeadLockerReacquire } from '../lockerDeadTrackReacquire';
import {
  estimateStreamDownloadMb,
  formatCellularDownloadNotice,
  isCellularNetwork,
  needsUncachedRemoteResolve,
} from '../networkPlayPolicy';
import { lookupLockerReplayGainDb } from '../replayGainPlayback';
import {
  dismissPrefetchProgress,
  notifyPrefetchProgress,
} from '../prefetchProgressNotify';
import { loadAggressiveOfflineCacheEnabled } from '../sandboxSettings';
import { tryInstantPlayable } from '../trackPrefetch';
import { fetchTrackMetadata } from '../sandboxLayer2';
import { isPodcastEnvelopeId } from '../podcastStorage';
import { resolvePodcastEnvelopeForPlayback, hasPlayablePodcastStreamUrl } from '../podcastPlayback';
import {
  hasPlayableAudiobookCatalogStreamUrl,
  resolveAudiobookCatalogEnvelopeForPlayback,
} from '../audiobookCatalogPlayback';
import { isAudiobookCatalogEnvelopeId } from '../audiobookCatalogIds';
import { yieldToMain } from '../uiTapFeedback';
import {
  playbackSwitchRequiresHardPreempt,
  seedPlaybackDisplayFromEnvelope,
  shouldSkipLockerPlaybackGate,
  type PlaybackDisplayFields,
} from '../playbackSession';
import { patchPlaylistTrackLockerRef } from '../playlistStorage';
import { isAndroid } from '../platformEnv';
import {
  tier34DhtResolve,
  getTier34BaseUrl,
  isTier34ReachableCached,
  refreshTier34Reachability,
} from '../tier34/client';
import {
  hasActiveMobileResolvers,
  getLastMobileResolveError,
  ensureYtDlpMobileReady,
  preferFreshMobileResolve,
} from '../mobileResolverRegistry';
import { isOfflineUnplayableStreamUrl } from '../nativeExoStreamResolver';
import {
  beginPlayIntent,
  formatMobilePlaybackError,
  isPlayIntentCurrent,
} from '../playIntent';
import {
  coalesceArtworkUrl,
  isCatalogPreviewUrl,
  proxiedArtworkUrl,
} from '../displaySanitize';
import {
  executeTrack,
  ensureCatalogPlaybackIdentity,
  isPlaybackDowngrade,
  preserveTappedEnvelopeIdentity,
} from '../playbackPipeline';
import { catalogTrackIdFromEnvelope } from '../catalogTrackId';
import { markActivePlaybackSession, type RepeatMode } from '../queuePersistence';
import {
  ensureTier34ForPlayback,
  getLastTier34StartError,
  isSandboxServerDesktop,
} from '../sandboxServerBridge';

const MOBILE_EXECUTE_TRACK_TIMEOUT_MS = 300_000;

export type UsePlayEnvelopeArgs = {
  audio: UseAudioFSMResult;
  playQueue: MediaEnvelope[];
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndex: number;
  queueIndexRef: MutableRefObject<number>;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  albumDrillAlbum: CatalogAlbum | null;
  albumDrillAlbumRef: MutableRefObject<CatalogAlbum | null>;
  albumDrillTracksRef: MutableRefObject<CatalogTrack[]>;
  searchHitsRef: MutableRefObject<ResolvedSearchHit[]>;
  searchResultsRef: MutableRefObject<MediaEnvelope[]>;
  setHomeAwaitingUserResume: Dispatch<SetStateAction<boolean>>;
  setMobilePlayerPending: Dispatch<SetStateAction<boolean>>;
  showMobileShell: boolean;
  showAppToast: (msg: string, durationMs?: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
  openSettings: (tab?: SettingsTab) => void;
  connectRolePref: ConnectRolePref;
  networkSyncEnabled: boolean;
  isConnectRemoteRef: MutableRefObject<boolean>;
  remoteMirror: SyncStatePayload | null;
  sendConnectCommand: (command: ConnectCommand) => void;
  syncThumbsFromFeedback: (envelopeId?: string) => void;
  playGenerationRef: MutableRefObject<number>;
  trackReachedPlayingRef: MutableRefObject<boolean>;
  trackReachedPlayingAtRef: MutableRefObject<number>;
  instantHandoffEnvelopeIdRef: MutableRefObject<string>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  setPlaybackDisplaySeed: Dispatch<SetStateAction<PlaybackDisplayFields | null>>;
  setArtworkUrl: Dispatch<SetStateAction<string>>;
  scheduleAutoSimilarRadioRef: MutableRefObject<
    (
      playable: MediaEnvelope,
      opts?: {
        seedSearchQueue?: boolean;
        seamless?: boolean;
        playQueueOverride?: MediaEnvelope[];
      },
    ) => void
  >;
};

export function usePlayEnvelope({
  audio,
  playQueue,
  playQueueRef,
  queueIndex,
  queueIndexRef,
  setPlayQueue,
  setQueueIndex,
  setRepeatMode,
  setMixRadioSession,
  autoSimilarRadioSeedRef,
  albumDrillAlbum,
  albumDrillAlbumRef,
  albumDrillTracksRef,
  searchHitsRef,
  searchResultsRef,
  setHomeAwaitingUserResume,
  setMobilePlayerPending,
  showMobileShell,
  showAppToast,
  t,
  openSettings,
  connectRolePref,
  networkSyncEnabled,
  isConnectRemoteRef,
  remoteMirror,
  sendConnectCommand,
  syncThumbsFromFeedback,
  playGenerationRef,
  trackReachedPlayingRef,
  trackReachedPlayingAtRef,
  instantHandoffEnvelopeIdRef,
  audioEnvelopeRef,
  setPlaybackDisplaySeed,
  setArtworkUrl,
  scheduleAutoSimilarRadioRef,
}: UsePlayEnvelopeArgs) {
  const applyPlaybackDisplaySeed = useCallback((env: MediaEnvelope, artwork?: string) => {
    const seed = seedPlaybackDisplayFromEnvelope(env, artwork);
    setPlaybackDisplaySeed(seed);
    setArtworkUrl(seed.artworkUrl);
    return seed;
  }, []);
  const syncPlaybackArtwork = useCallback((envelopeId: string, art: string) => {
    const trimmed = art?.trim();
    if (!trimmed || !envelopeId?.trim()) return;
    setPlaybackDisplaySeed((prev) =>
      prev?.envelopeId === envelopeId ? { ...prev, artworkUrl: trimmed } : prev,
    );
    setArtworkUrl(trimmed);
  }, []);
  /** In-place queue seek — sync display seed atomically so player UI never flashes album view. */
  const adoptInPlaceQueueTrack = useCallback(
    async (track: MediaEnvelope, seekSeconds: number) => {
      const enriched = await enrichEnvelopeWithPlaybackLockerArt(track);
      const lockerArt = resolveLockerEntryAlbumArt(enriched);
      const displayArt = resolvePlaybackCoverArt(enriched.artworkUrl, enriched, lockerArt);
      const resolvedArt = displayArt?.trim() || '';
      const withArt =
        resolvedArt && resolvedArt !== enriched.artworkUrl?.trim()
          ? { ...enriched, artworkUrl: resolvedArt }
          : enriched;
      applyPlaybackDisplaySeed(withArt, resolvedArt);
      audio.adoptQueueTrack(withArt, seekSeconds);
    },
    [audio, applyPlaybackDisplaySeed],
  );

  const seedSearchPlayQueue = useCallback((env: MediaEnvelope) => {
    const seed = computePlayQueueSeed(env, {
      searchHits: searchHitsRef.current,
      searchResults: searchResultsRef.current,
      albumTracks: albumDrillTracksRef.current,
      albumTitle: albumDrillAlbumRef.current?.title,
      expectedTrackCount: albumDrillAlbumRef.current?.trackCount,
      seedSearchOnly: true,
    });
    if (!seed) return null;
    setPlayQueue(seed.queue);
    setQueueIndex(seed.index);
    return seed;
  }, []);

  const persistLockerPlayRepair = useCallback((tapped: MediaEnvelope, playable: MediaEnvelope) => {
    if (playable.provider !== 'local-vault' || !playable.sourceId?.trim() || !playable.url?.trim()) {
      return;
    }
    patchPlaylistTrackLockerRef(tapped.envelopeId, playable);
  }, []);

  const handlePlayEnvelope = useCallback(
    async (
      env: MediaEnvelope,
      candidates?: CandidateSource[],
      options?: {
        autoPlay?: boolean;
        seedSearchQueue?: boolean;
        seedSearchEnvelope?: MediaEnvelope;
        seamless?: boolean;
        /** Keep multi-track album queue when resolving the next track after end/skip. */
        preservePlayQueue?: boolean;
      },
    ): Promise<boolean> => {
      setHomeAwaitingUserResume(false);
      const queueAdvanceSeamless = options?.seamless === true;
      const loadOptions: {
        autoPlay: boolean;
        seamless?: boolean;
      } = {
        autoPlay: options?.autoPlay !== false,
        seamless: queueAdvanceSeamless || undefined,
      };
      if (loadOptions.autoPlay) {
        audio.primePlaybackGesture(env);
        if (showMobileShell) {
          setMobilePlayerPending(true);
        }
      }

      if (import.meta.env.DEV) {
        showAppToast(`Play tapped: ${env.title || 'Unknown'}`, 1000);
      }

      const playTapStartedAt = performance.now();
      /*
       * Not DEV-gated. This measures the gap between tapping a track and hearing it, which is a
       * property of the phone — on-device extraction, real network, real CPU — and cannot be
       * observed on a dev server at all. Gating it to DEV meant the one instrument aimed at the
       * one complaint ("it takes fifteen seconds") had never run on the device it describes.
       *
       * console.warn, not log: release WebView logcat drops console.log under load, which is
       * exactly when the slow taps happen. Four lines per tap is not a volume problem.
       */
      const logPlayTiming = (phase: string, extra?: Record<string, unknown>) => {
        console.warn(
          `[playTiming] ${Math.round(performance.now() - playTapStartedAt)}ms ${phase} ` +
            `track="${env.artist} — ${env.title}"` +
            (extra ? ` ${JSON.stringify(extra)}` : ''),
        );
      };
      // Baseline, so every later phase is readable as a gap rather than an absolute number.
      logPlayTiming('tap', { provider: env.provider, envelopeId: env.envelopeId });

      if (import.meta.env.DEV) {
        console.warn(
          `[handlePlayEnvelope] tap ${JSON.stringify({
            title: env.title,
            artist: env.artist,
            envelopeId: env.envelopeId,
            hasUrl: Boolean(env.url?.trim()),
            mobileActive: hasActiveMobileResolvers(),
            serverReachable: isTier34ReachableCached(),
            connectRole: connectRolePref,
            networkSync: networkSyncEnabled,
          })}`,
        );
      }

      const generation = beginPlayIntent(env.envelopeId);
      playGenerationRef.current = generation;
      trackReachedPlayingRef.current = false;
      trackReachedPlayingAtRef.current = 0;
      instantHandoffEnvelopeIdRef.current = '';
      if (options?.seedSearchQueue) {
        autoSimilarRadioSeedRef.current = null;
      }
      const queueSeed = options?.seedSearchQueue
        ? seedSearchPlayQueue(options.seedSearchEnvelope ?? env)
        : null;
      if (options?.seedSearchQueue && (queueSeed?.queue.length ?? 1) <= 1) {
        setRepeatMode('none');
        setMixRadioSession(null);
      }
      const refQueue = playQueueRef.current;
      const stateQueue = playQueue;
      const queueResolution = resolveActivePlayQueue({
        envEnvelopeId: env.envelopeId,
        refQueue,
        stateQueue,
        queueSeed,
        preservePlayQueue: options?.preservePlayQueue,
      });
      let activePlayQueue: MediaEnvelope[];
      if (queueResolution.collapsed) {
        activePlayQueue = [env];
        playQueueRef.current = [env];
        queueIndexRef.current = 0;
        setPlayQueue([env]);
        setQueueIndex(0);
        setMixRadioSession(null);
        autoSimilarRadioSeedRef.current = null;
      } else {
        activePlayQueue = queueResolution.queue as MediaEnvelope[];
        if (activePlayQueue.length > 1) {
          const idx = Math.max(
            0,
            activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId),
          );
          const stateOutOfSync =
            stateQueue.length !== activePlayQueue.length ||
            !activePlayQueue.every(
              (track, i) => stateQueue[i]?.envelopeId === track.envelopeId,
            );
          if (stateOutOfSync) {
            setPlayQueue(activePlayQueue);
            setQueueIndex(idx);
            queueIndexRef.current = idx;
          }
        }
      }
      const activeQueueIndex =
        queueSeed?.index ??
        Math.max(0, activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId));
      const isStale = () => !isPlayIntentCurrent(generation, env.envelopeId);
      const envelopeLoadOpts = (extra?: { autoPlay?: boolean; seamless?: boolean; instant?: boolean }) => {
        // Every fast path funnels through here with instant:true, so this is the one place that has
        // to record it for the now-playing authority check.
        if (extra?.instant) instantHandoffEnvelopeIdRef.current = env.envelopeId;
        return {
          autoPlay: extra?.autoPlay ?? loadOptions.autoPlay,
          seamless: extra?.seamless ?? queueAdvanceSeamless,
          instant: extra?.instant,
          playToken: generation,
          playEnvelopeId: env.envelopeId,
        };
      };

      const lockerSeedArt = resolveLockerEntryAlbumArt(env);
      let seedArtwork = coalesceArtworkUrl(
        lockerSeedArt,
        env.artworkUrl,
        candidates?.find((s) => s.metadata?.artworkUrl)?.metadata?.artworkUrl,
        albumDrillAlbum?.artworkUrl,
      );
      let seedEnvelope =
        seedArtwork && !env.artworkUrl ? { ...env, artworkUrl: seedArtwork } : env;
      // Carry a playback-owned cover from track_blobs onto the envelope. Library grid joins
      // blobs when listing; the play path did not, so player bar + media session saw no art.
      seedEnvelope = await enrichEnvelopeWithPlaybackLockerArt(seedEnvelope);
      seedArtwork = coalesceArtworkUrl(seedEnvelope.artworkUrl, seedArtwork);
      const seedDisplayArt =
        proxiedArtworkUrl(seedArtwork) ?? seedArtwork ?? '';
      applyPlaybackDisplaySeed(seedEnvelope, seedDisplayArt);

      if (isPodcastEnvelopeId(env.envelopeId)) {
        queueMicrotask(() => syncThumbsFromFeedback(env.envelopeId));
        const seed =
          seedArtwork && !env.artworkUrl ? { ...env, artworkUrl: seedArtwork } : env;
        if (
          playbackSwitchRequiresHardPreempt(
            audio.envelope?.envelopeId,
            seed.envelopeId,
          )
        ) {
          audio.stop();
        }
        markActivePlaybackSession();
        const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
        if (idx >= 0) setQueueIndex(idx);

        if (!hasPlayablePodcastStreamUrl(seed)) {
          if (!isStale()) {
            audio.failResolve();
            showAppToast(
              t('player.podcastMissingAudio'),
              6000,
            );
          }
          setMobilePlayerPending(false);
          return false;
        }

        try {
          void audio.beginResolve(seed, loadOptions);
          await yieldToMain();
          const playable = await resolvePodcastEnvelopeForPlayback(seed, {
            skipCacheEviction: true,
          });
          if (isStale()) return false;
          const loaded = await audio.loadEnvelope(
            playable,
            envelopeLoadOpts({ seamless: true, instant: true }),
          );
          setMobilePlayerPending(false);
          if (!loaded) return false;
        } catch (err) {
          if (!isStale()) {
            console.warn('[handlePlayEnvelope] podcast playback failed:', err);
            audio.failResolve();
            showAppToast(
              err instanceof Error
                ? err.message
                : 'Podcast playback failed — refresh the feed and try again',
              6000,
            );
          }
          setMobilePlayerPending(false);
          return false;
        }
        return true;
      }

      if (isAudiobookCatalogEnvelopeId(env.envelopeId)) {
        queueMicrotask(() => syncThumbsFromFeedback(env.envelopeId));
        const seed =
          seedArtwork && !env.artworkUrl ? { ...env, artworkUrl: seedArtwork } : env;
        if (
          playbackSwitchRequiresHardPreempt(
            audio.envelope?.envelopeId,
            seed.envelopeId,
          )
        ) {
          audio.stop();
        }
        markActivePlaybackSession();
        const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
        if (idx >= 0) setQueueIndex(idx);

        if (!hasPlayableAudiobookCatalogStreamUrl(seed)) {
          if (!isStale()) {
            audio.failResolve();
            showAppToast(t('audiobooks.missingAudio'), 6000);
          }
          setMobilePlayerPending(false);
          return false;
        }

        try {
          void audio.beginResolve(seed, loadOptions);
          await yieldToMain();
          const playable = await resolveAudiobookCatalogEnvelopeForPlayback(seed, {
            skipCacheEviction: true,
          });
          if (isStale()) return false;
          const loaded = await audio.loadEnvelope(
            playable,
            envelopeLoadOpts({ seamless: true, instant: true }),
          );
          setMobilePlayerPending(false);
          if (!loaded) return false;
        } catch (err) {
          if (!isStale()) {
            console.warn('[handlePlayEnvelope] audiobook catalog playback failed:', err);
            audio.failResolve();
            showAppToast(
              err instanceof Error ? err.message : t('audiobooks.playbackFailed'),
              6000,
            );
          }
          setMobilePlayerPending(false);
          return false;
        }
        return true;
      }

      syncThumbsFromFeedback(env.envelopeId);

      const catalogTrackEarly = catalogTrackIdFromEnvelope(seedEnvelope);
      const needsMobileResolveEarly = needsMobileResolveEarlyPath(seedEnvelope, candidates);

      const currentUrl = audio.envelope?.url?.trim() ?? '';
      const targetQueueIdx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
      if (!isPodcastEnvelopeId(env.envelopeId)) {
        const inPlaceSeek = tryQueueInPlaceSeek({
          playQueue: activePlayQueue,
          queueIndex: activeQueueIndex,
          targetQueueIdx,
          currentUrl,
          streamDurationSeconds: audio.streamDurationSeconds,
          envelopeDurationSeconds: audio.envelope?.durationSeconds ?? 0,
        });
        if (
          currentUrl &&
          targetQueueIdx >= 0 &&
          env.envelopeId !== audio.envelope?.envelopeId &&
          inPlaceSeek != null
        ) {
          syncThumbsFromFeedback(env.envelopeId);
          setQueueIndex(targetQueueIdx);
          await adoptInPlaceQueueTrack(seedEnvelope, inPlaceSeek);
          setMobilePlayerPending(false);
          return true;
        }
      }

      /**
       * Whether the cellular data notice is on screen and this attempt owns taking it down.
       *
       * Declared up here rather than beside the line that raises it, because every way out of this
       * function has to clear it. It says a download is about to start, and it sat on screen for
       * its full four and a half seconds regardless of what happened next — including the paths
       * that give up without playing anything and without a word. A stale "streaming 2.7 MB on
       * cellular" over a track that never started is not a cosmetic problem: it is the only thing
       * the listener is told, and it says the opposite of what happened.
       */
      let cellularNoticeRaised = false;
      const clearCellularNotice = (): void => {
        if (!cellularNoticeRaised) return;
        cellularNoticeRaised = false;
        showAppToast('');
      };

      const failResolve = (showToast = true): boolean => {
        /*
         * Unconditionally, and before the staleness check. A superseded attempt returns from here
         * without saying anything, and a silent give-up says nothing by design — either way the
         * notice has to come down, or it is the last word on a track that never played. Where a
         * message does follow, it simply replaces this.
         */
        clearCellularNotice();
        if (isStale()) return false;
        if (showToast) {
          const base = getTier34BaseUrl().trim();
          const mobileActive = hasActiveMobileResolvers();
          const mobileErr = getLastMobileResolveError();
          const hasAttachedStream = candidates?.some(
            (c) => c.uri?.trim() && !isCatalogPreviewUrl(c.uri),
          );
          const catalogTrack = catalogTrackIdFromEnvelope(env);
          const needsServer =
            env.provider !== 'local-vault' &&
            env.provider !== 'stream-cache' &&
            env.provider !== 'indexeddb' &&
            env.provider !== 'blob';
          const sandboxNeeded =
            catalogTrack &&
            needsServer &&
            !hasAttachedStream &&
            !mobileActive &&
            (!base || !isTier34ReachableCached());
          if (mobileActive && mobileErr) {
            showAppToast(
              `Playback failed: ${formatMobilePlaybackError(mobileErr)}`,
              3800,
            );
          } else if (mobileActive) {
            showAppToast(t('artist.playbackHybridUnavailable'), 3800);
          } else if (sandboxNeeded || (!base && needsServer && !hasAttachedStream)) {
            const detail = getLastTier34StartError();
            showAppToast(
              detail
                ? `${t('artist.playbackSandboxRequired')} — ${detail}`
                : t('artist.playbackSandboxRequired'),
              3800,
            );
          } else if (base && needsServer && !isTier34ReachableCached() && !hasAttachedStream) {
            showAppToast(t('artist.playbackSandboxUnreachable'), 3800);
          } else {
            showAppToast(t('artist.playbackHybridUnavailable'), 3800);
          }
        }
        setMobilePlayerPending(false);
        audio.stop();
        return false;
      };

      try {
        if (!shouldSkipLockerPlaybackGate(env.envelopeId)) {
          const lockerEarly = await ensureLockerPlayable(seedEnvelope);
        if (lockerEarly.kind === 'missing-audio' && !isStale()) {
          if (
            await attemptDeadLockerReacquire(
              seedEnvelope.title,
              seedEnvelope.artist,
              seedEnvelope.album,
            )
          ) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                title: seedEnvelope.title,
              }),
              5000,
            );
            setMobilePlayerPending(false);
            return false;
          }
          const offlineOnly =
            env.provider === 'local-vault' &&
            !hasActiveMobileResolvers() &&
            !getTier34BaseUrl().trim();
          if (offlineOnly) {
            showAppToast(
              t('player.lockerAudioMissing', {
                defaultValue:
                  'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
              }),
              6000,
            );
            setMobilePlayerPending(false);
            return false;
          }
        } else if (lockerEarly.kind === 'playable' && !isStale()) {
          let playable = lockerEarly.envelope;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = await withMeasuredBitrate(
            preserveTappedEnvelopeIdentity(seedEnvelope, playable),
          );
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          if (targetQueueIdx >= 0) setQueueIndex(targetQueueIdx);
          setMobilePlayerPending(false);
          scheduleAutoSimilarRadioRef.current(syncedPlayable, {
            seedSearchQueue: options?.seedSearchQueue,
            seamless: queueAdvanceSeamless,
            playQueueOverride: activePlayQueue,
          });
          return true;
        }
      }

      if (!shouldSkipLockerPlaybackGate(env.envelopeId)) {
        const syncCached = readSyncCachedFastPath(seedEnvelope);
        if (syncCached?.url?.trim() && !isStale()) {
          const lockerGate = await ensureLockerPlayable(syncCached);
          if (lockerGate.kind === 'playable') {
          markActivePlaybackSession();
          let playable = lockerGate.envelope;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = await withMeasuredBitrate(
            preserveTappedEnvelopeIdentity(seedEnvelope, playable),
          );
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          if (targetQueueIdx >= 0) setQueueIndex(targetQueueIdx);
          setMobilePlayerPending(false);
          scheduleAutoSimilarRadioRef.current(syncedPlayable, {
            seedSearchQueue: options?.seedSearchQueue,
            seamless: queueAdvanceSeamless,
            playQueueOverride: activePlayQueue,
          });
          return true;
          }
        }
      }

      if (
        isAndroid() &&
        hasActiveMobileResolvers() &&
        (needsMobileResolveEarly || preferFreshMobileResolve() || Boolean(catalogTrackEarly))
      ) {
        ensureYtDlpMobileReady();
      }

      if (queueAdvanceSeamless && !shouldSkipLockerPlaybackGate(env.envelopeId)) {
        let seamlessInstant = await tryInstantPlayable(seedEnvelope, { forPrefetch: true });
        if (seedEnvelope.provider === 'local-vault' || seamlessInstant?.provider === 'local-vault') {
          seamlessInstant = await resolveLockerEnvelopeForPlayback(seamlessInstant ?? seedEnvelope);
        }
        if (
          seamlessInstant?.url?.trim() &&
          !(isAndroid() && seamlessInstant.url.startsWith('blob:')) &&
          !isStale()
        ) {
          let playable = seamlessInstant;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = await withMeasuredBitrate(
            preserveTappedEnvelopeIdentity(seedEnvelope, playable),
          );
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          if (targetQueueIdx >= 0) setQueueIndex(targetQueueIdx);
          setMobilePlayerPending(false);
          scheduleAutoSimilarRadioRef.current(syncedPlayable, {
            seedSearchQueue: options?.seedSearchQueue,
            seamless: queueAdvanceSeamless,
            playQueueOverride: activePlayQueue,
          });
          return true;
        }
      }

      await audio.beginResolve(seedEnvelope, loadOptions);
      markActivePlaybackSession();

      if (
        connectRolePref === 'remote' &&
        networkSyncEnabled &&
        isConnectRemoteRef.current &&
        remoteMirror
      ) {
        sendConnectCommand({ cmd: 'PLAY', envelopeId: env.envelopeId });
        showAppToast(`Connect remote: ${env.title || 'track'}`, 3200);
        return true;
      }

      if (!shouldSkipLockerPlaybackGate(env.envelopeId)) {
        let instant = await tryInstantPlayable(
          seedEnvelope,
          queueAdvanceSeamless ? { forPrefetch: true } : undefined,
        );
        if (seedEnvelope.provider === 'local-vault' || instant?.provider === 'local-vault') {
          instant = await resolveLockerEnvelopeForPlayback(instant ?? seedEnvelope);
        }
        if (
          !instant?.url?.trim() &&
          seedEnvelope.provider === 'local-vault' &&
          !isStale()
        ) {
          if (
            await attemptDeadLockerReacquire(
              seedEnvelope.title,
              seedEnvelope.artist,
              seedEnvelope.album,
            )
          ) {
            showAppToast(
              t('player.lockerAudioReacquiring', {
                title: seedEnvelope.title,
              }),
              5000,
            );
            setMobilePlayerPending(false);
            return false;
          }
          showAppToast(
            t('player.lockerAudioMissing', {
              defaultValue:
                'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
            }),
            6000,
          );
          setMobilePlayerPending(false);
          return false;
        }
        if (
          instant?.url?.trim() &&
          !(isAndroid() && instant.url.startsWith('blob:')) &&
          !isStale()
        ) {
          let playable = instant;
          if (!playable.album?.trim()) {
            const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata
              ?.album;
            const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
            if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
          }
          const resolvedArtwork = coalesceArtworkUrl(
            playable.artworkUrl,
            seedEnvelope.artworkUrl,
            env.artworkUrl,
          );
          if (resolvedArtwork) playable = { ...playable, artworkUrl: resolvedArtwork };
          markActivePlaybackSession();
          const syncedPlayable = await withMeasuredBitrate(
            preserveTappedEnvelopeIdentity(seedEnvelope, playable),
          );
          persistLockerPlayRepair(seedEnvelope, syncedPlayable);
          audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
          void runDeferredPlaySideEffects({
            seedEnvelope,
            playable: syncedPlayable,
            candidates,
            hadAttachedTier: false,
            preferFreshMobile: preferFreshMobileResolve(),
            mobileActive: hasActiveMobileResolvers(),
            loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
            notifyPrefetchProgress,
            dismissPrefetchProgress,
            seedArtwork,
          });
          const displayArt =
            proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
          if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
          const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
          if (idx >= 0) setQueueIndex(idx);
          setMobilePlayerPending(false);
          return true;
        }
      }

        let playable = env;
        if (!playable.album?.trim()) {
          const albumFromSource = candidates?.find((s) => s.metadata?.album)?.metadata?.album;
          const albumTitle = albumFromSource ?? albumDrillAlbum?.title;
          if (albumTitle?.trim()) playable = { ...playable, album: albumTitle.trim() };
        }

        const lockerResolved = await resolveLockerEnvelopeForPlayback(playable);
        if (lockerResolved) {
          playable = lockerResolved;
          if (playable.sourceId) {
            const lockerRg = await lookupLockerReplayGainDb(playable.sourceId);
            if (lockerRg != null) playable = { ...playable, replayGainDb: lockerRg };
          }
        } else if (playable.provider === 'local-vault' || findLockerEntryForTrack(
          playable.title,
          playable.artist,
          playable.album,
          getLockerEntriesSnapshot(),
        )) {
          const playableEntry = await findPlayableLockerEntryForTrack(
            playable.title,
            playable.artist,
            playable.album,
          );
          if (playableEntry) {
            const healed = await resolveLockerEnvelopeForPlayback({
              ...playable,
              provider: 'local-vault',
              sourceId: playableEntry.id,
              url: '',
            });
            if (healed?.url?.trim()) {
              playable = healed;
            } else {
              if (
                await attemptDeadLockerReacquire(
                  playable.title,
                  playable.artist,
                  playable.album,
                )
              ) {
                showAppToast(
                  t('player.lockerAudioReacquiring', {
                    title: playable.title,
                  }),
                  5000,
                );
                return failResolve(false);
              }
              showAppToast(
                t('player.lockerAudioMissing', {
                  defaultValue:
                    'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
                }),
                6000,
              );
              return failResolve(false);
            }
          } else {
            if (
              await attemptDeadLockerReacquire(
                playable.title,
                playable.artist,
                playable.album,
              )
            ) {
              showAppToast(
                t('player.lockerAudioReacquiring', {
                  title: playable.title,
                }),
                5000,
              );
              return failResolve(false);
            }
            showAppToast(
              t('player.lockerAudioMissing', {
                defaultValue:
                  'Offline audio is missing or corrupted on this device — open the track menu and download to Locker again',
              }),
              6000,
            );
            return failResolve(false);
          }
        }

        if (!playable.url || playable.provider === 'dht-swarm') {
          if (!preferFreshMobileResolve()) {
            const resolved = await tier34DhtResolve(
              playable.title,
              playable.artist,
              playable.sourceId,
            );
            if (resolved?.url) {
              playable = {
                ...resolved,
                envelopeId: playable.envelopeId,
                title: playable.title || resolved.title,
                artist: playable.artist || resolved.artist,
                album: playable.album ?? resolved.album,
                artworkUrl: coalesceArtworkUrl(
                  playable.artworkUrl,
                  seedArtwork,
                  resolved.artworkUrl,
                ),
                durationSeconds: playable.durationSeconds || resolved.durationSeconds,
              };
            }
          }
        }

        const hadAttachedTier =
          Boolean(
            candidates?.some(
              (c) =>
                (c.provider === 'proxy' ||
                  c.provider === 'stream-proxy' ||
                  c.provider === 'debrid') &&
                c.uri?.trim() &&
                !c.uri.includes('audio-ssl'),
            ),
          );

        const catalogTrack = catalogTrackIdFromEnvelope(playable);
        const needsTier34ForCatalog =
          catalogTrack &&
          playable.provider !== 'local-vault' &&
          playable.provider !== 'stream-cache' &&
          playable.provider !== 'indexeddb' &&
          playable.provider !== 'blob';

        if (
          needsTier34ForCatalog &&
          !getTier34BaseUrl().trim()
        ) {
          ensureYtDlpMobileReady();
        }

        const needsMobileResolve =
          playable.provider !== 'local-vault' &&
          playable.provider !== 'stream-cache' &&
          playable.provider !== 'indexeddb' &&
          playable.provider !== 'blob' &&
          (!playable.url?.trim() ||
            isCatalogPreviewUrl(playable.url ?? '') ||
            isOfflineUnplayableStreamUrl(playable.url ?? ''));

        if (
          (needsMobileResolve || preferFreshMobileResolve()) &&
          isAndroid()
        ) {
          ensureYtDlpMobileReady();
        }

        if (
          needsTier34ForCatalog &&
          (!getTier34BaseUrl().trim() || !isTier34ReachableCached())
        ) {
          if (isSandboxServerDesktop()) {
            showAppToast(t('artist.playbackSandboxStarting'), 8000);
            await ensureTier34ForPlayback({
              onPhase: (phase) => {
                if (phase === 'waiting') {
                  showAppToast(t('artist.playbackSandboxStarting'), 8000);
                }
              },
            });
            await refreshTier34Reachability();
            if (isStale()) return false;
          } else if (getTier34BaseUrl().trim() && !isTier34ReachableCached()) {
            showAppToast(t('artist.playbackSandboxUnreachable'), 5200);
          }
        }

        const executePayload =
          seedArtwork && !playable.artworkUrl
            ? { ...playable, artworkUrl: seedArtwork }
            : playable;
        // Reaching here at all means the instant path missed and this tap will pay for a full
        // resolve. The gap between this line and 'resolved' is the wait the listener feels.
        logPlayTiming('execute-start', { provider: playable.provider });
        const needsMobileExecuteTimeout =
          isAndroid() &&
          hasActiveMobileResolvers() &&
          playable.provider !== 'local-vault' &&
          playable.provider !== 'stream-cache' &&
          playable.provider !== 'indexeddb' &&
          playable.provider !== 'blob';
        if (needsMobileExecuteTimeout) {
          if (
            isCellularNetwork() &&
            (needsMobileResolveEarly ||
              needsUncachedRemoteResolve(playable) ||
              needsUncachedRemoteResolve(seedEnvelope))
          ) {
            const mb = estimateStreamDownloadMb(
              playable.durationSeconds ? playable : seedEnvelope,
            );
            showAppToast(formatCellularDownloadNotice(mb), 4500);
            /*
             * Taken down again the moment the track is loaded, below. This notice describes a
             * resolve that is about to happen; once it has, the words are stale and were sitting
             * over the Discover shelves for the rest of their four and a half seconds, which is
             * where they were photographed lying across the genre chips.
             */
            cellularNoticeRaised = true;
          }
          playable = await Promise.race([
            executeTrack(executePayload, candidates),
            new Promise<MediaEnvelope>((_, reject) => {
              window.setTimeout(
                () => reject(new Error('mobile resolve timeout')),
                MOBILE_EXECUTE_TRACK_TIMEOUT_MS,
              );
            }),
          ]);
        } else {
          playable = await executeTrack(executePayload, candidates);
        }
        if (isStale()) return false;
        logPlayTiming('resolved', {
          hasUrl: Boolean(playable.url?.trim()),
          source: playable.resolutionSource,
          provider: playable.provider,
        });
        if (import.meta.env.DEV) {
          console.warn(
            `[handlePlayEnvelope] resolved ${JSON.stringify({
              title: playable.title,
              hasUrl: Boolean(playable.url?.trim()),
              source: playable.resolutionSource,
              provider: playable.provider,
            })}`,
          );
        }
        playable = await ensureCatalogPlaybackIdentity(seedEnvelope, playable, candidates);
        if (isStale()) return false;

        if (
          !playable.artworkUrl &&
          playable.sourceId
        ) {
          const lockerArt =
            resolveLockerEntryAlbumArt(playable) ??
            (await adoptPlaybackLockerArtwork(playable.sourceId));
          if (lockerArt) playable = { ...playable, artworkUrl: lockerArt };
        }

        const resolvedArtwork =
          playable.provider === 'local-vault' || lockerResolved
            ? coalesceArtworkUrl(playable.artworkUrl, seedEnvelope.artworkUrl, env.artworkUrl)
            : coalesceArtworkUrl(
                playable.artworkUrl,
                seedArtwork,
                env.artworkUrl,
                albumDrillAlbum?.artworkUrl,
              );
        if (resolvedArtwork) {
          playable = { ...playable, artworkUrl: resolvedArtwork };
        }

        const activeEnvelope = audioEnvelopeRef.current;
        if (isPlaybackDowngrade(activeEnvelope, playable)) {
          return failResolve(false);
        }

        if (!playable.url?.trim()) {
          return failResolve(true);
        }

        if (import.meta.env.DEV) {
          console.warn(
            `[handlePlayEnvelope] load ${JSON.stringify({
              title: playable.title,
              urlLen: playable.url?.trim().length ?? 0,
              source: playable.resolutionSource,
              autoPlay: loadOptions.autoPlay,
            })}`,
          );
        }
        logPlayTiming('load', {
          urlLen: playable.url?.trim().length ?? 0,
          source: playable.resolutionSource,
        });
        const syncedPlayable = preserveTappedEnvelopeIdentity(seedEnvelope, playable);
        persistLockerPlayRepair(seedEnvelope, syncedPlayable);
        audio.loadEnvelope(syncedPlayable, envelopeLoadOpts({ seamless: true, instant: true }));
        // The resolve it warned about is done. Leaving it up put stale words over the shelves.
        clearCellularNotice();
        logPlayTiming('loadEnvelope-called', { autoPlay: loadOptions.autoPlay });
        void runDeferredPlaySideEffects({
          seedEnvelope,
          playable: syncedPlayable,
          candidates,
          hadAttachedTier,
          preferFreshMobile: preferFreshMobileResolve(),
          mobileActive: hasActiveMobileResolvers(),
          loadAggressiveCache: loadAggressiveOfflineCacheEnabled(),
          notifyPrefetchProgress,
          dismissPrefetchProgress,
          seedArtwork,
        });
        const displayArt =
          proxiedArtworkUrl(resolvedArtwork) ?? resolvedArtwork ?? seedDisplayArt;
        if (displayArt) syncPlaybackArtwork(env.envelopeId, displayArt);
        if (!resolvedArtwork) {
          void fetchTrackMetadata(playable.artist, playable.title).then((meta) => {
            if (isStale()) return;
            const fetched = coalesceArtworkUrl(meta.albumArt, seedArtwork);
            if (fetched) {
              setArtworkUrl((prev) => proxiedArtworkUrl(fetched) ?? fetched ?? prev);
            }
          });
        }
        const idx = activePlayQueue.findIndex((e) => e.envelopeId === env.envelopeId);
        if (idx >= 0) setQueueIndex(idx);
        setMobilePlayerPending(false);
        scheduleAutoSimilarRadioRef.current(syncedPlayable, {
          seedSearchQueue: options?.seedSearchQueue,
          seamless: queueAdvanceSeamless,
          playQueueOverride: activePlayQueue,
        });
        return true;
      } catch (err) {
        if (isStale()) return false;
        console.warn('[handlePlayEnvelope] playback failed:', err);
        return failResolve(true);
      }
    },
    [audio, playQueue, queueIndex, albumDrillAlbum, connectRolePref, networkSyncEnabled, sendConnectCommand, syncThumbsFromFeedback, showAppToast, t, openSettings, seedSearchPlayQueue, remoteMirror, showMobileShell, applyPlaybackDisplaySeed, syncPlaybackArtwork, adoptInPlaceQueueTrack],
  );

  return { handlePlayEnvelope, adoptInPlaceQueueTrack, persistLockerPlayRepair };
}
