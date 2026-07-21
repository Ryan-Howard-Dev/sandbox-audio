/**
 * Tauri bridge for embedded Sandbox Server sidecar (start/stop).
 * Spawns bundled `tier34-server.mjs` (packaged) or `npx tsx tier34-server/index.ts` (dev).
 */

import { tier34HealthOk } from './tier34/client';
import { canHostSandboxServerAnchor } from './platformEnv';
import {
  loadSandboxServerAutoStart,
  loadSandboxServerMode,
  syncTier34BackendUrlFromServerMode,
} from './sandboxSettings';

export type Tier34StartPhase = 'starting' | 'waiting' | 'ready' | 'failed';

let lastTier34StartError: string | null = null;

export function getLastTier34StartError(): string | null {
  return lastTier34StartError;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  return tauriInvoke<T>(cmd, args);
}

export function isSandboxServerDesktop(): boolean {
  return canHostSandboxServerAnchor();
}

export async function isLocalSandboxServerManaged(): Promise<boolean> {
  if (!isSandboxServerDesktop()) return false;
  try {
    return await invoke<boolean>('local_server_managed_running');
  } catch {
    return false;
  }
}

export async function waitForTier34Health(timeoutMs = 20_000): Promise<boolean> {
  syncTier34BackendUrlFromServerMode();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await tier34HealthOk()) return true;
    await new Promise((r) => window.setTimeout(r, 400));
  }
  return false;
}

export async function startLocalSandboxServer(): Promise<void> {
  if (!isSandboxServerDesktop()) {
    throw new Error('desktop-only');
  }
  syncTier34BackendUrlFromServerMode();
  lastTier34StartError = null;
  try {
    await invoke('start_local_server');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastTier34StartError = msg;
    throw err;
  }
}

export async function stopLocalSandboxServer(): Promise<void> {
  if (!isSandboxServerDesktop()) {
    throw new Error('desktop-only');
  }
  await invoke('stop_local_server');
}

/** Honor Settings → Vault auto-start when mode is anchor (Tauri desktop only). */
export async function maybeAutoStartLocalSandboxServer(): Promise<boolean> {
  if (!isSandboxServerDesktop()) return false;
  if (!loadSandboxServerAutoStart()) return false;
  if (loadSandboxServerMode() !== 'anchor') return false;
  syncTier34BackendUrlFromServerMode();
  if (await tier34HealthOk()) return true;
  try {
    await startLocalSandboxServer();
    return await waitForTier34Health();
  } catch {
    return false;
  }
}

/** Attempt tier34 start on anchor desktop before catalog playback resolve. */
export async function ensureTier34ForPlayback(options?: {
  onPhase?: (phase: Tier34StartPhase) => void;
}): Promise<boolean> {
  syncTier34BackendUrlFromServerMode();
  if (await tier34HealthOk()) {
    options?.onPhase?.('ready');
    return true;
  }
  if (!isSandboxServerDesktop()) return false;
  if (loadSandboxServerMode() !== 'anchor') return false;
  try {
    options?.onPhase?.('starting');
    await startLocalSandboxServer();
    options?.onPhase?.('waiting');
    const ok = await waitForTier34Health();
    options?.onPhase?.(ok ? 'ready' : 'failed');
    return ok;
  } catch {
    options?.onPhase?.('failed');
    return false;
  }
}
