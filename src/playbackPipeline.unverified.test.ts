import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  mobileResolveHasNoIndependentMetadata,
  mobileResolveMatchesCatalog,
  getMobileResolveVerificationCounts,
  resetMobileResolveVerificationCounts,
} from './playbackPipeline';

const catalog = {
  title: 'Vultures',
  artist: 'Kanye West',
  durationSeconds: 216,
} as never;

describe('mobileResolveHasNoIndependentMetadata', () => {
  it('is true when the resolver reported nothing and the envelope inherited the catalog', () => {
    expect(mobileResolveHasNoIndependentMetadata(catalog, {} as never)).toBe(true);
    expect(
      mobileResolveHasNoIndependentMetadata(catalog, {
        title: 'Vultures',
        artist: 'Kanye West',
        durationSeconds: 216,
      } as never),
    ).toBe(true);
  });

  it('is false as soon as the resolver contributes anything of its own', () => {
    expect(
      mobileResolveHasNoIndependentMetadata(catalog, { durationSeconds: 402 } as never),
    ).toBe(false);
    expect(
      mobileResolveHasNoIndependentMetadata(catalog, { title: 'Some Other Song' } as never),
    ).toBe(false);
  });
});

describe('mobile resolve verification counters', () => {
  beforeEach(() => {
    resetMobileResolveVerificationCounts();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('counts a metadata-less resolve as unverified, and still accepts it', () => {
    const accepted = mobileResolveMatchesCatalog(catalog, { url: 'https://x/y' } as never);
    expect(accepted).toBe(true);
    expect(getMobileResolveVerificationCounts()).toEqual({ verified: 0, unverified: 1 });
  });

  it('counts a resolve carrying real metadata as verified', () => {
    mobileResolveMatchesCatalog(catalog, {
      title: 'Kanye West - Vultures (Official Audio)',
      durationSeconds: 214,
    } as never);
    expect(getMobileResolveVerificationCounts()).toEqual({ verified: 1, unverified: 0 });
  });
});
