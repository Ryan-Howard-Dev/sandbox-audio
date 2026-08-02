import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The two modules the chooser reads are mocked rather than driven, because what is being tested is
 * the decision, not Capacitor's plugin registry or a live server.
 */
const nativePlatform = vi.fn(() => false);
const nativeSupported = vi.fn(() => false);
const serverConfigured = vi.fn(() => false);

vi.mock('./nativeCast', () => ({
  isNativeCastPlatform: () => nativePlatform(),
  isNativeCastSupported: () => nativeSupported(),
}));
vi.mock('./serverCast', () => ({
  isServerCastConfigured: () => serverConfigured(),
}));

const { castUnavailableReason, isCastingAvailable, resolveCastTransport } = await import(
  './castTransport'
);

afterEach(() => {
  nativePlatform.mockReturnValue(false);
  nativeSupported.mockReturnValue(false);
  serverConfigured.mockReturnValue(false);
});

describe('resolveCastTransport', () => {
  it('uses the Cast SDK when the build has it', () => {
    nativePlatform.mockReturnValue(true);
    nativeSupported.mockReturnValue(true);
    serverConfigured.mockReturnValue(true);
    // Both are available; the phone casting directly wins because it needs nothing else running.
    expect(resolveCastTransport()).toBe('native');
  });

  it('falls back to the server on a build with no Cast SDK', () => {
    nativePlatform.mockReturnValue(true);
    nativeSupported.mockReturnValue(false);
    serverConfigured.mockReturnValue(true);
    expect(resolveCastTransport()).toBe('server');
  });

  it('reports none when the F-Droid build has no server either', () => {
    nativePlatform.mockReturnValue(true);
    nativeSupported.mockReturnValue(false);
    expect(resolveCastTransport()).toBe('none');
    expect(isCastingAvailable()).toBe(false);
  });

  it('uses the server off-device, where there is no plugin to have', () => {
    serverConfigured.mockReturnValue(true);
    expect(resolveCastTransport()).toBe('server');
  });
});

describe('castUnavailableReason', () => {
  it('says nothing when casting works', () => {
    nativePlatform.mockReturnValue(true);
    nativeSupported.mockReturnValue(true);
    expect(castUnavailableReason()).toBeNull();
  });

  it('points at the server on a phone, which is the part the user can fix', () => {
    nativePlatform.mockReturnValue(true);
    expect(castUnavailableReason()).toMatch(/Sandbox Server/);
  });

  it('does not send someone off to start a server that would not help', () => {
    expect(castUnavailableReason()).toBe('Casting is not available in this app.');
  });
});
