import { describe, expect, it, vi } from 'vitest';
import {
  computePlaybackGainDb,
  EBU_TARGET_LUFS,
  FALLBACK_LUFS_GAIN_DB,
  lookupLockerReplayGainDb,
  onReplayGainLookupFailure,
  type ReplayGainLookupFailure,
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
  const stubLockerRow = (row: Record<string, unknown>) => {
    const calls: Array<{ name: string; version?: number }> = [];
    const fakeDb = {
      close: () => {},
      transaction: () => ({
        objectStore: () => ({
          get: () => {
            const req: Record<string, unknown> = { result: row };
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
    return calls;
  };

  it('opens the locker database without pinning a version', async () => {
    const calls = stubLockerRow({ trackGainDb: -7.5 });

    await expect(lookupLockerReplayGainDb('track-1')).resolves.toBe(-7.5);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('SandboxMusicCoreDB');
    // The bug: any number here reintroduces VersionError against a newer locker schema.
    expect(calls[0]!.version).toBeUndefined();
    vi.unstubAllGlobals();
  });

  /*
   * The legacy column stored peak dBFS under the name `replayGainDb`, and playback applied it as
   * a gain — so the quieter the track, the harder it was attenuated. Fixing D-1 is what made that
   * audible, since before the fix no lookup ever returned. Old rows must read as "unknown" and
   * take the documented fallback, never the old inverted value.
   */
  it('ignores the legacy peak-as-gain column', async () => {
    stubLockerRow({ replayGainDb: -18.2 });
    await expect(lookupLockerReplayGainDb('track-1')).resolves.toBeNull();
    vi.unstubAllGlobals();
  });

  it('returns null rather than throwing when the database is unavailable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { error: new Error('VersionError') };
        queueMicrotask(() => (req.onerror as () => void)?.());
        return req;
      },
    });
    await expect(lookupLockerReplayGainDb('track-1')).resolves.toBeNull();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });

  /*
   * D-1 was survivable for months because the catch here turned a total failure into a plausible
   * "no gain stored". Playback still must not break on a bad lookup, so keep returning null — but
   * make the failure observable so the next cross-module mistake surfaces on its first run.
   */
  it('reports lookup failures instead of swallowing them', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const failures: ReplayGainLookupFailure[] = [];
    const unsubscribe = onReplayGainLookupFailure((f) => failures.push(f));
    vi.stubGlobal('indexedDB', {
      open: () => {
        const req: Record<string, unknown> = { error: new Error('VersionError') };
        queueMicrotask(() => (req.onerror as () => void)?.());
        return req;
      },
    });

    await expect(lookupLockerReplayGainDb('track-9')).resolves.toBeNull();
    expect(failures).toHaveLength(1);
    expect(failures[0]!.entryId).toBe('track-9');
    expect(String((failures[0]!.error as Error)?.message)).toContain('VersionError');
    expect(warn).toHaveBeenCalled();

    unsubscribe();
    vi.unstubAllGlobals();
    warn.mockRestore();
  });
});
