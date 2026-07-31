import { describe, expect, it } from 'vitest';
import { documentToNarration, estimateNarrationSeconds } from './documentNarration';

describe('documentToNarration', () => {
  it('drops the reference list, which is minutes of unlistenable strings', () => {
    const chunks = documentToNarration(
      '# Findings\nThe result held.\n\n## References\nSmith, J. (2019). A Paper. Journal, 4(2).\nJones, K. (2020). Another. Press.',
    );
    const spoken = chunks.map((c) => c.text).join(' ');
    expect(spoken).toContain('The result held.');
    expect(spoken).not.toContain('Smith, J.');
    expect(spoken).not.toContain('Journal');
  });

  it('keeps references when explicitly asked', () => {
    const chunks = documentToNarration('## References\nSmith, J. (2019). A Paper.', {
      keepReferences: true,
    });
    expect(chunks.map((c) => c.text).join(' ')).toContain('Smith');
  });

  it('removes inline citations that wreck sentence flow', () => {
    const chunks = documentToNarration(
      'Growth was rapid (Smith et al., 2019) and sustained [12].',
    );
    expect(chunks[0]!.text).toBe('Growth was rapid and sustained.');
  });

  it('keeps inline citations when asked', () => {
    const chunks = documentToNarration('Growth was rapid (Smith et al., 2019).', {
      keepInlineCitations: true,
    });
    expect(chunks[0]!.text).toContain('(Smith et al., 2019)');
  });

  it('strips markup rather than announcing it', () => {
    const chunks = documentToNarration('This is **bold**, `code`, and a [link](https://x.com).');
    expect(chunks[0]!.text).toBe('This is bold, code, and a link.');
  });

  it('skips code fences entirely', () => {
    const chunks = documentToNarration('Before.\n\n```js\nconst x = 1;\n```\n\nAfter.');
    const spoken = chunks.map((c) => c.text).join(' ');
    expect(spoken).toContain('Before.');
    expect(spoken).toContain('After.');
    expect(spoken).not.toContain('const x');
  });

  it('attributes chunks to the nearest heading so they can become chapters', () => {
    const chunks = documentToNarration('# Method\nWe sampled widely.\n\n# Results\nIt worked.');
    const results = chunks.find((c) => c.text === 'It worked.');
    expect(results?.section).toBe('Results');
    expect(chunks.some((c) => c.isHeading && c.text === 'Method')).toBe(true);
  });

  it('splits on sentence boundaries, never mid-thought', () => {
    const long = Array.from({ length: 12 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    const chunks = documentToNarration(long, { maxChars: 80 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.text).toMatch(/[.!?]$/);
    }
  });

  it('keeps an oversized single sentence whole rather than cutting it', () => {
    const sentence = `${'word '.repeat(120).trim()}.`;
    const chunks = documentToNarration(sentence, { maxChars: 100 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.endsWith('.')).toBe(true);
  });

  it('ignores tables and horizontal rules', () => {
    const chunks = documentToNarration('Intro.\n\n| a | b |\n| - | - |\n\n---\n\nOutro.');
    const spoken = chunks.map((c) => c.text).join(' ');
    expect(spoken).toBe('Intro. Outro.');
  });

  it('returns nothing for an empty document', () => {
    expect(documentToNarration('')).toEqual([]);
    expect(documentToNarration('\n\n   \n')).toEqual([]);
  });
});

describe('estimateNarrationSeconds', () => {
  it('estimates listening time from word count', () => {
    const chunks = documentToNarration(`${'word '.repeat(155).trim()}.`);
    expect(estimateNarrationSeconds(chunks)).toBeCloseTo(60, -1);
  });
});
