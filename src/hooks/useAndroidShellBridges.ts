import { useEffect, type RefObject } from 'react';
import type { CandidateSource, MediaEnvelope } from '../sandboxLayer1';
import { isAndroid } from '../platformEnv';
import { prepareNativeExoPlayback } from '../androidNativePlayback';
import {
  initAndroidBackgroundMedia,
  syncAndroidMiniPlayerMode,
  teardownAndroidBackgroundMedia,
} from '../backgroundMedia';
import {
  initAndroidAutoBridge,
  syncAndroidAutoBrowseQueue,
  syncAndroidAutoBrowseLibrary,
  syncAndroidAutoSearchResults,
  browseItemFromEnvelope,
  buildAndroidAutoLibraryPayload,
  teardownAndroidAutoBridge,
} from '../androidAuto';
import { runAfterBootInteractive } from '../bootInteractivity';
import { getLockerEntriesSnapshot, subscribeLockerCache } from '../lockerStorage';
import { lockerEntryToEnvelope } from '../smartPlaylistEngine';
import { loadPlaylists, subscribePlaylists } from '../playlistStorage';
import { runUnifiedSearch } from '../unifiedSearch';
import type { ConnectCommand } from '../tier34/connectProtocol';

const ANDROID_AUTO_LIBRARY_SYNC_DEBOUNCE_MS = 2500;

function scheduleIdleWork(task: () => void, timeoutMs = 5000): void {
  if (typeof requestIdleCallback === 'function') {
    requestIdleCallback(() => task(), { timeout: timeoutMs });
    return;
  }
  setTimeout(task, 0);
}

export type AndroidShellShortcutCtx = {
  play: (options?: { userGesture?: boolean; system?: boolean }) => void;
  pause: (options?: { system?: boolean }) => void;
  skipForward: () => void;
  skipBack: () => void;
  seek: (seconds: number) => void;
  currentTimeSeconds: () => number;
  durationSeconds: () => number;
};

export type UseAndroidShellBridgesOptions = {
  playQueue: MediaEnvelope[];
  playQueueRef: RefObject<MediaEnvelope[]>;
  playEnvelopeRef: RefObject<
    (
      env: MediaEnvelope,
      candidates?: CandidateSource[],
      options?: {
        autoPlay?: boolean;
        seedSearchQueue?: boolean;
        seedSearchEnvelope?: MediaEnvelope;
        seamless?: boolean;
        preservePlayQueue?: boolean;
      },
      /*
       * Promise, not void | Promise. RefObject is invariant in its type argument because
       * current is mutable, so a ref holding an async function does not fit a ref declared as
       * possibly-sync. Matching what handlePlayEnvelope actually returns is the whole fix.
       */
    ) => Promise<boolean>
  >;
  shortcutCtxRef: RefObject<AndroidShellShortcutCtx>;
  sendConnectCommand: (command: ConnectCommand) => void;
};

