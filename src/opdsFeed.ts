/**
 * Reading an OPDS catalogue.
 *
 * Calibre-web is the reason this exists, but it is not what this speaks to. Calibre-web serves
 * OPDS, which is an open standard, and so do Calibre's own content server, Kavita, Komga,
 * Ubooquity and most other ebook servers. Writing to calibre-web's private JSON endpoints would
 * have been slightly shorter and would have worked with exactly one server.
 *
 * OPDS is Atom with two extra ideas: an entry can be a book or it can be a shelf, and the links on
 * an entry say which. Everything here is about reading those link relations correctly, because
 * getting them wrong is how a reader ends up downloading a cover image as if it were a book.
 *
 * The parsing needs a DOM and so cannot be unit tested in Node. Everything that decides anything is
 * separated out above it and is tested.
 */

export interface OpdsLink {
  rel: string;
  type: string;
  href: string;
  title?: string;
}

export interface OpdsEntry {
  id: string;
  title: string;
  author?: string;
  summary?: string;
  links: OpdsLink[];
}

export interface OpdsFeed {
  title: string;
  entries: OpdsEntry[];
  links: OpdsLink[];
}

/** A link that offers the book itself, in each of the forms a server may describe it. */
const ACQUISITION_RELS = [
  'http://opds-spec.org/acquisition',
  'http://opds-spec.org/acquisition/open-access',
  'http://opds-spec.org/acquisition/buy',
  'http://opds-spec.org/acquisition/borrow',
];

const IMAGE_REL = 'http://opds-spec.org/image';
const THUMBNAIL_REL = 'http://opds-spec.org/image/thumbnail';

/**
 * Formats worth downloading, best first.
 *
 * EPUB before everything because it is the only one the reader can paginate and narrate properly.
 * A PDF still opens, through pdf.js, so it is worth taking when it is all a book has. Anything
 * else is a file this app cannot read, and offering it produces a download that fails after it has
 * finished.
 */
export const PREFERRED_FORMATS = [
  'application/epub+zip',
  'application/x-mobipocket-ebook',
  'application/vnd.amazon.ebook',
  'application/pdf',
];

/**
 * Turn whatever someone typed into the server's root.
 *
 * People paste the address they see in their browser, which is as likely to be
 * "http://box:8083/opds" or a book page as it is the bare root. Trailing "/opds" is stripped
 * because every request here appends it, and appending twice gets a 404 that reads like the
 * server is down.
 */
export function normaliseCatalogUrl(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const path = url.pathname.replace(/\/+$/, '').replace(/\/opds(\/.*)?$/, '');
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/** Absolute URL for a link that may be relative, which most of them are. */
export function resolveOpdsUrl(base: string, href: string): string {
  try {
    return new URL(href, base.endsWith('/') ? base : `${base}/`).toString();
  } catch {
    return href;
  }
}

/** Where calibre-web answers searches. The query is a path segment, not a parameter. */
export function opdsSearchUrl(base: string, query: string): string {
  return `${base.replace(/\/+$/, '')}/opds/search/${encodeURIComponent(query.trim())}`;
}

export function opdsRootUrl(base: string): string {
  return `${base.replace(/\/+$/, '')}/opds`;
}

/**
 * The link to download from, in the best format this app can actually read.
 *
 * Returns null rather than the first acquisition link when nothing matches. A server offering only
 * CBZ or DjVu has nothing for us, and saying so beats downloading eight megabytes and then
 * reporting the file as corrupt.
 */
export function pickAcquisitionLink(
  links: OpdsLink[],
  preferred: string[] = PREFERRED_FORMATS,
): OpdsLink | null {
  const acquisition = links.filter((link) =>
    ACQUISITION_RELS.some((rel) => link.rel === rel || link.rel.startsWith(`${rel}/`)),
  );
  for (const type of preferred) {
    const match = acquisition.find((link) => link.type === type);
    if (match) return match;
  }
  return null;
}

/** Cover art, thumbnail preferred: a shelf shows them small and full covers are slow over a LAN. */
export function pickImageLink(links: OpdsLink[]): OpdsLink | null {
  return (
    links.find((link) => link.rel === THUMBNAIL_REL) ??
    links.find((link) => link.rel === IMAGE_REL) ??
    null
  );
}

/**
 * Is this entry a shelf to open rather than a book to download?
 *
 * A navigation entry has no acquisition link. Checking for that rather than for a navigation type
 * is deliberate: servers are inconsistent about the type they declare, but a book that cannot be
 * downloaded is not a book by any of them.
 */
export function isNavigationEntry(entry: OpdsEntry): boolean {
  return pickAcquisitionLink(entry.links) === null;
}

/** A short label for a format, for a list that has to say what it is about to fetch. */
export function formatLabel(mimeType: string): string {
  if (mimeType === 'application/epub+zip') return 'EPUB';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType === 'application/x-mobipocket-ebook') return 'MOBI';
  if (mimeType === 'application/vnd.amazon.ebook') return 'AZW3';
  return mimeType.split('/').pop()?.toUpperCase() ?? 'FILE';
}

