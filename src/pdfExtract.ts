/**
 * PDF text, in an order a voice can read.
 *
 * A PDF stores positioned glyphs, not sentences, so there is no "the text" to ask for — it has to
 * be reassembled from coordinates. That is why this leans on pdf.js rather than a hand-rolled
 * parser: the homegrown version reads two-column papers straight across, so half of every sentence
 * comes from the wrong column, and it never fails loudly enough for anyone to notice before the
 * audio is playing.
 *
 * What pdf.js does not do is make the result listenable. Its text layer still contains the running
 * head and the page number, once per page, exactly where they fall in reading order. Narrated,
 * that is "Chapter Three — forty seven" wedged between every two paragraphs. Stripping those is
 * most of this file.
 *
 * Everything here runs locally. The worker is bundled, not fetched: this app ships to a Capacitor
 * WebView with no network to reach a CDN with.
 */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
// Imported as a URL so Vite emits the worker as its own asset and rewrites this to the hashed
// path. The `legacy` build is deliberate — minSdk is 24, and a stock WebView on an old Android
// does not have the syntax the modern build assumes. The pre-minified worker is used because a
// `?url` asset is copied verbatim; Vite never gets to minify it.
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { DocumentExtraction } from './documentExtract';

/*
 * Only point pdf.js at the bundled worker where a real one exists. Under vitest there is no
 * `Worker` global, and pdf.js answers that by importing `workerSrc` as a module on the main
 * thread — handing it a browser asset URL there turns a working fallback into a load failure.
 * If the WebView refuses a module worker, pdf.js falls back the same way, just slower.
 */