/** Android background media, mini player, and Android Auto bridge wiring. */
export function useAndroidShellBridges({
  playQueue,
  playQueueRef,
  playEnvelopeRef,
  shortcutCtxRef,
  sendConnectCommand,
}: UseAndroidShellBridgesOptions): void {
  useEffect(() => {
    if (!isAndroid()) return;
    void prepareNativeExoPlayback();
  }, []);

  useEffect(() => {
    if (!isAndroid()) return;

    let disposed = false;
    let mediaReady = false;
    let autoReady = false;

    void initAndroidBackgroundMedia((event) => {
      if (disposed) return;
      const ctx = shortcutCtxRef.current;
      switch (event.action) {
        case 'play':
          void ctx.play({ system: true });
          break;
        case 'pause':
          ctx.pause({ system: true });
          break;
        case 'next':
          ctx.skipForward();
          break;
        case 'previous':
          ctx.skipBack();
          break;
        case 'seekForward':
          ctx.seek(
            Math.min(
              ctx.currentTimeSeconds() + 10,
              ctx.durationSeconds() || Infinity,
            ),
          );
          break;
        case 'seekBackward':
          ctx.seek(Math.max(0, ctx.currentTimeSeconds() - 10));
          break;
        case 'seekTo':
          if (typeof event.positionMs === 'number') {
            ctx.seek(event.positionMs / 1000);
          }
          break;
        default:
          break;
      }
    }).then(() => {
      if (disposed) {
        void teardownAndroidBackgroundMedia();
        return;
      }
      mediaReady = true;
    });

    void syncAndroidMiniPlayerMode();

    void initAndroidAutoBridge({
      onPlayFromMediaId: (mediaId) => {
        if (disposed) return;
        const q = playQueueRef.current;
        const idx = q.findIndex((e) => e.envelopeId === mediaId);
        if (idx >= 0) {
          // {queue, index} is neither a candidates list nor a known option, so it was being
          // handed to the candidates parameter and quietly discarded. Playing the envelope is
          // all this ever actually did.
          void playEnvelopeRef.current(q[idx]);
          return;
        }
        const entries = getLockerEntriesSnapshot();
        if (mediaId.startsWith('local-') && entries) {
          const sourceId = mediaId.slice('local-'.length);
          const entry = entries.find((e) => e.id === sourceId);
          if (entry) {
            void playEnvelopeRef.current(lockerEntryToEnvelope(entry));
            return;
          }
        }
        for (const pl of loadPlaylists()) {
          const track = pl.tracks.find((t) => t.envelopeId === mediaId);
          if (track) {
            void playEnvelopeRef.current(track);
            return;
          }
        }
      },
      onSearchQuery: (query) => {
        if (disposed) return;
        void (async () => {
          const result = await runUnifiedSearch(query, { limit: 15 });
          if (disposed) return;
          const searchItems = [...result.lockerItems, ...result.tracks]
            .map((t) => browseItemFromEnvelope(t.envelope ?? {}))
            .filter((item): item is NonNullable<typeof item> => item != null)
            .slice(0, 20);
          await syncAndroidAutoSearchResults(searchItems);
          const first = result.lockerItems[0] ?? result.tracks[0];
          const env = first?.envelope;
          if (env?.envelopeId) {
            void playEnvelopeRef.current(env);
          }
        })();
      },
    }).then(() => {
      if (disposed) {
        void teardownAndroidAutoBridge();
        return;
      }
      autoReady = true;
    });

    return () => {
      disposed = true;
      if (mediaReady) void teardownAndroidBackgroundMedia();
      if (autoReady) void teardownAndroidAutoBridge();
    };
  }, [playEnvelopeRef, playQueueRef, sendConnectCommand, shortcutCtxRef]);

  useEffect(() => {
    if (!isAndroid()) return;
    void syncAndroidAutoBrowseQueue(
      playQueue
        .filter((e) => e.envelopeId?.trim())
        .map((e) => ({
          mediaId: e.envelopeId!,
          title: e.title ?? 'Unknown title',
          artist: e.artist ?? 'Unknown artist',
          album: e.album,
        })),
    );
  }, [playQueue]);

  useEffect(() => {
    if (!isAndroid()) return;
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const pushAndroidAutoLibrary = () => {
      if (cancelled) return;
      const entries = getLockerEntriesSnapshot();
      if (!entries) return;
      scheduleIdleWork(() => {
        if (cancelled) return;
        const payload = buildAndroidAutoLibraryPayload(entries, loadPlaylists());
        void syncAndroidAutoBrowseLibrary(payload);
      });
    };

    const scheduleAndroidAutoLibrarySync = () => {
      if (cancelled) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        pushAndroidAutoLibrary();
      }, ANDROID_AUTO_LIBRARY_SYNC_DEBOUNCE_MS);
    };

    runAfterBootInteractive(scheduleAndroidAutoLibrarySync);
    const unsubLocker = subscribeLockerCache(scheduleAndroidAutoLibrarySync);
    const unsubPlaylists = subscribePlaylists(scheduleAndroidAutoLibrarySync);
    return () => {
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubLocker();
      unsubPlaylists();
    };
  }, []);

  useEffect(() => {
    if (!isAndroid()) return;
    const onSettingsChange = () => void syncAndroidMiniPlayerMode();
    window.addEventListener('sandbox-settings-change', onSettingsChange);
    return () => window.removeEventListener('sandbox-settings-change', onSettingsChange);
  }, []);
}
