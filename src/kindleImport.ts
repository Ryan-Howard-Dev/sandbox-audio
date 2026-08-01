/**
 * MOBI and AZW3 → the same shape an EPUB becomes.
 *
 * The shelf, the reader, narration, pagination and position all speak ParsedEpub. Making Kindle
 * books arrive as that costs one adapter here and changes nothing downstream, which is the whole
 * point: a book is a book once it is open.
 *
 * foliate-js does the format work. Writing a MOBI parser by hand would mean HUFF/CDIC Huffman
 * dictionaries, PalmDOC's LZ77 variant, and KF8's fragment tables — weeks of work to arrive
 * somewhere a maintained MIT library already is. It is MIT, which the GPL accepts, and it parses
 * in the WebView rather than across a native bridge, so no text is serialised twice on its way to
 * the reader.
 *
 * Note for anyone testing this: the extraction path needs DOMParser, which Node does not have.
 * The pure parts are split out and tested; the extraction itself can only be exercised on a
 * device or in a browser.
 */
import { unzlibSync } from 'fflate';
import type { EpubChapter, ParsedEpub } from './epubParse';
import { readKindleFileInfo, type KindleFileInfo } from './mobiFormat';

export type KindleImportFailure = 'kindle-drm' | 'kfx-unsupported' | 'kindle-unreadable';

export interface KindleImportResult {
  book?: ParsedEpub;
  reason?: KindleImportFailure;
}

/** Section of a foliate-js book, narrowed to what this needs. */
interface FoliateSection {
  createDocument: () => Promise<Document>;
  linear?: string;
}

interface FoliateBook {
  sections: FoliateSection[];
  metadata?: {
    title?: string | { [key: string]: string };
    author?: unknown;
    language?: string | string[];
    description?: string;
    identifier?: string;
  };
  getCover?: () => Promise<Blob | null>;
  toc?: { label?: string; href?: string }[];
}

/** foliate-js reports titles and authors in several shapes depending on the source metadata. */
function flattenName(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(flattenName).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return flattenName(record.name ?? Object.values(record)[0]);
  }
  return '';
}

/**
 * Chapter title from the document itself.
 *
 * MOBI has no per-section title the way an EPUB spine does, so the first heading is the only
 * honest source. A section without one gets a numbered fallback rather than an empty entry, which
 * would leave a blank row in the chapter list.
 */
function headingFor(doc: Document, index: number): string {
  const heading = doc.querySelector('h1, h2, h3');
  const text = heading?.textContent?.trim() ?? '';
  return text || `Section ${index + 1}`;
}

function textOf(doc: Document): string {
  return (doc.body?.textContent ?? '').replace(/\s+\n/g, '\n').trim();
}

/**
 * Read a Kindle book, or say precisely why not.
 *
 * Takes a File rather than bytes on purpose. A File holds a reference to storage rather than its
 * contents, so foliate-js slices the ranges it needs straight off disk. Reading a 20 MB book into
 * memory first costs far more than 20 MB once it is a buffer and a string at once, and that is
 * what gets a WebView render process killed on a mid-range phone.
 */
export async function importKindleFile(file: File): Promise<KindleImportResult> {
  const info: KindleFileInfo = readKindleFileInfo(await file.slice(0, 8192).arrayBuffer());
  if (info.format === 'kfx') return { reason: 'kfx-unsupported' };
  if (info.format === 'not-kindle') return { reason: 'kindle-unreadable' };
  // Checked before opening: decompressing a protected file yields garbage rather than an error.
  if (info.drm) return { reason: 'kindle-drm' };

  try {
    const { MOBI } = await import('foliate-js/mobi.js');
    const book = (await new MOBI({
      unzlib: (data: Uint8Array) => unzlibSync(data),
    }).open(file)) as FoliateBook;

    const chapters: EpubChapter[] = [];
    for (let i = 0; i < book.sections.length; i += 1) {
      const section = book.sections[i]!;
      // A section that fails to build must not lose the rest of the book.
      let doc: Document;
      try {
        doc = await section.createDocument();
      } catch {
        continue;
      }
      const text = textOf(doc);
      if (!text) continue;
      chapters.push({ index: chapters.length, title: headingFor(doc, i), text, href: `section-${i}` });
    }

    if (chapters.length === 0) return { reason: 'kindle-unreadable' };

    return {
      book: {
        isbn: flattenName(book.metadata?.identifier),
        title: flattenName(book.metadata?.title) || info.title || file.name,
        author: flattenName(book.metadata?.author),
        language: flattenName(book.metadata?.language),
        description: book.metadata?.description?.trim() ?? '',
        // The cover is a Blob here rather than a path inside an archive, so it is read separately.
        coverHref: '',
        chapters,
      },
    };
  } catch {
    return { reason: 'kindle-unreadable' };
  }
}

/** The cover, as a data URL the shelf can store. Absent rather than failing when there is none. */
export async function readKindleCover(file: File): Promise<string | undefined> {
  try {
    const { MOBI } = await import('foliate-js/mobi.js');
    const book = (await new MOBI({
      unzlib: (data: Uint8Array) => unzlibSync(data),
    }).open(file)) as FoliateBook;
    const blob = await book.getCover?.();
    if (!blob) return undefined;
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}