/**
 * A filename for the downloaded book.
 *
 * The URL is no help: calibre-web's download links end in the book's numeric id and its format as
 * a path segment, so taking the last segment names every file "epub". The importer dispatches on
 * content rather than name, but the name is what a failure message quotes, and "3417" tells nobody
 * which book failed.
 */
export function downloadFilename(title: string, mimeType: string): string {
  const stem = (title || 'book').replace(/[\\/:*?"<>|]+/g, '').trim().slice(0, 80) || 'book';
  const extension = formatLabel(mimeType).toLowerCase();
  return `${stem}.${extension}`;
}

/** HTTP Basic, which is what calibre-web wants. */
export function basicAuthHeader(username: string, password: string): string {
  const raw = `${username}:${password}`;
  const encoded =
    typeof btoa === 'function'
      ? btoa(raw)
      : // Node, for tests. Buffer is not present in the browser build.
        (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
          .Buffer?.from(raw, 'utf8')
          .toString('base64') ?? '';
  return `Basic ${encoded}`;
}

function textOf(parent: Element, tag: string): string {
  return parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? '';
}

function linksOf(parent: Element): OpdsLink[] {
  return [...parent.getElementsByTagName('link')].map((node) => ({
    rel: node.getAttribute('rel') ?? '',
    type: node.getAttribute('type') ?? '',
    href: node.getAttribute('href') ?? '',
    title: node.getAttribute('title') ?? undefined,
  }));
}

/**
 * Parse an OPDS document. Needs a real DOM, which is why it is the only thing here that is not
 * tested directly.
 */
export function parseOpdsFeed(doc: Document): OpdsFeed {
  const feed = doc.documentElement;
  const entries: OpdsEntry[] = [...doc.getElementsByTagName('entry')].map((node) => ({
    id: textOf(node, 'id'),
    title: textOf(node, 'title'),
    // Author is nested: <author><name>…</name></author>. Reading "name" from the entry finds it
    // without walking, because nothing else in an OPDS entry uses that tag.
    author: textOf(node, 'name') || undefined,
    summary: textOf(node, 'summary') || textOf(node, 'content') || undefined,
    links: linksOf(node),
  }));
  return {
    // The feed's own title is the first <title>; entries have their own further down.
    title: feed.getElementsByTagName('title')[0]?.textContent?.trim() ?? '',
    entries,
    links: [...feed.children]
      .filter((child) => child.tagName.toLowerCase() === 'link')
      .map((node) => ({
        rel: node.getAttribute('rel') ?? '',
        type: node.getAttribute('type') ?? '',
        href: node.getAttribute('href') ?? '',
        title: node.getAttribute('title') ?? undefined,
      })),
  };
}
