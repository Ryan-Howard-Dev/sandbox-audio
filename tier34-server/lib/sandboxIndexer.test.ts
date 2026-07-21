import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  extractInfoHash,
  infoHashToMagnet,
  isMagnetOrTorrentUrl,
  isTorrentResolvableInput,
  loadIndexerConfig,
  normalizeTorrentInput,
  saveIndexerConfig,
  searchSandboxIndexer,
} from './sandboxIndexer.js';

describe('isMagnetOrTorrentUrl', () => {
  it('detects magnet links', () => {
    expect(isMagnetOrTorrentUrl('magnet:?xt=urn:btih:abc')).toBe(true);
  });

  it('detects torrent file URLs', () => {
    expect(isMagnetOrTorrentUrl('https://example.com/file.torrent')).toBe(true);
  });

  it('rejects plain search queries', () => {
    expect(isMagnetOrTorrentUrl('Radiohead Creep FLAC')).toBe(false);
  });
});

describe('info hash → magnet', () => {
  const sampleHash = 'a1b2c3d4e5f6789012345678901234567890abcd';

  it('extracts bare 40-char hex hash', () => {
    expect(extractInfoHash(sampleHash)).toBe(sampleHash);
  });

  it('extracts hash embedded in pasted text', () => {
    expect(extractInfoHash(`hash: ${sampleHash} (flac)`)).toBe(sampleHash);
  });

  it('builds magnet URI from hash', () => {
    expect(infoHashToMagnet(sampleHash)).toBe(`magnet:?xt=urn:btih:${sampleHash}`);
    expect(infoHashToMagnet(sampleHash, 'My Album')).toBe(
      `magnet:?xt=urn:btih:${sampleHash}&dn=${encodeURIComponent('My Album')}`,
    );
  });

  it('normalizes bare hash to magnet', () => {
    expect(normalizeTorrentInput(sampleHash)).toBe(`magnet:?xt=urn:btih:${sampleHash}`);
  });

  it('treats bare hash as torrent-resolvable input', () => {
    expect(isTorrentResolvableInput(sampleHash)).toBe(true);
    expect(isTorrentResolvableInput('Radiohead Creep FLAC')).toBe(false);
  });
});

describe('indexer config', () => {
  it('round-trips torznab endpoints', () => {
    const saved = saveIndexerConfig({
      torznabEndpoints: [{ name: 'Test Jackett', url: 'http://127.0.0.1:9117/api?{query}', apiKey: 'key1' }],
    });
    expect(saved.torznabEndpoints).toHaveLength(1);
    const loaded = loadIndexerConfig();
    expect(loaded.torznabEndpoints[0]?.name).toBe('Test Jackett');
  });
});

describe('searchSandboxIndexer', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    saveIndexerConfig({ torznabEndpoints: [] });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns direct magnet entry for magnet paste', async () => {
    const magnet = 'magnet:?xt=urn:btih:deadbeef';
    const hits = await searchSandboxIndexer({ query: magnet, includeProxy: false });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe(magnet);
    expect(hits[0]?.source).toBe('magnet');
  });

  it('returns magnet entry for bare info hash paste', async () => {
    const hash = 'a1b2c3d4e5f6789012345678901234567890abcd';
    const hits = await searchSandboxIndexer({ query: hash, includeProxy: false });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe(`magnet:?xt=urn:btih:${hash}`);
    expect(hits[0]?.source).toBe('magnet');
  });

  it('parses torznab XML from configured endpoint', async () => {
    saveIndexerConfig({
      torznabEndpoints: [
        { name: 'Local Jackett', url: 'http://127.0.0.1:9117/torznab/all/api?apikey=test', apiKey: 'test' },
      ],
    });

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('archive.org')) {
        return new Response(JSON.stringify({ response: { docs: [] } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        `<?xml version="1.0"?><rss><channel><item>
            <title>Artist - Track Name FLAC</title>
            <link>magnet:?xt=urn:btih:abc123</link>
            <guid>guid-1</guid>
            <size>50000000</size>
          </item></channel></rss>`,
        { status: 200, headers: { 'Content-Type': 'application/xml' } },
      );
    }) as typeof fetch;

    const hits = await searchSandboxIndexer({
      query: 'Artist Track FLAC',
      includeProxy: false,
    });
    const torrentHit = hits.find((h) => h.source === 'torznab');
    expect(torrentHit?.title).toBe('Track Name FLAC');
    expect(torrentHit?.artist).toBe('Artist');
    expect(torrentHit?.magnetUrl).toContain('magnet:');
  });
});
