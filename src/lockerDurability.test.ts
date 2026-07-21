import { beforeEach, describe, expect, it } from 'vitest';
import { formatDurabilityGb } from './lockerDurability';

describe('lockerDurability', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('formats durability sizes for settings readout', () => {
    expect(formatDurabilityGb(0)).toBe('0 GB');
    expect(formatDurabilityGb(5 * 1024 * 1024)).toContain('MB');
    expect(formatDurabilityGb(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});
