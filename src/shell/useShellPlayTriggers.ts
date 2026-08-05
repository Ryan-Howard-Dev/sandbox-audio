/**
 * Play-trigger cluster for the shell — auto-similar-radio scheduling, locker-track tap-to-play,
 * search-result play (plus the stream-hit wrapper), and the Sonic Locker queue/mix/discovery-
 * station helpers. Extracted from sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position: right after usePlayEnvelope (handlePlayEnvelope,
 * findHitCandidates, and the locker-queue helpers below it must already exist) and before the
 * mobile-tap / home-player wrappers that follow. scheduleAutoSimilarRadioRef is populated here
 * (this hook sets `.current` once scheduleAutoSimilarRadio exists) rather than only read, so the
 * usePlayEnvelope call above it can invoke the not-yet-declared scheduleAutoSimilarRadio via the
 * same ref-indirection pattern used for handlePlayEnvelope itself. repeatModeRef must already be
 * declared by the time this hook is called — it was moved earlier in the shell (next to the
 * `repeatMode` state) specifically to unblock this extraction, since scheduleAutoSimilarRadio
 * reads `repeatModeRef.current` and a plain forward reference at the call site (an object literal
 * argument, not a deferred closure) would hit the temporal dead zone.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { RepeatMode } from '../queuePersistence';
import type { MixRadioSession } from '../playerMixRadio';
import type { CatalogAlbum, CatalogTrack } from '../searchCatalog';
import { getLockerEntriesSnapshot, type LockerEntry } from '../lockerStorage';
import { ensureLockerPlayable } from '../play/ensureLockerPlayable';
import { preserveTappedEnvelopeIdentity } from '../playbackPipeline';
import { startAutoSimilarRadioIfNeeded } from '../play/standaloneSimilarRadio';
import { isLockerVaultPlayQueue, prefetchUpcomingQueueTracks } from '../trackPrefetch';

type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  options?: {
    autoPlay?: boolean;
    seedSearchQueue?: boolean;
    seedSearchEnvelope?: MediaEnvelope;
    seamless?: boolean;
    preservePlayQueue?: boolean;
  },
) => Promise<boolean>;

type ScheduleAutoSimilarRadioFn = (
  playable: MediaEnvelope,
  opts?: {
    seedSearchQueue?: boolean;
    seamless?: boolean;
    playQueueOverride?: MediaEnvelope[];
  },
) => void;

export type UseShellPlayTriggersArgs = {
  audio: UseAudioFSMResult;
  t: (key: string, opts?: Record<string, unknown>) => string;
  handlePlayEnvelope: PlayEnvelopeFn;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  primeLockerNativeQueueFrom: (tracks: MediaEnvelope[], fromIndex: number) => Promise<void>;
  showAppToast: (msg: string, durationMs?: number) => void;
  setHomeAwaitingUserResume: Dispatch<SetStateAction<boolean>>;
  setMobilePlayerPending: Dispatch<SetStateAction<boolean>>;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  setMixRadioSaveOpen: Dispatch<SetStateAction<boolean>>;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  mixRadioSessionRef: MutableRefObject<MixRadioSession | null>;
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  repeatModeRef: MutableRefObject<RepeatMode>;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  albumDrillTracksRef: MutableRefObject<CatalogTrack[]>;
  albumDrillAlbumRef: MutableRefObject<CatalogAlbum | null>;
  searchHitsRef: MutableRefObject<ResolvedSearchHit[]>;
  scheduleAutoSimilarRadioRef: MutableRefObject<ScheduleAutoSimilarRadioFn>;
  logLockerQueueInstrumentation: (
    phase: string,
    selectedSourceId: string | undefined,
    selectedIndex: number,
    envs: MediaEnvelope[],
  ) => void;
  seedLockerAlbumPlayQueue: (
    entries: LockerEntry[],
    albumTitle: string,
    artistName: string,
    selectedSourceId?: string,
    selectedTitle?: string,
  ) => { envs: MediaEnvelope[]; index: number } | null;
};

export function useShellPlayTriggers({
  audio,
  t,
  handlePlayEnvelope,
  findHitCandidates,
  primeLockerNativeQueueFrom,
  showAppToast,
  setHomeAwaitingUserResume,
  setMobilePlayerPending,
  setPlayQueue,
  setQueueIndex,
  setMixRadioSession,
  setRepeatMode,
  setShuffleOn,
  setMixRadioSaveOpen,
  playQueueRef,
  mixRadioSessionRef,
  autoSimilarRadioSeedRef,
  repeatModeRef,
  audioEnvelopeRef,
  albumDrillTracksRef,
  albumDrillAlbumRef,
  searchHitsRef,
  scheduleAutoSimilarRadioRef,
  logLockerQueueInstrumentation,
  seedLockerAlbumPlayQueue,
}: UseShellPlayTriggersArgs) {
  const scheduleAutoSimilarRadio = useCallback(
    (
      playable: MediaEnvelope,
      opts?: { seedSearchQueue?: boolean; seamless?: boolean; playQueueOverride?: MediaEnvelope[] },
    ) => {
      if (opts?.seamless) return;

      const queueNow = opts?.playQueueOverride ?? playQueueRef.current;
      const refQueue = playQueueRef.current;
      const lockerAlbumFromRef =
        refQueue.length > queueNow.length &&
        isLockerVaultPlayQueue(refQueue) &&
        refQueue.some((track) => track.envelopeId === playable.envelopeId)
          ? refQueue
          : null;
      const effectiveQueue = lockerAlbumFromRef ?? queueNow;
      if (
        autoSimilarRadioSeedRef.current === playable.envelopeId &&
        effectiveQueue.length > 1 &&
        effectiveQueue.some((track) => track.envelopeId === playable.envelopeId)
      ) {
        return;
      }

      const midRadio =
        Boolean(mixRadioSessionRef.current) &&
        effectiveQueue.length > 1 &&
        effectiveQueue.some((track) => track.envelopeId === playable.envelopeId);

      const primeRadioContinuation = (queue: MediaEnvelope[], index: number) => {
        void primeLockerNativeQueueFrom(queue, index);
        prefetchUpcomingQueueTracks({
          playQueue: queue,
          queueIndex: index,
          repeatMode: repeatModeRef.current,
          findCandidates: findHitCandidates,
          onResolvedUrl: (url, envelope) =>
            audio.prebufferUrl(url, {
              title: envelope.title,
              artist: envelope.artist,
              album: envelope.album,
              artworkUrl: envelope.artworkUrl,
              envelopeId: envelope.envelopeId,
            }),
        });
      };

      if (
        !opts?.seedSearchQueue &&
        effectiveQueue.length > 1 &&
        isLockerVaultPlayQueue(effectiveQueue) &&
        effectiveQueue.some((track) => track.envelopeId === playable.envelopeId)
      ) {
        const idx = effectiveQueue.findIndex((track) => track.envelopeId === playable.envelopeId);
        primeRadioContinuation(effectiveQueue, idx >= 0 ? idx : 0);
        return;
      }

      void startAutoSimilarRadioIfNeeded(
        {
          envelope: playable,
          playQueue: effectiveQueue,
          // Seeded singles must not be blocked by a stale album-drill listing
          // (e.g. American Dream still in refs after playing one locker track).
          albumTracks: opts?.seedSearchQueue ? undefined : albumDrillTracksRef.current,
          searchHits: searchHitsRef.current,
          albumTitle: opts?.seedSearchQueue ? undefined : albumDrillAlbumRef.current?.title,
          expectedTrackCount: opts?.seedSearchQueue
            ? undefined
            : albumDrillAlbumRef.current?.trackCount,
          seedSearchQueue: opts?.seedSearchQueue,
          hasMixRadioSession: midRadio,
        },
        {
          setPlayQueue,
          setQueueIndex,
          setMixRadioSession,
          setRepeatMode,
          setShuffleOn,
          isStillCurrent: () => audioEnvelopeRef.current?.envelopeId === playable.envelopeId,
          labelFor: (key) =>
            key === 'unknownTitle' ? t('player.unknownTitle') : t('player.unknownArtist'),
          persistRadioPlaylist: true,
        },
      ).then((result) => {
        if (!result.started) return;
        autoSimilarRadioSeedRef.current = playable.envelopeId;
        primeRadioContinuation(result.queue, result.index);
      });
    },
    [t, audio.prebufferUrl, findHitCandidates, primeLockerNativeQueueFrom],
  );
  scheduleAutoSimilarRadioRef.current = scheduleAutoSimilarRadio;

  const handleLockerTrackPlay = useCallback(
    async (env: MediaEnvelope): Promise<boolean> => {
      setHomeAwaitingUserResume(false);
      const artistName = env.artist?.trim() ?? '';
      const albumTitle = env.album?.trim();
      const sourceId = env.sourceId?.trim();
      const trackTitle = env.title?.trim() ?? '';

      if (albumTitle && artistName) {
        const snapshot = getLockerEntriesSnapshot() ?? [];
        const seeded = seedLockerAlbumPlayQueue(
          snapshot,
          albumTitle,
          artistName,
          sourceId,
          trackTitle,
        );
        if (seeded) {
          logLockerQueueInstrumentation('tap', sourceId, seeded.index, seeded.envs);
          const target = seeded.envs[seeded.index]!;
          const locker = await ensureLockerPlayable(target);
          if (locker.kind !== 'playable' || !locker.envelope.url?.trim()) {
            return false;
          }
          const playable = preserveTappedEnvelopeIdentity(target, locker.envelope);
          const started = await handlePlayEnvelope(playable, findHitCandidates(playable), {
            autoPlay: true,
            preservePlayQueue: true,
          });
          if (started) {
            await primeLockerNativeQueueFrom(seeded.envs, seeded.index);
            await audio.flushNativeExoEnqueueChain();
          }
          return started;
        }
      }

      return handlePlayEnvelope(env, findHitCandidates(env), {
        autoPlay: true,
        preservePlayQueue: true,
      });
    },
    [
      audio,
      findHitCandidates,
      handlePlayEnvelope,
      logLockerQueueInstrumentation,
      primeLockerNativeQueueFrom,
      seedLockerAlbumPlayQueue,
    ],
  );

  const handleSearchPlay = useCallback(
    (env: MediaEnvelope, candidates?: CandidateSource[]) => {
      /*
       * The entry point, logged before anything can swallow it. handlePlayEnvelope already times
       * itself, but a silent log there is ambiguous: it means either the tap was slow or the tap
       * never arrived, and those need opposite investigations. This line separates them — if it
       * appears and the timing does not, the play call itself is being dropped; if neither
       * appears, the gesture never reached this handler at all.
       */
      console.warn(
        `[handleSearchPlay] play requested track="${env.artist} — ${env.title}" ` +
          `provider=${env.provider} sources=${candidates?.length ?? 0}`,
      );
      void handlePlayEnvelope(env, candidates, { seedSearchQueue: true }).catch((err) => {
        console.warn('[handleSearchPlay] playback failed:', err);
        showAppToast(t('artist.playbackHybridUnavailable'), 3800);
        setMobilePlayerPending(false);
      });
    },
    [handlePlayEnvelope, showAppToast, t],
  );

  const handleStreamSearchHit = useCallback(
    (hit: ResolvedSearchHit) => {
      handleSearchPlay(hit.primaryEnvelope, hit.sources);
    },
    [handleSearchPlay],
  );

  const handleSonicLockerPlayQueue = useCallback(
    (tracks: MediaEnvelope[], shuffle = false) => {
      if (tracks.length === 0) return;
      const ordered = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
      setPlayQueue(ordered);
      setQueueIndex(0);
      setMixRadioSession({
        kind: 'radio',
        seedTitle: ordered[0]?.title?.trim() || t('player.unknownTitle'),
        seedArtist: ordered[0]?.artist?.trim() || t('player.unknownArtist'),
      });
      setShuffleOn(shuffle);
      handlePlayEnvelope(ordered[0], findHitCandidates(ordered[0]));
    },
    [handlePlayEnvelope, findHitCandidates, t],
  );

  const handleSonicLockerSaveMix = useCallback((tracks: MediaEnvelope[]) => {
    if (tracks.length === 0) return;
    setPlayQueue(tracks);
    setQueueIndex(0);
    setMixRadioSession({
      kind: 'radio',
      seedTitle: 'Sonic Locker',
      seedArtist: 'Saved mix',
    });
    setMixRadioSaveOpen(true);
  }, []);

  const handleSonicLockerDiscoveryStation = useCallback(
    (tracks: MediaEnvelope[]) => {
      if (tracks.length === 0) return;
      setPlayQueue(tracks);
      setQueueIndex(0);
      setMixRadioSession({
        kind: 'discovery-station',
        skipOnly: true,
        seedTitle: 'Discovery Station',
        seedArtist: 'Sonic Locker',
      });
      setShuffleOn(false);
      setRepeatMode('all');
      handlePlayEnvelope(tracks[0], findHitCandidates(tracks[0]));
    },
    [handlePlayEnvelope, findHitCandidates],
  );

  return {
    scheduleAutoSimilarRadio,
    handleLockerTrackPlay,
    handleSearchPlay,
    handleStreamSearchHit,
    handleSonicLockerPlayQueue,
    handleSonicLockerSaveMix,
    handleSonicLockerDiscoveryStation,
  };
}
