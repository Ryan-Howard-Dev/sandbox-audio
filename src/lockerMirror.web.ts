import type { LockerMirrorPlugin, LockerMirrorSearchHit, LockerMirrorTrack } from './lockerMirror';

/** Web fallback — no native SQLite; search returns empty (IndexedDB handles search). */
export class LockerMirrorWeb implements LockerMirrorPlugin {
  async isAvailable(): Promise<{ available: boolean }> {
    return { available: false };
  }

  async upsertTracks(_options: { tracks: LockerMirrorTrack[] }): Promise<{ count: number }> {
    return { count: 0 };
  }

  async search(_options: { query: string; limit?: number }): Promise<{ hits: LockerMirrorSearchHit[] }> {
    return { hits: [] };
  }

  async getCount(): Promise<{ count: number }> {
    return { count: 0 };
  }

  async listAllTracks(): Promise<{ hits: LockerMirrorSearchHit[] }> {
    return { hits: [] };
  }

  async clear(): Promise<void> {
    /* noop */
  }
}
