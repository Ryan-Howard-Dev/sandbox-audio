import type { NativeCastPlugin } from './nativeCast';

export class NativeCastWeb implements NativeCastPlugin {
  async initialize(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'Native Cast is Android-only' };
  }

  async isAvailable(): Promise<{ available: boolean }> {
    return { available: false };
  }

  async showDevicePicker(): Promise<void> {
    throw new Error('Native Cast is Android-only');
  }

  async requestSession() {
    return { ok: false, error: 'Native Cast is Android-only', code: 'unsupported' };
  }

  async endSession(): Promise<void> {
    /* noop */
  }

  async syncPlayback(): Promise<void> {
    /* noop */
  }

  async addListener(): Promise<{ remove: () => Promise<void> }> {
    return { remove: async () => undefined };
  }
}
