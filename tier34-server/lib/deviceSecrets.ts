/**
 * Cross-device API key store — lives on the user's tier34 host (self-hosted trust model).
 * Plain JSON in locker storage; optional TIER34_DEVICE_SYNC_SECRET gates PUT/GET.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Request } from 'express';
import { LOCKER_STORAGE_ROOT } from './lockerPaths.js';

export type DeviceSecretEntry = {
  value: string;
  updatedAt: number;
};

export type DeviceSecretsStore = {
  version: 1;
  updatedAt: number;
  secrets: Record<string, DeviceSecretEntry>;
};

const SECRETS_FILE = join(LOCKER_STORAGE_ROOT, 'device-secrets.json');

function emptyStore(): DeviceSecretsStore {
  return { version: 1, updatedAt: 0, secrets: {} };
}

function ensureDir(): void {
  mkdirSync(LOCKER_STORAGE_ROOT, { recursive: true });
}

export function loadDeviceSecrets(): DeviceSecretsStore {
  if (!existsSync(SECRETS_FILE)) return emptyStore();
  try {
    const parsed = JSON.parse(readFileSync(SECRETS_FILE, 'utf8')) as DeviceSecretsStore;
    if (!parsed?.secrets || typeof parsed.secrets !== 'object') return emptyStore();
    return {
      version: 1,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      secrets: parsed.secrets,
    };
  } catch {
    return emptyStore();
  }
}

function normalizeIncomingEntry(
  raw: string | DeviceSecretEntry | { value?: string; updatedAt?: number },
  fallbackAt: number,
): DeviceSecretEntry | null {
  if (typeof raw === 'string') {
    return { value: raw, updatedAt: fallbackAt };
  }
  if (!raw || typeof raw !== 'object') return null;
  const value = String(raw.value ?? '');
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : fallbackAt;
  return { value, updatedAt };
}

/** Merge client patch — per-key last-write-wins by updatedAt. */
export function mergeDeviceSecrets(
  incoming: Record<string, string | DeviceSecretEntry | { value?: string; updatedAt?: number }>,
): DeviceSecretsStore {
  const store = loadDeviceSecrets();
  const now = Date.now();

  for (const [key, raw] of Object.entries(incoming)) {
    const trimmedKey = key.trim();
    if (!trimmedKey) continue;
    const entry = normalizeIncomingEntry(raw, now);
    if (!entry) continue;
    const existing = store.secrets[trimmedKey];
    if (!existing || entry.updatedAt >= existing.updatedAt) {
      store.secrets[trimmedKey] = entry;
    }
  }

  store.updatedAt = now;
  ensureDir();
  writeFileSync(SECRETS_FILE, JSON.stringify(store, null, 2), 'utf8');
  return store;
}

export function getDeviceSecretsPayload(): {
  updatedAt: number;
  secrets: Record<string, DeviceSecretEntry>;
} {
  const store = loadDeviceSecrets();
  return { updatedAt: store.updatedAt, secrets: store.secrets };
}

/** Auth: X-Sandbox-Client + optional TIER34_DEVICE_SYNC_SECRET (or X-Sandbox-Token). */
export function verifyDeviceSyncAuth(
  req: Request,
): { ok: true } | { ok: false; status: number; error: string } {
  const clientHeader = String(req.headers['x-sandbox-client'] ?? '').trim();
  if (!clientHeader.startsWith('sandbox-music/')) {
    return { ok: false, status: 403, error: 'X-Sandbox-Client required' };
  }

  const envSecret = process.env.TIER34_DEVICE_SYNC_SECRET?.trim();
  const providedSecret = String(req.headers['x-tier34-device-sync'] ?? '').trim();
  const sandboxToken = String(req.headers['x-sandbox-token'] ?? '').trim();

  if (envSecret) {
    if (providedSecret === envSecret) return { ok: true };
    if (sandboxToken) return { ok: true };
    return { ok: false, status: 401, error: 'Invalid device sync credentials' };
  }

  return { ok: true };
}
