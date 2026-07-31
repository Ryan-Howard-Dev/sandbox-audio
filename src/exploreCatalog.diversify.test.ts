import { describe, expect, it } from 'vitest';
import { __testDiversifyChartPool as diversify } from './exploreCatalog';

function pool(names: string[]) {
  return names.map((artistName, i) => ({ artistName, id: String(i) }));
}

describe('diversifyChartPool', () => {
  it('caps one artist at two entries so they cannot fill the shelf', () => {
    const rows = pool([
      'Drake', 'Drake', 'Drake', 'Drake', 'Drake',
      'Nas', 'Jay-Z', 'Kendrick', 'Future', 'Tyler',
      'MF DOOM', 'Andre 3000',
    ]);
    const picked = diversify(rows, 6, 0);
    const drakes = picked.filter((r) => r.artistName === 'Drake').length;
    expect(picked).toHaveLength(6);
    expect(drakes).toBeLessThanOrEqual(2);
  });

  it('returns a different window on a different day', () => {
    const rows = pool(Array.from({ length: 40 }, (_, i) => `Artist ${i}`));
    const dayA = diversify(rows, 5, 1).map((r) => r.id).join(',');
    const dayB = diversify(rows, 5, 2).map((r) => r.id).join(',');
    expect(dayA).not.toBe(dayB);
  });

  it('returns the pool unchanged when it is smaller than the limit', () => {
    const rows = pool(['Nas', 'Jay-Z']);
    expect(diversify(rows, 10, 0)).toHaveLength(2);
  });

  it('still fills the shelf when diversity capping would leave it short', () => {
    const rows = pool(['Drake', 'Drake', 'Drake', 'Drake', 'Drake', 'Drake']);
    expect(diversify(rows, 4, 0)).toHaveLength(4);
  });
});
