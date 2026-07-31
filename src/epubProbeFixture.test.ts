/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { buildProbeEpub } from './epubProbeFixture';
import { importEpubBytes } from './epubImport';

/*
 * The fixture is only useful if it is a real EPUB. A probe that fails because its own input was
 * malformed would read exactly like the books shelf being broken, so the fixture is asserted here
 * rather than discovered on a phone.
 */
describe('buildProbeEpub', () => {
  it('parses as an EPUB with title, author and both chapters', () => {
    const result = importEpubBytes(buildProbeEpub());

    expect(result.reason).toBeUndefined();
    expect(result.book?.title).toBe('The Probe Book');
    expect(result.book?.author).toBe('Probe Author');
    expect(result.book?.chapters).toHaveLength(2);
  });

  /* Chapters shorter than MIN_CHAPTER_CHARS are dropped as front matter. */
  it('gives every chapter enough text to survive the front-matter filter', () => {
    const chapters = importEpubBytes(buildProbeEpub()).book?.chapters ?? [];

    for (const chapter of chapters) {
      expect(chapter.text.length).toBeGreaterThan(200);
    }
  });

  it('carries the chapter titles through', () => {
    const titles = (importEpubBytes(buildProbeEpub()).book?.chapters ?? []).map((c) => c.title);

    expect(titles).toEqual(['The First Chapter', 'The Second Chapter']);
  });
});
