import { WebPlugin } from '@capacitor/core';
import type { DownloadForegroundPlugin } from './downloadForeground';

export class DownloadForegroundWeb extends WebPlugin implements DownloadForegroundPlugin {
  async setActive(): Promise<void> {}

  async updateProgress(): Promise<void> {}

  async stop(): Promise<void> {}

  async isActive(): Promise<{ active: boolean }> {
    return { active: false };
  }
}
