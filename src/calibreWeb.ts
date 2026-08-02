/**
 * Books from a calibre-web server, over OPDS.
 *
 * The shelf already imports a Calibre library from a picked folder, which works when the library
 * is on the same machine. It is not, usually. A Calibre library lives on the box in the cupboard,
 * and the phone reaching it is the whole point of running calibre-web in front of it.
 *
 * Everything here goes through OPDS rather than calibre-web's own endpoints, so the same code
 * reaches Calibre's content server, Kavita, Komga and anything else that speaks the standard. See
 * opdsFeed.ts for the parsing.
 *
 * Off until an address is set. Nothing is contacted, and no default server exists to fall back to.
 *
 * The password is kept with the other settings, in the clear, the way a mail client keeps one. It
 * is the credential for a server on the same network as the phone, and encrypting it against a key
 * that would have to sit beside it would be theatre rather than protection.
 */

import { prefsGetItem, prefsSetItem } from './prefsStorage';
import {
  basicAuthHeader,
  downloadFilename,
  normaliseCatalogUrl,
  opdsRootUrl,
  opdsSearchUrl,
  parseOpdsFeed,
  pickAcquisitionLink,
  pickImageLink,
  resolveOpdsUrl,
  type OpdsEntry,
  type OpdsFeed,
} from './opdsFeed';

const URL_KEY = 'sandbox_calibre_web_url';
const USER_KEY = 'sandbox_calibre_web_user';
const PASSWORD_KEY = 'sandbox_calibre_web_password';

/** A catalogue on a domestic network answers quickly or not at all. */
const REQUEST_TIMEOUT_MS = 15_000;

/** A book can be tens of megabytes over Wi-Fi, so the download gets its own, longer budget. */
const DOWNLOAD_TIMEOUT_MS = 120_000;

export interface CalibreWebSettings {
  url: string;
  username: string;
  password: string;
}

export type CalibreWebFailure =
  | 'not-configured'
  | 'unreachable'
  | 'unauthorised'
  | 'not-a-catalog'
  | 'no-readable-format';

export interface CalibreBook {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  /** Absolute URL the book downloads from. */
  downloadUrl: string;
  /** MIME type of the download, which decides how the importer reads it. */
  contentType: string;
  coverUrl?: string;
}

export function loadCalibreWebSettings(): CalibreWebSettings {
  return {
    url: normaliseCatalogUrl(prefsGetItem(URL_KEY) ?? '') ?? '',
    username: prefsGetItem(USER_KEY) ?? '',
    password: prefsGetItem(PASSWORD_KEY) ?? '',
  };
}

export function saveCalibreWebSettings(settings: Partial<CalibreWebSettings>): void {
  if (settings.url !== undefined) {
    prefsSetItem(URL_KEY, normaliseCatalogUrl(settings.url) ?? '');
  }
  if (settings.username !== undefined) prefsSetItem(USER_KEY, settings.username.trim());
  if (settings.password !== undefined) prefsSetItem(PASSWORD_KEY, settings.password);
}

export function isCalibreWebConfigured(): boolean {
  return loadCalibreWebSettings().url !== '';
}

/**
 * Headers for a catalogue request.
 *
 * Authorisation is only sent when a username was given. Calibre-web can be run without login, and
 * sending an empty Basic header to a server that allows anonymous access turns a working
 * connection into a 401.
 */
export function catalogHeaders(settings: CalibreWebSettings): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/atom+xml, application/xml' };
  if (settings.username) {
    headers.Authorization = basicAuthHeader(settings.username, settings.password);
  }
  return headers;
}

