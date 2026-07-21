import { describe, expect, it } from 'vitest';
import {
  CAST_BROWSER_PORT_HINT,
  isTauriEmbeddedOrigin,
  loadCastBrowserChoice,
  resolveCastBrowserUrlFromLocation,
  saveCastBrowserChoice,
} from './castPlatform';
import { prefsRemoveItem } from './prefsStorage';

describe('castPlatform URL resolution', () => {
  it('detects embedded Tauri origins', () => {
    expect(isTauriEmbeddedOrigin('https:', 'tauri.localhost')).toBe(true);
    expect(isTauriEmbeddedOrigin('tauri:', 'localhost')).toBe(true);
    expect(isTauriEmbeddedOrigin('https:', 'asset.localhost')).toBe(true);
    expect(isTauriEmbeddedOrigin('http:', 'localhost')).toBe(false);
    expect(isTauriEmbeddedOrigin('http:', '127.0.0.1')).toBe(false);
  });

  it('uses dev UI server during tauri dev', () => {
    expect(
      resolveCastBrowserUrlFromLocation('http://localhost:3002', 'http:', 'localhost'),
    ).toBe('http://localhost:3002');
  });

  it('uses embedded localhost server for packaged desktop', () => {
    expect(
      resolveCastBrowserUrlFromLocation('https://tauri.localhost', 'https:', 'tauri.localhost'),
    ).toBe(`http://127.0.0.1:${CAST_BROWSER_PORT_HINT}`);
  });

  it('keeps normal browser origin when already in Chrome', () => {
    expect(
      resolveCastBrowserUrlFromLocation('http://localhost:5173', 'http:', 'localhost'),
    ).toBe('http://localhost:5173');
  });
});

describe('cast browser preference', () => {
  it('persists browser choice', () => {
    prefsRemoveItem('sandbox_cast_browser_choice');
    expect(loadCastBrowserChoice()).toBe('default');
    saveCastBrowserChoice('edge');
    expect(loadCastBrowserChoice()).toBe('edge');
    prefsRemoveItem('sandbox_cast_browser_choice');
  });
});
