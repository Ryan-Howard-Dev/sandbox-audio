import { zipSync, strToU8 } from 'fflate';

/**
 * A minimal but genuinely valid EPUB, built in memory for the device probe.
 *
 * The books shelf begins at a native file picker, so nothing after it has ever been exercised on
 * device — the picker cannot be driven from a deep link. It only supplies bytes, though, so a
 * fixture built here reaches exactly the same code as a picked file: container.xml locates the
 * OPF, the OPF carries the metadata and spine, and the spine items become chapters.
 *
 * Chapter bodies are padded past MIN_CHAPTER_CHARS on purpose. Short sections are dropped as
 * front matter, so a fixture with token-length chapters would parse and then assert nothing.
 */

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>The Probe Book</dc:title>
    <dc:creator>Probe Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid">9780000000001</dc:identifier>
    <dc:description>A fixture used by the on-device books probe.</dc:description>
  </metadata>
  <manifest>
    <item id="c1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`;

function chapter(title: string, body: string): string {
  const padded = Array.from({ length: 6 }, () => body).join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1><p>${padded}</p></body></html>`;
}

/** Zipped EPUB bytes. `mimetype` goes in uncompressed and first, as the spec requires. */
export function buildProbeEpub(): Uint8Array {
  return zipSync(
    {
      mimetype: [strToU8('application/epub+zip'), { level: 0 }],
      'META-INF/container.xml': strToU8(CONTAINER),
      'OEBPS/content.opf': strToU8(OPF),
      'OEBPS/chapter1.xhtml': strToU8(
        chapter(
          'The First Chapter',
          'The narrator sets out on a journey that the reader is invited to follow closely.',
        ),
      ),
      'OEBPS/chapter2.xhtml': strToU8(
        chapter(
          'The Second Chapter',
          'The journey continues, and the consequences of the first chapter become apparent.',
        ),
      ),
    },
    { level: 6 },
  );
}
