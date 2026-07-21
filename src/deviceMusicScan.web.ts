import { WebPlugin } from '@capacitor/core';
import type { DeviceMusicScanPlugin } from './deviceMusicScan';

export class DeviceMusicScanWeb extends WebPlugin implements DeviceMusicScanPlugin {
  async isAvailable(): Promise<{ available: boolean }> {
    return { available: false };
  }

  async checkPermissions(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async requestPermissions(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async scan(): Promise<{ tracks: []; count: number }> {
    return { tracks: [], count: 0 };
  }

  async scanAudiobooks(): Promise<{ tracks: []; count: number }> {
    return { tracks: [], count: 0 };
  }
}
