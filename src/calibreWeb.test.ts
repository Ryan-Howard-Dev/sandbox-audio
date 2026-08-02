import { beforeEach, describe, expect, it } from 'vitest';
import {
  catalogHeaders,
  entryToBook,
  isCalibreWebConfigured,
  loadCalibreWebSettings,
  saveCalibreWebSettings,
} from './calibreWeb';
import type { OpdsEntry } from './opdsFeed';

const entry = (overrides: Partial<OpdsEntry> = {}): OpdsEntry => ({
  id: 'urn:uuid:123',
  title: 'Jane Eyre',
  author: 'Charlotte Brontë',
  summary: 'An orphan becomes a governess.',
  links: [
    {
      rel: 'http://opds-spec.org/acquisition',
      type: 'application/epub+zip',
      href: '/opds/download/7/epub/',
    },
    { rel: 'http://opds-spec.org/image/thumbnail', type: 'image/jpeg', href: '/opds/cover/7' },
  ],
  ...overrides,
});

describe('the connection settings', () => {
  beforeEach(() => {
    saveCalibreWebSettings({ url: '', username: '', password: '' });
  });

  it('is off until an address is set, so nothing is contacted by default', () => {
    expect(isCalibreWebConfigured()).toBe(false);
    expect(loadCalibreWebSettings().url).toBe('');
  });

  it('normalises the address on the way in', () => {
    saveCalibreWebSettings({ url: '  http://192.168.1.10:8083/opds/  ' });
    expect(loadCalibreWebSettings().url).toBe('http://192.168.1.10:8083');
    expect(isCalibreWebConfigured()).toBe(true);
  });

  it('keeps credentials separately, so a password survives changing the address', () => {
    saveCalibreWebSettings({ url: 'http://box:8083', username: 'reader', password: 'hunter2' });
    saveCalibreWebSettings({ url: 'http://other:8083' });
    const settings = loadCalibreWebSettings();
    expect(settings.username).toBe('reader');
    expect(settings.password).toBe('hunter2');
  });

  it('refuses an address it cannot make sense of', () => {
    saveCalibreWebSettings({ url: 'box:8083' });
    expect(isCalibreWebConfigured()).toBe(false);
  });
});

describe('catalogHeaders', () => {
  it('sends no Authorization when there is no username', () => {
    // Calibre-web can allow anonymous access, and an empty Basic header turns that into a 401.
    const headers = catalogHeaders({ url: 'http://box:8083', username: '', password: '' });
    expect(headers.Authorization).toBeUndefined();
    expect(headers.Accept).toMatch(/atom/);
  });

  it('sends Basic auth when a username is set', () => {
    const headers = catalogHeaders({
      url: 'http://box:8083',
      username: 'reader',
      password: 'hunter2',
    });
    expect(headers.Authorization).toBe('Basic cmVhZGVyOmh1bnRlcjI=');
  });
});

describe('entryToBook', () => {
  it('makes the download and cover URLs absolute against the server', () => {
    const book = entryToBook(entry(), 'http://box:8083');
    expect(book?.downloadUrl).toBe('http://box:8083/opds/download/7/epub/');
    expect(book?.coverUrl).toBe('http://box:8083/opds/cover/7');
    expect(book?.contentType).toBe('application/epub+zip');
  });

  it('carries the title and author through for the shelf', () => {
    const book = entryToBook(entry(), 'http://box:8083');
    expect(book?.title).toBe('Jane Eyre');
    expect(book?.author).toBe('Charlotte Brontë');
  });

  it('drops an entry with no readable format rather than showing an unopenable book', () => {
    expect(
      entryToBook(
        entry({
          links: [
            { rel: 'http://opds-spec.org/acquisition', type: 'application/x-cbz', href: '/x' },
          ],
        }),
        'http://box:8083',
      ),
    ).toBeNull();
  });

  it('drops a navigation entry, which is a shelf rather than a book', () => {
    expect(
      entryToBook(
        entry({ links: [{ rel: 'subsection', type: 'application/atom+xml', href: '/opds/a' }] }),
        'http://box:8083',
      ),
    ).toBeNull();
  });

  it('survives an entry with no cover', () => {
    const book = entryToBook(
      entry({
        links: [
          {
            rel: 'http://opds-spec.org/acquisition',
            type: 'application/epub+zip',
            href: '/opds/download/7/epub/',
          },
        ],
      }),
      'http://box:8083',
    );
    expect(book?.coverUrl).toBeUndefined();
    expect(book?.downloadUrl).toBeTruthy();
  });

  it('falls back to the download href when the entry has no id', () => {
    const book = entryToBook(entry({ id: '' }), 'http://box:8083');
    expect(book?.id).toBe('/opds/download/7/epub/');
  });
});
