import { describe, expect, it } from 'vitest';
import {
  hasMobilePlaybackShell,
  mobileShellUsesPlayerPadding,
  shouldShowMobileInfoStrip,
  shouldShowMobileMiniBar,
  shouldUseAndroidInlinePlayerDock,
} from './mobilePlayerShellLogic';

describe('mobilePlayerShellLogic', () => {
  it('shows mini bar on all stations when playback shell is active', () => {
    expect(shouldShowMobileMiniBar('locker', true)).toBe(true);
    expect(shouldShowMobileMiniBar('search', true)).toBe(true);
    expect(shouldShowMobileMiniBar('dj', true)).toBe(true);
    expect(shouldShowMobileMiniBar('home', true)).toBe(true);
    expect(shouldShowMobileMiniBar('locker', false)).toBe(false);
  });

  it('hides mini bar while full now-playing sheet is open', () => {
    expect(shouldShowMobileMiniBar('home', true, false, true)).toBe(false);
    expect(shouldShowMobileMiniBar('dj', true, false, true)).toBe(false);
  });

  it('does not use info strip (full sheet replaces it)', () => {
    expect(shouldShowMobileInfoStrip('home', true, true)).toBe(false);
    expect(shouldShowMobileInfoStrip('locker', true, true)).toBe(false);
    expect(shouldShowMobileInfoStrip('search', true, false)).toBe(false);
  });

  it('keeps mini bar visible while mobile search overlay is open', () => {
    expect(shouldShowMobileMiniBar('home', true, true)).toBe(true);
    expect(shouldShowMobileMiniBar('locker', true, true)).toBe(true);
    expect(shouldShowMobileMiniBar('search', true, true)).toBe(true);
    expect(shouldShowMobileMiniBar('dj', true, true)).toBe(true);
  });

  it('treats pending mobile play as active shell', () => {
    expect(hasMobilePlaybackShell(false, true)).toBe(true);
    expect(hasMobilePlaybackShell(true, false)).toBe(true);
    expect(hasMobilePlaybackShell(false, false)).toBe(false);
  });

  it('applies player padding when mini bar or info strip is visible', () => {
    expect(mobileShellUsesPlayerPadding('home', true)).toBe(true);
    expect(mobileShellUsesPlayerPadding('home', true, false, false, true)).toBe(false);
    expect(mobileShellUsesPlayerPadding('locker', true, false, false, true)).toBe(false);
    expect(mobileShellUsesPlayerPadding('discover', true)).toBe(true);
    expect(mobileShellUsesPlayerPadding('dj', true)).toBe(true);
    expect(mobileShellUsesPlayerPadding('discover', false)).toBe(false);
  });

  it('skips main padding when Android uses inline player dock', () => {
    expect(mobileShellUsesPlayerPadding('discover', true, false, true)).toBe(false);
    expect(shouldUseAndroidInlinePlayerDock(true)).toBe(true);
    expect(shouldUseAndroidInlinePlayerDock(false)).toBe(false);
  });
});
