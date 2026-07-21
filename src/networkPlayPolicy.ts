/**
 * Network-aware playback policy — cellular warnings, Wi‑Fi prefetch, aggressive cache gating.
 */

import type { MediaEnvelope } from './sandboxLayer1';

type NetworkConnection = {
  type?: string;
  effectiveType?: string;
  saveData?: boolean;
};

function readConnection(): NetworkConnection | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const nav = navigator as Navigator & {
    connection?: NetworkConnection;
    mozConnection?: NetworkConnection;
    webkitConnection?: NetworkConnection;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

export function isCellularNetwork(): boolean {
  const conn = readConnection();
  if (!conn) return false;
  if (conn.saveData) return true;
  const type = (conn.type ?? '').toLowerCase();
  return type === 'cellular' || type === 'wimax';
}

export function isWifiNetwork(): boolean {
  const conn = readConnection();
  if (!conn) return true;
  if (conn.saveData) return false;
  const type = (conn.type ?? '').toLowerCase();
  if (type === 'wifi' || type === 'ethernet' || type === 'none') return true;
  if (type === 'cellular' || type === 'wimax') return false;
  return true;
}

/** Aggressive full-track cache runs after play — skip on cellular to protect first audible frame. */
export function shouldRunAggressiveCacheOnNetwork(): boolean {
  return !isCellularNetwork();
}

/** ~128 kbps AAC estimate when Content-Length is unknown. */
export function estimateStreamDownloadMb(
  env: MediaEnvelope,
  bitrateKbps = 128,
): number {
  const seconds = env.durationSeconds;
  if (seconds > 0 && Number.isFinite(seconds)) {
    return Math.max(0.3, (seconds * bitrateKbps) / 8 / 1024);
  }
  return 3.5;
}

export function formatCellularDownloadNotice(mb: number): string {
  const rounded = mb < 10 ? mb.toFixed(1) : Math.round(mb).toString();
  return `Streaming ~${rounded} MB on cellular`;
}

export function needsUncachedRemoteResolve(env: MediaEnvelope): boolean {
  if (env.provider === 'local-vault' || env.provider === 'stream-cache') return false;
  if (env.provider === 'indexeddb' || env.provider === 'blob') return false;
  const url = env.url?.trim() ?? '';
  return !url;
}
