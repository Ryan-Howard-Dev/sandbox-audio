/**
 * Auto-repair corrupt locker blobs — re-acquire from alternate sources.
 */

import {
  loadMasterManifest,
  saveBlob,
  sha256HexBuffer,
  upsertManifestEntry,
  type LockerSyncManifestEntry,
} from './lockerStorage.js';
import { markJobComplete, markJobFailed, updateJobPayload, type JobRecord } from './jobQueue.js';
import {
  findEnvelopesByContentHash,
  getSourcesForEnvelope,
  syncAcquireBlob,
  type SourceOrigin,
} from './mediaGraph.js';
import { proxyStreamUpstream } from './proxyResolve.js';
import { resolveDebridCandidates } from './debridResolve.js';
import { searchProxyTier } from './search.js';

export type HealBlobPayload = {
  type: 'heal-blob';
  hash: string;
  expectedHash: string;
  actualHash: string;
  envelopeId?: string;
};

async function fetchAudioBuffer(url: string): Promise<Buffer> {
  let upstream: Response;
  if (url.startsWith('http://') || url.startsWith('https://')) {
    if (url.includes('/api/proxy/stream')) {
      try {
        const parsed = new URL(url, 'http://localhost');
        const target = parsed.searchParams.get('url');
        if (target) {
          upstream = await proxyStreamUpstream(target);
        } else {
          upstream = await fetch(url, {
            headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'audio/*,*/*' },
          });
        }
      } catch {
        upstream = await fetch(url, {
          headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'audio/*,*/*' },
        });
      }
    } else {
      upstream = await fetch(url, {
        headers: { 'User-Agent': 'SandboxTier34/1.0', Accept: 'audio/*,*/*' },
      });
    }
  } else {
    throw new Error('Invalid source URL');
  }

  if (!upstream.ok) throw new Error(`Download failed (HTTP ${upstream.status})`);
  const body = upstream.body;
  if (!body) throw new Error('Empty response body');

  const chunks: Buffer[] = [];
  const reader = body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  const buf = Buffer.concat(chunks);
  if (buf.length < 8_000) throw new Error('Download too small');
  return buf;
}

async function resolveAlternateUrl(title: string, artist: string): Promise<string | null> {
  const query = `${title} ${artist}`.trim();
  const proxyRows = await searchProxyTier(query);
  if (proxyRows[0]?.url) return proxyRows[0].url;

  const debridRows = await resolveDebridCandidates({
    query,
    prowlarrUrl: process.env.PROWLARR_URL ?? '',
    prowlarrApiKey: process.env.PROWLARR_API_KEY ?? '',
    realDebridApiKey: process.env.REALDEBRID_API_KEY ?? '',
  });
  return debridRows.find((r) => r.url?.trim())?.url ?? null;
}

function manifestEntryForEnvelope(envelopeId: string): LockerSyncManifestEntry | null {
  const manifest = loadMasterManifest();
  return manifest.entries.find((e) => e.id === envelopeId) ?? null;
}

export async function runHealBlobJob(record: JobRecord): Promise<void> {
  const payload = record.payload as HealBlobPayload;
  const expectedHash = payload.expectedHash.replace(/[^a-f0-9]/gi, '').toLowerCase();

  updateJobPayload(record.jobId, payload);

  const envelopes = payload.envelopeId
    ? [{ id: payload.envelopeId }]
    : findEnvelopesByContentHash(expectedHash);

  if (envelopes.length === 0) {
    markJobFailed(record.jobId, 'No envelope found for corrupt hash');
    return;
  }

  const errors: string[] = [];

  for (const env of envelopes) {
    const entry = manifestEntryForEnvelope(env.id);
    const title = entry?.title ?? '';
    const artist = entry?.artist ?? '';
    const sources = getSourcesForEnvelope(env.id);

    const uris = sources
      .map((s) => s.uri)
      .filter((u): u is string => Boolean(u?.trim()))
      .filter((u) => !u.includes(`/api/locker/blob/${expectedHash}`));

    if (uris.length === 0) {
      const alt = await resolveAlternateUrl(title, artist);
      if (alt) uris.push(alt);
    }

    for (const uri of uris) {
      try {
        const buf = await fetchAudioBuffer(uri);
        const contentHash = sha256HexBuffer(buf);
        if (contentHash !== expectedHash) {
          errors.push(`Re-acquired hash mismatch: ${contentHash.slice(0, 12)}`);
          continue;
        }

        saveBlob(contentHash, buf);
        const origin = (sources[0]?.origin ?? 'proxy') as SourceOrigin;

        if (entry) {
          syncAcquireBlob(env.id, contentHash, buf.length, origin, uri, {
            title: entry.title,
            artist: entry.artist,
            albumName: entry.albumName,
            durationSeconds: entry.durationSeconds,
            releaseYear: entry.releaseYear,
            musicbrainzReleaseId: entry.musicbrainzReleaseId,
            version: (entry.version ?? 1) + 1,
          });
          upsertManifestEntry({
            ...entry,
            contentHash,
            remoteBlobUrl: `/api/locker/blob/${contentHash}`,
            version: (entry.version ?? 1) + 1,
          });
        }

        markJobComplete(record.jobId, {
          healed: true,
          hash: contentHash,
          envelopeId: env.id,
          bytes: buf.length,
        });
        return;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  markJobFailed(
    record.jobId,
    errors.length > 0 ? errors.join('; ') : 'No alternate source available',
  );
}
