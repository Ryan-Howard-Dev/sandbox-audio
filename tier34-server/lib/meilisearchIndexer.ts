/**
 * Meilisearch indexer — flat track documents from SQLite graph + manifest.
 * Requires Meilisearch running separately (default http://localhost:7700).
 */

import { loadMasterManifest } from './lockerStorage.js';
import { getAllTrackDocuments, type TrackSearchDocument } from './mediaGraph.js';

const MEILI_URL = (process.env.MEILISEARCH_URL ?? 'http://localhost:7700').replace(/\/$/, '');
const MEILI_KEY = process.env.MEILISEARCH_API_KEY ?? '';
const INDEX_NAME = 'tracks';

export type MeiliSearchHit = TrackSearchDocument & { _formatted?: Record<string, string> };

export type LockerSearchFilters = {
  artist?: string;
  genre?: string;
  year?: string;
  source?: string;
  lossless?: boolean;
  releaseGroupId?: string;
};

export type LockerSearchFacets = Record<string, Record<string, number>>;

export type LockerSearchResult = {
  hits: MeiliSearchHit[];
  ok: boolean;
  facetDistribution?: LockerSearchFacets;
  estimatedTotalHits?: number;
};

async function meiliFetch(path: string, init?: RequestInit): Promise<Response | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    };
    if (MEILI_KEY) headers.Authorization = `Bearer ${MEILI_KEY}`;

    const res = await fetch(`${MEILI_URL}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    return res;
  } catch {
    return null;
  }
}

export async function meilisearchAvailable(): Promise<boolean> {
  const res = await meiliFetch('/health');
  if (!res?.ok) return false;
  try {
    const data = (await res.json()) as { status?: string };
    return data.status === 'available';
  } catch {
    return res.ok;
  }
}

function escapeFilterValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function buildFilterExpression(filters?: LockerSearchFilters): string | undefined {
  if (!filters) return undefined;
  const clauses: string[] = [];

  if (filters.artist?.trim()) {
    clauses.push(`artist = "${escapeFilterValue(filters.artist.trim())}"`);
  }
  if (filters.genre?.trim()) {
    clauses.push(`genre = "${escapeFilterValue(filters.genre.trim())}"`);
  }
  if (filters.year?.trim()) {
    clauses.push(`year = "${escapeFilterValue(filters.year.trim())}"`);
  }
  if (filters.source?.trim()) {
    clauses.push(`source = "${escapeFilterValue(filters.source.trim())}"`);
  }
  if (filters.releaseGroupId?.trim()) {
    clauses.push(
      `musicbrainzReleaseGroupId = "${escapeFilterValue(filters.releaseGroupId.trim())}"`,
    );
  }
  if (filters.lossless === true) {
    clauses.push('lossless = true');
  } else if (filters.lossless === false) {
    clauses.push('lossless = false');
  }

  return clauses.length > 0 ? clauses.join(' AND ') : undefined;
}

const DEFAULT_FACETS = [
  'artist',
  'genre',
  'year',
  'source',
  'musicbrainzReleaseGroupId',
  'lossless',
] as const;

async function ensureIndex(): Promise<boolean> {
  const res = await meiliFetch(`/indexes/${INDEX_NAME}`, { method: 'GET' });
  if (res?.ok) return true;

  const create = await meiliFetch('/indexes', {
    method: 'POST',
    body: JSON.stringify({ uid: INDEX_NAME, primaryKey: 'id' }),
  });
  if (!create?.ok && create?.status !== 409) return false;

  await meiliFetch(`/indexes/${INDEX_NAME}/settings`, {
    method: 'PATCH',
    body: JSON.stringify({
      searchableAttributes: [
        'title',
        'artist',
        'albumArtist',
        'album',
        'genre',
        'label',
        'year',
        'envelopeId',
        'musicbrainzReleaseGroupId',
      ],
      filterableAttributes: [
        'hash',
        'source',
        'artist',
        'albumArtist',
        'genre',
        'year',
        'label',
        'lossless',
        'musicbrainzReleaseId',
        'musicbrainzReleaseGroupId',
      ],
      sortableAttributes: ['year', 'title', 'artist'],
    }),
  });

  return true;
}

export async function reindexTracks(): Promise<{ indexed: number; ok: boolean; error?: string }> {
  if (!(await meilisearchAvailable())) {
    return { indexed: 0, ok: false, error: 'Meilisearch offline' };
  }
  if (!(await ensureIndex())) {
    return { indexed: 0, ok: false, error: 'Failed to create tracks index' };
  }

  const manifest = loadMasterManifest();
  const docs = getAllTrackDocuments(manifest.entries);

  const res = await meiliFetch(`/indexes/${INDEX_NAME}/documents`, {
    method: 'PUT',
    body: JSON.stringify(docs),
  });

  if (!res?.ok) {
    const text = await res?.text().catch(() => 'unknown');
    return { indexed: 0, ok: false, error: text };
  }

  return { indexed: docs.length, ok: true };
}

export async function searchTracks(
  query: string,
  options?: {
    limit?: number;
    filters?: LockerSearchFilters;
    facets?: string[];
  },
): Promise<LockerSearchResult> {
  const q = query.trim();
  const limit = options?.limit ?? 40;
  if (!q) return { hits: [], ok: true };
  if (!(await meilisearchAvailable())) return { hits: [], ok: false };

  const filter = buildFilterExpression(options?.filters);
  const facets = options?.facets ?? [...DEFAULT_FACETS];

  const body: Record<string, unknown> = {
    q,
    limit,
    facets,
  };
  if (filter) body.filter = filter;

  const res = await meiliFetch(`/indexes/${INDEX_NAME}/search`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res?.ok) return { hits: [], ok: false };

  try {
    const data = (await res.json()) as {
      hits?: MeiliSearchHit[];
      facetDistribution?: LockerSearchFacets;
      estimatedTotalHits?: number;
    };
    return {
      hits: data.hits ?? [],
      ok: true,
      facetDistribution: data.facetDistribution,
      estimatedTotalHits: data.estimatedTotalHits,
    };
  } catch {
    return { hits: [], ok: false };
  }
}

/** Fire-and-forget reindex after manifest merge (best-effort). */
export function scheduleReindex(): void {
  void reindexTracks().catch(() => {
    /* offline is fine */
  });
}
