import { describe, expect, it } from 'vitest';
import { parseFpcalcOutput, pickBestAcoustidMatch } from './acoustid.js';

describe('parseFpcalcOutput', () => {
  it('parses plain-text fpcalc output', () => {
    const parsed = parseFpcalcOutput('DURATION=245\nFINGERPRINT=AQADtEmUIkkO');
    expect(parsed).toEqual({ duration: 245, fingerprint: 'AQADtEmUIkkO' });
  });

  it('parses JSON fpcalc output', () => {
    const parsed = parseFpcalcOutput('{"duration": 183.4, "fingerprint": "AQAAabc"}');
    expect(parsed).toEqual({ duration: 183.4, fingerprint: 'AQAAabc' });
  });

  it('returns null for empty output', () => {
    expect(parseFpcalcOutput('')).toBeNull();
  });
});

describe('pickBestAcoustidMatch', () => {
  it('picks highest score above threshold', () => {
    const match = pickBestAcoustidMatch([
      {
        id: 'a1',
        score: 0.62,
        recordings: [{ id: 'mb-1', title: 'Low', artists: [{ name: 'A' }] }],
      },
      {
        id: 'a2',
        score: 0.91,
        recordings: [{ id: 'mb-2', title: 'High', artists: [{ name: 'B' }] }],
      },
    ]);
    expect(match?.musicbrainzRecordingId).toBe('mb-2');
    expect(match?.score).toBe(0.91);
    expect(match?.title).toBe('High');
  });

  it('ignores results below min score', () => {
    const match = pickBestAcoustidMatch([
      {
        id: 'a1',
        score: 0.2,
        recordings: [{ id: 'mb-1', title: 'Weak', artists: [{ name: 'A' }] }],
      },
    ]);
    expect(match).toBeNull();
  });
});
