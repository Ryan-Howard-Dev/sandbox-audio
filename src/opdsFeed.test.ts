import { describe, expect, it } from 'vitest';
import {
  basicAuthHeader,
  downloadFilename,
  formatLabel,
  isNavigationEntry,
  normaliseCatalogUrl,
  opdsRootUrl,
  opdsSearchUrl,
  pickAcquisitionLink,
  pickImageLink,
  resolveOpdsUrl,
  type OpdsLink,
} from './opdsFeed';

const acquisition = (type: string, href = '/opds/download/1'): OpdsLink => ({
  rel: 'http://opds-spec.org/acquisition',
  type,
  href,
});

describe('normaliseCatalogUrl', () => {
  it('accepts the bare server root', () => {
    expect(normaliseCatalogUrl('http://192.168.1.10:8083')).toBe('http://192.168.1.10:8083');
  });

  it('strips /opds, because every request appends it again', () => {
    // Pasting the address from the browser is the likeliest way to configure this, and that
    // address is usually the catalogue rather than the root.
    expect(normaliseCatalogUrl('http://box:8083/opds')).toBe('http://box:8083');
    expect(normaliseCatalogUrl('http://box:8083/opds/new')).toBe('http://box:8083');
  });

  it('keeps a subpath, for a server behind a reverse proxy', () => {
    expect(normaliseCatalogUrl('https://home.example/calibre/opds')).toBe(
      'https://home.example/calibre',
    );
  });

  it('rejects anything that is not http', () => {
    expect(normaliseCatalogUrl('file:///books')).toBeNull();
    expect(normaliseCatalogUrl('box:8083')).toBeNull();
    expect(normaliseCatalogUrl('')).toBeNull();
  });
});

describe('URL building', () => {
  it('puts the query in the path, which is where calibre-web looks for it', () => {
    expect(opdsSearchUrl('http://box:8083', 'jane eyre')).toBe(
      'http://box:8083/opds/search/jane%20eyre',
    );
  });

  it('does not double a slash when the base has a trailing one', () => {
    expect(opdsSearchUrl('http://box:8083/', 'x')).toBe('http://box:8083/opds/search/x');
    expect(opdsRootUrl('http://box:8083/')).toBe('http://box:8083/opds');
  });

  it('resolves relative link hrefs, which is most of them', () => {
    expect(resolveOpdsUrl('http://box:8083', '/opds/download/7/epub/')).toBe(
      'http://box:8083/opds/download/7/epub/',
    );
    expect(resolveOpdsUrl('http://box:8083/calibre', 'cover/3')).toBe(
      'http://box:8083/calibre/cover/3',
    );
  });
});

describe('pickAcquisitionLink', () => {
  it('prefers EPUB, the only format the reader can paginate and narrate', () => {
    const chosen = pickAcquisitionLink([
      acquisition('application/pdf'),
      acquisition('application/epub+zip'),
    ]);
    expect(chosen?.type).toBe('application/epub+zip');
  });

  it('falls back to PDF, which pdf.js can still read', () => {
    expect(pickAcquisitionLink([acquisition('application/pdf')])?.type).toBe('application/pdf');
  });

  it('returns null when nothing is readable, rather than a download that fails at the end', () => {
    expect(pickAcquisitionLink([acquisition('application/x-cbz')])).toBeNull();
  });

  it('accepts the sub-relations servers use for open-access and borrowing', () => {
    const chosen = pickAcquisitionLink([
      {
        rel: 'http://opds-spec.org/acquisition/open-access',
        type: 'application/epub+zip',
        href: '/x',
      },
    ]);
    expect(chosen?.href).toBe('/x');
  });

  it('ignores cover images, which are links on the same entry', () => {
    expect(
      pickAcquisitionLink([
        { rel: 'http://opds-spec.org/image', type: 'image/jpeg', href: '/cover/1' },
      ]),
    ).toBeNull();
  });
});

describe('pickImageLink', () => {
  it('prefers the thumbnail, because a shelf shows them small', () => {
    const chosen = pickImageLink([
      { rel: 'http://opds-spec.org/image', type: 'image/jpeg', href: '/full' },
      { rel: 'http://opds-spec.org/image/thumbnail', type: 'image/jpeg', href: '/thumb' },
    ]);
    expect(chosen?.href).toBe('/thumb');
  });

  it('falls back to the full cover when there is no thumbnail', () => {
    expect(
      pickImageLink([{ rel: 'http://opds-spec.org/image', type: 'image/jpeg', href: '/full' }])
        ?.href,
    ).toBe('/full');
  });
});

describe('isNavigationEntry', () => {
  it('treats an entry with nothing to download as a shelf to open', () => {
    expect(
      isNavigationEntry({
        id: '1',
        title: 'Authors',
        links: [{ rel: 'subsection', type: 'application/atom+xml', href: '/opds/author' }],
      }),
    ).toBe(true);
  });

  it('treats an entry that can be downloaded as a book', () => {
    expect(
      isNavigationEntry({ id: '2', title: 'Jane Eyre', links: [acquisition('application/epub+zip')] }),
    ).toBe(false);
  });
});

describe('downloadFilename', () => {
  it('names the file after the book, not the URL', () => {
    // Calibre-web download links end in the format as a path segment, so the URL names every
    // file "epub" and a failure message then names no book at all.
    expect(downloadFilename('Jane Eyre', 'application/epub+zip')).toBe('Jane Eyre.epub');
  });

  it('strips characters a filesystem will not take', () => {
    expect(downloadFilename('What: A/Question?', 'application/pdf')).toBe('What AQuestion.pdf');
  });

  it('still produces a name when the title is empty or all punctuation', () => {
    expect(downloadFilename('', 'application/epub+zip')).toBe('book.epub');
    expect(downloadFilename('///', 'application/epub+zip')).toBe('book.epub');
  });
});

describe('formatLabel', () => {
  it('names the formats the shelf can read', () => {
    expect(formatLabel('application/epub+zip')).toBe('EPUB');
    expect(formatLabel('application/pdf')).toBe('PDF');
    expect(formatLabel('application/x-mobipocket-ebook')).toBe('MOBI');
  });

  it('degrades to something readable for anything else', () => {
    expect(formatLabel('application/x-cbz')).toBe('X-CBZ');
  });
});

describe('basicAuthHeader', () => {
  it('encodes the credentials the way calibre-web expects', () => {
    expect(basicAuthHeader('reader', 'hunter2')).toBe('Basic cmVhZGVyOmh1bnRlcjI=');
  });
});
