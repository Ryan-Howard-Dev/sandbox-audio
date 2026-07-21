import { WebPlugin } from '@capacitor/core';
import type { YtDlpMobilePlugin, YtDlpMobileResolveResult, YtDlpMobileSearchHit, YtDlpMobileStatus } from './ytDlpMobile';

export class YtDlpMobileWeb extends WebPlugin implements YtDlpMobilePlugin {
  async getStatus(): Promise<YtDlpMobileStatus> {
    return { available: false, initialized: false };
  }

  async resolve(): Promise<YtDlpMobileResolveResult> {
    throw this.unavailable('YtDlpMobile is only available on Android');
  }

  async downloadAudio(): Promise<YtDlpMobileResolveResult> {
    throw this.unavailable('YtDlpMobile is only available on Android');
  }

  async cancel(): Promise<void> {
    /* no-op on web */
  }

  async search(): Promise<{ results: YtDlpMobileSearchHit[] }> {
    return { results: [] };
  }
}
