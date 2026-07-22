import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'tier34-server', 'fixtures');
const soulSearchHtml = readFileSync(join(fixtureDir, 'audiobooks4soul-catalog.snippet.html'), 'utf8');

describe('searchAudiobooks4soulClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('audiobooks4soul.com/?s=')) {
        return new Response(soulSearchHtml, { status: 200, headers: { 'content-type': 'text/html' } });
      }
      return new Response('', { status: 404 });
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns parsed books from ?s= search HTML (CF-bypass client path)', async () => {
    const { searchAudiobooks4soulClient } = await import('./audiobookScrapeClient');
    const books = await searchAudiobooks4soulClient('gatsby', 5);
    expect(books.length).toBeGreaterThan(0);
    expect(books.some((b) => /gatsby/i.test(b.title))).toBe(true);
    expect(books[0]?.source).toBe('audiobooks4soul');
  });
});
