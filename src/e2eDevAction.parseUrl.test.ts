import { describe, expect, it } from 'vitest';
import { parseE2eUrl } from './e2eDevAction';

/*
 * These are the exact strings scripts/android-playback-e2e.sh sends over adb. The previous
 * parser relied on `new URL().hostname`, which Android's WebView leaves empty for the
 * non-special sandboxmusic:// scheme — so every deep link returned null on device while the
 * existing tests passed under jsdom. The gate could never get past its first step.
 */
describe('parseE2eUrl against the literal deep links the gate sends', () => {
  it('parses a bare action', () => {
    const out = parseE2eUrl('sandboxmusic://e2e/skip-onboarding');
    expect(out?.action).toBe('skip-onboarding');
  });

  it('parses an action with query params', () => {
    const out = parseE2eUrl(
      'sandboxmusic://e2e/play-artist-track?artist=Kanye%20West&track=FATHER&progressSeconds=25',
    );
    expect(out?.action).toBe('play-artist-track');
    expect(out?.params.get('artist')).toBe('Kanye West');
    expect(out?.params.get('progressSeconds')).toBe('25');
  });

  it('parses the other bootstrap actions the gate depends on', () => {
    for (const a of ['probe-handlers', 'clear-server', 'check-ytdlp']) {
      expect(parseE2eUrl(`sandboxmusic://e2e/${a}`)?.action).toBe(a);
    }
  });

  it('still rejects non-e2e hosts and junk', () => {
    expect(parseE2eUrl('sandboxmusic://player/home')).toBeNull();
    expect(parseE2eUrl('sandboxmusic://e2e/')).toBeNull();
    expect(parseE2eUrl('')).toBeNull();
  });
});
