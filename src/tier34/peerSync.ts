/**
 * Sandbox Connect — WebSocket client for tier34 /peer-sync relay.
 * Host publishes SYNC_STATE; remotes send commands.
 */

import { loadNetworkSyncEnabled } from '../sandboxSettings';
import { peerSyncWsUrl } from './client';
import {
  type ConnectCommand,
  type ConnectRole,
  type ConnectWireMessage,
  parseConnectMessage,
  type SyncStatePayload,
} from './connectProtocol';

export function isNetworkSyncEnabled(): boolean {
  return loadNetworkSyncEnabled();
}

type StateListener = (payload: SyncStatePayload) => void;
type CommandListener = (command: ConnectCommand, fromDeviceId: string) => void;

export type ConnectClientOptions = {
  room?: string;
  role: ConnectRole;
  deviceId: string;
  deviceName: string;
};

export class ConnectClient {
  private ws: WebSocket | null = null;
  private stateListeners = new Set<StateListener>();
  private commandListeners = new Set<CommandListener>();
  private room: string;
  private role: ConnectRole;
  private deviceId: string;
  private deviceName: string;
  private reconnectTimer: number | null = null;
  private heartbeatTimer: number | null = null;
  private getHeartbeatState: (() => SyncStatePayload) | null = null;

  constructor(opts: ConnectClientOptions) {
    this.room = opts.room ?? 'sandbox-room';
    this.role = opts.role;
    this.deviceId = opts.deviceId;
    this.deviceName = opts.deviceName;
  }

  connect(): void {
    if (!isNetworkSyncEnabled()) return;
    if (this.ws?.readyState === WebSocket.OPEN) return;
    try {
      this.ws = new WebSocket(peerSyncWsUrl(this.room));
      this.ws.onopen = () => {
        this.sendWire({
          type: 'hello',
          deviceId: this.deviceId,
          deviceName: this.deviceName,
          role: this.role,
        });
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg = parseConnectMessage(JSON.parse(String(ev.data)));
          if (!msg) return;
          if (msg.type === 'sync_state') {
            for (const fn of this.stateListeners) fn(msg.payload);
          } else if (msg.type === 'command') {
            for (const fn of this.commandListeners) fn(msg.command, msg.deviceId);
          }
        } catch {
          /* ignore */
        }
      };
      this.ws.onclose = () => {
        this.ws = null;
        this.reconnectTimer = window.setTimeout(() => this.connect(), 3000);
      };
    } catch {
      /* ignore */
    }
  }

  disconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.ws?.close();
    this.ws = null;
  }

  private sendWire(msg: ConnectWireMessage): void {
    if (!isNetworkSyncEnabled() || this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  sendCommand(command: ConnectCommand): void {
    this.sendWire({ type: 'command', deviceId: this.deviceId, command });
  }

  publishState(payload: SyncStatePayload, heartbeat = false): void {
    if (this.role !== 'host') return;
    this.sendWire({ type: 'sync_state', payload, ...(heartbeat ? { heartbeat: true } : {}) });
  }

  subscribeState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }

  subscribeCommand(fn: CommandListener): () => void {
    this.commandListeners.add(fn);
    return () => this.commandListeners.delete(fn);
  }

  /** Host-only periodic SYNC_STATE heartbeat. */
  startHeartbeat(getState: () => SyncStatePayload, intervalMs = 4000): void {
    this.stopHeartbeat();
    this.getHeartbeatState = getState;
    this.heartbeatTimer = window.setInterval(() => {
      const payload = this.getHeartbeatState?.();
      if (payload) this.publishState(payload, true);
    }, intervalMs);
  }

  stopHeartbeat(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.getHeartbeatState = null;
  }
}

/** @deprecated Use ConnectClient — kept for type compatibility during migration. */
export type PeerPlaybackPayload = {
  envelopeId: string;
  title: string;
  artist: string;
  state: string;
  currentTimeSeconds: number;
  isPlaying: boolean;
};
