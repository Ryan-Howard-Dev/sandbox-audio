import { WebPlugin } from '@capacitor/core';
import type {
  NativeExoPlaybackPlugin,
  NativeExoPlaybackStatus,
} from './androidNativePlayback';

export class NativeExoPlaybackWeb extends WebPlugin implements NativeExoPlaybackPlugin {
  async getStatus(): Promise<NativeExoPlaybackStatus> {
    return {
      available: false,
      wired: false,
      message: 'Native ExoPlayer playback is Android-only.',
    };
  }

  async prepare(): Promise<{ ok: boolean; message: string }> {
    return { ok: false, message: 'Native ExoPlayer playback is Android-only.' };
  }

  async localStreamProxyUrl(options: { url: string }): Promise<{ url: string }> {
    return { url: options.url };
  }

  async playUrl(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async enqueueNext(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async setGaplessEnabled(): Promise<{ ok: boolean; gaplessEnabled: boolean }> {
    return { ok: false, gaplessEnabled: false };
  }

  async setCrossfadeEnabled(): Promise<{ ok: boolean; crossfadeEnabled: boolean }> {
    return { ok: false, crossfadeEnabled: false };
  }

  async setReplayGainDb(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async setUserVolume(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async setPlaybackSpeed(): Promise<{ ok: boolean; speed?: number }> {
    return { ok: false, speed: 1 };
  }

  async setBitPerfectEnabled(): Promise<{ ok: boolean; bitPerfectActive?: boolean }> {
    return { ok: false, bitPerfectActive: false };
  }

  async setWiredDacStabilityEnabled(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async getUsbBitPerfectSupport(): Promise<{
    available: boolean;
    usbDacConnected: boolean;
    active: boolean;
    apiLevel: number;
  }> {
    return { available: false, usbDacConnected: false, active: false, apiLevel: 0 };
  }

  async pause(): Promise<void> {}

  async resume(): Promise<void> {}

  async rerouteToWiredOutput(_options?: {
    forceRestart?: boolean;
  }): Promise<{ ok: boolean; route?: string }> {
    return { ok: false };
  }

  async stop(): Promise<void> {}

  async seek(): Promise<void> {}

  async updateTrackMetadata(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async beginLockerBlob(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async appendLockerBlobChunk(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async finishLockerBlob(): Promise<{ ok: boolean; contentUri: string }> {
    return { ok: false, contentUri: '' };
  }

  async abortLockerBlob(): Promise<{ ok: boolean }> {
    return { ok: false };
  }

  async getLockerBlobUri(): Promise<{ contentUri?: string }> {
    return {};
  }

  async importLockerBlobFromPath(): Promise<{ ok: boolean; contentUri?: string; bytes?: number }> {
    return { ok: false };
  }

  async auditLockerStorage(): Promise<{
    migrationRan?: boolean;
    durableBlobCount?: number;
    durableBlobBytes?: number;
    durableYtdlpCount?: number;
    durableYtdlpBytes?: number;
    cacheBlobCount?: number;
    cacheBlobBytes?: number;
    cacheYtdlpCount?: number;
    cacheYtdlpBytes?: number;
  }> {
    return {
      migrationRan: false,
      durableBlobCount: 0,
      durableBlobBytes: 0,
      durableYtdlpCount: 0,
      durableYtdlpBytes: 0,
      cacheBlobCount: 0,
      cacheBlobBytes: 0,
      cacheYtdlpCount: 0,
      cacheYtdlpBytes: 0,
    };
  }

  async probeLocalFile(): Promise<{ exists: boolean; bytes?: number }> {
    return { exists: false };
  }
}
