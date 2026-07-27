/**
 * @vitest-environment jsdom
 */
import { zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { importEpubBytes, unzipEpub } from './epubImport';

const enc = new TextEncoder();

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>A Real Book</dc:title><dc:creator>An Author</dc:creator>
  </metadata>
  <manifest><item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

const CH1 = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><h1>One</h1><p>${'Words enough to count as a chapter. '.repeat(10)}</p></body></html>`;

function epubZip(extra: Record<string, string> = {}): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'META-INF/container.xml': enc.encode(CONTAINER),
    'content.opf': enc.encode(OPF),
    'ch1.xhtml': enc.encode(CH1),
  };
  for (const [k, v] of Object.entries(extra)) entries[k] = enc.encode(v);
  return zipSync(entries);
}

describe('importEpubBytes', () => {
  it('reads a real EPUB into metadata and chapters', () => {
    const { book } = importEpubBytes(epubZip());
    expect(book).toBeDefined();
    expect(book!.title).toBe('A Real Book');
    expect(book!.author).toBe('An Author');
    expect(book!.chapters).toHaveLength(1);
    expect(book!.chapters[0]!.title).toBe('One');
  });

  /*
   * Three genuinely different failures. A single "could not read that" would be useless for all
   * of them: DRM will never work, a corrupt archive might on re-download, and a mislabelled zip
   * is simply the wrong file.
   */
  it('names DRM specifically rather than calling it corrupt', () => {
    const result = importEpubBytes(epubZip({ 'META-INF/encryption.xml': '<encryption/>' }));
    expect(result).toEqual({ reason: 'encrypted' });
  });

  it('reports a zip that is not an EPUB', () => {
    const notEpub = zipSync({ 'notes.txt': enc.encode('hello') });
    expect(importEpubBytes(notEpub)).toEqual({ reason: 'not-an-epub' });
  });

  it('reports bytes that are not a zip at all', () => {
    expect(importEpubBytes(enc.encode('this is not a zip'))).toEqual({ reason: 'unreadable' });
  });

  /* An EPUB whose spine is all front matter has nothing to narrate. */
  it('rejects an EPUB with no chapter long enough to read', () => {
    const shortCh = `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body><p>Hi</p></body></html>`;
    const result = importEpubBytes(epubZip({ 'ch1.xhtml': shortCh }));
    expect(result).toEqual({ reason: 'unreadable' });
  });
});

describe('unzipEpub', () => {
  it('returns null rather than throwing on junk bytes', () => {
    expect(unzipEpub(enc.encode('nope'))).toBeNull();
  });
});
