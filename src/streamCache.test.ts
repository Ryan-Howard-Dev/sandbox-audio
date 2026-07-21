import { describe, expect, it } from 'vitest';
import { buildFullStreamDownloadUrl, streamCacheKey, getCachedStream, putCachedStream } from './streamCache';
import { MOBILE_RESOLUTION_CACHE_TTL_MS } from './sandboxSettings';

const BASE = 'http://127.0.0.1:3001';

describe('streamCacheKey', () => {
  it('prefers stable sourceId over envelopeId for acquire tracks', () => {
    const key = streamCacheKey({
      envelopeId: 'acquire-abc',
      sourceId: 'track-42',
      title: 'Song',
      artist: 'Artist',
    });
    expect(key).toContain('track-42');
    expect(key).not.toContain('acquire-abc');
  });

  it('falls back to title and artist when no ids', () => {
    const key = streamCacheKey({
      envelopeId: 'env-1',
      sourceId: '',
      title: 'Hello',
      artist: 'World',
    });
    expect(key).toBe('env-1|hello|world');
  });
});

describe('buildFullStreamDownloadUrl', () => {
  it('maps cast stream paths to tier34 full download endpoint', () => {
    const url = buildFullStreamDownloadUrl('/api/cast/stream/abc123', BASE);
    expect(url).toContain('/api/stream/abc123/full');
    expect(url).toContain('sb_client=');
  });

  it('rewrites proxy stream URLs to full download via upstream param', () => {
    const proxy = `${BASE}/api/proxy/stream?url=${encodeURIComponent('https://cdn.example/audio.flac')}`;
    const url = buildFullStreamDownloadUrl(proxy, BASE);
    expect(url).toContain('/api/stream/full?url=');
    expect(url).toContain(encodeURIComponent('https://cdn.example/audio.flac'));
  });

  it('preserves locker blob URLs with client query', () => {
    const blobPath = '/api/locker/blob/abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const url = buildFullStreamDownloadUrl(blobPath, BASE);
    expect(url).toContain(blobPath);
    expect(url).toContain('sb_client=');
  });
});

describe('CachedStream URI cache', () => {
  it('stores and retrieves with default 6h mobile TTL', () => {
    localStorage.clear();
    const before = Date.now();
    putCachedStream({
      query: 'artist|title',
      uri: 'https://cdn.example/song.mp3',
      source: 'mobile',
    });
    const hit = getCachedStream('artist|title');
    expect(hit?.uri).toBe('https://cdn.example/song.mp3');
    expect(hit?.source).toBe('mobile');
    expect(hit?.expiresAt).toBeGreaterThanOrEqual(before + MOBILE_RESOLUTION_CACHE_TTL_MS - 50);
  });

  it('expires stale URI cache entries', () => {
    localStorage.clear();
    const past = Date.now() - 1000;
    localStorage.setItem(
      'sandbox_resolution_uri_cache_v1',
      JSON.stringify([
        {
          query: 'stale',
          uri: 'https://old.example/a.mp3',
          source: 'server',
          resolvedAt: past - 10_000,
          expiresAt: past,
        },
      ]),
    );
    expect(getCachedStream('stale')).toBeNull();
  });
});
