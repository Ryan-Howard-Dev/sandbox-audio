import { describe, expect, it } from 'vitest';
import {
  applySearchUrlTemplate,
  extractInfoHash,
  hitsFromParsedRows,
  infoHashToMagnet,
  isAllowedSearchPluginUrl,
  normalizeMagnetOrTorrentInput,
  parseSearchPluginBody,
  validateAudiobookSearchPlugin,
} from '../tier34-server/lib/audiobookAcquireCore';

describe('audiobook search plugin URL templates', () => {
  it('substitutes {query} and %s', () => {
    expect(applySearchUrlTemplate('https://example.com/s?q={query}', 'pride')).toBe(
      'https://example.com/s?q=pride',
    );
    expect(applySearchUrlTemplate('https://example.com/s/%s', 'hello world')).toBe(
      'https://example.com/s/hello%20world',
    );
  });

  it('rejects private and non-https search URLs', () => {
    expect(isAllowedSearchPluginUrl('https://example.com/search')).toBe(true);
    expect(isAllowedSearchPluginUrl('http://example.com/search')).toBe(false);
    expect(isAllowedSearchPluginUrl('https://localhost/search')).toBe(false);
    expect(isAllowedSearchPluginUrl('https://192.168.1.1/search')).toBe(false);
  });
});

describe('audiobook search plugin validation', () => {
  it('requires query placeholder and public https URL', () => {
    const bad = validateAudiobookSearchPlugin({
      id: 'x',
      name: 'Test',
      enabled: true,
      searchUrlTemplate: 'https://example.com/search',
    });
    expect(bad.ok).toBe(false);

    const good = validateAudiobookSearchPlugin({
      id: 'x',
      name: 'Test',
      enabled: true,
      searchUrlTemplate: 'https://example.com/search?q={query}',
    });
    expect(good.ok).toBe(true);
  });
});

describe('magnet parsing', () => {
  const hash = 'abcdef0123456789abcdef0123456789abcdef01';

  it('extracts info hash from magnet and bare hash', () => {
    expect(extractInfoHash(`magnet:?xt=urn:btih:${hash}`)).toBe(hash);
    expect(extractInfoHash(hash)).toBe(hash);
  });

  it('normalizes bare hash to magnet', () => {
    expect(normalizeMagnetOrTorrentInput(hash)).toBe(infoHashToMagnet(hash));
    expect(normalizeMagnetOrTorrentInput('https://x.example/a.torrent')).toBe(
      'https://x.example/a.torrent',
    );
  });
});

describe('search result parsing', () => {
  const plugin = {
    id: 'p1',
    name: 'Test',
    enabled: true,
    searchUrlTemplate: 'https://example.com/?q={query}',
    parserHint: 'html-links' as const,
  };

  it('parses magnet links from HTML', () => {
    const html = `
      <html><body>
        <a href="magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01">Book</a>
        <a href="https://cdn.example/file.torrent">t</a>
      </body></html>`;
    const rows = parseSearchPluginBody(html, plugin);
    const hits = hitsFromParsedRows(rows, plugin);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.magnetUrl).toContain('magnet:');
  });

  it('parses JSON results array', () => {
    const jsonPlugin = {
      ...plugin,
      parserHint: 'json' as const,
      resultSelector: 'results',
    };
    const body = JSON.stringify({
      results: [{ title: 'My Book', magnetUrl: 'magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01' }],
    });
    const hits = hitsFromParsedRows(parseSearchPluginBody(body, jsonPlugin), jsonPlugin);
    expect(hits[0]?.title).toBe('My Book');
    expect(hits[0]?.magnetUrl).toContain('magnet:');
  });
});
