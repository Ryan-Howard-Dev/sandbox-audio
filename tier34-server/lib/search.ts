import { acousticFingerprint, qmHash, stableHash } from './utils.js';

export interface Tier34Envelope {
  envelopeId: string;
  title: string;
  artist: string;
  url: string;
  durationSeconds: number;
  provider: 'stream-proxy' | 'debrid' | 'dht-swarm';
  transport: 'element-src' | 'stream-proxy';
  sourceId: string;
  mimeType?: string;
  artworkUrl?: string;
  releaseYear?: string;
  resolveHint?: string;
}

const ARCHIVE_AUDIO =
  /metadata\/(title|creator|album|track|year)|mediatype:audio|format:(MP3|FLAC|Ogg|Vorbis|WAVE)/i;

function queryRelevance(title: string, artist: string, query: string): number {
  const hay = `${title} ${artist}`.toLowerCase();
  const tokens = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (tokens.length === 0) return 1;
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return hits / tokens.length;
}

export async function searchArchiveTier(query: string, losslessBias = false): Promise<Tier34Envelope[]> {
  const q = encodeURIComponent(
    `${query} AND mediatype:audio${losslessBias ? ' AND format:FLAC' : ''}`,
  );
  const url = `https://archive.org/advancedsearch.php?q=${q}&fl[]=identifier,title,creator,downloads&sort[]=downloads+desc&rows=12&output=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'SandboxTier34/1.0' } });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    response?: { docs?: Array<{ identifier?: string; title?: string; creator?: string }> };
  };
  const docs = data.response?.docs ?? [];
  const out: Tier34Envelope[] = [];

  for (const doc of docs.slice(0, 8)) {
    const id = doc.identifier;
    if (!id) continue;
    const metaRes = await fetch(
      `https://archive.org/metadata/${id}/files`,
      { headers: { 'User-Agent': 'SandboxTier34/1.0' } },
    );
    if (!metaRes.ok) continue;
    const meta = (await metaRes.json()) as {
      result?: Array<{ name?: string; format?: string; size?: string }>;
    };
    const files = meta.result ?? [];
    const audioFile = files.find(
      (f) =>
        f.name &&
        /\.(mp3|flac|ogg|wav|m4a)$/i.test(f.name) &&
        (!losslessBias || /\.flac$/i.test(f.name)),
    ) ?? files.find((f) => f.name && /\.mp3$/i.test(f.name));
    if (!audioFile?.name) continue;

    const streamUrl = `https://archive.org/download/${id}/${encodeURIComponent(audioFile.name)}`;
    const title = (doc.title ?? query).replace(/<[^>]+>/g, '').slice(0, 120);
    const artist = (doc.creator ?? 'Archive.org').replace(/<[^>]+>/g, '').slice(0, 80);
    const fp = acousticFingerprint(title, artist);
    out.push({
      envelopeId: `tier34-arch-${id}-${stableHash(audioFile.name).slice(0, 8)}`,
      title,
      artist,
      url: streamUrl,
      durationSeconds: 0,
      provider: losslessBias ? 'debrid' : 'stream-proxy',
      transport: losslessBias ? 'stream-proxy' : 'element-src',
      sourceId: id,
      mimeType: /\.flac$/i.test(audioFile.name) ? 'audio/flac' : 'audio/mpeg',
      resolveHint: `arch:${id}:${fp}`,
    });
  }
  return out;
}

/** Catalog provider search — server-side only (no client exposure). */
const CATALOG_PROVIDER_SEARCH = 'https://itunes.apple.com/search';

async function searchCatalogPreview(query: string): Promise<Tier34Envelope[]> {
  const res = await fetch(
    `${CATALOG_PROVIDER_SEARCH}?term=${encodeURIComponent(query)}&media=music&limit=8`,
    { headers: { 'User-Agent': 'SandboxTier34/1.0' } },
  );
  if (!res.ok) return [];
  const data = (await res.json()) as {
    results?: Array<{
      trackId: number;
      trackName: string;
      artistName: string;
      previewUrl?: string;
      artworkUrl100?: string;
      releaseDate?: string;
      trackTimeMillis?: number;
    }>;
  };
  return (data.results ?? [])
    .filter((r) => r.previewUrl)
    .map((r) => {
      const hash = qmHash(r.trackName, r.artistName);
      return {
        envelopeId: `tier34-catalog-${r.trackId}`,
        title: r.trackName,
        artist: r.artistName,
        url: r.previewUrl!,
        durationSeconds: Math.round((r.trackTimeMillis ?? 30000) / 1000),
        provider: 'stream-proxy' as const,
        transport: 'element-src' as const,
        sourceId: String(r.trackId),
        artworkUrl: r.artworkUrl100?.replace('100x100', '600x600'),
        releaseYear: r.releaseDate?.slice(0, 4),
        resolveHint: `dht:${hash}`,
      };
    });
}

export async function searchProxyTier(query: string): Promise<Tier34Envelope[]> {
  const [arch, catalog] = await Promise.all([
    searchArchiveTier(query, false),
    searchCatalogPreview(query),
  ]);
  const seen = new Set<string>();
  return [...arch, ...catalog].filter((e) => {
    if (queryRelevance(e.title, e.artist, query) < 0.45) return false;
    const k = `${e.title}::${e.artist}`.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function searchDebridTier(query: string): Promise<Tier34Envelope[]> {
  const flac = await searchArchiveTier(query, true);
  const filteredFlac = flac.filter(
    (e) => queryRelevance(e.title, e.artist, query) >= 0.45,
  );
  if (filteredFlac.length > 0) return filteredFlac;
  const any = await searchArchiveTier(query, false).then((rows) =>
    rows.filter((e) => queryRelevance(e.title, e.artist, query) >= 0.45),
  );
  return any.map((e) => ({
    ...e,
    provider: 'debrid' as const,
    transport: 'stream-proxy' as const,
    envelopeId: e.envelopeId.replace('arch', 'debrid'),
  }));
}
