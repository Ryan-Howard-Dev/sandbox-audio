/**
 * Resolve locker blob / local-vault URLs to HTTP URLs network speakers can fetch on LAN.
 */

import type { MediaEnvelope } from './sandboxLayer1';
import { getLockerEntries } from './lockerStorage';
import { hashBlob } from './lockerSync';
import { appendSandboxClientQuery, getTier34LanBaseUrl } from './tier34/client';

const LOCAL_PROVIDERS = new Set(['local-vault', 'indexeddb', 'blob']);
const HASH_RE = /^[a-f0-9]{64}$/i;

export function needsCastUrlResolution(url: string, provider?: string): boolean {
  const trimmed = url?.trim() ?? '';
  if (!trimmed) return false;
  if (trimmed.startsWith('blob:')) return true;
  if (provider && LOCAL_PROVIDERS.has(provider)) return true;
  return false;
}

/** Reject blob: URLs — Sonos/UPnP cannot pull from browser object URLs. */
export function isSpeakerCastableUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  if (!trimmed || trimmed.startsWith('blob:')) return false;
  return isCastAccessibleUrl(trimmed);
}

/** True when cast receiver can fetch the URL over HTTP(S) on the LAN. */
export function isCastAccessibleUrl(url: string): boolean {
  const trimmed = url?.trim() ?? '';
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false;
    return true;
  } catch {
    return false;
  }
}

function lanCastBase(): string {
  return getTier34LanBaseUrl().replace(/\/$/, '');
}

async function hashForLockerEntry(entryId: string): Promise<string | null> {
  const cleanId = entryId.replace(/^local-/, '');
  const entries = await getLockerEntries();
  const entry = entries.find((e) => e.id === cleanId || e.id === entryId);
  if (!entry?.url) return null;
  try {
    const res = await fetch(entry.url);
    if (!res.ok) return null;
    return hashBlob(await res.blob());
  } catch {
    return null;
  }
}

function buildCastStreamUrl(trackKey: string): string {
  return appendSandboxClientQuery(
    `${lanCastBase()}/api/cast/stream/${encodeURIComponent(trackKey)}`,
  );
}

/**
 * Resolve a playable envelope URL to an absolute tier34 cast stream URL when needed.
 * Returns null when no HTTP-accessible URL is available for casting.
 */
export async function resolveSpeakerCastStreamUrl(
  envelope?: MediaEnvelope | null,
): Promise<string | null> {
  if (!envelope?.url?.trim()) return null;

  const rawUrl = envelope.url.trim();
  if (rawUrl.startsWith('blob:')) {
    /* fall through to locker resolution */
  } else if (isCastAccessibleUrl(rawUrl)) {
    return rawUrl;
  }

  if (!needsCastUrlResolution(rawUrl, envelope.provider)) {
    return isSpeakerCastableUrl(rawUrl) ? rawUrl : null;
  }

  if (envelope.sourceId) {
    const resolved = buildCastStreamUrl(envelope.sourceId);
    return isCastAccessibleUrl(resolved) ? resolved : null;
  }

  let contentHash: string | null = null;
  if (envelope.envelopeId) {
    const fromId = envelope.envelopeId.replace(/^local-/, '');
    if (HASH_RE.test(fromId)) contentHash = fromId.toLowerCase();
    else contentHash = await hashForLockerEntry(fromId);
  }

  if (!contentHash) return null;

  const resolved = buildCastStreamUrl(contentHash);
  return isCastAccessibleUrl(resolved) ? resolved : null;
}

/** @deprecated Use resolveSpeakerCastStreamUrl — kept for cinema cast compatibility. */
export async function resolveCastStreamUrl(
  envelope?: MediaEnvelope | null,
): Promise<string | null> {
  return resolveSpeakerCastStreamUrl(envelope);
}