async function fetchFeed(
  url: string,
  settings: CalibreWebSettings,
): Promise<{ feed?: OpdsFeed; reason?: CalibreWebFailure }> {
  try {
    const { fetchWithTimeout } = await import('./fetchWithTimeout');
    const response = await fetchWithTimeout(
      url,
      { headers: catalogHeaders(settings) },
      REQUEST_TIMEOUT_MS,
    );
    if (response.status === 401 || response.status === 403) return { reason: 'unauthorised' };
    if (!response.ok) return { reason: 'unreachable' };

    const xml = await response.text();
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    // A parse failure produces a <parsererror> document rather than throwing, and an HTML login
    // page parses "successfully" as XML while containing no entries at all.
    if (doc.querySelector('parsererror') || doc.documentElement.tagName.toLowerCase() !== 'feed') {
      return { reason: 'not-a-catalog' };
    }
    return { feed: parseOpdsFeed(doc) };
  } catch {
    return { reason: 'unreachable' };
  }
}

/**
 * Turn a catalogue entry into a book worth showing.
 *
 * Entries with no format this app can read are dropped rather than shown greyed out. A shelf of
 * books that cannot be opened is worse than a shorter shelf, and the alternative is a download
 * that only fails once it has finished.
 */
export function entryToBook(entry: OpdsEntry, base: string): CalibreBook | null {
  const acquisition = pickAcquisitionLink(entry.links);
  if (!acquisition) return null;
  const cover = pickImageLink(entry.links);
  return {
    id: entry.id || acquisition.href,
    title: entry.title || 'Untitled',
    author: entry.author,
    summary: entry.summary,
    downloadUrl: resolveOpdsUrl(base, acquisition.href),
    contentType: acquisition.type,
    coverUrl: cover ? resolveOpdsUrl(base, cover.href) : undefined,
  };
}

export interface CalibreSearchResult {
  books: CalibreBook[];
  reason?: CalibreWebFailure;
}

/** Confirm the address points at a catalogue, before anyone tries to search it. */
export async function probeCalibreWeb(
  settings: CalibreWebSettings = loadCalibreWebSettings(),
): Promise<{ ok: boolean; title?: string; reason?: CalibreWebFailure }> {
  if (!settings.url) return { ok: false, reason: 'not-configured' };
  const { feed, reason } = await fetchFeed(opdsRootUrl(settings.url), settings);
  if (!feed) return { ok: false, reason };
  return { ok: true, title: feed.title };
}

export async function searchCalibreWeb(
  query: string,
  settings: CalibreWebSettings = loadCalibreWebSettings(),
): Promise<CalibreSearchResult> {
  if (!settings.url) return { books: [], reason: 'not-configured' };
  const trimmed = query.trim();
  // An empty search asks for the whole catalogue, which for a real library is thousands of entries
  // the server has to render. The newest books are a better answer and a far cheaper request.
  const url = trimmed
    ? opdsSearchUrl(settings.url, trimmed)
    : `${settings.url}/opds/new`;

  const { feed, reason } = await fetchFeed(url, settings);
  if (!feed) return { books: [], reason };

  const books = feed.entries
    .map((entry) => entryToBook(entry, settings.url))
    .filter((book): book is CalibreBook => book !== null);
  return { books };
}

/**
 * Fetch a book as a File, so it goes through exactly the same import as one picked off disk.
 *
 * A File rather than bytes on purpose: the shelf's importer reads the head of the file to identify
 * the format and spot DRM, and slicing a File does not pull the whole thing into memory. Handing
 * it an array would undo that for a twenty megabyte book.
 */
export async function downloadCalibreBook(
  book: CalibreBook,
  settings: CalibreWebSettings = loadCalibreWebSettings(),
): Promise<{ file?: File; reason?: CalibreWebFailure }> {
  try {
    const { fetchWithTimeout } = await import('./fetchWithTimeout');
    const headers: Record<string, string> = {};
    if (settings.username) {
      headers.Authorization = basicAuthHeader(settings.username, settings.password);
    }
    const response = await fetchWithTimeout(book.downloadUrl, { headers }, DOWNLOAD_TIMEOUT_MS);
    if (response.status === 401 || response.status === 403) return { reason: 'unauthorised' };
    if (!response.ok) return { reason: 'unreachable' };

    const blob = await response.blob();
    const name = downloadFilename(book.title, book.contentType);
    return { file: new File([blob], name, { type: book.contentType }) };
  } catch {
    return { reason: 'unreachable' };
  }
}
