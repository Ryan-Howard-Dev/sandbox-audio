import { WebPlugin } from '@capacitor/core';
import type { BackgroundMediaPlugin } from './backgroundMedia';

export class BackgroundMediaWeb extends WebPlugin implements BackgroundMediaPlugin {
  async initialize(): Promise<void> {
    // Web uses navigator.mediaSession directly (keyboardShortcuts.ts).
  }

  async configureAudioSession() {
    return { route: 'unknown' as const, audioFocusGranted: true };
  }

  async getAudioOutputRoute() {
    return { route: 'unknown' as const };
  }

  async startAudioRouteWatcher(): Promise<void> {}

  async stopAudioRouteWatcher(): Promise<void> {}

  async setWiredDacStabilityEnabled(): Promise<void> {}

  async startForeground(): Promise<void> {}

  async stopForeground(): Promise<void> {}

  async updateMetadata(): Promise<void> {}

  async updatePlaybackState(): Promise<void> {}

  async setMiniPlayerMode(): Promise<void> {}

  async enterPictureInPicture(): Promise<void> {}

  async requestBatteryOptimizationExemption(): Promise<{ granted: boolean }> {
    return { granted: true };
  }
}
