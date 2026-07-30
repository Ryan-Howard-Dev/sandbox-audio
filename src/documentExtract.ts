/**
 * Turn a document file into plain text, so anything readable can become an audiobook.
 *
 * The narration side has existed for a while: documentToNarration() chunks text and
 * nativeTextToSpeech reads it. What was missing was everything in front of that — DocumentShelf
 * accepted only .txt and .md and handed the file's raw contents straight over, so a book in any
 * real format could not be read aloud at all.
 *
 * This is the layer that was absent. Give it bytes and a filename, get text back. No new
 * dependencies: fflate already ships for EPUB, and DOCX is the same zip-plus-XML shape.
 *
 * Everything here runs locally. Nothing is uploaded to convert a document.
 */

import { unzipSync } from 'fflate';
import { importEpubBytes } from './epubImport';
import { stripXhtmlText } from './epubParse';

export type DocumentFormat = 'text' | 'markdown' | 'html' | 'docx' | 'epub' | 'pdf' | 'unknown';

export interface DocumentExtraction {
  format: DocumentFormat;
  text: string;
  title?: string;
  /**
   * Set when the format was recognised but the text could not be read. A caller that shows this
   * tells the user why a file did nothing; one that ignores it shows an empty book instead.
   */
  reason?: string;
}

/**
 * What the file picker offers, as an <input accept> list.
 *
 * The extensions lead with .docx and .epub because this list is now read twice: once by the file
 * picker, where order is cosmetic, and once by the import screens, which show it to the user. The
 * two formats people actually arrive with should be the first words they see.
 */
export const SUPPORTED_DOCUMENT_ACCEPT =
  '.docx,.epub,.pdf,.txt,.md,.markdown,.text,.htm,.html,' +
  'text/plain,text/markdown,text/html,application/epub+zip,application/pdf,' +
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Extensions that name the same format to a reader. ".md" and ".markdown" are one thing; listing
 * both pads the promise without adding a format anyone can act on.
 */
const FORMAT_LABEL_ALIASES: Record<string, string> = {
  markdown: 'MD',
  text: 'TXT',
  htm: 'HTML',
};

/**
 * The formats that genuinely read, as short display labels — `['DOCX', 'EPUB', 'PDF', 'TXT', 'MD',
 * 'HTML']`.
 *
 * Derived from the accept list rather than written out again next to the import button. A second
 * hand-kept copy is the one that drifts, and the failure it causes is the worst kind: the UI
 * promising a format the extractor will reject, discovered only after the user hunted down the
 * file. MIME entries are dropped — "application/epub+zip" tells nobody anything.
 */
export function supportedDocumentFormatLabels(
  accept: string = SUPPORTED_DOCUMENT_ACCEPT,
): string[] {
  const labels: string[] = [];
  for (const entry of accept.split(',')) {
    const token = entry.trim().toLowerCase();
    if (!token.startsWith('.')) continue;
    const ext = token.slice(1);
    if (!ext) continue;
    const label = FORMAT_LABEL_ALIASES[ext] ?? ext.toUpperCase();
    if (!labels.includes(label)) labels.push(label);
  }
  return labels;
}

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

function hasMagic(bytes: Uint8Array, magic: number[]): boolean {
  if (!bytes || bytes.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) return false;
  }
  return true;
}

function extensionOf(filename: string): string {
  const name = (filename ?? '').toLowerCase();
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1);
}

/**
 * Content first, filename second.
 *
 * DOCX and EPUB are both zip archives, so an extension is the only thing separating them for a
 * file named "book.zip" — but a .docx that is really an EPUB should still read, and a renamed
 * file is common enough with books pulled off the web. Sniffing the archive's contents settles it.
 */
export function detectDocumentFormat(bytes: Uint8Array, filename = ''): DocumentFormat {
  if (hasMagic(bytes, [0x25, 0x50, 0x44, 0x46])) return 'pdf'; // %PDF

  if (hasMagic(bytes, ZIP_MAGIC)) {
    try {
      const entries = unzipSync(bytes);
      if (entries['word/document.xml']) return 'docx';
      if (entries['mimetype'] || entries['META-INF/container.xml']) return 'epub';
    } catch {
      // Falls through to the extension: a truncated archive still has a name.
    }
  }

  switch (extensionOf(filename)) {
    case 'docx':
      return 'docx';
    case 'epub':
      return 'epub';
    case 'pdf':
      return 'pdf';
    case 'htm':
    case 'html':
      return 'html';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'txt':
    case 'text':
      return 'text';
    default:
      return 'unknown';
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCodePoint(parseInt(code, 16)))
    // Last, so that "&amp;lt;" does not become "<".
    .replace(/&amp;/g, '&');
}

