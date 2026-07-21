import { describe, expect, it } from 'vitest';
import { checkAcquireDedup } from './acoustidEnrich.js';

describe('checkAcquireDedup', () => {
  it('returns new when manifest is empty', () => {
    expect(checkAcquireDedup('a'.repeat(64))).toEqual({ kind: 'new' });
  });
});
