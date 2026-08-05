/**
 * Play-action wrappers for the shell — play an album/queue, explore-mix and discovery-mix
 * playback, artist/track radio, mix-radio save, and search-result play. Extracted from
 * sandboxLayer3 with no JSX.
 *
 * Call this hook at the original position, right after usePlaybackQueue. handlePlayAlbum is the
 * shared primitive nearly every other wrapper here calls. useShellQueueResume and
 * useShellDownloadMix both consume values returned from this hook (handlePlayAlbum and
 * handlePrepareForTravel respectively) and must stay in the shell, called right after this hook,
 * so their own call-position relative to heal / Android resume / Connect wiring is unaffected.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import type { ConnectCommand } from '../tier34/connectProtocol';
import type { ResolvedSearchHit } from '../sandboxLayer2';
import type { RepeatMode } from '../queuePersistence';
import type { DownloadTierPreference } from '../downloadQueue';
import type { DiscoverTabId } from '../stations/DiscoverStationView';
import type { LockerSectionId } from '../stations/CollectionView';
import type { MixRadioSaveMode } from '../components/MixRadioSaveDialog';
import type { DiscoveryMix } from '../discoveryMixes';
import {
  buildArtistMix,
  buildTrackRadio,
  discoveryMixRadioSession,
  prepareDiscoveryMixQueue,
  saveMixRadioToLocker,
  type MixRadioSession,
} from '../playerMixRadio';
import { createPlaylistWithTracks } from '../playlistStorage';
import { prepareTracksForTravel } from '../prepareForTravel';
import { discoveryMixAsPlaylist } from '../discoveryMixShare';
import { shareOrDownloadPlaylist } from '../playlistCollaborativeShare';

type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  opts?: unknown,
) => Promise<boolean> | boolean | void | Promise<void>;

export type UseShellPlayActionsArgs = {
  audio: UseAudioFSMResult;
  isConnectRemoteRef: MutableRefObject<boolean>;
  sendConnectCommand: (command: ConnectCommand) => void;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndexRef: MutableRefObject<number>;
  setRepeatMode: Dispatch<SetStateAction<RepeatMode>>;
  setShuffleOn: Dispatch<SetStateAction<boolean>>;
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  mixRadioSession: MixRadioSession | null;
  playQueue: MediaEnvelope[];
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  primeLockerNativeQueueFrom: (tracks: MediaEnvelope[], fromIndex: number) => Promise<void>;
  handlePlayEnvelope: PlayEnvelopeFn;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[] | undefined;
  syncThumbsFromFeedback: (envelopeId?: string) => void;
  setArtworkUrl: Dispatch<SetStateAction<string>>;
  showAppToast: (msg: string, durationMs?: number) => void;
  setAppToast: Dispatch<SetStateAction<string | null>>;
  goToDiscover: (tab?: DiscoverTabId) => void;
  setLockerSection: Dispatch<SetStateAction<LockerSectionId>>;
  setMixRadioSaveOpen: Dispatch<SetStateAction<boolean>>;
  setMixRadioSaveBusy: Dispatch<SetStateAction<boolean>>;
  downloadTierPreference: DownloadTierPreference;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

export function useShellPlayActions({
  audio,
  isConnectRemoteRef,
  sendConnectCommand,
  setPlayQueue,
  setQueueIndex,
  playQueueRef,
  queueIndexRef,
  setRepeatMode,
  setShuffleOn,
  setMixRadioSession,
  mixRadioSession,
  playQueue,
  autoSimilarRadioSeedRef,
  primeLockerNativeQueueFrom,
  handlePlayEnvelope,
  findHitCandidates,
  syncThumbsFromFeedback,
  setArtworkUrl,
  showAppToast,
  setAppToast,
  goToDiscover,
  setLockerSection,
  setMixRadioSaveOpen,
  setMixRadioSaveBusy,
  downloadTierPreference,
  t,
}: UseShellPlayActionsArgs) {
  const handlePlayAlbum = useCallback(
    async (
      tracks: MediaEnvelope[],
      shuffle?: boolean,
      options?: {
        fromMixRadio?: MixRadioSession;
        /** Resume point — chapter to open on, and where inside it to land. */
        startIndex?: number;
        startSeconds?: number;
      },
    ) => {
      if (tracks.length === 0) return;
      if (!options?.fromMixRadio) {
        setMixRadioSession(null);
        autoSimilarRadioSeedRef.current = null;
      }
      if (isConnectRemoteRef.current) {
        const ordered = shuffle
          ? [...tracks].sort(() => Math.random() - 0.5)
          : [...tracks];
        const first = ordered[0];
        if (first) sendConnectCommand({ cmd: 'PLAY', envelopeId: first.envelopeId });
        for (let i = 1; i < ordered.length; i++) {
          sendConnectCommand({ cmd: 'ADD_TO_QUEUE', envelopeId: ordered[i].envelopeId });
        }
        if (options?.fromMixRadio) setMixRadioSession(options.fromMixRadio);
        return;
      }
      const ordered = shuffle
        ? [...tracks].sort(() => Math.random() - 0.5)
        : [...tracks];
      const startIndex = Math.min(
        Math.max(0, Math.floor(options?.startIndex ?? 0)),
        ordered.length - 1,
      );
      setPlayQueue(ordered);
      setQueueIndex(startIndex);
      playQueueRef.current = ordered;
      queueIndexRef.current = startIndex;
      if (ordered.length > 1) {
        setRepeatMode((mode) => (mode === 'one' ? 'none' : mode));
      }
      if (options?.fromMixRadio) setMixRadioSession(options.fromMixRadio);
      const first = ordered[startIndex];
      const primePromise = primeLockerNativeQueueFrom(ordered, startIndex);
      const started = await handlePlayEnvelope(first, findHitCandidates(first));
      await primePromise;
      if (started && ordered.length > 1) {
        await primeLockerNativeQueueFrom(ordered, startIndex);
      }
      /*
       * Seek after playback starts, not before — the position is meaningless until the media is
       * loaded. Below a couple of seconds is not worth a seek: it would trade a visible jump for
       * nothing a listener would notice.
       */
      const startSeconds = options?.startSeconds ?? 0;
      if (started && startSeconds > 2) audio.seek(startSeconds);
    },
    [handlePlayEnvelope, findHitCandidates, sendConnectCommand, primeLockerNativeQueueFrom, audio],
  );

  const handleExploreInstantMix = useCallback(
    (tracks: MediaEnvelope[], label: string) => {
      if (tracks.length === 0) return;
      handlePlayAlbum(tracks, false, {
        fromMixRadio: {
          kind: 'radio',
          seedTitle: label,
          seedArtist: 'Explore mix',
        },
      });
    },
    [handlePlayAlbum],
  );

  const handlePlayDiscoveryMix = useCallback(
    (tracks: MediaEnvelope[], mix: DiscoveryMix) => {
      if (tracks.length === 0) return;
      const ordered = prepareDiscoveryMixQueue(mix, tracks);
      setRepeatMode('all');
      setShuffleOn(false);
      handlePlayAlbum(ordered, false, { fromMixRadio: discoveryMixRadioSession(mix) });
    },
    [handlePlayAlbum, setRepeatMode, setShuffleOn],
  );

  const handleSaveInstantPlaylist = useCallback(
    (tracks: MediaEnvelope[], name: string) => {
      if (tracks.length === 0) return;
      createPlaylistWithTracks(name.trim() || 'Explore mix', tracks, 'Instant explore mix');
      showAppToast(`Saved "${name.trim() || 'Explore mix'}"`);
      goToDiscover('playlists');
    },
    [goToDiscover, showAppToast],
  );

  const handlePrepareForTravel = useCallback(
    async (tracks: MediaEnvelope[]) => {
      if (tracks.length === 0) return;
      const result = await prepareTracksForTravel(tracks, {
        findCandidates: findHitCandidates,
      });
      if (result.blockedReason === 'cellular') {
        showAppToast(t('travel.wifiRequired'), 4500);
        return;
      }
      if (result.blockedReason === 'offline') {
        showAppToast(t('travel.offlineBlocked'), 4500);
        return;
      }
      if (result.blockedReason === 'empty') return;
      const remoteCount = tracks.filter(
        (tr) =>
          tr.provider !== 'local-vault' &&
          tr.provider !== 'stream-cache' &&
          tr.provider !== 'indexeddb' &&
          tr.provider !== 'blob',
      ).length;
      if (remoteCount > 0) {
        showAppToast(t('travel.started', { count: remoteCount }), 3200);
      }
      const syncPart =
        result.syncPulled > 0
          ? t('travel.syncPart', { syncPulled: result.syncPulled })
          : '';
      if (result.prefetched === 0 && result.failed === 0 && remoteCount === 0) {
        showAppToast(t('travel.nothingToDo'), 4000);
        return;
      }
      if (result.failed > 0) {
        showAppToast(
          t('travel.donePartial', { prefetched: result.prefetched, failed: result.failed }),
          5200,
        );
        return;
      }
      showAppToast(
        t('travel.done', {
          prefetched: result.prefetched,
          skippedLocal: result.skippedLocal,
          syncPart,
        }),
        5200,
      );
    },
    [findHitCandidates, showAppToast, t],
  );

  const handleShareMix = useCallback(
    async (mix: DiscoveryMix) => {
      if (mix.tracks.length === 0) return;
      try {
        const result = await shareOrDownloadPlaylist(discoveryMixAsPlaylist(mix), 'm3u');
        if (result === 'shared') showAppToast('Mix shared');
        else if (result === 'clipboard') showAppToast('M3U copied to clipboard');
        else showAppToast('M3U downloaded');
      } catch (err) {
        // The share sheet resolves as AbortError when the user backs out — not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        showAppToast('Share failed', 4000);
      }
    },
    [showAppToast],
  );

  const handleArtistMix = useCallback(async () => {
    const seed = audio.envelope;
    if (!seed || audio.state === 'Idle') return;
    const tracks = await buildArtistMix(seed);
    if (tracks.length === 0) return;
    const session: MixRadioSession = {
      kind: 'mix',
      seedTitle: seed.title?.trim() || t('player.unknownTitle'),
      seedArtist: seed.artist?.trim() || t('player.unknownArtist'),
    };
    setShuffleOn(true);
    handlePlayAlbum(tracks, false, { fromMixRadio: session });
  }, [audio.envelope, audio.state, handlePlayAlbum, t, setShuffleOn]);

  const handleTrackRadio = useCallback(async () => {
    const seed = audio.envelope;
    if (!seed || audio.state === 'Idle') return;
    const tracks = await buildTrackRadio(seed);
    if (tracks.length === 0) return;
    const session: MixRadioSession = {
      kind: 'radio',
      seedTitle: seed.title?.trim() || t('player.unknownTitle'),
      seedArtist: seed.artist?.trim() || t('player.unknownArtist'),
    };
    setRepeatMode('all');
    setShuffleOn(false);
    handlePlayAlbum(tracks, false, { fromMixRadio: session });
  }, [audio.envelope, audio.state, handlePlayAlbum, t, setRepeatMode, setShuffleOn]);

  const handleSaveMixRadio = useCallback(
    (name: string, mode: MixRadioSaveMode) => {
      if (!mixRadioSession || playQueue.length === 0) return;
      if (mode === 'playlist') {
        const description =
          mixRadioSession.kind === 'mix'
            ? t('player.mixRadioSave.descriptionMix')
            : t('player.mixRadioSave.descriptionRadio');
        createPlaylistWithTracks(name, playQueue, description);
        setMixRadioSaveOpen(false);
        setLockerSection('playlists');
        setAppToast(t('player.mixRadioSave.toast'));
        return;
      }

      setMixRadioSaveBusy(true);
      void saveMixRadioToLocker(playQueue, downloadTierPreference, name)
        .then((result) => {
          setMixRadioSaveOpen(false);
          if (result.downloaded > 0 && result.failed > 0) {
            setAppToast(
              t('player.mixRadioSave.toastLockerPartial', {
                downloaded: result.downloaded,
                failed: result.failed,
              }),
            );
          } else if (result.downloaded > 0) {
            setAppToast(t('player.mixRadioSave.toastLocker'));
          } else if (result.skipped === playQueue.length) {
            setAppToast(t('player.mixRadioSave.toastLockerAlready'));
          } else {
            setAppToast(t('player.mixRadioSave.toastLockerFailed'));
          }
          if (result.downloaded > 0) {
            setLockerSection('artists');
          }
        })
        .catch(() => {
          setAppToast(t('player.mixRadioSave.toastLockerFailed'));
        })
        .finally(() => {
          setMixRadioSaveBusy(false);
        });
    },
    [
      mixRadioSession,
      playQueue,
      t,
      downloadTierPreference,
      setMixRadioSaveOpen,
      setLockerSection,
      setAppToast,
      setMixRadioSaveBusy,
    ],
  );

  const handlePlaySource = useCallback(
    (source: CandidateSource, hit: ResolvedSearchHit) => {
      syncThumbsFromFeedback(source.id);
      void handlePlayEnvelope(
        {
          envelopeId: source.id,
          title: source.metadata?.title ?? hit.title,
          artist: source.metadata?.artist ?? hit.artist,
          url: source.uri ?? '',
          durationSeconds: source.metadata?.durationSeconds ?? 0,
          provider: source.provider,
          transport: source.transport,
          sourceId: source.id,
          mimeType: source.mimeType,
          artworkUrl: source.metadata?.artworkUrl ?? hit.artworkUrl,
        },
        hit.sources,
        { seedSearchQueue: true, seedSearchEnvelope: hit.primaryEnvelope },
      );
      if (hit.artworkUrl) setArtworkUrl(hit.artworkUrl);
    },
    [handlePlayEnvelope, syncThumbsFromFeedback, setArtworkUrl],
  );

  return {
    handlePlayAlbum,
    handleExploreInstantMix,
    handlePlayDiscoveryMix,
    handleSaveInstantPlaylist,
    handlePrepareForTravel,
    handleShareMix,
    handleArtistMix,
    handleTrackRadio,
    handleSaveMixRadio,
    handlePlaySource,
  };
}
