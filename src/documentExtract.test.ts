import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { detectDocumentFormat, docxToText, extractDocumentText } from './documentExtract';

/*
 * DOCX fixtures are built here rather than committed as binaries: the interesting cases are all
 * about which XML gets read, and a checked-in .docx hides that in a zip nobody can diff.
 */
function makeDocx(documentXml: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types/>'),
    'word/document.xml': strToU8(documentXml),
  });
}

function paragraphs(...lines: string[]): string {
  const body = lines.map((line) => `<w:p><w:r><w:t>${line}</w:t></w:r></w:p>`).join('');
  return `<?xml version="1.0"?><w:document><w:body>${body}</w:body></w:document>`;
}

const utf8 = (value: string) => new TextEncoder().encode(value);

describe('detectDocumentFormat', () => {
  it('reads the archive rather than trusting the extension', () => {
    // DOCX and EPUB are both zips, so a wrong or missing extension has to be survivable.
    const docx = makeDocx(paragraphs('hello'));
    expect(detectDocumentFormat(docx, 'book.epub')).toBe('docx');
    expect(detectDocumentFormat(docx, '')).toBe('docx');
  });

  it('identifies a PDF by its magic bytes', () => {
    expect(detectDocumentFormat(utf8('%PDF-1.7\n...'), 'anything.txt')).toBe('pdf');
  });

  it('falls back to the extension when there is nothing to sniff', () => {
    expect(detectDocumentFormat(utf8('# Title'), 'notes.md')).toBe('markdown');
    expect(detectDocumentFormat(utf8('plain'), 'notes.txt')).toBe('text');
    expect(detectDocumentFormat(utf8('<p>hi</p>'), 'page.html')).toBe('html');
    expect(detectDocumentFormat(utf8('?'), 'mystery.xyz')).toBe('unknown');
  });
});

describe('docxToText', () => {
  it('keeps paragraph breaks, which narration chunks on', () => {
    const text = docxToText(makeDocx(paragraphs('First line.', 'Second line.')));
    expect(text).toBe('First line.\n\nSecond line.');
  });

  it('joins runs inside one paragraph without inventing a break', () => {
    // Word splits a sentence across runs whenever formatting changes mid-line.
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      '<w:p><w:r><w:t>Once upon </w:t></w:r><w:r><w:t>a time.</w:t></w:r></w:p>' +
      '</w:body></w:document>';
    expect(docxToText(makeDocx(xml))).toBe('Once upon a time.');
  });

  it('ignores field codes and tracked deletions', () => {
    // The reason for reading only <w:t>: stripping every tag would narrate this document twice,
    // once as prose and once as revision history.
    const xml =
      '<?xml version="1.0"?><w:document><w:body>' +
      '<w:p><w:r><w:instrText>PAGEREF _Toc12345</w:instrText></w:r>' +
      '<w:r><w:t>Real prose.</w:t></w:r>' +
      '<w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del></w:p>' +
      '</w:body></w:document>';
    expect(docxToText(makeDocx(xml))).toBe('Real prose.');
  });

  it('decodes entities, ampersand last', () => {
    const xml = paragraphs('Tom &amp; Jerry &lt;tag&gt; &#65;', 'caf&#xe9;');
    expect(docxToText(makeDocx(xml))).toBe('Tom & Jerry <tag> A\n\ncafé');
  });

  it('does not treat a literal escaped entity as markup', () => {
    // "&amp;lt;" is the text "&lt;", not a less-than sign.
    expect(docxToText(makeDocx(paragraphs('&amp;lt;')))).toBe('&lt;');
  });

  it('returns empty for a zip with no document part', () => {
    const notADocx = zipSync({ 'mimetype': strToU8('application/epub+zip') });
    expect(docxToText(notADocx)).toBe('');
  });

  it('returns empty rather than throwing on a corrupt archive', () => {
    expect(docxToText(utf8('PK truncated'))).toBe('');
  });
});

describe('extractDocumentText', () => {
  it('reads a docx end to end', () => {
    const result = extractDocumentText(makeDocx(paragraphs('Chapter one.')), 'book.docx');
    expect(result.format).toBe('docx');
    expect(result.text).toBe('Chapter one.');
    expect(result.reason).toBeUndefined();
  });

  it('passes plain text through', () => {
    expect(extractDocumentText(utf8('Just words.'), 'a.txt').text).toBe('Just words.');
  });

  it('strips html down to prose', () => {
    const result = extractDocumentText(utf8('<h1>Title</h1><p>Body text.</p>'), 'a.html');
    expect(result.format).toBe('html');
    expect(result.text).toContain('Body text.');
    expect(result.text).not.toContain('<p>');
  });

  it('says why a PDF produced nothing instead of returning silence', () => {
    // An empty book with no explanation reads as a broken import; this is the difference between
    // "not supported yet" and "your file is broken".
    const result = extractDocumentText(utf8('%PDF-1.4'), 'book.pdf');
    expect(result.format).toBe('pdf');
    expect(result.text).toBe('');
    expect(result.reason).toMatch(/PDF/i);
  });

  it('gives a reason for an unknown type', () => {
    const result = extractDocumentText(utf8('binary junk'), 'thing.xyz');
    expect(result.text).toBe('');
    expect(result.reason).toBeTruthy();
  });

  it('never throws on rubbish input', () => {
    expect(() => extractDocumentText(new Uint8Array(0), '')).not.toThrow();
    expect(extractDocumentText(new Uint8Array(0), '').text).toBe('');
  });
});
