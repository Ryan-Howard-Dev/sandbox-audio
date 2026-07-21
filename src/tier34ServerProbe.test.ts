import { describe, expect, it } from 'vitest';
import { normalizeTier34ServerUrl } from './tier34ServerProbe';

describe('normalizeTier34ServerUrl', () => {
  it('adds http scheme when missing', () => {
    expect(normalizeTier34ServerUrl('192.168.1.10:3001')).toBe('http://192.168.1.10:3001');
  });

  it('strips trailing slash', () => {
    expect(normalizeTier34ServerUrl('http://192.168.1.10:3001/')).toBe('http://192.168.1.10:3001');
  });

  it('returns empty for blank input', () => {
    expect(normalizeTier34ServerUrl('  ')).toBe('');
  });
});
