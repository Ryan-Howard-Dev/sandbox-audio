import { describe, expect, it } from 'vitest';
import { joinPdfPages, pdfToText, stripRunningHeads } from './pdfExtract';
import { extractDocumentText } from './documentExtract';

/*
 * PDFs are built here rather than committed as binaries.
 *
 * The whole question these tests ask is which lines survive and in what order, and a checked-in
 * PDF hides that behind a compressed object stream nobody can read in a diff. Building one by hand
 * costs thirty lines and makes each fixture say what it is testing: this many pages, these lines,
 * this leading.
 *
 * The result is a real PDF — pdf.js parses it the same way it parses a book — just a very plain
 * one: uncompressed streams, one standard font, one text block per page.
 */
function makePdf(pages: string[][]): Uint8Array {
  const objects: (string | { stream: string })[] = [];
  const pageIds = pages.map((_page, index) => 4 + index * 2);

  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] =
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] ` +
    `/Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  pages.forEach((lines, index) => {
    const pageId = pageIds[index];
    objects[pageId] =
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`;
    // 14 TL is the leading; an empty line emits the line feed without any glyphs, which is exactly
    // how a real producer marks a paragraph break — extra vertical space and nothing else.
    let stream = 'BT\n/F1 12 Tf\n14 TL\n72 720 Td\n';
    for (const line of lines) {
      if (line) {
        const escaped = line.replace(/([\\()])/g, '\\$1');
        stream += `(${escaped}) Tj\n`;
      }
      stream += 'T*\n';
    }
    objects[pageId + 1] = { stream: `${stream}ET\n` };
  });

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  const lastId = 3 + pages.length * 2;
  for (let id = 1; id <= lastId; id++) {
    offsets[id] = body.length;
    const object = objects[id];
    body +=
      typeof object === 'string'
        ? `${id} 0 obj\n${object}\nendobj\n`
        : `${id} 0 obj\n<< /Length ${object.stream.length} >>\nstream\n${object.stream}\nendstream\nendobj\n`;
  }
  const startxref = body.length;
  body += `xref\n0 ${lastId + 1}\n0000000000 65535 f \n`;
  for (let id = 1; id <= lastId; id++) {
    body += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${lastId + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('stripRunningHeads', () => {
  it('drops a header that repeats across most pages', () => {
    const pages = [
      ['A Very Long Book', 'The first sentence.', 'More prose.'],
      ['A Very Long Book', 'The second sentence.', 'More prose.'],
      ['A Very Long Book', 'The third sentence.', 'More prose.'],
    ];
    expect(stripRunningHeads(pages).map((page) => page[0])).toEqual([
      'The first sentence.',
      'The second sentence.',
      'The third sentence.',
    ]);
  });

  it('drops a running foot whose page number changes', () => {
    // The point of normalising digits away: "Chapter 3 - 47" is never literally repeated, and a
    // literal comparison would leave one of these in the middle of every paragraph.
    const pages = [
      ['Prose one.', 'Chapter 3 - 47'],
      ['Prose two.', 'Chapter 3 - 48'],
      ['Prose three.', 'Chapter 3 - 49'],
    ];
    expect(stripRunningHeads(pages)).toEqual([['Prose one.'], ['Prose two.'], ['Prose three.']]);
  });

  it('drops bare page numbers however they are dressed', () => {
    const pages = [
      ['12', 'Prose one.', '- 13 -'],
      ['[ xiv ]', 'Prose two.', 'Page 15'],
    ];
    expect(stripRunningHeads(pages)).toEqual([['Prose one.'], ['Prose two.']]);
  });

  it('does not mistake a word for a roman numeral', () => {
    // "did" and "mix" are both spelled from roman digits and both parse as numbers; deleting the
    // first line of a page because it happens to be one of them would be silent damage.
    const pages = [['did', 'Prose one.'], ['mix', 'Prose two.'], ['civic', 'Prose three.']];
    expect(stripRunningHeads(pages).map((page) => page[0])).toEqual(['did', 'mix', 'civic']);
  });

  it('keeps a line that repeats on a short document', () => {
    // Two pages opening the same way is a coincidence, not furniture. The floor of three is what
    // stops a two-page handout losing its title.
    const pages = [
      ['Field Notes', 'Prose one.'],
      ['Field Notes', 'Prose two.'],
    ];
    expect(stripRunningHeads(pages)).toEqual(pages);
  });

  it('keeps a long line even when it repeats', () => {
    const refrain =
      'This sentence is far too long to be a running head and repeats only because the ' +
      'document is a refrain.';
    const pages = [[refrain, 'a'], [refrain, 'b'], [refrain, 'c']];
    expect(stripRunningHeads(pages).map((page) => page[0])).toEqual([refrain, refrain, refrain]);
  });

  it('leaves a repeated line alone when it is buried in the body', () => {
    // Only the edges are furniture. A phrase in the middle of a page is prose, however often the
    // author repeats it.
    const pages = [
      ['one', 'two', 'refrain', 'three', 'four'],
      ['five', 'six', 'refrain', 'seven', 'eight'],
      ['nine', 'ten', 'refrain', 'eleven', 'twelve'],
    ];
    expect(stripRunningHeads(pages).map((page) => page[2])).toEqual([
      'refrain',
      'refrain',
      'refrain',
    ]);
  });
});

describe('joinPdfPages', () => {
  it('separates pages with a blank line so narration chunks on the boundary', () => {
    expect(joinPdfPages([['One.'], ['Two.']])).toBe('One.\n\nTwo.');
  });

  it('rejoins a word hyphenated across a line break', () => {
    expect(joinPdfPages([['This is appro-', 'ximately right.']])).toBe(
      'This is approximately right.',
    );
  });

  it('does not rejoin across a sentence that merely ends in a dash', () => {
    expect(joinPdfPages([['He stopped —', 'Then went on.']])).toBe('He stopped —\nThen went on.');
  });

  it('keeps an intentional blank line as a paragraph break', () => {
    expect(joinPdfPages([['One.', '', 'Two.']])).toBe('One.\n\nTwo.');
  });
});

describe('pdfToText', () => {
  it('reads prose page by page', async () => {
    const result = await pdfToText(
      makePdf([['The first page of prose.'], ['The second page of prose.']]),
    );
    expect(result.format).toBe('pdf');
    expect(result.reason).toBeUndefined();
    expect(result.text).toBe('The first page of prose.\n\nThe second page of prose.');
  });

  it('strips the furniture a narrator would otherwise read between paragraphs', async () => {
    const bytes = makePdf([
      ['A Very Long Book', 'The first sentence of the book.', '1'],
      ['A Very Long Book', 'The second sentence of the book.', '2'],
      ['A Very Long Book', 'The third sentence of the book.', '3'],
    ]);
    const result = await pdfToText(bytes);
    expect(result.text).not.toContain('A Very Long Book');
    expect(result.text).toBe(
      'The first sentence of the book.\n\n' +
        'The second sentence of the book.\n\n' +
        'The third sentence of the book.',
    );
  });

  it('turns extra leading into a paragraph break', async () => {
    const result = await pdfToText(
      makePdf([['First paragraph.', 'Still the first.', '', 'Second paragraph.']]),
    );
    expect(result.text).toBe('First paragraph.\nStill the first.\n\nSecond paragraph.');
  });

  it('says a scanned PDF is scanned rather than returning silence', async () => {
    // A page of images extracts to nothing at all, and an empty book with no explanation is the
    // commonest way this feature "does not work". OCR is out of scope; saying so is not.
    const result = await pdfToText(makePdf([[], [], []]));
    expect(result.text).toBe('');
    expect(result.reason).toMatch(/scanned/i);
  });

  it('returns a reason rather than throwing on a file that is not a PDF', async () => {
    const result = await pdfToText(new TextEncoder().encode('%PDF-1.4 and then nothing'));
    expect(result.format).toBe('pdf');
    expect(result.text).toBe('');
    expect(result.reason).toBeTruthy();
  });

  it('survives empty input', async () => {
    await expect(pdfToText(new Uint8Array(0))).resolves.toMatchObject({ text: '' });
  });
});

describe('extractDocumentText, for PDFs', () => {
  it('reaches pdf.js through the normal import path', async () => {
    const bytes = makePdf([['Chapter One'], ['It was a bright cold day in April.']]);
    const result = await extractDocumentText(bytes, 'book.pdf');
    expect(result.format).toBe('pdf');
    expect(result.text).toContain('It was a bright cold day in April.');
  });

  it('dispatches on the magic bytes, not the extension', async () => {
    const bytes = makePdf([['Some prose that is long enough to count as a text layer.']]);
    const result = await extractDocumentText(bytes, 'mislabelled.txt');
    expect(result.format).toBe('pdf');
    expect(result.text).toContain('Some prose');
  });
});
