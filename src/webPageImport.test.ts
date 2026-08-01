import { describe, expect, it } from 'vitest';
import {
  MIN_ARTICLE_CHARS,
  cleanExtractedText,
  isImportableUrl,
  looksLikeJavaScriptShell,
} from './webPageImport';

describe('isImportableUrl', () => {
  it('accepts http and https', () => {
    expect(isImportableUrl('https://example.test/article')).toBe(true);
    expect(isImportableUrl('http://example.test/article')).toBe(true);
    expect(isImportableUrl('  https://example.test/a  ')).toBe(true);
  });

  /*
   * Anything else is a way into the device rather than a page to read. file: would reach local
   * storage and javascript: would execute, and neither is a feature anyone asked for.
   */
  it('refuses schemes that are not the web', () => {
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:text/html,<h1>hi</h1>',
      'ftp://example.test/x',
      'content://media/external/file/1',
    ]) {
      expect(isImportableUrl(bad)).toBe(false);
    }
  });

  it('refuses things that are not URLs at all', () => {
    expect(isImportableUrl('')).toBe(false);
    expect(isImportableUrl('not a url')).toBe(false);
    expect(isImportableUrl('example.test')).toBe(false);
  });
});

describe('cleanExtractedText', () => {
  it('collapses the whitespace HTML leaves behind', () => {
    expect(cleanExtractedText('  Hello     world  ')).toBe('Hello world');
  });

  /*
   * Paragraph breaks are the only structure narration has — the chunker splits on them — so
   * flattening them would turn a long article into one unbroken passage.
   */
  it('keeps paragraph breaks while removing the rest', () => {
    const out = cleanExtractedText('First para.\n\n\n\n\nSecond para.');
    expect(out).toBe('First para.\n\nSecond para.');
  });

  it('normalises Windows line endings', () => {
    expect(cleanExtractedText('a\r\n\r\nb')).toBe('a\n\nb');
  });

  it('trims the indentation HTML sources are full of', () => {
    expect(cleanExtractedText('\n   Line one   \n   Line two   \n')).toBe('Line one\nLine two');
  });
});

describe('looksLikeJavaScriptShell', () => {
  const long = 'x'.repeat(MIN_ARTICLE_CHARS + 100);

  it('passes a page that actually sent its article', () => {
    expect(looksLikeJavaScriptShell('<html>' + 'y'.repeat(50_000) + '</html>', long)).toBe(false);
  });

  /*
   * The case this exists for. A Gemini share page is a large document containing almost no text,
   * and narrating its cookie banner would be worse than refusing it.
   */
  it('catches a large page with almost no text in it', () => {
    expect(looksLikeJavaScriptShell('<html>' + 'y'.repeat(50_000) + '</html>', 'Loading…')).toBe(
      true,
    );
  });

  it('does not accuse a genuinely short page of being a shell', () => {
    // A short note is allowed to be short; it just has little to read.
    expect(looksLikeJavaScriptShell('<html><p>A short note.</p></html>', 'A short note.')).toBe(
      false,
    );
  });

  it('uses the text length, not the ratio, as the first gate', () => {
    // Plenty of text in a small document is still a real page.
    expect(looksLikeJavaScriptShell('<html>' + long + '</html>', long)).toBe(false);
  });
});
