import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentToNarration, estimateNarrationSeconds } from './documentNarration';

/*
 * End-to-end check against a real research paper rather than hand-written fragments: headings,
 * inline citations, a reference list, markdown emphasis. These are the four things that make a
 * synthesised paper unlistenable, and every one of them is present here.
 */
const paper = readFileSync(join(__dirname, '__fixtures__', 'research-paper.md'), 'utf8');

describe('documentToNarration on a real paper', () => {
  const chunks = documentToNarration(paper);

  it('produces speakable chunks', () => {
    expect(chunks.length).toBeGreaterThan(3);
    expect(estimateNarrationSeconds(chunks)).toBeGreaterThan(30);
  });

  /* Minutes of "Journal of Audio Engineering, 69(4), 210-225" is the worst offender. */
  it('drops the reference list entirely', () => {
    const spoken = chunks.map((c) => c.text).join(' ');
    expect(spoken).not.toContain('Journal of Audio Engineering');
    expect(spoken).not.toContain('Proceedings of the Audio Workshop');
  });

  /* "open paren Smith et al comma 2019 close paren" mid-sentence wrecks the flow. */
  it('strips inline citations from prose', () => {
    const spoken = chunks.map((c) => c.text).join(' ');
    expect(spoken).not.toContain('(Smith et al., 2019)');
    expect(spoken).not.toContain('(Jones and Patel, 2021)');
  });

  it('never speaks markdown syntax', () => {
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(/^#{1,6}\s/);
      expect(chunk.text).not.toContain('**');
    }
  });

  it('tags chunks with the heading they fall under, for resume and seeking', () => {
    const sections = new Set(chunks.map((c) => c.section));
    expect(sections.has('Introduction')).toBe(true);
    expect(sections.has('Method')).toBe(true);
  });

  it('keeps the actual argument of the paper', () => {
    const spoken = chunks.map((c) => c.text).join(' ');
    expect(spoken).toContain('Peak is a property');
    expect(spoken).toContain('RMS proxy is adequate');
  });

  it('splits below the synthesiser context window', () => {
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(600);
  });
});
