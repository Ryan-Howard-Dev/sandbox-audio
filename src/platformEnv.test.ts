import { describe, expect, it } from 'vitest';
import {
  getServerCapabilityMessage,
  type ServerCapabilityInfo,
} from './platformEnv';

describe('getServerCapabilityMessage', () => {
  it('describes anchor desktop without negative wording', () => {
    const msg = getServerCapabilityMessage({
      capability: 'anchor',
      canHostAnchor: true,
      platform: 'tauri',
      desktopOs: 'windows',
      isMobile: false,
    });
    expect(msg).toContain('Sandbox Server');
    expect(msg.toLowerCase()).not.toContain('tier34');
    expect(msg.toLowerCase()).not.toContain('desktop only');
  });

  it('describes mobile client with path forward', () => {
    const msg = getServerCapabilityMessage({
      capability: 'client',
      canHostAnchor: false,
      platform: 'android',
      desktopOs: null,
      isMobile: true,
    } satisfies ServerCapabilityInfo);
    expect(msg).toContain('Locker');
    expect(msg).toContain('LAN');
  });
});
