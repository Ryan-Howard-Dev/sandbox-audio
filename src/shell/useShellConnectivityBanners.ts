/**
 * Android launch bootstrap plus the three dismissible connectivity/coverage banners (missing
 * Tier-3/4 server, mobile resolvers down, TV coverage notice) — their persisted dismissed state,
 * live reachability polling, and the derived show/hide booleans. Extracted from sandboxLayer3 with
 * no JSX (the banners themselves still render from ShellChrome).
 *
 * Call this hook at the original position, right after the toast/DJ-deck state block — it only
 * reads showMobileShell/isTV/station/tvScreen, which already exist by then.
 */

import { useEffect, useState } from 'react';
import type { StationId } from './shellNav';
import { isAndroid, isCapacitorNative } from '../platformEnv';
import {
  ensureAndroidLocalPlaybackOnLaunch,
  loadTvCoverageBannerDismissed,
} from '../sandboxSettings';
import { waitForYtDlpInit } from '../ytDlpMobile';
import {
  getTier34BaseUrl,
  isServerReachableCached,
  refreshTier34Reachability,
} from '../tier34/client';
import { hasActiveMobileResolvers, ensureYtDlpMobileReady } from '../mobileResolverRegistry';

const ANDROID_SERVER_BANNER_KEY = 'sandbox_android_server_banner_dismissed';
const MOBILE_RESOLVER_BANNER_KEY = 'sandbox_mobile_resolver_banner_dismissed';

type TVScreenId = 'home' | 'playback';

export type UseShellConnectivityBannersArgs = {
  showMobileShell: boolean;
  isTV: boolean;
  station: StationId;
  tvScreen: TVScreenId;
};

export function useShellConnectivityBanners({
  showMobileShell,
  isTV,
  station,
  tvScreen,
}: UseShellConnectivityBannersArgs) {
  const [androidServerBannerDismissed, setAndroidServerBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(ANDROID_SERVER_BANNER_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [mobileResolverBannerDismissed, setMobileResolverBannerDismissed] = useState(() => {
    try {
      return localStorage.getItem(MOBILE_RESOLVER_BANNER_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [serverReachable, setServerReachable] = useState(() => isServerReachableCached());
  const [mobileResolversActive, setMobileResolversActive] = useState(() =>
    hasActiveMobileResolvers(),
  );
  const showAndroidServerBanner =
    isAndroid() && !getTier34BaseUrl().trim() && !androidServerBannerDismissed && !showMobileShell;
  const showMobileResolverBanner =
    isCapacitorNative() &&
    Boolean(getTier34BaseUrl().trim()) &&
    !serverReachable &&
    !mobileResolversActive &&
    !mobileResolverBannerDismissed;
  const [tvCoverageBannerDismissed, setTvCoverageBannerDismissed] = useState(
    loadTvCoverageBannerDismissed,
  );
  const showTvCoverageBanner =
    isTV && station === 'home' && tvScreen === 'home' && !tvCoverageBannerDismissed;

  useEffect(() => {
    if (!isAndroid()) return;
    ensureAndroidLocalPlaybackOnLaunch();
    ensureYtDlpMobileReady();
    void waitForYtDlpInit();
  }, []);

  useEffect(() => {
    const syncReachability = () => {
      setServerReachable(isServerReachableCached());
      setMobileResolversActive(hasActiveMobileResolvers());
    };
    const onSettingsChange = () => {
      syncReachability();
      if (getTier34BaseUrl().trim()) {
        void refreshTier34Reachability().then(syncReachability);
      }
    };
    window.addEventListener('sandbox-settings-change', onSettingsChange);
    window.addEventListener('sandbox-resolution-change', syncReachability);
    if (getTier34BaseUrl().trim()) {
      void refreshTier34Reachability().then(syncReachability);
    }
    return () => {
      window.removeEventListener('sandbox-settings-change', onSettingsChange);
      window.removeEventListener('sandbox-resolution-change', syncReachability);
    };
  }, []);

  return {
    showAndroidServerBanner,
    setAndroidServerBannerDismissed,
    showMobileResolverBanner,
    setMobileResolverBannerDismissed,
    showTvCoverageBanner,
    setTvCoverageBannerDismissed,
  };
}
