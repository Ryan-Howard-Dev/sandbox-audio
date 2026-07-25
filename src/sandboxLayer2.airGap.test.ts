import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * R-009: searchArchive and searchCatalogProvider reached the network with no air-gap check while
 * ~20 other modules gated correctly. Air-gap has to mean zero outbound requests, so these assert
 * on fetch never being called — not merely on an empty result, which a network error also yields.
 */
const { airGapMock } = vi.hoisted(() => ({ airGapMock: vi.fn(() => false) }));

vi.mock('./airGapMode', () => ({
  isAirGapEnabled: airGapMock,
  setAirGapEnabled: vi.fn(),
}));

import { searchArchive, searchCatalogProvider } from './sandboxLayer2';

describe('air-gap gating (R-009)', () => {
  beforeEach(() => {
    airGapMock.mockReset();
    vi.restoreAllMocks();
  });

  it('searchArchive makes no network call when air-gap is on', async () => {
    airGapMock.mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(searchArchive('kanye west')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('searchCatalogProvider makes no network call when air-gap is on', async () => {
    airGapMock.mockReturnValue(true);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(searchCatalogProvider('kanye west')).resolves.toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not short-circuit when air-gap is off', async () => {
    airGapMock.mockReturnValue(false);
    // Fail the request rather than let the suite hit the real network; the point is only that the
    // gate did not swallow the call before it was attempted.
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('offline in test'));

    await searchArchive('kanye west');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
