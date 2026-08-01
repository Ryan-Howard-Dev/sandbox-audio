import { describe, expect, it } from 'vitest';
import type { NarrationChunk } from './documentNarration';
import {
  chaptersFromPages,
  pageForChunk,
  paginateDocument,
} from './documentPagination';

function chunk(text: string, isHeading = false): NarrationChunk {
  return { text, section: 'Doc', isHeading };
}

const para = (n: number) => chunk('x'.repeat(n));

describe('paginateDocument', () => {
  it('returns nothing for an empty document', () => {
    expect(paginateDocument([])).toEqual([]);
  });

  it('keeps a short document on one page', () => {
    const pages = paginateDocument([para(100), para(100)], 1400);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
  });

  it('breaks once the character budget is crossed', () => {
    const pages = paginateDocument([para(600), para(600), para(600), para(600)], 1000);
    expect(pages.length).toBeGreaterThan(1);
    // Every chunk lands on exactly one page, and the pages are contiguous.
    expect(pages[0]!.startIndex).toBe(0);
    expect(pages[pages.length - 1]!.endIndex).toBe(3);
    for (let i = 1; i < pages.length; i += 1) {
      expect(pages[i]!.startIndex).toBe(pages[i - 1]!.endIndex + 1);
    }
  });

  it('gives a passage longer than a whole page its own page rather than an empty one', () => {
    const pages = paginateDocument([para(5000), para(50)], 1000);
    expect(pages[0]).toMatchObject({ startIndex: 0, endIndex: 0 });
    expect(pages.every((p) => p.endIndex >= p.startIndex)).toBe(true);
  });

  it('starts a new page at a heading', () => {
    const chunks = [para(100), chunk('Chapter Two', true), para(100)];
    const pages = paginateDocument(chunks, 1400);
    expect(pages).toHaveLength(2);
    expect(pages[1]!.startIndex).toBe(1);
  });

  it('carries the chapter across the pages that continue it', () => {
    const chunks = [chunk('Chapter One', true), para(900), para(900), para(900)];
    const pages = paginateDocument(chunks, 1000);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.every((p) => p.chapter === 'Chapter One')).toBe(true);
  });

  it('covers every chunk exactly once', () => {
    const chunks = Array.from({ length: 40 }, (_, i) =>
      i % 7 === 0 ? chunk(`Heading ${i}`, true) : para(300),
    );
    const pages = paginateDocument(chunks, 1000);
    const seen: number[] = [];
    for (const page of pages) {
      for (let i = page.startIndex; i <= page.endIndex; i += 1) seen.push(i);
    }
    expect(seen).toEqual(chunks.map((_, i) => i));
  });
});

describe('pageForChunk', () => {
  it('finds the page a passage sits on', () => {
    const chunks = [para(600), para(600), para(600), para(600)];
    const pages = paginateDocument(chunks, 1000);
    expect(pageForChunk(pages, 0)).toBe(0);
    expect(pageForChunk(pages, 3)).toBe(pages.length - 1);
  });

  it('clamps rather than returning nothing for an index past the end', () => {
    const pages = paginateDocument([para(100)], 1000);
    expect(pageForChunk(pages, 99)).toBe(0);
  });

  it('returns the first page when there are none, rather than -1', () => {
    expect(pageForChunk([], 5)).toBe(0);
  });
});

describe('chaptersFromPages', () => {
  it('lists each chapter once, against the page it starts on', () => {
    const chunks = [
      chunk('One', true),
      para(900),
      para(900),
      chunk('Two', true),
      para(100),
    ];
    const pages = paginateDocument(chunks, 1000);
    const chapters = chaptersFromPages(pages);
    expect(chapters.map((c) => c.title)).toEqual(['One', 'Two']);
    expect(chapters[1]!.page).toBe(pageForChunk(pages, 3));
  });

  it('returns nothing for a document with no headings', () => {
    const pages = paginateDocument([para(100), para(100)], 1000);
    expect(chaptersFromPages(pages)).toEqual([]);
  });
});
