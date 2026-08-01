/**
 * Turning a document into pages.
 *
 * A reader that scrolls forever is not a reader. Big Magic arrives as 586 passages, and rendering
 * them in one column gives no sense of where you are, no way to move a known distance, and a
 * scrollbar thin enough to be useless. A book has pages because pages are how people hold a
 * position in a long text.
 *
 * Pages are cut by character count rather than passage count, because passages vary from a
 * two-word heading to six hundred characters and counting them produces pages of wildly different
 * length. Cutting by characters gives pages that look the same size, which is the only property
 * that matters here.
 *
 * A heading always starts a new page. That is what makes chapters navigable: the page a chapter
 * begins on is the page that chapter's name belongs to.
 */
import type { NarrationChunk } from './documentNarration';

export interface DocumentPage {
  /** Index into the chunk array where this page starts. */
  startIndex: number;
  /** Index of the last chunk on this page, inclusive. */
  endIndex: number;
  /** Heading this page falls under, when the document has headings above it. */
  chapter?: string;
}

/**
 * Roughly a screenful on a phone at the reader's type size.
 *
 * Deliberately not tuned per device: a page that changes length with the window is not a page, and
 * a position saved on one device would land somewhere else on another.
 */
export const DEFAULT_PAGE_CHARS = 1400;

export function paginateDocument(
  chunks: NarrationChunk[],
  pageChars: number = DEFAULT_PAGE_CHARS,
): DocumentPage[] {
  if (chunks.length === 0) return [];
  const budget = Math.max(1, pageChars);
  const pages: DocumentPage[] = [];

  let start = 0;
  let used = 0;
  /** Last heading seen, so a page that continues a chapter is still labelled with it. */
  let chapter: string | undefined;

  const close = (endIndex: number) => {
    pages.push({ startIndex: start, endIndex, chapter });
  };

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;

    // A heading opens a chapter, and a chapter opens a page. Never mid-page, or the chapter list
    // would point at somewhere halfway down.
    if (chunk.isHeading && i > start) {
      close(i - 1);
      start = i;
      used = 0;
    }
    if (chunk.isHeading) chapter = chunk.text;

    used += chunk.text.length;

    // Break after the chunk that crossed the budget rather than before it, so a single passage
    // longer than a whole page still gets a page of its own instead of an empty one.
    if (used >= budget && i < chunks.length - 1 && !chunks[i + 1]!.isHeading) {
      close(i);
      start = i + 1;
      used = 0;
    }
  }
  close(chunks.length - 1);
  return pages;
}

/** Which page a passage falls on — how the reader follows the voice across a page break. */
export function pageForChunk(pages: DocumentPage[], chunkIndex: number): number {
  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i]!;
    if (chunkIndex >= page.startIndex && chunkIndex <= page.endIndex) return i;
  }
  return pages.length > 0 ? pages.length - 1 : 0;
}

/**
 * Chapters, as the page each one starts on.
 *
 * Built from the pages rather than the chunks so that jumping to a chapter and turning to its page
 * cannot disagree with each other.
 */
export function chaptersFromPages(
  pages: DocumentPage[],
): { title: string; page: number }[] {
  const out: { title: string; page: number }[] = [];
  let last: string | undefined;
  pages.forEach((page, index) => {
    if (page.chapter && page.chapter !== last) {
      out.push({ title: page.chapter, page: index });
      last = page.chapter;
    }
  });
  return out;
}
