/**
 * Sandbox Connect V1 — host-authoritative command + SYNC_STATE protocol.
 * Relayed over tier34 WebSocket /peer-sync (no WebRTC).
 */

import type { MediaEnvelope, MediaProvider } from '../sandboxLayer1';

export type ConnectRole = 'host' | 'remote';

/** Persisted preference; resolved to ConnectRole at runtime. */
export type ConnectRolePref = 'auto' | 'host' | 'remote';

export type QueueEnvelopeSummary = {
  /** Same as envelopeId — stable track identity for PLAY / ADD_TO_QUEUE. */
  identityId: string;
  envelopeId: string;
  title: string;
  artist: string;
  artworkUrl?: string;
  provider?: MediaProvider;
  sourceId?: string;
  durationSeconds?: number;
  album?: string;
};

export type SyncStatePayload = {
  currentTrackId: string | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
  /** Host volume 0–1 */
  volume: number;
  playQueue: QueueEnvelopeSummary[];
  queueIndex: number;
};

export type ConnectCommand =
  | { cmd: 'PLAY'; envelopeId: string }
  | { cmd: 'PAUSE' }
  | { cmd: 'SKIP_NEXT' }
  | { cmd: 'SKIP_PREV' }
  | { cmd: 'SEEK_TO'; seconds: number }
  | { cmd: 'SET_VOLUME'; volume: number }
  | { cmd: 'ADD_TO_QUEUE'; envelopeId: string }
  | { cmd: 'REMOVE_QUEUE_ITEM'; index: number }
  /** Full playQueue indices (0 = first track, includes now-playing). */
  | { cmd: 'REORDER_QUEUE'; fromIndex: number; toIndex: number }
  | { cmd: 'CLEAR_QUEUE' };

export type ConnectHelloMessage = {
  type: 'hello';
  deviceId: string;
  deviceName: string;
  role: ConnectRole;
};

export type ConnectCommandMessage = {
  type: 'command';
  deviceId: string;
  command: ConnectCommand;
};

export type ConnectSyncStateMessage = {
  type: 'sync_state';
  payload: SyncStatePayload;
  heartbeat?: boolean;
};

export type ConnectWireMessage =
  | ConnectHelloMessage
  | ConnectCommandMessage
  | ConnectSyncStateMessage
  | { type: 'role_denied'; reason: string };

export function envelopeToQueueSummary(env: MediaEnvelope): QueueEnvelopeSummary {
  return {
    identityId: env.envelopeId,
    envelopeId: env.envelopeId,
    title: env.title,
    artist: env.artist,
    artworkUrl: env.artworkUrl,
    provider: env.provider,
    sourceId: env.sourceId,
    durationSeconds: env.durationSeconds,
    album: env.album,
  };
}

export function queueSummaryToEnvelope(summary: QueueEnvelopeSummary): MediaEnvelope {
  return {
    envelopeId: summary.envelopeId,
    title: summary.title,
    artist: summary.artist,
    url: '',
    durationSeconds: summary.durationSeconds ?? 0,
    provider: summary.provider ?? 'local-vault',
    transport: 'element-src',
    sourceId: summary.sourceId ?? summary.envelopeId,
    artworkUrl: summary.artworkUrl,
    album: summary.album,
  };
}

export function buildSyncState(input: {
  envelope: MediaEnvelope | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  isPlaying: boolean;
  volume: number;
  playQueue: MediaEnvelope[];
  queueIndex: number;
}): SyncStatePayload {
  return {
    currentTrackId: input.envelope?.envelopeId ?? null,
    currentTimeSeconds: input.currentTimeSeconds,
    durationSeconds: input.durationSeconds,
    isPlaying: input.isPlaying,
    volume: input.volume,
    playQueue: input.playQueue.map(envelopeToQueueSummary),
    queueIndex: input.queueIndex,
  };
}

export function parseConnectMessage(raw: unknown): ConnectWireMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const msg = raw as Record<string, unknown>;
  if (msg.type === 'hello' && typeof msg.deviceId === 'string' && typeof msg.role === 'string') {
    return msg as ConnectHelloMessage;
  }
  if (msg.type === 'command' && msg.command && typeof msg.deviceId === 'string') {
    return msg as ConnectCommandMessage;
  }
  if (msg.type === 'sync_state' && msg.payload) {
    return msg as ConnectSyncStateMessage;
  }
  if (msg.type === 'role_denied') {
    return msg as { type: 'role_denied'; reason: string };
  }
  return null;
}
