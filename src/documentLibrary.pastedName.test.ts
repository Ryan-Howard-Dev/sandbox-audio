import { describe, it, expect } from 'vitest';
import { pastedDocumentName } from './documentLibrary';

describe('pastedDocumentName', () => {
  it('uses the first non-empty line', () => {
    expect(pastedDocumentName('Deep research: Sandbox\n\nBody text', 'Pasted text')).toBe(
      'Deep research: Sandbox',
    );
  });

  it('skips leading blank lines rather than returning the fallback', () => {
    expect(pastedDocumentName('\n\n   \nActual title\nbody', 'Pasted text')).toBe('Actual title');
  });

  it('falls back when there is no usable line', () => {
    expect(pastedDocumentName('   \n\n  \n', 'Pasted text')).toBe('Pasted text');
    expect(pastedDocumentName('', 'Pasted text')).toBe('Pasted text');
  });

  it('truncates a wall of text with no line breaks', () => {
    const name = pastedDocumentName('x'.repeat(500), 'Pasted text');
    expect(name.length).toBe(80);
    expect(name.endsWith('…')).toBe(true);
  });

  it('does not truncate a line that is exactly at the limit', () => {
    const exact = 'y'.repeat(80);
    expect(pastedDocumentName(exact, 'Pasted text')).toBe(exact);
  });
});
