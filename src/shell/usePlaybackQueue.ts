/**
 * Play-queue mutation helpers for the shell — add/remove/reorder, play-next, clear,
 * save-as-playlist, and podcast "queue unplayed". Extracted from sandboxLayer3 with no JSX.
 *
 * Queue state (playQueue / queueIndex / shuffle / repeat) and persistence effects stay in the
 * shell so their registration order relative to play / exo / Connect effects is unchanged.
 */

import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import type { ConnectCommand } from '../tier34/connectProtocol';
import {
  buildPodcastQueueForFeed,
  loadSovereignUpNextSettings,
  mergeIntoUpNextQueue,
} from '../sovereignUpNext';
import { createPlaylistWithTracks } from '../playlistStorage';
import { clearPersistedQueue } from '../queuePersistence';
import type { MixRadioSession } from '../playerMixRadio';

type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  opts?: unknown,
) => Promise<boolean> | boolean | void | Promise<void>;

export type UsePlaybackQueueArgs = {
  playQueue: MediaEnvelope[];
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  queueIndex: number;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  isConnectRemoteRef: MutableRefObject<boolean>;
  sendConnectCommand: (command: ConnectCommand) => void;
  handlePlayEnvelope: PlayEnvelopeFn;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[];
  setMixRadioSession: Dispatch<SetStateAction<MixRadioSession | null>>;
  autoSimilarRadioSeedRef: MutableRefObject<string | null>;
  sovereignUpNextPodcastCountRef: MutableRefObject<number>;
  showAppToast: (msg: string, durationMs?: number) => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
};

export function usePlaybackQueue({
  playQueue,
  setPlayQueue,
  queueIndex,
  setQueueIndex,
  isConnectRemoteRef,
  sendConnectCommand,
  handlePlayEnvelope,
  findHitCandidates,
  setMixRadioSession,
  autoSimilarRadioSeedRef,
  sovereignUpNextPodcastCountRef,
  showAppToast,
  t,
}: UsePlaybackQueueArgs) {
  const handleAddToQueue = useCallback((tracks: MediaEnvelope[]) => {
    if (tracks.length === 0) return;
    if (isConnectRemoteRef.current) {
      for (const env of tracks) {
        sendConnectCommand({ cmd: 'ADD_TO_QUEUE', envelopeId: env.envelopeId });
      }
      return;
    }
    setPlayQueue((q) =>
      mergeIntoUpNextQueue(q, queueIndex, tracks, loadSovereignUpNextSettings()),
    );
  }, [sendConnectCommand, queueIndex, isConnectRemoteRef, setPlayQueue]);

  const handleRemoveFromQueue = useCallback(
    (index: number) => {
      if (isConnectRemoteRef.current) {
        sendConnectCommand({ cmd: 'REMOVE_QUEUE_ITEM', index });
        return;
      }
      setPlayQueue((q) => {
        if (index < 0 || index >= q.length) return q;
        const filtered = q.filter((_, i) => i !== index);
        if (index === queueIndex) {
          if (filtered.length === 0) {
            setQueueIndex(0);
          } else {
            const nextIdx = Math.min(index, filtered.length - 1);
            setQueueIndex(nextIdx);
            const track = filtered[nextIdx];
            void handlePlayEnvelope(track, findHitCandidates(track));
          }
        } else if (index < queueIndex) {
          setQueueIndex((i) => Math.max(0, i - 1));
        }
        return filtered;
      });
    },
    [queueIndex, handlePlayEnvelope, findHitCandidates, sendConnectCommand, isConnectRemoteRef, setPlayQueue, setQueueIndex],
  );

  const handleReorderUpNext = useCallback((fromRel: number, toRel: number) => {
    if (fromRel === toRel) return;
    if (isConnectRemoteRef.current) {
      const fromIndex = queueIndex + 1 + fromRel;
      const toIndex = queueIndex + 1 + toRel;
      sendConnectCommand({ cmd: 'REORDER_QUEUE', fromIndex, toIndex });
      return;
    }
    setPlayQueue((q) => {
      const start = queueIndex + 1;
      const tail = q.slice(start);
      if (fromRel < 0 || fromRel >= tail.length || toRel < 0 || toRel >= tail.length) {
        return q;
      }
      const reordered = [...tail];
      const [moved] = reordered.splice(fromRel, 1);
      reordered.splice(toRel, 0, moved);
      return [...q.slice(0, start), ...reordered];
    });
  }, [queueIndex, sendConnectCommand, isConnectRemoteRef, setPlayQueue]);

  const handleReorderQueue = useCallback((fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'REORDER_QUEUE', fromIndex, toIndex });
      return;
    }
    setPlayQueue((q) => {
      if (fromIndex < 0 || fromIndex >= q.length || toIndex < 0 || toIndex >= q.length) return q;
      const next = [...q];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
    setQueueIndex((qi) => {
      if (qi === fromIndex) return toIndex;
      if (fromIndex < qi && toIndex >= qi) return qi - 1;
      if (fromIndex > qi && toIndex <= qi) return qi + 1;
      return qi;
    });
  }, [sendConnectCommand, isConnectRemoteRef, setPlayQueue, setQueueIndex]);

  const handleClearQueue = useCallback(() => {
    if (isConnectRemoteRef.current) {
      sendConnectCommand({ cmd: 'CLEAR_QUEUE' });
      return;
    }
    setPlayQueue([]);
    setQueueIndex(0);
    setMixRadioSession(null);
    autoSimilarRadioSeedRef.current = null;
    sovereignUpNextPodcastCountRef.current = 0;
    clearPersistedQueue();
  }, [
    sendConnectCommand,
    isConnectRemoteRef,
    setPlayQueue,
    setQueueIndex,
    setMixRadioSession,
    autoSimilarRadioSeedRef,
    sovereignUpNextPodcastCountRef,
  ]);

  const handleSaveQueueAsPlaylist = useCallback(
    (name: string) => {
      if (playQueue.length === 0) return;
      createPlaylistWithTracks(name, playQueue, 'Saved from play queue');
    },
    [playQueue],
  );

  const handlePlayNext = useCallback(
    (tracks: MediaEnvelope[]) => {
      if (tracks.length === 0) return;
      if (isConnectRemoteRef.current) {
        for (const env of tracks) {
          sendConnectCommand({ cmd: 'ADD_TO_QUEUE', envelopeId: env.envelopeId });
        }
        return;
      }
      setPlayQueue((q) =>
        mergeIntoUpNextQueue(
          q,
          queueIndex,
          tracks,
          loadSovereignUpNextSettings(),
          'play-next',
        ),
      );
    },
    [queueIndex, sendConnectCommand, isConnectRemoteRef, setPlayQueue],
  );

  const handleQueueShowUnplayed = useCallback(
    (feedId: string) => {
      const settings = loadSovereignUpNextSettings();
      const tracks = buildPodcastQueueForFeed(feedId, {
        unplayedOnly: true,
        newestFirst: settings.insertNewestAtTop,
      });
      if (tracks.length === 0) {
        showAppToast('No unplayed episodes in this show.');
        return;
      }
      handleAddToQueue(tracks);
      showAppToast(t('player.sovereignUpNext.queuedUnplayed', { count: tracks.length }));
    },
    [handleAddToQueue, showAppToast, t],
  );

  return {
    handleAddToQueue,
    handleRemoveFromQueue,
    handleReorderUpNext,
    handleReorderQueue,
    handleClearQueue,
    handleSaveQueueAsPlaylist,
    handlePlayNext,
    handleQueueShowUnplayed,
  };
}
