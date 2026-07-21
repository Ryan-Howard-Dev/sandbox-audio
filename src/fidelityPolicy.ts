/**
 * Rank candidate sources by Settings → Audio Fidelity policy.
 */

import type { CandidateSource, MediaTransport } from './sandboxLayer1';
import { isCatalogPreviewUrl } from './displaySanitize';
import { loadFidelityPolicy, type FidelityPolicy } from './sandboxSettings';
import type { EnvelopeSource } from './tier34/client';

function isLosslessCandidate(c: CandidateSource): boolean {
  if (c.provider === 'local-vault' || c.provider === 'indexeddb' || c.provider === 'blob') {
    return true;
  }
  const mime = (c.mimeType ?? '').toLowerCase();
  const uri = (c.uri ?? '').toLowerCase();
  if (mime.includes('flac') || uri.includes('.flac')) return true;
  if (c.provider === 'debrid' || c.transport === 'debrid') return true;
  if ((c.bitrateKbps ?? 0) >= 900) return true;
  return false;
}

function isHighQualityCandidate(c: CandidateSource): boolean {
  if (isLosslessCandidate(c)) return true;
  if (
    c.provider === 'proxy' ||
    c.provider === 'stream-proxy' ||
    c.transport === 'proxy' ||
    c.transport === 'stream-proxy'
  ) {
    return true;
  }
  const url = c.uri?.trim() ?? '';
  if (url && !isCatalogPreviewUrl(url)) return true;
  return (c.bitrateKbps ?? 0) >= 192;
}

function isPreviewCandidate(c: CandidateSource): boolean {
  const url = c.uri?.trim() ?? '';
  return Boolean(url && isCatalogPreviewUrl(url));
}

/** Higher = better for current fidelity policy. */
export function fidelityRank(candidate: CandidateSource, policy?: FidelityPolicy): number {
  const p = policy ?? loadFidelityPolicy();
  const lossless = isLosslessCandidate(candidate);
  const high = isHighQualityCandidate(candidate);
  const preview = isPreviewCandidate(candidate);

  if (p === 'LOSSLESS') {
    if (lossless) return 100;
    if (high && !preview) return 70;
    if (preview) return 5;
    return 40;
  }
  if (p === 'HIGH') {
    if (lossless) return 90;
    if (high && !preview) return 75;
    if (preview) return 15;
    return 35;
  }
  // STANDARD — accept previews but still prefer better when available
  if (lossless) return 80;
  if (high && !preview) return 60;
  if (preview) return 45;
  return 30;
}

/** True when candidate should be skipped entirely for the active policy. */
export function fidelityAllowsCandidate(candidate: CandidateSource, policy?: FidelityPolicy): boolean {
  const p = policy ?? loadFidelityPolicy();
  if (p === 'LOSSLESS' && isPreviewCandidate(candidate)) return false;
  if (p === 'HIGH') {
    if (isPreviewCandidate(candidate)) return false;
    const kbps = candidate.bitrateKbps ?? 0;
    if (kbps > 0 && kbps < 320) return false;
  }
  return true;
}

export function sortCandidatesByFidelity(candidates: CandidateSource[]): CandidateSource[] {
  const policy = loadFidelityPolicy();
  return [...candidates]
    .filter((c) => fidelityAllowsCandidate(c, policy))
    .sort(
      (a, b) =>
        fidelityRank(b, policy) - fidelityRank(a, policy) || a.priority - b.priority,
    );
}

function mimeFromUri(uri: string): string | undefined {
  const lower = uri.toLowerCase();
  if (lower.includes('.flac')) return 'audio/flac';
  if (lower.includes('.mp3')) return 'audio/mpeg';
  if (lower.includes('.ogg')) return 'audio/ogg';
  if (lower.includes('.wav')) return 'audio/wav';
  if (lower.includes('.m4a') || lower.includes('.aac')) return 'audio/mp4';
  if (lower.includes('.opus')) return 'audio/opus';
  if (lower.includes('.webm')) return 'audio/webm';
  return undefined;
}

function providerFromOrigin(origin: string): CandidateSource['provider'] {
  if (origin === 'youtube' || origin === 'proxy') return 'proxy';
  if (origin === 'debrid') return 'debrid';
  return 'local-vault';
}

function transportForProvider(provider: CandidateSource['provider']): MediaTransport {
  if (provider === 'debrid') return 'debrid';
  if (provider === 'proxy' || provider === 'stream-proxy') return 'proxy';
  return 'element-src';
}

/** Map tier34 envelope source row to a fidelity-rankable candidate. */
export function envelopeSourceToCandidate(source: EnvelopeSource): CandidateSource {
  const uri = source.uri?.trim() || `/api/locker/blob/${source.contentHash}`;
  const provider = providerFromOrigin(source.origin);
  return {
    id: String(source.id),
    priority: 1,
    provider,
    transport: transportForProvider(provider),
    uri,
    mimeType: mimeFromUri(uri),
    bitrateKbps: uri.toLowerCase().includes('.flac') ? 1411 : undefined,
    metadata: { title: '', artist: '', durationSeconds: 0 },
  };
}

/** Rank envelope sources — highest quality first per fidelity policy. */
export function rankSourceQuality(sources: EnvelopeSource[]): EnvelopeSource[] {
  if (sources.length <= 1) return sources;
  const policy = loadFidelityPolicy();
  const ranked = [...sources].sort((a, b) => {
    const ca = envelopeSourceToCandidate(a);
    const cb = envelopeSourceToCandidate(b);
    return fidelityRank(cb, policy) - fidelityRank(ca, policy);
  });
  return ranked;
}