if (typeof Worker !== 'undefined') {
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

/** The shape of a pdf.js text item that matters here; the rest of the union carries no text. */
interface PdfTextItem {
  str?: string;
  width?: number;
  height?: number;
  hasEOL?: boolean;
  /** [a, b, c, d, x, y] — only the translation is used. */
  transform?: number[];
}

interface PlacedLine {
  text: string;
  y: number;
}

/** Lines examined at each edge of a page when hunting for running heads. */
const EDGE_BAND = 2;

/** A running head is furniture, not prose. Anything longer is a sentence that happens to repeat. */
const MAX_RUNNING_HEAD_CHARS = 90;

/**
 * Below this many non-space characters per page, the file is images of text.
 *
 * A page of prose carries well over a thousand. The gap is wide enough that this never has to
 * guess: it is separating "scanned" from "typeset", not "sparse" from "dense".
 */
const MIN_CHARS_PER_PAGE = 16;

/**
 * Roman page numbers, up to cccxcix.
 *
 * Deliberately not the full grammar: "m" and "d" are dropped so that ordinary words spelled from
 * roman letters stop matching. "mix" is a perfectly valid 1009 and "did" parses as far as 501, and
 * either one alone at the top of a page would be deleted as furniture. Front matter never runs
 * past a few dozen pages, so nothing real is lost by refusing to count that high.
 */
const ROMAN = /^c{0,3}(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/i;

/** A line that is only a page number, however it is dressed: "12", "- 12 -", "[ xiv ]", "Page 12". */
function isPageNumber(line: string): boolean {
  const bare = line.replace(/^[[(\s|.–—-]+/, '').replace(/[\])\s|.–—-]+$/, '');
  const stripped = bare.replace(/^page\s+/i, '');
  if (!stripped) return false;
  if (/^\d{1,4}$/.test(stripped)) return true;
  return ROMAN.test(stripped) && stripped.length > 0;
}

/**
 * Collapse a candidate head to what stays the same page to page.
 *
 * Digits become a placeholder because the page number inside a running head is the one part that
 * changes — "Chapter 3 — 47" and "Chapter 3 — 48" are the same piece of furniture, and comparing
 * them literally would find no repetition at all.
 */
function normaliseHead(line: string): string {
  return line
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/[^a-zÀ-ɏ#]+/g, ' ')
    .trim();
}

/** Indices of the first and last few non-blank lines — where furniture lives. */
function edgeIndices(page: string[]): number[] {
  const filled: number[] = [];
  for (let i = 0; i < page.length; i++) {
    if ((page[i] ?? '').trim()) filled.push(i);
  }
  const edges = new Set<number>();
  for (let i = 0; i < EDGE_BAND && i < filled.length; i++) {
    edges.add(filled[i]);
    edges.add(filled[filled.length - 1 - i]);
  }
  return Array.from(edges);
}

/**
 * Drop repeated running headers and footers, and page numbers.
 *
 * Repetition is the only signal available — nothing in a PDF marks a line as a header. So a short
 * line near an edge is dropped when the same line sits near an edge on at least half the pages.
 * The count floor of three is what protects a short document: on a two-page handout "the same line
 * on both pages" is a coincidence, not a pattern, and a chapter title would be the casualty.
 *
 * Page numbers are handled separately because they are never the same twice, so no amount of
 * counting finds them.
 */
export function stripRunningHeads(pages: string[][]): string[][] {
  if (!pages || pages.length === 0) return [];

  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const index of edgeIndices(page)) {
      const line = (page[index] ?? '').trim();
      if (line.length > MAX_RUNNING_HEAD_CHARS) continue;
      const key = normaliseHead(line);
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const threshold = Math.max(3, Math.ceil(pages.length / 2));

  return pages.map((page) => {
    const edges = new Set(edgeIndices(page));
    return page.filter((line, index) => {
      if (!edges.has(index)) return true;
      const text = (line ?? '').trim();
      if (isPageNumber(text)) return false;
      if (text.length > MAX_RUNNING_HEAD_CHARS) return true;
      const key = normaliseHead(text);
      if (!key) return true;
      return (counts.get(key) ?? 0) < threshold;
    });
  });
}

/**
 * Lines into prose, pages into paragraphs.
 *
 * Lines inside a page are joined with a single newline rather than a space so that
 * documentToNarration still sees a paragraph it can re-flow, and pages are separated by a blank
 * line so narration chunks land on page boundaries instead of straddling them.
 */
export function joinPdfPages(pages: string[][]): string {
  const rendered: string[] = [];
  for (const page of pages ?? []) {
    const text = joinPageLines(page ?? []);
    if (text) rendered.push(text);
  }
  return rendered.join('\n\n');
}

function joinPageLines(lines: string[]): string {
  let out = '';
  for (const raw of lines) {
    const line = (raw ?? '').trim();
    if (!line) {
      if (out && !out.endsWith('\n\n')) out += '\n\n';
      continue;
    }
    if (!out || out.endsWith('\n')) {
      out += line;
      continue;
    }
    /*
     * Justified text hyphenates at the margin, and a synthesiser reads the two halves as two
     * invented words. Rejoining costs the occasional real hyphen ("well-known" set across a line
     * break becomes "wellknown"), which is still the right trade: that one is heard as the correct
     * word, "appro" and "ximately" are heard as neither.
     */
    if (/[a-zÀ-ɏ]-$/.test(out) && /^[a-zÀ-ɏ]/.test(line)) {
      out = `${out.slice(0, -1)}${line}`;
    } else {
      out += `\n${line}`;
    }
  }
  return out.trim();
}

/**
 * Group positioned glyph runs into lines, in the order pdf.js emitted them.
 *
 * Emphatically not sorted by vertical position: in a two-column layout the content stream gives
 * the whole left column and then the whole right one, and sorting by y interleaves them into
 * alternating half-sentences. Sequential grouping keeps each column intact, and the jump back to
 * the top of the page reads as one more line break.
 */
function itemsToLines(items: PdfTextItem[]): PlacedLine[] {
  const lines: PlacedLine[] = [];
  let text = '';
  let y: number = null;
  let endX = 0;
  let size = 0;

  const flush = () => {
    if (text.trim()) lines.push({ text: text.replace(/\s+/g, ' ').trim(), y });
    text = '';
  };

  for (const item of items) {
    const str = item?.str;
    if (typeof str !== 'string') continue; // Marked-content boundaries carry no glyphs.
    const transform = item.transform ?? [];
    const itemY = typeof transform[5] === 'number' ? transform[5] : y;
    const itemX = typeof transform[4] === 'number' ? transform[4] : endX;
    const height = typeof item.height === 'number' && item.height > 0 ? item.height : size || 10;

    if (y === null || Math.abs(itemY - y) > Math.max(1, height * 0.4)) {
      flush();
      y = itemY;
    } else if (text && !/\s$/.test(text) && !/^\s/.test(str) && itemX - endX > height * 0.25) {
      // pdf.js splits a line wherever the text matrix moves, including across a plain space that
      // was drawn as a jump rather than a character. Without this, words fuse.
      text += ' ';
    }

    text += str;
    endX = itemX + (typeof item.width === 'number' ? item.width : 0);
    size = height;
    if (item.hasEOL) {
      flush();
      y = itemY;
    }
  }
  flush();
  return lines;
}

/**
 * Insert blank lines where the leading opens up.
 *
 * Paragraphs in a PDF are marked by nothing but extra vertical space, so the page's own line
 * spacing is the baseline and anything much larger is a break. Without this a whole page arrives
 * as one paragraph and narration loses every pause the author put there.
 *
 * The baseline is the lower quartile of the gaps, not the median: on a page with few lines — a
 * chapter opening, a title page — paragraph gaps are half the sample and drag the median up until
 * nothing looks like a break any more. The quartile still lands on body leading there.
 */
function withParagraphBreaks(lines: PlacedLine[]): string[] {
  if (lines.length === 0) return [];
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const leading = gaps.length ? gaps[Math.floor(gaps.length * 0.25)] : 0;

  const out: string[] = [lines[0].text];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1].y - lines[i].y;
    // A negative gap means the text jumped back up the page — a new column, which is at least as
    // strong a break as extra leading.
    if (gap < 0 || (leading > 0 && gap > leading * 1.6)) out.push('');
    out.push(lines[i].text);
  }
  return out;
}

/**
 * Read a PDF into narratable text.
 *
 * Never throws. A PDF that cannot be read comes back with empty text and a reason the shelf can
 * show, because the alternative is an imported book that is silently blank.
 */
export async function pdfToText(bytes: Uint8Array): Promise<DocumentExtraction> {
  let loadingTask: ReturnType<typeof pdfjs.getDocument> = null;
  try {
    loadingTask = pdfjs.getDocument({
      data: bytes,
      /*
       * Nothing is fetched, and no glyph is ever drawn. The font work pdf.js does by default —
       * rebuilding embedded fonts into @font-face rules, reaching for a system font when one is
       * missing — exists to render pages, and this only reads their encoding. On a phone in
       * aeroplane mode that work is a stall with no output.
       */
      disableFontFace: true,
      useSystemFonts: false,
      // ERRORS only: an ordinary PDF logs a page of warnings about resources we chose not to load.
      verbosity: 0,
    });
    const doc = await loadingTask.promise;

    const pages: string[][] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = (content?.items ?? []) as unknown as PdfTextItem[];
      pages.push(withParagraphBreaks(itemsToLines(items)));
      // Each page holds on to its parsed operator list; a long book exhausts a WebView without it.
      page.cleanup();
    }

    const text = joinPdfPages(stripRunningHeads(pages));
    const density = text.replace(/\s+/g, '').length / Math.max(1, pages.length);
    if (density < MIN_CHARS_PER_PAGE) {
      /*
       * Scanned books are the single commonest PDF that "does not work", and the failure is
       * invisible: the file opens, the pages look like pages, and extraction returns nothing.
       * Saying which kind of PDF it is turns a bug report into a sentence the reader can act on.
       * OCR is deliberately not attempted — it is a second engine, tens of megabytes, and a
       * different feature.
       */
      return {
        format: 'pdf',
        text: '',
        reason:
          'This PDF looks scanned — its pages are images with no text layer, so there is nothing to read aloud.',
      };
    }

    return { format: 'pdf', text, title: await pdfTitle(doc) };
  } catch (error) {
    return { format: 'pdf', text: '', reason: describeFailure(error) };
  } finally {
    // Tears down the worker too. Leaking one per import would be a background thread per book.
    try {
      await loadingTask?.destroy();
    } catch {
      // A load that never started has nothing to destroy.
    }
  }
}

/** The embedded title, when the producer bothered — better than "scan_0001.pdf" on the shelf. */
async function pdfTitle(doc: { getMetadata: () => Promise<unknown> }): Promise<string | undefined> {
  try {
    const metadata = (await doc.getMetadata()) as { info?: { Title?: string } };
    const title = metadata?.info?.Title;
    return typeof title === 'string' && title.trim() ? title.trim() : undefined;
  } catch {
    return undefined;
  }
}

function describeFailure(error: unknown): string {
  const name = (error as { name?: string })?.name ?? '';
  if (name === 'PasswordException') {
    return 'This PDF is password-protected, so its text cannot be read.';
  }
  if (name === 'InvalidPDFException') {
    return 'This PDF could not be read — the file may be damaged or incomplete.';
  }
  return 'This PDF could not be read.';
}
