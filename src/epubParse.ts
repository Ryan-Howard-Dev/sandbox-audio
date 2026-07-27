/**
 * EPUB → chapters and metadata.
 *
 * An EPUB is a zip holding XHTML documents plus an OPF manifest. That manifest is worth more than
 * anything a plain text file can offer: it carries the real title, author, language and often a
 * description, and the spine gives the *actual* chapter order rather than headings inferred from
 * prose. A book imported this way arrives populated instead of guessed at.
 *
 * Everything here is pure and operates on an already-unzipped file map, so the rules are testable
 * without a zip fixture and without a browser. Unzipping lives at the call site.
 */

/** Unzipped EPUB: path inside the archive → file bytes. */
export type EpubFiles = Record<string, Uint8Array>;

export interface EpubChapter {
  /** Spine order, 0-based. */
  index: number;
  title: string;
  text: string;
  href: string;
}

export interface EpubMetadata {
  /** ISBN from dc:identifier, when present — an exact key beats a fuzzy title match. */
  isbn: string;
  title: string;
  author: string;
  language: string;
  description: string;
  /** Path of the cover image inside the archive, when the manifest names one. */
  coverHref: string;
}

export interface ParsedEpub extends EpubMetadata {
  chapters: EpubChapter[];
}

const decoder = new TextDecoder('utf-8');

function decode(bytes: Uint8Array | undefined): string {
  return bytes ? decoder.decode(bytes) : '';
}

function parseXml(xml: string): Document | null {
  try {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    // A parse failure produces a <parsererror> document rather than throwing.
    return doc.querySelector('parsererror') ? null : doc;
  } catch {
    return null;
  }
}

/**
 * Path of the OPF package document, from META-INF/container.xml.
 *
 * The OPF is not at a fixed location — publishers put it anywhere — so container.xml is the only
 * correct way in. Guessing common paths works until it silently doesn't.
 */
export function findOpfPath(files: EpubFiles): string | null {
  const container = decode(files['META-INF/container.xml']);
  if (!container) return null;
  const doc = parseXml(container);
  const full = doc?.querySelector('rootfile')?.getAttribute('full-path')?.trim();
  return full || null;
}

