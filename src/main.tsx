import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import CinemaCastView from './stations/CinemaCastView';
import VinylWidgetView from './stations/VinylWidgetView';
import AppErrorBoundary from './components/AppErrorBoundary';
import WindowsTitleBar from './components/WindowsTitleBar';
import { isCinemaCastView } from './cinemaCast';
import { isVinylWidgetView } from './vinylWidget';
import { installAirGapFetchGuard } from './airGapMode';
import { initEngineTheme } from './engineTheme';
import { preloadLocale } from './i18n';
import { initLanguage } from './languageSettings';
import { warmStreamCacheIndex } from './streamCache';
import { ensureBuiltinAddons, syncExperimentalAddons } from './addonStorage';
import {
  ensureDesktopSandboxDefaults,
  ensureStreamCacheSmartDefaults,
  loadShowExperimentalIntegrations,
} from './sandboxSettings';
import { migrateLegacyInstalledPacks } from './recordPlayerAddons';
import { initTasteProfile } from './tasteProfile';
import { initAndroidSafeAreaInsets } from './androidSafeAreaInsets';
import { initPlatformEnv } from './platformEnv';
import { initPlatformTypography } from './platformTypography';
import { initDeviceSecretSync } from './deviceSecretSync';
import { initPlaybackRestoreGuard } from './queuePersistence';
import { APP_WINDOW_TITLE, BUILD_ID } from './buildId';
import { isTauri } from './platformEnv';
import { refreshTier34Reachability } from './tier34/client';
import { migrateLegacyResponseCaches } from './responseCache';
import { initPodcastEpisodeNotificationListeners } from './podcastEpisodeNotifications';
import { initNativeNotificationChannels } from './nativeLocalNotifications';
import { pollOfflineStatus } from './offlineStatus';
import { Capacitor } from '@capacitor/core';
import { initE2eDeepLinks, isE2eBridgeEnabled } from './e2eDevAction';
import { installE2eHandlerStubs } from './e2eHandlerBootstrap';
import { safeBoot } from './bootTasks';
import { initBootInteractivityGate, runAfterBootInteractive } from './bootInteractivity';
import './index.css';

/** E2E APK: kick off shell chunk at module load so handler registration beats stress probes. */
let sandboxShellImport: Promise<typeof import('./sandboxLayer3.tsx')> | null = null;
if (__SANDBOX_ANDROID_E2E__) {
  sandboxShellImport = import('./sandboxLayer3.tsx');
}

const SandboxShell = lazy(() => sandboxShellImport ?? import('./sandboxLayer3.tsx'));

installAirGapFetchGuard();

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (ev) => {
    console.warn('[Sandbox] Unhandled promise rejection:', ev.reason);
  });
}

/** Theme + platform chrome only — keep first paint fast. */
initEngineTheme();
const bootLanguage = initLanguage();
initPlatformEnv();
initAndroidSafeAreaInsets();
initBootInteractivityGate();

/** E2E deep links must register before deferred boot — device stress scripts fire immediately after cold start. */
if (Capacitor.isNativePlatform() && isE2eBridgeEnabled()) {
  installE2eHandlerStubs();
  safeBoot('initE2eDeepLinks', () => initE2eDeepLinks());
}

const RootView = isVinylWidgetView()
  ? VinylWidgetView
  : isCinemaCastView()
    ? CinemaCastView
    : SandboxShell;

document.title = APP_WINDOW_TITLE;
console.log('BUILD_ID', BUILD_ID);

const rootEl = document.getElementById('root');

if (!rootEl) {
  document.body.innerHTML =
    '<p style="font-family:system-ui;padding:2rem;color:#f87171">Sandbox Music: missing #root element.</p>';
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <AppErrorBoundary label="app root">
        {!isVinylWidgetView() ? <WindowsTitleBar /> : null}
        <AppErrorBoundary label="main shell">
          <Suspense fallback={null}>
            <RootView />
          </Suspense>
        </AppErrorBoundary>
      </AppErrorBoundary>
    </StrictMode>,
  );
}

/** Heavy storage / network warm-up after the shell can paint. */
function runDeferredBootTasks(): void {
  safeBoot('preloadLocale', () => preloadLocale(bootLanguage));
  ensureDesktopSandboxDefaults();
  ensureStreamCacheSmartDefaults();
  migrateLegacyResponseCaches();
  initPlatformTypography();
  initPlaybackRestoreGuard();
  safeBoot('warmStreamCacheIndex', () => warmStreamCacheIndex());
  safeBoot('initPodcastEpisodeNotificationListeners', () =>
    initPodcastEpisodeNotificationListeners(),
  );
  safeBoot('initNativeNotificationChannels', () => {
    void initNativeNotificationChannels();
  });
  ensureBuiltinAddons();
  syncExperimentalAddons(loadShowExperimentalIntegrations());
  migrateLegacyInstalledPacks();
  initTasteProfile();
  safeBoot('initDeviceSecretSync', () => initDeviceSecretSync());
  safeBoot('refreshTier34Reachability', () => refreshTier34Reachability());

  if (typeof window !== 'undefined') {
    window.addEventListener('sandbox-settings-change', () => {
      safeBoot('refreshTier34Reachability', () => refreshTier34Reachability());
    });
    if (isTauri()) {
      safeBoot('pollOfflineStatus', () => pollOfflineStatus());
    }
  }

  if (isTauri()) {
    safeBoot('tauriSetTitle', () =>
      import('@tauri-apps/api/window').then(({ getCurrentWindow }) =>
        getCurrentWindow().setTitle(APP_WINDOW_TITLE),
      ),
    );
  }
}

runAfterBootInteractive(() => {
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => runDeferredBootTasks(), { timeout: 1200 });
  } else {
    window.setTimeout(runDeferredBootTasks, 0);
  }
});
