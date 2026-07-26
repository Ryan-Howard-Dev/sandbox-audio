import { describe, expect, it, vi } from 'vitest';
import {
  computePlaybackGainDb,
  EBU_TARGET_LUFS,
  FALLBACK_LUFS_GAIN_DB,
  lookupLockerReplayGainDb,
} from './replayGainPlayback';

describe('computePlaybackGainDb', () => {
  it('uses tag gain when present', () => {
    expect(computePlaybackGainDb(-6.5)).toBe(-6.5);
  });

  it('falls back to EBU proxy when tag is 0 dB placeholder', () => {
    expect(computePlaybackGainDb(0)).toBe(FALLBACK_LUFS_GAIN_DB);
  });

  it('exports EBU target constant for docs parity', () => {
    expect(EBU_TARGET_LUFS).toBe(-14);
  });
});

describe('locker DB access (D-1 regression)', () => {
  /*
   * replayGainPlayback pinned SandboxMusicCoreDB at version 2 while lockerStorage owns it at
   * version 3. Opening an existing v3 database with a lower version throws VersionError, which
   * lookupLockerReplayGainDb's catch swallowed — every lookup silently returned null and
   * playback used the placeholder gain instead. It failed quietly on every upgraded locker.
   *
   * A read-only consumer must not declare a version: it opens whatever exists, so it cannot
   * drift when lockerStorage next migrates.
   */
  it('opens the locker database without pinning a version', async () => {
    const calls: Array<{ name: string; version?: number }> = [];
    const fakeDb = {
      close: () => {},
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const req: Record<string, unknown> = { result: { replayGainDb: -7.5 } };
            queueMicrotask(() => (req.onsuccess as () => void)?.());
            return req;
          },
        }),
      }),
    };
    vi.stubGlobal('indexedDB', {
      open: (name: string, version?: number) => {
        calls.push({ name, version });
        const req: Record<string, unknown> = { result: fakeDb };
        queueMicrotask(() => (req.onsuccess as () => void)?.());
        return req;
      },
    });

    await expect(lookupLockerReplayGainDb('track-1')).resolves.toBe(-7.5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('SandboxMusicCoreDB');
    // The bug: any number here reintroduces VersionError against a newer locker schema.
    expect(calls[0]!.version).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it('returns null rather than throwing when the database is unavailable', async () => {
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { error: new Error('VersionError') };
        queueMicrotask(() => (req.onerror as () => void)?.());
        return req;
      },
    });
    await expect(lookupLockerReplayGainDb('track-1')).resolves.toBeNull();
    vi.unstubAllGlobals();
  });
});