/** Resolve a manifest href against the OPF's own directory, since hrefs are relative to it. */
export function resolveHref(opfPath: string, href: string): string {
  const clean = href.split('#')[0]!.trim();
  if (!clean) return '';
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const joined = `${dir}${clean}`;
  // Collapse ../ segments so a nested OPF still resolves to a real archive path.
  const parts: string[] = [];
  for (const segment of joined.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
}

export function parseEpubMetadata(opfXml: string, opfPath: string): EpubMetadata {
  const doc = parseXml(opfXml);
  const pick = (tag: string): string => {
    const nodes = doc?.getElementsByTagName(`dc:${tag}`);
    const fallback = doc?.getElementsByTagName(tag);
    const node = (nodes && nodes[0]) || (fallback && fallback[0]);
    return node?.textContent?.trim() ?? '';
  };

  let coverHref = '';
  if (doc) {
    // EPUB 3 marks the cover with properties="cover-image"; EPUB 2 uses a meta name=cover
    // pointing at a manifest id. Both are common enough that neither can be skipped.
    const items = [...doc.getElementsByTagName('item')];
    const byProperty = items.find((i) =>
      (i.getAttribute('properties') ?? '').split(/\s+/).includes('cover-image'),
    );
    const metaCoverId = [...doc.getElementsByTagName('meta')]
      .find((m) => m.getAttribute('name') === 'cover')
      ?.getAttribute('content');
    const byId = metaCoverId ? items.find((i) => i.getAttribute('id') === metaCoverId) : undefined;
    const href = (byProperty ?? byId)?.getAttribute('href');
    if (href) coverHref = resolveHref(opfPath, href);
  }

  return {
    title: pick('title'),
    author: pick('creator'),
    language: pick('language'),
    description: stripXhtmlText(pick('description')),
    coverHref,
    isbn: pickIsbn(doc),
  };
}

/**
 * ISBN from the Dublin Core identifiers.
 *
 * Publishers write it as `urn:isbn:9780306406157`, `ISBN 978-0-306-40615-7`, or bare digits, so
 * this normalises to digits and accepts only the two valid lengths. An exact identifier turns
 * enrichment from a fuzzy title search into a direct lookup.
 */
function pickIsbn(doc: Document | null): string {
  if (!doc) return '';
  const nodes = [
    ...doc.getElementsByTagName('dc:identifier'),
    ...doc.getElementsByTagName('identifier'),
  ];
  for (const node of nodes) {
    const raw = (node.textContent ?? '').toLowerCase();
    // Either it says so, or it is nothing but digits, hyphens and spaces. A UUID identifier —
    // which most EPUBs carry — must not be mistaken for an ISBN.
    if (!raw.includes('isbn') && !/^[0-9\s-]+$/.test(raw)) continue;
    const digits = raw.replace(/[^0-9x]/g, '');
    if (digits.length === 13 || digits.length === 10) return digits;
  }
  return '';
}

/**
 * DRM or obfuscation, which no amount of parsing gets past.
 *
 * A protected EPUB unzips fine and then yields gibberish, so without this check the failure looks
 * like a corrupt file or an empty book. Saying "this one is protected" is the difference between
 * a user knowing why and a user thinking the app is broken.
 */
export function isEpubEncrypted(files: EpubFiles): boolean {
  return 'META-INF/encryption.xml' in files;
}

/** Archive paths of the readable documents, in spine order — the book's real reading order. */
export function parseEpubSpine(opfXml: string, opfPath: string): string[] {
  const doc = parseXml(opfXml);
  if (!doc) return [];
  const hrefById = new Map<string, string>();
  for (const item of [...doc.getElementsByTagName('item')]) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    const type = item.getAttribute('media-type') ?? '';
    // Only documents: images and stylesheets are in the manifest too and are not readable text.
    if (!id || !href || !/xhtml|html/i.test(type)) continue;
    hrefById.set(id, resolveHref(opfPath, href));
  }
  const out: string[] = [];
  for (const ref of [...doc.getElementsByTagName('itemref')]) {
    // linear="no" marks front matter the reader is not meant to walk through in order.
    if ((ref.getAttribute('linear') ?? '').toLowerCase() === 'no') continue;
    const href = hrefById.get(ref.getAttribute('idref') ?? '');
    if (href) out.push(href);
  }
  return out;
}

/**
 * Readable text of an XHTML document.
 *
 * Script and style content is removed rather than flattened — leaving it in means a narrator
 * reading CSS aloud, which is the sort of thing that only shows up once someone listens.
 */
export function stripXhtmlText(xhtml: string): string {
  if (!xhtml.trim()) return '';
  const withoutCode = xhtml
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const doc = parseXml(withoutCode) ?? null;
  const text = doc?.documentElement?.textContent ?? withoutCode.replace(/<[^>]+>/g, ' ');
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Chapter title: the document's first heading, else its <title>, else a numbered fallback.
 *
 * A chapter list of "Chapter 1, Chapter 2" is worth less than the book's own headings, and most
 * EPUBs carry them.
 */
export function chapterTitleFrom(xhtml: string, index: number): string {
  const doc = parseXml(xhtml);
  const heading = doc?.querySelector('h1, h2, h3')?.textContent?.trim();
  if (heading) return heading;
  const title = doc?.querySelector('title')?.textContent?.trim();
  if (title) return title;
  return `Chapter ${index + 1}`;
}

/** Minimum characters for a spine document to count as a chapter rather than a title page. */
export const MIN_CHAPTER_CHARS = 200;

export function parseEpub(files: EpubFiles): ParsedEpub | null {
  const opfPath = findOpfPath(files);
  if (!opfPath) return null;
  const opfXml = decode(files[opfPath]);
  if (!opfXml) return null;

  const metadata = parseEpubMetadata(opfXml, opfPath);
  const spine = parseEpubSpine(opfXml, opfPath);

  const chapters: EpubChapter[] = [];
  for (const href of spine) {
    const xhtml = decode(files[href]);
    if (!xhtml) continue;
    const text = stripXhtmlText(xhtml);
    // Cover pages and copyright notices are in the spine and are not chapters; narrating them
    // as such makes a twelve-chapter book claim twenty.
    if (text.length < MIN_CHAPTER_CHARS) continue;
    chapters.push({ index: chapters.length, title: chapterTitleFrom(xhtml, chapters.length), text, href });
  }

  return { ...metadata, chapters };
}
