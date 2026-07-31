/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_CHAPTER_CHARS,
  chapterTitleFrom,
  findOpfPath,
  parseEpub,
  parseEpubMetadata,
  parseEpubSpine,
  isEpubEncrypted,
  resolveHref,
  stripXhtmlText,
  type EpubFiles,
} from './epubParse';

const enc = new TextEncoder();

function files(map: Record<string, string>): EpubFiles {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, enc.encode(v)]));
}

const CONTAINER = `<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

const OPF = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Red House Mystery</dc:title>
    <dc:creator>A. A. Milne</dc:creator>
    <dc:language>en</dc:language>
    <dc:description>A country house party is interrupted by a death.</dc:description>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="titlepage" href="title.xhtml" media-type="application/xhtml+xml"/>
    <item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/ch2.xhtml" media-type="application/xhtml+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="titlepage"/>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

const body = (heading: string, prose: string) =>
  `<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${heading}</title></head><body><h1>${heading}</h1><p>${prose}</p></body></html>`;

const LONG = 'The house stood at the end of a long drive. '.repeat(10);

describe('findOpfPath', () => {
  it('reads the package path from container.xml rather than guessing', () => {
    expect(findOpfPath(files({ 'META-INF/container.xml': CONTAINER }))).toBe('OEBPS/content.opf');
  });

  it('returns null when there is no container', () => {
    expect(findOpfPath(files({}))).toBeNull();
  });

  it('returns null on malformed XML rather than throwing', () => {
    expect(findOpfPath(files({ 'META-INF/container.xml': '<container' }))).toBeNull();
  });
});

describe('resolveHref', () => {
  /* Manifest hrefs are relative to the OPF, which is rarely at the archive root. */
  it('resolves against the OPF directory', () => {
    expect(resolveHref('OEBPS/content.opf', 'text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('collapses parent segments', () => {
    expect(resolveHref('OEBPS/pkg/content.opf', '../text/ch1.xhtml')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('drops the fragment, which is not part of the file path', () => {
    expect(resolveHref('OEBPS/content.opf', 'text/ch1.xhtml#part2')).toBe('OEBPS/text/ch1.xhtml');
  });

  it('handles an OPF at the archive root', () => {
    expect(resolveHref('content.opf', 'ch1.xhtml')).toBe('ch1.xhtml');
  });
});

describe('parseEpubMetadata', () => {
  it('reads the real title, author, language and description', () => {
    const meta = parseEpubMetadata(OPF, 'OEBPS/content.opf');
    expect(meta.title).toBe('The Red House Mystery');
    expect(meta.author).toBe('A. A. Milne');
    expect(meta.language).toBe('en');
    expect(meta.description).toContain('country house party');
  });

  /* EPUB 2 names the cover via meta name=cover pointing at a manifest id. */
  it('resolves an EPUB 2 cover reference', () => {
    expect(parseEpubMetadata(OPF, 'OEBPS/content.opf').coverHref).toBe('OEBPS/images/cover.jpg');
  });

  it('resolves an EPUB 3 properties cover', () => {
    const opf3 = OPF.replace(
      '<item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>',
      '<item id="cover-img" href="images/c.png" media-type="image/png" properties="cover-image"/>',
    ).replace('<meta name="cover" content="cover-img"/>', '');
    expect(parseEpubMetadata(opf3, 'OEBPS/content.opf').coverHref).toBe('OEBPS/images/c.png');
  });

  it('returns empty strings rather than throwing on junk', () => {
    expect(parseEpubMetadata('<package', 'a.opf').title).toBe('');
  });
});

describe('ISBN extraction', () => {
  const withId = (id: string) =>
    OPF.replace('<dc:title>', `<dc:identifier id="pub-id">${id}</dc:identifier><dc:title>`);

  it('reads the common identifier shapes', () => {
    expect(parseEpubMetadata(withId('urn:isbn:9780306406157'), 'a.opf').isbn).toBe('9780306406157');
    expect(parseEpubMetadata(withId('ISBN 978-0-306-40615-7'), 'a.opf').isbn).toBe('9780306406157');
    expect(parseEpubMetadata(withId('0306406152'), 'a.opf').isbn).toBe('0306406152');
  });

  /*
   * Most EPUBs identify themselves with a UUID. Treating one as an ISBN would send enrichment
   * chasing a book that does not exist, which is worse than not enriching at all.
   */
  it('does not mistake a UUID for an ISBN', () => {
    expect(
      parseEpubMetadata(withId('urn:uuid:a1b2c3d4-e5f6-7890-abcd-ef1234567890'), 'a.opf').isbn,
    ).toBe('');
  });

  it('rejects a number of the wrong length', () => {
    expect(parseEpubMetadata(withId('12345'), 'a.opf').isbn).toBe('');
  });

  it('is empty when there is no identifier', () => {
    expect(parseEpubMetadata(OPF, 'OEBPS/content.opf').isbn).toBe('');
  });
});

describe('isEpubEncrypted', () => {
  /*
   * A DRM-protected EPUB unzips fine and yields gibberish, so without this the failure looks like
   * a corrupt file and the user has no idea why their book will not open.
   */
  it('detects the encryption manifest', () => {
    expect(isEpubEncrypted(files({ 'META-INF/encryption.xml': '<encryption/>' }))).toBe(true);
  });

  it('is false for an ordinary archive', () => {
    expect(isEpubEncrypted(files({ 'META-INF/container.xml': CONTAINER }))).toBe(false);
  });
});

describe('parseEpubSpine', () => {
  it('returns readable documents in reading order', () => {
    expect(parseEpubSpine(OPF, 'OEBPS/content.opf')).toEqual([
      'OEBPS/title.xhtml',
      'OEBPS/text/ch1.xhtml',
      'OEBPS/text/ch2.xhtml',
    ]);
  });

  /* Images and stylesheets are in the manifest too, and are not readable text. */
  it('excludes non-document manifest items', () => {
    expect(parseEpubSpine(OPF, 'OEBPS/content.opf').some((h) => h.endsWith('.css'))).toBe(false);
    expect(parseEpubSpine(OPF, 'OEBPS/content.opf').some((h) => h.endsWith('.jpg'))).toBe(false);
  });

  it('skips linear="no" front matter', () => {
    const opf = OPF.replace('<itemref idref="titlepage"/>', '<itemref idref="titlepage" linear="no"/>');
    expect(parseEpubSpine(opf, 'OEBPS/content.opf')).toEqual([
      'OEBPS/text/ch1.xhtml',
      'OEBPS/text/ch2.xhtml',
    ]);
  });
});

describe('stripXhtmlText', () => {
  it('returns readable prose without markup', () => {
    expect(stripXhtmlText(body('One', 'Hello there.'))).toContain('Hello there.');
    expect(stripXhtmlText(body('One', 'Hello there.'))).not.toContain('<p>');
  });

  /* Only discovered by listening: a narrator reading CSS aloud. */
  it('removes script and style content rather than flattening it', () => {
    const xhtml = `<html><head><style>body{color:red}</style></head><body><script>var x=1</script><p>Real text.</p></body></html>`;
    const text = stripXhtmlText(xhtml);
    expect(text).toContain('Real text.');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x');
  });

  it('is empty for empty input', () => {
    expect(stripXhtmlText('')).toBe('');
  });
});

describe('chapterTitleFrom', () => {
  it('prefers the document heading', () => {
    expect(chapterTitleFrom(body('Mr Ablett Is At Home', 'x'), 0)).toBe('Mr Ablett Is At Home');
  });

  it('falls back to a numbered chapter when there is nothing to use', () => {
    expect(chapterTitleFrom('<html><body><p>x</p></body></html>', 4)).toBe('Chapter 5');
  });
});

describe('parseEpub', () => {
  const epub = files({
    'META-INF/container.xml': CONTAINER,
    'OEBPS/content.opf': OPF,
    'OEBPS/title.xhtml': body('Title Page', 'The Red House Mystery'),
    'OEBPS/text/ch1.xhtml': body('Chapter One', LONG),
    'OEBPS/text/ch2.xhtml': body('Chapter Two', LONG),
  });

  it('produces metadata and chapters from a whole archive', () => {
    const parsed = parseEpub(epub)!;
    expect(parsed.title).toBe('The Red House Mystery');
    expect(parsed.author).toBe('A. A. Milne');
    expect(parsed.chapters).toHaveLength(2);
    expect(parsed.chapters[0]!.title).toBe('Chapter One');
    expect(parsed.chapters[0]!.text).toContain('long drive');
  });

  /*
   * Title and copyright pages sit in the spine. Counting them makes a twelve-chapter book claim
   * twenty, and puts the listener two "chapters" in before any prose starts.
   */
  it('skips front matter too short to be a chapter', () => {
    const parsed = parseEpub(epub)!;
    expect(parsed.chapters.some((c) => c.title === 'Title Page')).toBe(false);
    expect(MIN_CHAPTER_CHARS).toBeGreaterThan(0);
  });

  it('numbers chapters by their position after filtering, not by spine index', () => {
    const parsed = parseEpub(epub)!;
    expect(parsed.chapters.map((c) => c.index)).toEqual([0, 1]);
  });

  it('returns null for an archive that is not an EPUB', () => {
    expect(parseEpub(files({ 'readme.txt': 'hello' }))).toBeNull();
  });
});
