/**
 * Connect (peer sync) wiring for the shell — role prefs, remote mirror, and command send.
 *
 * Split into two hooks so effect registration order in SandboxShell stays unchanged:
 * - useShellConnect — prefs + sendConnectCommand (early call site)
 * - useShellConnectRuntime — command handling + ConnectClient lifecycle (late call site)
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { CandidateSource, MediaEnvelope, UseAudioFSMResult } from '../sandboxLayer1';
import { ConnectClient } from '../tier34/peerSync';
import {
  buildSyncState,
  queueSummaryToEnvelope,
  type ConnectCommand,
  type SyncStatePayload,
} from '../tier34/connectProtocol';
import {
  getOrCreateConnectDeviceId,
  loadConnectDeviceName,
  loadConnectRolePref,
  loadNetworkSyncEnabled,
  resolveConnectRole,
} from '../sandboxSettings';
import { proxiedArtworkUrl } from '../displaySanitize';

type PlayEnvelopeFn = (
  env: MediaEnvelope,
  candidates?: CandidateSource[],
  opts?: unknown,
) => Promise<boolean> | boolean | void | Promise<void>;

export function useShellConnect() {
  const connectClientRef = useRef<ConnectClient | null>(null);
  const isConnectRemoteRef = useRef(false);
  const [connectRolePref, setConnectRolePref] = useState(loadConnectRolePref);
  const [networkSyncEnabled, setNetworkSyncEnabled] = useState(loadNetworkSyncEnabled);
  const [remoteMirror, setRemoteMirror] = useState<SyncStatePayload | null>(null);
  const effectiveConnectRole = networkSyncEnabled
    ? resolveConnectRole(connectRolePref)
    : null;
  isConnectRemoteRef.current = effectiveConnectRole === 'remote';
  useEffect(() => {
    const sync = () => {
      setConnectRolePref(loadConnectRolePref());
      setNetworkSyncEnabled(loadNetworkSyncEnabled());
    };
    window.addEventListener('storage', sync);
    window.addEventListener('sandbox-settings-change', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('sandbox-settings-change', sync);
    };
  }, []);

  const sendConnectCommand = useCallback((command: ConnectCommand) => {
    connectClientRef.current?.sendCommand(command);
  }, []);

  return {
    connectClientRef,
    isConnectRemoteRef,
    connectRolePref,
    networkSyncEnabled,
    remoteMirror,
    setRemoteMirror,
    effectiveConnectRole,
    sendConnectCommand,
  };
}

export type ShellConnectRuntimeArgs = {
  audio: UseAudioFSMResult;
  playQueue: MediaEnvelope[];
  queueIndex: number;
  setPlayQueue: Dispatch<SetStateAction<MediaEnvelope[]>>;
  setQueueIndex: Dispatch<SetStateAction<number>>;
  setArtworkUrl: Dispatch<SetStateAction<string>>;
  setRemoteMirror: Dispatch<SetStateAction<SyncStatePayload | null>>;
  effectiveConnectRole: ReturnType<typeof resolveConnectRole> | null;
  networkSyncEnabled: boolean;
  connectClientRef: MutableRefObject<ConnectClient | null>;
  resolveEnvelopeById: (envelopeId: string) => MediaEnvelope | null;
  playEnvelopeRef: MutableRefObject<PlayEnvelopeFn>;
  findHitCandidates: (env: MediaEnvelope) => CandidateSource[];
  skipForward: () => void;
  skipBack: () => void;
  handleAddToQueue: (tracks: MediaEnvelope[]) => void;
  handleRemoveFromQueue: (index: number) => void;
  handleReorderQueue: (fromIndex: number, toIndex: number) => void;
  handleClearQueue: () => void;
  audioEnvelopeRef: MutableRefObject<MediaEnvelope | null>;
  audioCurrentTimeRef: MutableRefObject<number>;
  audioDurationRef: MutableRefObject<number>;
  audioStateRef: MutableRefObject<UseAudioFSMResult['state']>;
  audioVolumeRef: MutableRefObject<number>;
  playQueueRef: MutableRefObject<MediaEnvelope[]>;
  queueIndexRef: MutableRefObject<number>;
};

export function useShellConnectRuntime({
  audio,
  playQueue,
  queueIndex,
  setPlayQueue,
  setQueueIndex,
  setArtworkUrl,
  setRemoteMirror,
  effectiveConnectRole,
  networkSyncEnabled,
  connectClientRef,
  resolveEnvelopeById,
  playEnvelopeRef,
  findHitCandidates,
  skipForward,
  skipBack,
  handleAddToQueue,
  handleRemoveFromQueue,
  handleReorderQueue,
  handleClearQueue,
  audioEnvelopeRef,
  audioCurrentTimeRef,
  audioDurationRef,
  audioStateRef,
  audioVolumeRef,
  playQueueRef,
  queueIndexRef,
}: ShellConnectRuntimeArgs) {
  const resolveEnvelopeByIdRef = useRef(resolveEnvelopeById);
  resolveEnvelopeByIdRef.current = resolveEnvelopeById;

  const applyRemoteSyncState = useCallback((payload: SyncStatePayload) => {
    setRemoteMirror(payload);
    setPlayQueue(payload.playQueue.map(queueSummaryToEnvelope));
    setQueueIndex(payload.queueIndex);
    const track = payload.playQueue[payload.queueIndex];
    if (track?.artworkUrl) setArtworkUrl(proxiedArtworkUrl(track.artworkUrl) ?? track.artworkUrl);
  }, [setRemoteMirror, setPlayQueue, setQueueIndex, setArtworkUrl]);

  const handleConnectCommand = useCallback((command: ConnectCommand) => {
    switch (command.cmd) {
      case 'PLAY': {
        const env = resolveEnvelopeByIdRef.current(command.envelopeId);
        if (env) void playEnvelopeRef.current(env, findHitCandidates(env));
        break;
      }
      case 'PAUSE':
        audio.pause();
        break;
      case 'SKIP_NEXT':
        skipForward();
        break;
      case 'SKIP_PREV':
        skipBack();
        break;
      case 'SEEK_TO':
        audio.seek(command.seconds);
        break;
      case 'SET_VOLUME':
        audio.setVolume(command.volume);
        break;
      case 'ADD_TO_QUEUE': {
        const env = resolveEnvelopeByIdRef.current(command.envelopeId);
        if (env) handleAddToQueue([env]);
        break;
      }
      case 'REMOVE_QUEUE_ITEM':
        handleRemoveFromQueue(command.index);
        break;
      case 'REORDER_QUEUE':
        handleReorderQueue(command.fromIndex, command.toIndex);
        break;
      case 'CLEAR_QUEUE':
        handleClearQueue();
        break;
      default:
        break;
    }
  }, [audio, skipForward, skipBack, handleAddToQueue, handleRemoveFromQueue, handleReorderQueue, handleClearQueue, findHitCandidates]);

  const handleConnectCommandRef = useRef(handleConnectCommand);
  handleConnectCommandRef.current = handleConnectCommand;

  const publishHostSyncState = useCallback(() => {
    if (effectiveConnectRole !== 'host') return;
    connectClientRef.current?.publishState(
      buildSyncState({
        envelope: audio.envelope,
        currentTimeSeconds: audio.currentTimeSeconds,
        durationSeconds: audio.durationSeconds,
        isPlaying: audio.state === 'Playing',
        volume: audio.volume,
        playQueue,
        queueIndex,
      }),
    );
  }, [
    effectiveConnectRole,
    audio.envelope,
    audio.currentTimeSeconds,
    audio.durationSeconds,
    audio.state,
    audio.volume,
    playQueue,
    queueIndex,
  ]);

  useEffect(() => {
    if (!networkSyncEnabled || !effectiveConnectRole) {
      connectClientRef.current?.disconnect();
      connectClientRef.current = null;
      setRemoteMirror(null);
      return;
    }
    const client = new ConnectClient({
      room: 'sandbox-room',
      role: effectiveConnectRole,
      deviceId: getOrCreateConnectDeviceId(),
      deviceName: loadConnectDeviceName(),
    });
    connectClientRef.current = client;
    client.connect();

    let unsubState: (() => void) | undefined;
    let unsubCommand: (() => void) | undefined;

    if (effectiveConnectRole === 'remote') {
      unsubState = client.subscribeState((payload) => applyRemoteSyncState(payload));
    } else {
      unsubCommand = client.subscribeCommand((cmd) => handleConnectCommandRef.current(cmd));
      client.startHeartbeat(() =>
        buildSyncState({
          envelope: audioEnvelopeRef.current,
          currentTimeSeconds: audioCurrentTimeRef.current,
          durationSeconds: audioDurationRef.current,
          isPlaying: audioStateRef.current === 'Playing',
          volume: audioVolumeRef.current,
          playQueue: playQueueRef.current,
          queueIndex: queueIndexRef.current,
        }),
      );
    }

    return () => {
      unsubState?.();
      unsubCommand?.();
      client.disconnect();
      if (connectClientRef.current === client) connectClientRef.current = null;
    };
  }, [networkSyncEnabled, effectiveConnectRole, applyRemoteSyncState]);

  useEffect(() => {
    if (effectiveConnectRole !== 'host') return;
    publishHostSyncState();
  }, [effectiveConnectRole, publishHostSyncState]);
}
