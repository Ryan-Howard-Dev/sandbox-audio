/**
 * EPUB file → a saved book.
 *
 * Unzipping is the only impure part of reading an EPUB, so it lives here and `epubParse` stays a
 * pure function of an already-unzipped file map. fflate over jszip: ~8 kB against ~100 kB, no
 * dependencies of its own, and this app ships on F-Droid where every dependency is review time
 * somebody has to pay for.
 */

import { unzipSync } from 'fflate';
import { isEpubEncrypted, parseEpub, type EpubFiles, type ParsedEpub } from './epubParse';

/** DRM, a non-EPUB zip, or a corrupt archive — each needs a different message, not one failure. */
export type EpubImportFailure = 'encrypted' | 'unreadable' | 'not-an-epub';

/*
 * A plain result object rather than a discriminated union on an `ok` flag. This project compiles
 * without `strict`, so `strictNullChecks` is off and TypeScript does not narrow such a union
 * reliably — `result.reason` inside an `if (!result.ok)` block was reported as missing. Two
 * independent optional fields need no narrowing to be read safely.
 */
export interface EpubImportResult {
  book?: ParsedEpub;
  reason?: EpubImportFailure;
}

export function unzipEpub(bytes: Uint8Array): EpubFiles | null {
  try {
    return unzipSync(bytes) as EpubFiles;
  } catch {
    return null;
  }
}

/**
 * Read an EPUB, or say precisely why not.
 *
 * The three failures are genuinely different and a single "could not read that" would be useless
 * for all of them: a DRM-protected book will never work, a corrupt archive might on re-download,
 * and a mislabelled zip is the wrong file entirely.
 */
export function importEpubBytes(bytes: Uint8Array): EpubImportResult {
  const files = unzipEpub(bytes);
  if (!files) return { reason: 'unreadable' };
  // Checked before parsing: an encrypted book unzips fine and then yields gibberish, which would
  // otherwise be reported as a corrupt file.
  if (isEpubEncrypted(files)) return { reason: 'encrypted' };
  const book = parseEpub(files);
  if (!book) return { reason: 'not-an-epub' };
  if (book.chapters.length === 0) return { reason: 'unreadable' };
  return { book };
}

/** Cover bytes from inside the archive, as a data URL — no network, no second lookup. */
export function epubCoverDataUrl(files: EpubFiles, coverHref: string): string | undefined {
  const bytes = coverHref ? files[coverHref] : undefined;
  if (!bytes || bytes.length === 0) return undefined;
  const ext = coverHref.slice(coverHref.lastIndexOf('.') + 1).toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:${mime};base64,${btoa(binary)}`;
}
