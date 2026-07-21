import { describe, expect, it } from 'vitest';
import type { MediaEnvelope } from './sandboxLayer1';
import { getSonicLockerScoringKey } from './sonicLockerRadio';

function track(id: string, title = 'Title', artist = 'Artist'): MediaEnvelope {
  return {
    envelopeId: id,
    title,
    artist,
    url: 'https://example.com/a.mp3',
    durationSeconds: 180,
    provider: 'local-vault',
    transport: 'element-src',
    sourceId: id,
  };
}

describe('getSonicLockerScoringKey', () => {
  it('changes when locker metadata changes beyond count', () => {
    const a = getSonicLockerScoringKey([track('1', 'A', 'X')]);
    const b = getSonicLockerScoringKey([track('1', 'B', 'X')]);
    expect(a).not.toBe(b);
  });

  it('changes when track ids differ at same length', () => {
    const a = getSonicLockerScoringKey([track('1'), track('2')]);
    const b = getSonicLockerScoringKey([track('1'), track('3')]);
    expect(a).not.toBe(b);
  });
});