/** Collapse runaway whitespace without flattening paragraph breaks, which narration chunks on. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * DOCX text, paragraph by paragraph.
 *
 * Only <w:t> runs are taken. Stripping every tag instead would sweep up field codes, deleted
 * revisions and index entries as if they were prose — a document with tracked changes would be
 * read aloud twice over. Paragraphs are split on </w:p> because the XML carries no whitespace of
 * its own: textContent alone would run the whole book into one sentence.
 */
export function docxToText(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes) as Record<string, Uint8Array>;
  } catch {
    return '';
  }
  const doc = entries['word/document.xml'];
  if (!doc) return '';

  const xml = new TextDecoder('utf-8').decode(doc);
  const paragraphs: string[] = [];
  for (const block of xml.split(/<\/w:p>/)) {
    let line = '';
    // <w:br/> and <w:tab/> are the only formatting that survives into speech as a pause.
    const withBreaks = block.replace(/<w:br\s*\/?>/g, '\n').replace(/<w:tab\s*\/?>/g, ' ');
    for (const run of withBreaks.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)) {
      line += run[1];
    }
    const cleaned = decodeEntities(line).trim();
    if (cleaned) paragraphs.push(cleaned);
  }
  return tidy(paragraphs.join('\n\n'));
}

/** EPUB text in spine order, each chapter separated so narration keeps its shape. */
export function epubToText(bytes: Uint8Array): DocumentExtraction {
  const result = importEpubBytes(bytes);
  if (!result.book) {
    const reason =
      result.reason === 'encrypted'
        ? 'This EPUB is DRM-protected, so its text cannot be read.'
        : result.reason === 'not-an-epub'
          ? 'That file is a zip archive but not an EPUB.'
          : 'This EPUB could not be read — the archive may be damaged.';
    return { format: 'epub', text: '', reason };
  }
  const parts: string[] = [];
  for (const chapter of result.book.chapters ?? []) {
    const body = (chapter.text ?? '').trim();
    if (!body) continue;
    const heading = (chapter.title ?? '').trim();
    parts.push(heading ? `${heading}\n\n${body}` : body);
  }
  return {
    format: 'epub',
    text: tidy(parts.join('\n\n')),
    title: result.book.title,
  };
}

/**
 * Extract readable text from a document.
 *
 * Never throws — nor rejects: a document that cannot be read comes back with an empty `text` and a
 * `reason` worth showing. Callers are import handlers, and an exception there loses the file
 * silently.
 *
 * Asynchronous because of PDF alone. pdf.js parses off the main thread and cannot be made to
 * answer synchronously, and every other format is fast enough that a promise costs nothing. One
 * entry point that sometimes needs awaiting is better than two that differ only in colour.
 */
export async function extractDocumentText(
  bytes: Uint8Array,
  filename = '',
): Promise<DocumentExtraction> {
  const format = detectDocumentFormat(bytes, filename);

  try {
    switch (format) {
      case 'text':
      case 'markdown':
        return { format, text: tidy(new TextDecoder('utf-8').decode(bytes)) };

      case 'html':
        return { format, text: tidy(stripXhtmlText(new TextDecoder('utf-8').decode(bytes))) };

      case 'docx': {
        const text = docxToText(bytes);
        return text
          ? { format, text }
          : { format, text: '', reason: 'No readable text was found in that .docx.' };
      }

      case 'epub':
        return epubToText(bytes);

      case 'pdf': {
        /*
         * Loaded on demand. pdf.js is the largest dependency in the app by a wide margin — a
         * parser plus its worker — and most sessions never open a PDF. A static import would put
         * all of it in the startup path of a phone app whose first screen is a music library.
         */
        const { pdfToText } = await import('./pdfExtract');
        return await pdfToText(bytes);
      }

      default:
        return {
          format: 'unknown',
          text: '',
          reason: 'That file type cannot be read aloud yet.',
        };
    }
  } catch {
    return { format, text: '', reason: 'That document could not be read.' };
  }
}
