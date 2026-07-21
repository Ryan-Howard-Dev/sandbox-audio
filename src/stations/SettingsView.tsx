import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  LogOut,
  Sliders,
  Music,
  Database,
  Palette,
  Puzzle,
  Activity,
  Plus,
  Loader2,
  Search as SearchIcon,
  Shield,
  Cast,
  AlarmClock,
  Car,
  ClipboardCheck,
  ChevronLeft,
  Disc3,
  Info,
} from 'lucide-react';
import SandboxSwitch from '../components/SandboxSwitch';
import TasteRecipePanel from '../components/TasteRecipePanel';
import NavPinTabsSettings from '../components/settings/NavPinTabsSettings';
import SettingsGroup from '../components/settings/SettingsGroup';
import SettingsMobileRoot, {
  type SettingsCategory,
  type SettingsCategoryId,
} from '../components/settings/SettingsMobileRoot';
import SettingsProfileHeader from '../components/settings/SettingsProfileHeader';
import SettingsQuickAccess from '../components/settings/SettingsQuickAccess';
import SettingsDesktopNav from '../components/settings/SettingsDesktopNav';
import {
  settingsCategoryStatusValue,
  type SettingsStatusSnapshot,
} from '../components/settings/settingsCategoryStatus';
import SettingsToggleRow from '../components/settings/SettingsToggleRow';
import SettingsSearchBar from '../components/settings/SettingsSearchBar';
import SettingsSearchResults from '../components/settings/SettingsSearchResults';
import SettingsSectionAnchor from '../components/settings/SettingsSectionAnchor';
import { SETTINGS_SEARCH_ANCHORS } from '../components/settings/settingsSearchAnchors';
import VinylSettingsPanel from '../components/settings/VinylSettingsPanel';
import {
  buildSettingsSearchIndex,
  filterSettingsSearch,
  type SettingsSearchItem,
} from '../components/settings/settingsSearchIndex';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import ConnectSetupWizard from '../components/ConnectSetupWizard';
import ConfirmDialog from '../components/ConfirmDialog';
import AlertDialog from '../components/AlertDialog';
import OfflineStatusBanner from '../components/OfflineStatusBanner';
import { acquireOfflineHint, connectOfflineHint } from '../offlineStatus';
import {
  applyPlatformTypography,
  architectFontToPlatformId,
  loadPlatformTypography,
  PLATFORM_FONTS,
  type PlatformFontId,
} from '../platformTypography';
import {
  C,
  DEVICE_CAPACITY_OPTIONS,
  type DeviceCapacity,
} from './theme';
import {
  applyEngineTheme,
  applyThemePreset,
  applyThemeShell,
  FOCUS_ACCENT_HEX,
  INTENSITY_PRESETS,
  loadEngineTheme,
  resolveThemeTone,
  saveEngineTheme,
  type IntensityId,
} from '../engineTheme';
import { THEME_PRESETS } from '../themePresets';
import { clearLockerVault } from '../lockerStorage';
import { LOCKER_USER_DELETE_CONFIRMED } from '../lockerDeleteGuard';
import {
  formatDurabilityGb,
  getOfflineLibraryDurabilityReport,
  type OfflineLibraryDurabilityReport,
} from '../lockerDurability';
import {
  exportLockerManifest,
  formatPlaylistSyncStats,
  importLockerManifest,
  isLockerSyncAvailable,
  loadLockerSyncSettings,
  LOCKER_SYNC_COMPLETE_EVENT,
  parseManifestFile,
  pullAndMergeLockerManifest,
  pullManifestFromWebdav,
  pushManifestToWebdav,
  recordLockerSyncResult,
  saveLockerSyncSettings,
  type LockerSyncProvider,
  type PlaylistSyncMergeStats,
} from '../lockerSync';
import LockerSyncConflictsPanel from '../components/LockerSyncConflictsPanel';
import {
  capacityUsagePercent,
  formatCapacityLabel,
  formatLockerMb,
  getLockerStorageUsage,
  subscribeLockerCache,
} from '../lockerStorage';
import { prefsGetItem, prefsSetItem } from '../prefsStorage';
import { clearAllAppCaches } from '../responseCache';
import {
  LANGUAGE_OPTIONS,
  loadLanguage,
  saveLanguage,
  type AppLanguage,
} from '../languageSettings';
import { useTranslation } from '../i18n';
import {
  loadAudiophileDeviceId,
  loadAudiophileEnabled,
  loadAudiophileExclusiveMode,
  loadCrossfadeEnabled,
  loadDeviceCapacity,
  loadFidelityPolicy,
  loadGaplessEnabled,
  loadNetworkSyncEnabled,
  loadConnectDeviceName,
  loadConnectRolePref,
  loadConnectSetupDone,
  loadAggressiveCacheMaxMb,
  loadAggressiveOfflineCacheEnabled,
  loadStreamCacheEnabled,
  loadStreamCacheLimitMb,
  loadShowExperimentalIntegrations,
  loadSandboxSonicEnabled,
  loadEarSafeListeningEnabled,
  loadSonicOutputOverride,
  loadSandboxSpatialEnabled,
  loadSandboxSpatialWidth,
  loadSonicPeqPresetId,
  loadSandboxServerDownloadToLocker,
  syncTier34BackendUrlFromServerMode,
  resolveConnectRole,
  saveAudiophileDeviceId,
  saveAudiophileEnabled,
  saveAudiophileExclusiveMode,
  saveCrossfadeEnabled,
  saveDeviceCapacity,
  saveFidelityPolicy,
  saveGaplessEnabled,
  saveNetworkSyncEnabled,
  saveConnectDeviceName,
  saveConnectRolePref,
  saveAggressiveCacheMaxMb,
  saveAggressiveOfflineCacheEnabled,
  saveStreamCacheEnabled,
  saveStreamCacheLimitMb,
  saveShowExperimentalIntegrations,
  saveSandboxSonicEnabled,
  saveEarSafeListeningEnabled,
  saveSonicOutputOverride,
  saveSandboxSpatialEnabled,
  saveSandboxSpatialWidth,
  saveSonicPeqPresetId,
  saveSandboxServerDownloadToLocker,
  AGGRESSIVE_CACHE_MAX_OPTIONS,
  STREAM_CACHE_LIMIT_OPTIONS,
  type AggressiveCacheMaxMb,
  type FidelityPolicy,
  type SandboxServerMode,
  type SonicOutputOverride,
  type StreamCacheLimitMb,
  shouldShowTauriCastGuidancePanel,
} from '../sandboxSettings';
import {
  detectSonicOutputRoute,
  getCachedSonicOutputRoute,
  getSonicRouteResolution,
  type SonicOutputRoute,
  type SonicRouteResolution,
} from '../sandboxSonic';
import {
  SONIC_PEQ_PRESETS,
} from '../sonicPeqPresets';
import { isHeadphoneSonicRoute } from '../sandboxSpatial';
import type { ConnectRolePref } from '../tier34/connectProtocol';
import {
  clearStreamCache,
  formatStreamCacheMb,
  getStreamCacheUsage,
  getUriCacheStats,
  streamCacheUsagePercent,
  subscribeStreamCache,
} from '../streamCache';
import {
  getLastResolvedSource,
  getResolutionOrder,
  type ResolutionSource,
} from '../hybridResolution';
import {
  getMobileResolvers,
  getUserMobileResolverManifests,
  installMobileResolverManifest,
  MOBILE_RESOLVER_INTERFACE_SPEC,
  removeMobileResolver,
  removeUserMobileResolver,
  setMobileResolverEnabled,
} from '../mobileResolverRegistry';
import { getTier34BaseUrl, isServerReachableCached, refreshTier34Reachability } from '../tier34/client';
import {
  canOpenCastInBrowser,
  getCastBrowserUrl,
  loadCastBrowserChoice,
  openCastInExternalBrowser,
} from '../castPlatform';
import TauriCastGuidancePanel from '../components/TauriCastGuidancePanel';
import {
  getCastDeviceName,
  getCastUnsupportedMessage,
  getCinemaCastMode,
  hasCustomCastReceiver,
  isCastSdkSupported,
  openCinemaCastPopout,
  requestCinemaCast,
  startScreenMirror,
  stopCinemaCast,
  subscribeCastSession,
  warmCastSdk,
  type CinemaCastMode,
} from '../cinemaCast';
import {
  loadAutoCastEnabled,
  loadDefaultCastDevice,
  loadLastCastScan,
  saveAutoCastEnabled,
  saveDefaultCastDevice,
  saveLastCastScan,
} from '../castState';
import { tier34CastDiscover, type CastDevice } from '../tier34/client';
import { fetchStemCapabilities } from '../stemSeparation';
import {
  getSearchCacheSnapshot,
  lruCache,
  searchFeedback,
} from '../sandboxLayer2';
import {
  loadHeroDisplayMode,
  saveHeroDisplayMode,
  type HeroDisplayMode,
} from '../heroDisplaySettings';
import {
  loadVinylVisualSettings,
  saveVinylVisualSettings,
  type VinylVisualSettings,
} from '../vinylVisualSettings';
import {
  migrateLegacyInstalledPacks,
  fetchRecordPlayerCatalog,
  getOfficialPresets,
  importRecordPlayerAddonJson,
  installRecordPlayerAddonFromUrl,
  loadActiveRecordPlayerAddonId,
  loadInstalledCommunityPacks,
  removeRecordPlayerAddon,
  saveActiveRecordPlayerAddonId,
  type RecordPlayerAddon,
  type RecordPlayerCatalogEntry,
} from '../recordPlayerAddons';
import { loadVinylDisplayMode, type VinylDisplayMode } from '../vinylDisplaySettings';
import {
  loadSearchSortOrder,
  saveSearchSortOrder,
  type SearchSortOrder,
} from '../searchSettings';
import {
  ensureBuiltinAddons,
  getAddonStatus,
  installUserAddon,
  isStubAddon,
  loadAddons,
  removeUserAddon,
  setAddonConfig,
  setAddonEnabled,
  type AddonStatus,
  type SandboxAddon,
} from '../addonStorage';
import { isAllowedAddonSearchEndpoint } from '../addons/addonUrlValidation';
import {
  PROWLARR_URL_PLACEHOLDER,
  loadPlaybackEngineSettings,
  savePlaybackEngineSettings,
} from '../playbackEngineSettings';
import {
  testProwlarrBackend,
  testRealDebridBackend,
  testSandboxIndexerBackend,
  testYtdlpBackend,
  tier34GetDlnaSettings,
  tier34GetDefenseProtocol,
  tier34GetIngestionWatch,
  tier34GetStorageInfo,
  tier34HealthOk,
  tier34IndexerConfigure,
  tier34IndexerStatus,
  tier34SetDefenseProtocol,
  tier34SetDlnaEnabled,
  tier34SetIngestionWatchDetailed,
  type IngestionWatchStatus,
  type SandboxIndexerStatus,
  type Tier34DlnaSettings,
  type Tier34StorageInfo,
} from '../tier34/client';
import {
  clearTierResolutionLog,
  getTierResolutionLog,
  subscribeTierResolutionLog,
} from '../tierResolutionLog';
import {
  getPlaybackDiagnostics,
  subscribePlaybackDiagnostics,
} from '../playbackDiagnostics';
import {
  cancelSleepTimer,
  formatSleepRemaining,
  getSleepTimerSnapshot,
  presetLabel,
  startSleepTimer,
  SLEEP_TIMER_PRESETS,
  subscribeSleepTimer,
} from '../sleepTimer';
import {
  enterCarMode,
  exitCarMode,
  isAndroidNative,
  isCarModeActive,
  loadCarModeAutoOffer,
  saveCarModeAutoOffer,
  subscribeCarMode,
  syncCarModeFromPrefs,
} from '../carMode';
import {
  loadAndroidMiniPlayerMode,
  saveAndroidMiniPlayerMode,
  type AndroidMiniPlayerMode,
} from '../androidMiniPlayerSettings';
import {
  getAndroidAudioOutputRoute,
  type AndroidAudioOutputRoute,
  syncAndroidMiniPlayerMode,
} from '../backgroundMedia';
import { SHORTCUT_LEGEND } from '../keyboardShortcuts';
import {
  saveTier34BackendUrl,
  tier34HealthStatus,
  tier34MediaGraphStats,
  tier34ReindexSearch,
  type MediaGraphStats,
} from '../tier34/client';
import {
  formatValidationTimestamp,
  runTier34ValidationSuite,
  validationOverallLabel,
  type ValidationReport,
} from '../tier34ValidationSuite';
import {
  checkSovereignSystemStatus,
  formatSovereignCheckedAt,
  formatSovereignStateLabel,
  sovereignStatusBadgeClass,
  startSovereignStatusPolling,
  SOVEREIGN_STATUS_POLL_INTERVAL_MS,
  type SovereignServiceId,
  type SovereignSystemSnapshot,
} from '../sovereignSystemStatus';
import { batterySaverPollMultiplier } from '../batterySaverSettings';
import {
  getPlatformDiagnostics,
  isAndroid,
  isCapacitorNative,
  isTauri,
  type SandboxPlatformDiagnostics,
} from '../platformEnv';
import { detectTVPlatform } from '../tvDetection';
import {
  isAirGapEnabled,
  isLanPartyMode,
  setAirGap,
  setLanPartyMode,
  subscribeAirGap,
} from '../airGapMode';
import { isDjAudioRoutingEnabled, setDjAudioRoutingEnabled } from '../djAudioEngine';
import MetadataRepairPanel from '../components/MetadataRepairPanel';
import LockerRepairPanel from '../components/LockerRepairPanel';
import ServerDiscovery from '../components/ServerDiscovery';
import {
  displayTier34StoragePath,
  isLocalTier34Backend,
  sanitizePathForDisplay,
} from '../sanitizeDisplayPath';
import {
  loadDeviceSyncEnabled,
  saveDeviceSyncEnabled,
} from '../deviceSecretSync';
import {
  loadSecuritySettings,
  saveSecuritySettings,
  type SecuritySettings,
} from '../securitySettings';
import {
  loadDiscoverStationEnabled,
  saveDiscoverStationEnabled,
} from '../discoverStationSettings';
import { syncLockerAutoFollow } from '../lockerAutoFollow';
import type { DownloadTierPreference } from '../downloadQueue';
import {
  loadLockerAutoFollowEnabled,
  saveLockerAutoFollowEnabled,
} from '../lockerAutoFollowSettings';
import {
  loadFollowedReleaseNotifEnabled,
  saveFollowedReleaseNotifEnabled,
} from '../followedReleaseNotificationSettings';
import {
  loadPodcastAutoDownloadWifiOnly,
  loadPodcastSeekIntervalSeconds,
  loadPodcastsEnabled,
  PODCAST_SEEK_INTERVALS,
  savePodcastAutoDownloadWifiOnly,
  savePodcastSeekIntervalSeconds,
  savePodcastsEnabled,
} from '../podcastSettings';
import {
  loadAudiobooksEnabled,
  saveAudiobooksEnabled,
} from '../audiobooksSettings';
import {
  loadLibraryStationEnabled,
  saveLibraryStationEnabled,
} from '../libraryStationSettings';
import {
  loadSonicLockerStationEnabled,
  saveSonicLockerStationEnabled,
} from '../sonicLockerStationSettings';
import {
  getAudiophilePlatformSupport,
  isTauriDesktop,
  listAudioOutputDevices,
  nativePlaybackStatus,
  syncAudiophileSettingsToBackend,
  type AudioOutputDevice,
  type AudiophilePlatformSupport,
  type NativePlaybackStatus,
} from '../nativeAudiophile';
import {
  getNativeExoPlaybackStatus,
  getNativeExoUsbBitPerfectSupport,
  nativeExoSetBitPerfectEnabled,
  type NativeExoPlaybackStatus,
} from '../androidNativePlayback';
import {
  loadAndroidNativePlaybackEnabled,
  saveAndroidNativePlaybackEnabled,
  loadAndroidWebViewCrossfadeEnabled,
  saveAndroidWebViewCrossfadeEnabled,
  loadAndroidUsbBitPerfectEnabled,
  saveAndroidUsbBitPerfectEnabled,
  loadAndroidWiredDacStabilityEnabled,
  saveAndroidWiredDacStabilityEnabled,
} from '../androidNativePlaybackSettings';
import { syncWiredDacStabilityNative } from '../androidWiredDacPlayback';
import { loadScrobbleSettings, saveScrobbleSettings } from '../scrobbleSettings';
import { getLastfmAuthUrl, isScrobbleBlockedByAirGap } from '../scrobble';
import {
  loadBatterySaverEnabled,
  saveBatterySaverEnabled,
} from '../batterySaverSettings';
import { fetchDeviceIdentity } from '../identityBridge';

const PRO_AUDIO_KEY = 'isProAudioEnabled';
const THEME_TONE_KEY = 'sandbox_theme_tone';
const ACCENT_HEX_KEY = 'sandbox_accent_hex';
const RADIUS_KEY = 'sandbox_border_radius';
const CARD_SCALE_KEY = 'cardScale';

const ARCHITECT_FONT_LABEL_KEYS: Record<PlatformFontId, string> = {
  'plex-mono': 'settings.architect.fonts.terminalMono',
  barlow: 'settings.architect.fonts.commandDisplay',
  jetbrains: 'settings.architect.fonts.signalCode',
  inter: 'settings.architect.fonts.cleanOps',
};

const BORDER_RADIUS_OPTIONS = [
  { value: '4px', labelKey: 'settings.architect.radiusOption4' },
  { value: '8px', labelKey: 'settings.architect.radiusOption8' },
  { value: '12px', labelKey: 'settings.architect.radiusOption12' },
  { value: '16px', labelKey: 'settings.architect.radiusOption16' },
] as const;

const THEME_TONE_LABEL_KEYS: Record<string, string> = {
  Focus: 'settings.architect.presets.focus',
  'Tactical Midnight': 'settings.architect.presets.tacticalMidnight',
  'Light Canvas': 'settings.architect.presets.lightCanvas',
  'HC Terminal': 'settings.architect.presets.hcTerminal',
  'Deep Ocean': 'settings.architect.presets.deepOcean',
  'Blood Moon': 'settings.architect.presets.bloodMoon',
  'Custom CSS': 'settings.architect.presets.customCss',
  'Custom Override': 'settings.architect.presets.customCss',
};

function themeToneDisplayLabel(tone: string, translate: (key: string) => string): string {
  const key = THEME_TONE_LABEL_KEYS[tone];
  return key ? translate(key) : tone;
}

export type SettingsTab =
  | 'fidelity'
  | 'playback'
  | 'vault'
  | 'architect'
  | 'vinyl'
  | 'addons'
  | 'telemetry'
  | 'diagnostics'
  | 'security'
  | 'about';

const ADDON_MANIFEST_EXAMPLE = `{
  "name": "My Search Provider",
  "version": "1.0.0",
  "tier": 2,
  "defaults": {
    "provider": "stream-proxy",
    "transport": "element-src"
  },
  "search": {
    "endpoint": "https://example.com/search?q={query}",
    "method": "GET"
  }
}`;

function parseAddonTier(value: unknown): 1 | 2 | 3 | 4 {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (n >= 1 && n <= 4) return n as 1 | 2 | 3 | 4;
  return 2;
}

async function resolveAddonFromManifest(url: string): Promise<{
  name: string;
  version: string;
  tier: 1 | 2 | 3 | 4;
  fetched: boolean;
}> {
  const parsed = new URL(url);
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as Record<string, unknown> & {
      search?: { endpoint?: string };
    };
    const endpoint = data.search?.endpoint;
    if (typeof endpoint === 'string' && endpoint.trim()) {
      if (!isAllowedAddonSearchEndpoint(endpoint)) {
        throw new Error(
          'Manifest search.endpoint must be a public HTTPS URL (no localhost, private IPs, or file:).',
        );
      }
    }
    return {
      name:
        typeof data.name === 'string' && data.name.trim() ? data.name.trim() : parsed.hostname,
      version: typeof data.version === 'string' ? data.version : '0.0.0',
      tier: parseAddonTier(data.tier),
      fetched: true,
    };
  } catch (e) {
    if (e instanceof Error && e.message.includes('search.endpoint')) throw e;
    return { name: parsed.hostname, version: '0.0.0', tier: 2, fetched: false };
  }
}

const BACKEND_URL_KEY = 'sandbox_tier34_backend_url';

function addonStatusBadgeClass(status: AddonStatus): string {
  if (status === 'ACTIVE') return 'theme-badge';
  if (status === 'STUBBED') return 'text-amber-500/90 border-amber-500/40 bg-amber-500/5';
  return 'text-[var(--text-dim)] border-[var(--border)]';
}

function addonStatusLabel(
  status: AddonStatus,
  t: (key: string) => string,
): string {
  if (status === 'STUBBED') return t('settings.addons.statusExperimental');
  if (status === 'ACTIVE') return t('settings.addons.statusActive');
  return t('settings.addons.statusDisabled');
}

function openAcquisitionKeysPanel(
  setActiveTab: (tab: SettingsTab) => void,
  setMobileDrill: (tab: SettingsTab | null) => void,
  setShowAcquisitionKeys: (v: boolean) => void,
  setPendingSettingsAnchor: (id: string | null) => void,
  isMobileLayout: boolean,
): void {
  setActiveTab('addons');
  if (isMobileLayout) setMobileDrill('addons');
  setShowAcquisitionKeys(true);
  setPendingSettingsAnchor(SETTINGS_SEARCH_ANCHORS.addonsAcquisition);
}

const SOVEREIGN_SERVICE_ORDER: SovereignServiceId[] = [
  'tier34',
  'meilisearch',
  'ytdlp',
  'dlna',
  'connect',
  'lockerSync',
];

function findSovereignChangedServices(
  before: SovereignSystemSnapshot,
  after: SovereignSystemSnapshot,
): SovereignServiceId[] {
  return SOVEREIGN_SERVICE_ORDER.filter((id) => {
    const prev = before.services[id];
    const next = after.services[id];
    return (
      prev.state !== next.state ||
      prev.failureReason !== next.failureReason ||
      prev.checkedAt !== next.checkedAt
    );
  });
}

function loadStr(key: string, fallback: string): string {
  return prefsGetItem(key) ?? fallback;
}

function loadBool(key: string, fallback: boolean): boolean {
  const v = prefsGetItem(key);
  if (v === null) return fallback;
  return v === 'true';
}

const accentStyle = { color: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))' };
const accentBorder = { borderColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))' };
const accentBgSoft = {
  backgroundColor: 'hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.12)',
};

const SONIC_OUTPUT_OVERRIDE_OPTIONS: SonicOutputOverride[] = [
  'auto',
  'speaker',
  'headphones',
  'line-out',
];

function sonicRouteLabel(route: SonicOutputRoute, t: (key: string) => string): string {
  switch (route) {
    case 'phone-speaker':
      return t('settings.playback.sonicRoutePhoneSpeaker');
    case 'wired-headphones':
      return t('settings.playback.sonicRouteWired');
    case 'bluetooth':
      return t('settings.playback.sonicRouteBluetooth');
    case 'tv-hdmi':
      return t('settings.playback.sonicRouteTv');
    case 'laptop':
      return t('settings.playback.sonicRouteLaptop');
    case 'pc-speaker':
      return t('settings.playback.sonicRoutePcSpeaker');
    case 'line-out':
      return t('settings.playback.sonicRouteLineOut');
    default:
      return t('settings.playback.sonicRouteUnknown');
  }
}

function sonicOverrideLabel(override: SonicOutputOverride, t: (key: string) => string): string {
  switch (override) {
    case 'speaker':
      return t('settings.playback.sonicOutputOverrideSpeaker');
    case 'headphones':
      return t('settings.playback.sonicOutputOverrideHeadphones');
    case 'line-out':
      return t('settings.playback.sonicOutputOverrideLineOut');
    default:
      return t('settings.playback.sonicOutputOverrideAuto');
  }
}

export interface SettingsViewProps {
  profileName: string;
  onSignOut: () => void;
  onProAudioChange?: (enabled: boolean) => void;
  onPodcastsChange?: (enabled: boolean) => void;
  onAudiobooksChange?: (enabled: boolean) => void;
  onDiscoverChange?: (enabled: boolean) => void;
  onLibraryChange?: (enabled: boolean) => void;
  onSonicLockerChange?: (enabled: boolean) => void;
  onOpenListening?: () => void;
  initialTab?: SettingsTab;
  onMobileDrillChange?: (tab: SettingsTab | null) => void;
  settingsDrillBackRef?: React.MutableRefObject<(() => boolean) | null>;
  downloadTierPreference?: DownloadTierPreference;
  onDownloadTierChange?: (tier: DownloadTierPreference) => void;
}

export default function SettingsView({
  profileName,
  onSignOut,
  onProAudioChange,
  onPodcastsChange,
  onAudiobooksChange,
  onDiscoverChange,
  onLibraryChange,
  onSonicLockerChange,
  onOpenListening,
  initialTab,
  onMobileDrillChange,
  settingsDrillBackRef,
  downloadTierPreference = 'best',
  onDownloadTierChange,
}: SettingsViewProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab ?? 'fidelity');
  const isMobileLayout = useNarrowViewport(767);
  const [mobileDrill, setMobileDrill] = useState<SettingsTab | null>(null);
  const [settingsSearchQuery, setSettingsSearchQuery] = useState('');
  const settingsSearchInputRef = useRef<HTMLInputElement>(null);
  const [pendingSettingsAnchor, setPendingSettingsAnchor] = useState<string | null>(null);
  const [capacity, setCapacity] = useState<DeviceCapacity>(loadDeviceCapacity);
  const [fidelity, setFidelity] = useState<FidelityPolicy>(loadFidelityPolicy);
  const [castMode, setCastMode] = useState<CinemaCastMode>(getCinemaCastMode);
  const [castDevice, setCastDevice] = useState<string | null>(getCastDeviceName);
  const [castRequesting, setCastRequesting] = useState(false);
  const [networkScanning, setNetworkScanning] = useState(false);
  const [networkDevices, setNetworkDevices] = useState<CastDevice[]>(() => loadLastCastScan());
  const [networkScanError, setNetworkScanError] = useState<string | null>(null);
  const [defaultCastDeviceId, setDefaultCastDeviceId] = useState(
    () => loadDefaultCastDevice()?.id ?? '',
  );
  const [autoCastOnOpen, setAutoCastOnOpen] = useState(loadAutoCastEnabled);
  const [castError, setCastError] = useState<string | null>(null);
  const castSdkAvailable = isCastSdkSupported();
  const castBlockedMessage = getCastUnsupportedMessage();
  const showCastBrowserWorkaround = canOpenCastInBrowser();
  const [tauriCastGuidanceDismissed, setTauriCastGuidanceDismissed] = useState(
    () => !shouldShowTauriCastGuidancePanel(),
  );
  useEffect(() => {
    warmCastSdk();
    return subscribeCastSession((mode) => {
      setCastMode(mode);
      setCastDevice(getCastDeviceName());
    });
  }, []);

  const [isProAudio, setIsProAudio] = useState(() => loadBool(PRO_AUDIO_KEY, false));
  const [podcastsEnabled, setPodcastsEnabled] = useState(loadPodcastsEnabled);
  const [audiobooksEnabled, setAudiobooksEnabled] = useState(loadAudiobooksEnabled);
  const [podcastWifiOnlyAutoSave, setPodcastWifiOnlyAutoSave] = useState(
    loadPodcastAutoDownloadWifiOnly,
  );
  const [podcastSeekInterval, setPodcastSeekInterval] = useState(
    loadPodcastSeekIntervalSeconds,
  );
  const [discoverStationEnabled, setDiscoverStationEnabled] = useState(loadDiscoverStationEnabled);
  const [libraryStationEnabled, setLibraryStationEnabled] = useState(loadLibraryStationEnabled);
  const [sonicLockerEnabled, setSonicLockerEnabled] = useState(loadSonicLockerStationEnabled);
  const [lockerAutoFollowEnabled, setLockerAutoFollowEnabled] = useState(loadLockerAutoFollowEnabled);
  const [followedReleaseNotifEnabled, setFollowedReleaseNotifEnabled] = useState(
    loadFollowedReleaseNotifEnabled,
  );
  const [gapless, setGapless] = useState(loadGaplessEnabled);
  const [batterySaver, setBatterySaver] = useState(loadBatterySaverEnabled);
  const [crossfade, setCrossfade] = useState(loadCrossfadeEnabled);
  const [scrobbleSettings, setScrobbleSettings] = useState(loadScrobbleSettings);
  const [networkSync, setNetworkSync] = useState(loadNetworkSyncEnabled);
  const [connectRole, setConnectRole] = useState<ConnectRolePref>(loadConnectRolePref);
  const [connectDeviceName, setConnectDeviceName] = useState(loadConnectDeviceName);
  const [connectWizardOpen, setConnectWizardOpen] = useState(false);
  const [lockerUsageBytes, setLockerUsageBytes] = useState(0);
  const [lockerTrackCount, setLockerTrackCount] = useState(0);
  const [durabilityReport, setDurabilityReport] =
    useState<OfflineLibraryDurabilityReport | null>(null);
  const [flushVaultConfirmOpen, setFlushVaultConfirmOpen] = useState(false);
  const [flushVaultBusy, setFlushVaultBusy] = useState(false);
  const [flushVaultSuccessOpen, setFlushVaultSuccessOpen] = useState(false);
  const [streamCacheEnabled, setStreamCacheEnabled] = useState(loadStreamCacheEnabled);
  const [streamCacheLimitMb, setStreamCacheLimitMb] = useState(loadStreamCacheLimitMb);
  const [aggressiveCacheEnabled, setAggressiveCacheEnabled] = useState(
    loadAggressiveOfflineCacheEnabled,
  );
  const [aggressiveCacheMaxMb, setAggressiveCacheMaxMb] = useState(loadAggressiveCacheMaxMb);
  const [streamCacheUsageBytes, setStreamCacheUsageBytes] = useState(0);
  const [streamCacheTrackCount, setStreamCacheTrackCount] = useState(0);
  const [resolutionServerReachable, setResolutionServerReachable] = useState(
    () => isServerReachableCached(),
  );
  const [resolutionUriCache, setResolutionUriCache] = useState(() => getUriCacheStats());
  const [resolutionResolvers, setResolutionResolvers] = useState(() => getMobileResolvers());
  const [lastResolved, setLastResolved] = useState(() => getLastResolvedSource());
  const [sandboxServerDownloadToLocker, setSandboxServerDownloadToLocker] = useState(
    loadSandboxServerDownloadToLocker,
  );
  const [deviceFingerprint, setDeviceFingerprint] = useState<string | null>(null);
  const [themeTone, setThemeTone] = useState(() => resolveThemeTone());
  const [accentHex, setAccentHex] = useState(() => loadStr(ACCENT_HEX_KEY, FOCUS_ACCENT_HEX));
  const [borderRadius, setBorderRadius] = useState(() => loadStr(RADIUS_KEY, '12px'));
  const [cardScale, setCardScale] = useState(() => {
    const s = prefsGetItem(CARD_SCALE_KEY);
    return s ? parseFloat(s) : 1;
  });

  const initialTheme = loadEngineTheme();
  const [hue, setHue] = useState(initialTheme.h);
  const [accentS, setAccentS] = useState(initialTheme.s);
  const [accentL, setAccentL] = useState(initialTheme.l);
  const [intensity, setIntensity] = useState<IntensityId>(initialTheme.intensity);
  const [language, setLanguage] = useState<AppLanguage>(() => loadLanguage());
  const engineSettings = loadPlaybackEngineSettings();
  const [backendUrl, setBackendUrl] = useState(() =>
    loadStr(
      BACKEND_URL_KEY,
      isCapacitorNative() || isTauri() ? '' : 'http://localhost:3001',
    ),
  );
  const [prowlarrUrl, setProwlarrUrl] = useState(engineSettings.prowlarrUrl);
  const [prowlarrApiKey, setProwlarrApiKey] = useState(engineSettings.prowlarrApiKey);
  const [realDebridApiKey, setRealDebridApiKey] = useState(engineSettings.realDebridApiKey);
  const [discogsApiToken, setDiscogsApiToken] = useState(engineSettings.discogsApiToken);
  const [addonUrl, setAddonUrl] = useState('');
  const [installedAddons, setInstalledAddons] = useState<SandboxAddon[]>(() => {
    ensureBuiltinAddons();
    return loadAddons();
  });
  const [cacheTick, setCacheTick] = useState(0);
  const [tier34Ok, setTier34Ok] = useState<boolean | null>(null);
  const [ingestionWatch, setIngestionWatch] = useState<IngestionWatchStatus | null>(null);
  const [tier34StorageInfo, setTier34StorageInfo] = useState<Tier34StorageInfo | null>(null);
  const [watchPathInput, setWatchPathInput] = useState('');
  const [watchSaving, setWatchSaving] = useState(false);
  const [watchStatusMsg, setWatchStatusMsg] = useState('');
  const [security, setSecurity] = useState<SecuritySettings>(() => loadSecuritySettings());
  const [deviceSecretSyncEnabled, setDeviceSecretSyncEnabled] = useState(() =>
    loadDeviceSyncEnabled(),
  );
  const [defenseProtocolBusy, setDefenseProtocolBusy] = useState(false);
  const [showAcquisitionKeys, setShowAcquisitionKeys] = useState(false);
  const [advancedNavOpen, setAdvancedNavOpen] = useState(false);
  const [ytdlpTest, setYtdlpTest] = useState<string | null>(null);
  const [prowlarrTest, setProwlarrTest] = useState<string | null>(null);
  const [rdTest, setRdTest] = useState<string | null>(null);
  const [indexerStatus, setIndexerStatus] = useState<SandboxIndexerStatus | null>(null);
  const [indexerTest, setIndexerTest] = useState<string | null>(null);
  const [torznabConfigJson, setTorznabConfigJson] = useState('[]');
  const [torznabSaving, setTorznabSaving] = useState(false);
  const [tierLogTick, setTierLogTick] = useState(0);
  const [meiliStatus, setMeiliStatus] = useState<string | null>(null);
  const [meiliReindexing, setMeiliReindexing] = useState(false);
  const [sovereignSnapshot, setSovereignSnapshot] = useState<SovereignSystemSnapshot | null>(null);
  const sovereignSnapshotRef = useRef<SovereignSystemSnapshot | null>(null);
  const sovereignHighlightTimerRef = useRef<number | null>(null);
  const [sovereignRefreshing, setSovereignRefreshing] = useState(false);
  const [sovereignRefreshSummary, setSovereignRefreshSummary] = useState('');
  const [sovereignRefreshIsError, setSovereignRefreshIsError] = useState(false);
  const [sovereignChangedIds, setSovereignChangedIds] = useState<SovereignServiceId[]>([]);
  const [cacheClearMessage, setCacheClearMessage] = useState('');
  const [pendingValidationRun, setPendingValidationRun] = useState(false);
  const [dlnaSettings, setDlnaSettings] = useState<Tier34DlnaSettings | null>(null);
  const [dlnaSaving, setDlnaSaving] = useState(false);
  const [graphStats, setGraphStats] = useState<MediaGraphStats | null>(null);
  const [playbackDiagTick, setPlaybackDiagTick] = useState(0);
  const [sleepTimerTick, setSleepTimerTick] = useState(0);
  const [carModeTick, setCarModeTick] = useState(0);
  const [carAutoOffer, setCarAutoOffer] = useState(loadCarModeAutoOffer);
  const [androidMiniPlayerMode, setAndroidMiniPlayerMode] = useState(loadAndroidMiniPlayerMode);
  const [androidNativePlayback, setAndroidNativePlayback] = useState(loadAndroidNativePlaybackEnabled);
  const [androidWebViewCrossfade, setAndroidWebViewCrossfade] = useState(
    loadAndroidWebViewCrossfadeEnabled,
  );
  const [androidUsbBitPerfect, setAndroidUsbBitPerfect] = useState(loadAndroidUsbBitPerfectEnabled);
  const [androidWiredDacStability, setAndroidWiredDacStability] = useState(
    loadAndroidWiredDacStabilityEnabled,
  );
  const [androidUsbBitPerfectProbe, setAndroidUsbBitPerfectProbe] = useState<{
    available: boolean;
    usbDacConnected: boolean;
    active: boolean;
  } | null>(null);
  const [androidNativePlaybackStatus, setAndroidNativePlaybackStatus] =
    useState<NativeExoPlaybackStatus | null>(null);
  const [androidAudioRoute, setAndroidAudioRoute] = useState<AndroidAudioOutputRoute>('unknown');
  const [sandboxSonicEnabled, setSandboxSonicEnabled] = useState(loadSandboxSonicEnabled);
  const [earSafeListening, setEarSafeListening] = useState(loadEarSafeListeningEnabled);
  const [sonicOutputRoute, setSonicOutputRoute] = useState<SonicOutputRoute>(
    () => getCachedSonicOutputRoute(),
  );
  const [sonicOutputOverride, setSonicOutputOverride] = useState(loadSonicOutputOverride);
  const [sandboxSpatialEnabled, setSandboxSpatialEnabled] = useState(loadSandboxSpatialEnabled);
  const [spatialWidthPct, setSpatialWidthPct] = useState(() =>
    Math.round(loadSandboxSpatialWidth() * 100),
  );
  const [sonicPeqPresetId, setSonicPeqPresetId] = useState(loadSonicPeqPresetId);
  const [sonicRouteResolution, setSonicRouteResolution] = useState<SonicRouteResolution>(
    getSonicRouteResolution,
  );
  const [audiophileEnabled, setAudiophileEnabled] = useState(loadAudiophileEnabled);
  const [audiophileDeviceId, setAudiophileDeviceId] = useState(
    () => loadAudiophileDeviceId() ?? '',
  );
  const [audiophileExclusive, setAudiophileExclusive] = useState(loadAudiophileExclusiveMode);
  const [audiophileDevices, setAudiophileDevices] = useState<AudioOutputDevice[]>([]);
  const [audiophilePlatform, setAudiophilePlatform] = useState<AudiophilePlatformSupport | null>(
    null,
  );
  const [nativePlaybackDiag, setNativePlaybackDiag] = useState<NativePlaybackStatus | null>(null);
  const [audiophileDiagTick, setAudiophileDiagTick] = useState(0);
  const [airGapEnabled, setAirGapEnabled] = useState(isAirGapEnabled);
  const [lanPartyEnabled, setLanPartyEnabled] = useState(isLanPartyMode);
  const [djAudioRouting, setDjAudioRouting] = useState(isDjAudioRoutingEnabled);
  const [demucsAvailable, setDemucsAvailable] = useState<boolean | null>(null);
  const [validationReport, setValidationReport] = useState<ValidationReport | null>(null);
  const [validationRunning, setValidationRunning] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [platformDiag] = useState<SandboxPlatformDiagnostics>(() => getPlatformDiagnostics());

  useEffect(() => {
    if (!initialTab) return;
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (!isMobileLayout) setMobileDrill(null);
  }, [isMobileLayout]);

  useEffect(() => {
    onMobileDrillChange?.(mobileDrill);
  }, [mobileDrill, onMobileDrillChange]);

  useEffect(() => {
    if (!settingsDrillBackRef) return;
    settingsDrillBackRef.current = () => {
      if (mobileDrill === null) return false;
      setMobileDrill(null);
      return true;
    };
    return () => {
      settingsDrillBackRef.current = null;
    };
  }, [mobileDrill, settingsDrillBackRef]);

  const refreshLockerUsage = useCallback(() => {
    void getLockerStorageUsage().then(({ bytes, trackCount }) => {
      setLockerUsageBytes(bytes);
      setLockerTrackCount(trackCount);
    });
    void getOfflineLibraryDurabilityReport().then(setDurabilityReport).catch(() => {
      setDurabilityReport(null);
    });
  }, []);

  const refreshStreamCacheUsage = useCallback(() => {
    void getStreamCacheUsage().then(({ bytes, trackCount }) => {
      setStreamCacheUsageBytes(bytes);
      setStreamCacheTrackCount(trackCount);
    });
  }, []);

  useEffect(() => {
    refreshLockerUsage();
    return subscribeLockerCache(refreshLockerUsage);
  }, [refreshLockerUsage]);

  useEffect(() => {
    refreshStreamCacheUsage();
    return subscribeStreamCache(refreshStreamCacheUsage);
  }, [refreshStreamCacheUsage]);

  useEffect(() => {
    const syncResolution = () => {
      setResolutionServerReachable(isServerReachableCached());
      setResolutionUriCache(getUriCacheStats());
      setResolutionResolvers(getMobileResolvers());
      setLastResolved(getLastResolvedSource());
    };
    syncResolution();
    void refreshTier34Reachability().then((ok) => setResolutionServerReachable(ok));
    window.addEventListener('sandbox-resolution-change', syncResolution);
    window.addEventListener('sandbox-settings-change', syncResolution);
    return () => {
      window.removeEventListener('sandbox-resolution-change', syncResolution);
      window.removeEventListener('sandbox-settings-change', syncResolution);
    };
  }, [backendUrl, cacheTick]);

  useEffect(() => {
    void tier34HealthOk().then(setTier34Ok);
    void tier34HealthStatus().then((s) => {
      setMeiliStatus(
        s.ok
          ? s.meilisearch
            ? t('settings.addons.lockerSearchOnline')
            : t('settings.addons.lockerSearchOfflineOptional')
          : t('settings.addons.lockerSearchServerOffline'),
      );
    });
  }, [backendUrl, cacheTick, t]);

  useEffect(() => {
    if (!tier34Ok) return;
    void tier34GetDlnaSettings().then(setDlnaSettings);
  }, [tier34Ok, cacheTick, backendUrl]);

  useEffect(() => {
    if (!tier34Ok) {
      setDemucsAvailable(null);
      return;
    }
    void fetchStemCapabilities().then((caps) => setDemucsAvailable(caps?.demucsAvailable ?? false));
  }, [tier34Ok, cacheTick, backendUrl]);

  useEffect(() => {
    if (!tier34Ok) return;
    void tier34GetIngestionWatch().then((status) => {
      if (status) {
        setIngestionWatch(status);
        setWatchPathInput('');
      }
    });
    void tier34GetStorageInfo().then(setTier34StorageInfo);
  }, [tier34Ok, backendUrl, cacheTick]);

  useEffect(() => {
    if (!tier34Ok) {
      setIndexerStatus(null);
      return;
    }
    void tier34IndexerStatus().then((status) => {
      setIndexerStatus(status);
      if (status?.torznabEndpoints) {
        setTorznabConfigJson(JSON.stringify(status.torznabEndpoints, null, 2));
      }
    });
  }, [tier34Ok, backendUrl, cacheTick]);

  useEffect(() => {
    if (activeTab !== 'security' || !tier34Ok) return;
    void tier34GetDefenseProtocol().then((status) => {
      if (status && typeof status.enabled === 'boolean') {
        setSecurity((prev) => ({ ...prev, defenseProtocol: status.enabled }));
        saveSecuritySettings({ defenseProtocol: status.enabled });
      }
    });
  }, [activeTab, tier34Ok, backendUrl, cacheTick]);

  useEffect(() => {
    void tier34MediaGraphStats().then(setGraphStats);
  }, [activeTab, tier34Ok, cacheTick]);

  useEffect(() => {
    return subscribeTierResolutionLog(() => setTierLogTick((t) => t + 1));
  }, []);

  useEffect(() => {
    return subscribePlaybackDiagnostics(() => setPlaybackDiagTick((t) => t + 1));
  }, []);

  useEffect(() => {
    return subscribeSleepTimer(() => setSleepTimerTick((t) => t + 1));
  }, []);

  useEffect(() => {
    syncCarModeFromPrefs();
    return subscribeCarMode(() => setCarModeTick((t) => t + 1));
  }, []);

  useEffect(() => {
    return subscribeAirGap(setAirGapEnabled);
  }, []);

  useEffect(() => {
    const onSettingsChange = () => {
      setShowExperimentalIntegrations(loadShowExperimentalIntegrations());
      setHeroDisplay(loadHeroDisplayMode());
      setLanPartyEnabled(isLanPartyMode());
      setDjAudioRouting(isDjAudioRoutingEnabled());
      setBackendUrl(
        prefsGetItem(BACKEND_URL_KEY)?.trim() ??
          (isCapacitorNative() || isTauri() ? '' : 'http://localhost:3001'),
      );
    };
    window.addEventListener('sandbox-settings-change', onSettingsChange);
    return () => window.removeEventListener('sandbox-settings-change', onSettingsChange);
  }, []);

  useEffect(() => {
    if (!isAndroidNative()) return;
    void getNativeExoPlaybackStatus().then(setAndroidNativePlaybackStatus);
    void getNativeExoUsbBitPerfectSupport().then((probe) => {
      if (probe) {
        setAndroidUsbBitPerfectProbe({
          available: probe.available,
          usbDacConnected: probe.usbDacConnected,
          active: probe.active,
        });
      }
    });
  }, [androidNativePlayback, androidWebViewCrossfade, androidUsbBitPerfect]);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    void getAudiophilePlatformSupport().then((p) => {
      setAudiophilePlatform(p);
      if (!p.supported && loadAudiophileEnabled()) {
        setAudiophileEnabled(false);
        saveAudiophileEnabled(false);
        void syncAudiophileSettingsToBackend();
      }
    });
    void listAudioOutputDevices().then(setAudiophileDevices);
    void syncAudiophileSettingsToBackend();
  }, []);

  useEffect(() => {
    if (!isTauriDesktop() || !audiophileEnabled) return;
    const id = window.setInterval(() => {
      void nativePlaybackStatus()
        .then(setNativePlaybackDiag)
        .catch(() => setNativePlaybackDiag(null));
      setAudiophileDiagTick((t) => t + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [audiophileEnabled]);

  useEffect(() => {
    if (!isAndroidNative()) return;
    const refreshRoute = () => {
      void getAndroidAudioOutputRoute().then(setAndroidAudioRoute);
    };
    refreshRoute();
    const id = window.setInterval(refreshRoute, 5000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const refreshSonicRoute = () => {
      void detectSonicOutputRoute().then(() => {
        setSonicOutputRoute(getCachedSonicOutputRoute());
        setSonicRouteResolution(getSonicRouteResolution());
      });
    };
    refreshSonicRoute();
    const onSettingsChange = () => {
      setSonicOutputOverride(loadSonicOutputOverride());
      refreshSonicRoute();
    };
    window.addEventListener('sandbox-settings-change', onSettingsChange);
    const id = window.setInterval(refreshSonicRoute, 5000);
    return () => {
      window.removeEventListener('sandbox-settings-change', onSettingsChange);
      window.clearInterval(id);
    };
  }, []);

  const initialTypo = loadPlatformTypography();
  const [fontId, setFontId] = useState<PlatformFontId>(initialTypo.fontId);
  const [fontSizePx, setFontSizePx] = useState(initialTypo.sizePx);
  const [addonFilter, setAddonFilter] = useState<'installed' | 'all'>('installed');
  const [addonSearch, setAddonSearch] = useState('');
  const [addonInstalling, setAddonInstalling] = useState(false);
  const [mobileResolverUrl, setMobileResolverUrl] = useState('');
  const [mobileResolverStatus, setMobileResolverStatus] = useState('');
  const [mobileResolverInstalling, setMobileResolverInstalling] = useState(false);
  const [addonStatus, setAddonStatus] = useState('');
  const [showAddonGuide, setShowAddonGuide] = useState(false);
  const [showExperimentalIntegrations, setShowExperimentalIntegrations] = useState(
    loadShowExperimentalIntegrations,
  );
  const [lockerSync, setLockerSync] = useState(() => loadLockerSyncSettings());
  const [lockerSyncStatus, setLockerSyncStatus] = useState('');
  const [lastPlaylistSyncStats, setLastPlaylistSyncStats] = useState<PlaylistSyncMergeStats | null>(
    null,
  );
  const lockerImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onSyncComplete = (ev: Event) => {
      const detail = (ev as CustomEvent<PlaylistSyncMergeStats>).detail;
      if (!detail) return;
      setLastPlaylistSyncStats({
        playlistsImported: detail.playlistsImported ?? 0,
        playlistsMerged: detail.playlistsMerged ?? 0,
        playlistsDeleted: detail.playlistsDeleted ?? 0,
        conflictsResolved: detail.conflictsResolved ?? 0,
      });
      setLockerSync(loadLockerSyncSettings());
    };
    window.addEventListener(LOCKER_SYNC_COMPLETE_EVENT, onSyncComplete);
    return () => window.removeEventListener(LOCKER_SYNC_COMPLETE_EVENT, onSyncComplete);
  }, []);

  useEffect(() => {
    sovereignSnapshotRef.current = sovereignSnapshot;
  }, [sovereignSnapshot]);

  useEffect(() => {
    return () => {
      if (sovereignHighlightTimerRef.current !== null) {
        window.clearTimeout(sovereignHighlightTimerRef.current);
      }
    };
  }, []);

  const runSovereignStatusRefresh = useCallback(() => {
    if (sovereignHighlightTimerRef.current !== null) {
      window.clearTimeout(sovereignHighlightTimerRef.current);
    }
    setSovereignRefreshing(true);
    setSovereignRefreshSummary('');
    setSovereignRefreshIsError(false);
    setSovereignChangedIds([]);

    void checkSovereignSystemStatus({
      backendUrl,
      networkSyncEnabled: networkSync,
      dlnaSettings,
      lockerSyncSettings: lockerSync,
    })
      .then((snapshot) => {
        const previous = sovereignSnapshotRef.current;
        sovereignSnapshotRef.current = snapshot;
        setSovereignSnapshot(snapshot);

        const changed = previous ? findSovereignChangedServices(previous, snapshot) : [];
        setSovereignChangedIds(changed);

        const services = Object.values(snapshot.services);
        const online = services.filter((s) => s.state === 'online').length;
        const changedNote =
          changed.length > 0
            ? ` ${changed.length} service${changed.length === 1 ? '' : 's'} updated.`
            : ' No status changes since last check.';
        setSovereignRefreshSummary(
          `Status refreshed at ${formatSovereignCheckedAt(snapshot.checkedAt)} — ${online}/${services.length} services online.${changedNote}`,
        );

        sovereignHighlightTimerRef.current = window.setTimeout(
          () => setSovereignChangedIds([]),
          2500,
        );
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Status refresh failed';
        setSovereignRefreshSummary(msg);
        setSovereignRefreshIsError(true);
      })
      .finally(() => setSovereignRefreshing(false));
  }, [backendUrl, networkSync, dlnaSettings, lockerSync]);

  const runTier34Validation = useCallback(() => {
    setValidationRunning(true);
    setValidationError(null);
    void runTier34ValidationSuite(backendUrl)
      .then((report) => {
        setValidationReport(report);
      })
      .catch((err) => {
        setValidationError(err instanceof Error ? err.message : 'Validation run failed');
      })
      .finally(() => setValidationRunning(false));
  }, [backendUrl]);

  useEffect(() => {
    void fetchDeviceIdentity().then(setDeviceFingerprint);
  }, []);

  useEffect(() => {
    if (activeTab !== 'diagnostics' || !pendingValidationRun) return;
    setPendingValidationRun(false);
    runTier34Validation();
  }, [activeTab, pendingValidationRun, runTier34Validation]);

  useEffect(() => {
    const intervalMs = Math.round(
      SOVEREIGN_STATUS_POLL_INTERVAL_MS * batterySaverPollMultiplier(),
    );
    return startSovereignStatusPolling(
      setSovereignSnapshot,
      () => ({
        backendUrl,
        networkSyncEnabled: networkSync,
        dlnaSettings,
        lockerSyncSettings: lockerSync,
      }),
      intervalMs,
    );
  }, [backendUrl, networkSync, dlnaSettings, lockerSync, batterySaver]);

  const [searchSortOrder, setSearchSortOrder] = useState<SearchSortOrder>(loadSearchSortOrder);
  const [heroDisplay, setHeroDisplay] = useState<HeroDisplayMode>(loadHeroDisplayMode);
  const [vinylVisuals, setVinylVisuals] = useState<VinylVisualSettings>(loadVinylVisualSettings);
  const [vinylDisplayMode, setVinylDisplayMode] = useState<VinylDisplayMode>(loadVinylDisplayMode);
  const [communityPacks, setCommunityPacks] = useState<RecordPlayerAddon[]>(() => {
    migrateLegacyInstalledPacks();
    return loadInstalledCommunityPacks();
  });
  const [activeRecordPlayerAddonId, setActiveRecordPlayerAddonId] = useState(
    loadActiveRecordPlayerAddonId,
  );
  const [recordPlayerAddonUrl, setRecordPlayerAddonUrl] = useState('');
  const [recordPlayerAddonStatus, setRecordPlayerAddonStatus] = useState('');
  const [recordPlayerAddonInstalling, setRecordPlayerAddonInstalling] = useState(false);
  const [recordPlayerCatalog, setRecordPlayerCatalog] = useState<RecordPlayerCatalogEntry[] | null>(
    null,
  );
  const [recordPlayerCatalogLoading, setRecordPlayerCatalogLoading] = useState(false);
  const recordPlayerAddonUrlRef = useRef<HTMLInputElement>(null);
  const addonUrlInputRef = useRef<HTMLInputElement>(null);

  const patchVinylVisual = useCallback((patch: Partial<VinylVisualSettings>) => {
    const next = { ...vinylVisuals, ...patch };
    setVinylVisuals(next);
    saveVinylVisualSettings(next);
  }, [vinylVisuals]);

  const refreshRecordPlayerAddons = useCallback(() => {
    migrateLegacyInstalledPacks();
    setCommunityPacks(loadInstalledCommunityPacks());
    setActiveRecordPlayerAddonId(loadActiveRecordPlayerAddonId());
  }, []);

  const setActiveRecordPlayerAddon = useCallback(
    (id: string) => {
      saveActiveRecordPlayerAddonId(id);
      setActiveRecordPlayerAddonId(id);
      const addon =
        getOfficialPresets().find((a) => a.id === id) ??
        loadInstalledCommunityPacks().find((a) => a.id === id);
      setRecordPlayerAddonStatus(
        addon ? t('settings.vinyl.presetActive', { name: addon.name }) : '',
      );
    },
    [t],
  );

  const installRecordPlayerAddon = useCallback(async () => {
    const raw = recordPlayerAddonUrl.trim();
    if (!raw) {
      setRecordPlayerAddonStatus(t('settings.vinyl.installUrlRequired'));
      recordPlayerAddonUrlRef.current?.focus();
      return;
    }
    setRecordPlayerAddonInstalling(true);
    setRecordPlayerAddonStatus('');
    try {
      const addon = await installRecordPlayerAddonFromUrl(raw);
      refreshRecordPlayerAddons();
      setRecordPlayerAddonUrl('');
      setRecordPlayerAddonStatus(
        t('settings.vinyl.presetInstalled', { name: addon.name }),
      );
    } catch (e) {
      setRecordPlayerAddonStatus(
        e instanceof Error ? e.message : t('settings.vinyl.installFailed'),
      );
    } finally {
      setRecordPlayerAddonInstalling(false);
    }
  }, [recordPlayerAddonUrl, refreshRecordPlayerAddons, t]);

  const browseRecordPlayerCatalog = useCallback(async () => {
    setRecordPlayerCatalogLoading(true);
    setRecordPlayerAddonStatus('');
    try {
      const catalog = await fetchRecordPlayerCatalog();
      setRecordPlayerCatalog(catalog.packs);
    } catch (e) {
      setRecordPlayerAddonStatus(
        e instanceof Error ? e.message : t('settings.vinyl.catalogFailed'),
      );
    } finally {
      setRecordPlayerCatalogLoading(false);
    }
  }, [t]);

  const installCatalogPack = useCallback(
    async (entry: RecordPlayerCatalogEntry) => {
      setRecordPlayerAddonInstalling(true);
      setRecordPlayerAddonStatus('');
      try {
        const addon = await installRecordPlayerAddonFromUrl(entry.downloadUrl);
        refreshRecordPlayerAddons();
        setRecordPlayerAddonStatus(
          t('settings.vinyl.presetInstalled', { name: addon.name }),
        );
      } catch (e) {
        setRecordPlayerAddonStatus(
          e instanceof Error ? e.message : t('settings.vinyl.installFailed'),
        );
      } finally {
        setRecordPlayerAddonInstalling(false);
      }
    },
    [refreshRecordPlayerAddons, t],
  );

  const importRecordPlayerAddonClipboard = useCallback(async () => {
    setRecordPlayerAddonStatus('');
    try {
      const text = await navigator.clipboard.readText();
      const addon = importRecordPlayerAddonJson(text);
      refreshRecordPlayerAddons();
      setRecordPlayerAddonStatus(
        t('settings.vinyl.presetInstalled', { name: addon.name }),
      );
    } catch (e) {
      setRecordPlayerAddonStatus(
        e instanceof Error ? e.message : t('settings.vinyl.importFailed'),
      );
    }
  }, [refreshRecordPlayerAddons, t]);

  const installAddon = useCallback(async () => {
    const raw = addonUrl.trim();
    if (!raw) {
      setAddonStatus('Paste a manifest URL below, then tap Add addon.');
      addonUrlInputRef.current?.focus();
      return;
    }
    let manifestUrl: URL;
    try {
      manifestUrl = new URL(raw);
      if (manifestUrl.protocol !== 'https:') {
        throw new Error('bad protocol');
      }
    } catch {
      setAddonStatus('Enter a valid HTTPS manifest URL.');
      addonUrlInputRef.current?.focus();
      return;
    }

    if (installedAddons.some((a) => a.manifestUrl === raw)) {
      setAddonStatus('That manifest is already installed.');
      return;
    }

    setAddonInstalling(true);
    setAddonStatus('');
    try {
      const meta = await resolveAddonFromManifest(raw);
      installUserAddon({
        id: `addon-${Date.now()}`,
        name: meta.name,
        version: meta.version,
        tier: meta.tier,
        manifestUrl: raw,
      });
      setInstalledAddons(loadAddons());
      setAddonUrl('');
      setAddonStatus(
        meta.fetched
          ? `Installed ${meta.name} v${meta.version}.`
          : `Saved ${meta.name} (manifest could not be fetched — using host name).`,
      );
    } catch (e) {
      setAddonStatus(e instanceof Error ? e.message : 'Could not install addon.');
    } finally {
      setAddonInstalling(false);
    }
  }, [addonUrl, installedAddons]);

  const installMobileResolver = useCallback(async () => {
    const raw = mobileResolverUrl.trim();
    if (!raw) {
      setMobileResolverStatus('Paste a manifest URL below, then tap Register.');
      return;
    }
    setMobileResolverInstalling(true);
    setMobileResolverStatus('');
    try {
      const row = await installMobileResolverManifest(raw);
      setMobileResolverUrl('');
      setResolutionResolvers(getMobileResolvers());
      setMobileResolverStatus(`Registered ${row.name} v${row.version}.`);
    } catch (e) {
      setMobileResolverStatus(e instanceof Error ? e.message : 'Could not register resolver.');
    } finally {
      setMobileResolverInstalling(false);
    }
  }, [mobileResolverUrl]);

  useEffect(() => {
    applyEngineTheme(hue, accentS, accentL);
    applyThemeShell(themeTone);
    saveEngineTheme({ h: hue, s: accentS, l: accentL, intensity });
  }, [hue, accentS, accentL, intensity, themeTone]);

  const enterCustomTheme = () => {
    setThemeTone('Custom CSS');
    prefsSetItem(THEME_TONE_KEY, 'Custom CSS');
  };

  const setIntensityPreset = (id: IntensityId) => {
    enterCustomTheme();
    const preset = INTENSITY_PRESETS[id];
    setIntensity(id);
    setAccentS(preset.s);
    setAccentL(preset.l);
  };

  const onCapacityChange = (value: DeviceCapacity) => {
    setCapacity(value);
    saveDeviceCapacity(value);
  };

  const usagePct = capacityUsagePercent(lockerUsageBytes, capacity);
  const streamCacheUsagePct = streamCacheUsagePercent(streamCacheUsageBytes);

  const subTabs: Array<{ id: SettingsTab; label: string; icon: React.ElementType }> = [
    { id: 'fidelity', label: t('settings.tabs.fidelity'), icon: Sliders },
    { id: 'playback', label: t('settings.tabs.playback'), icon: Music },
    { id: 'vault', label: t('settings.tabs.vault'), icon: Database },
    { id: 'architect', label: t('settings.tabs.architect'), icon: Palette },
    { id: 'vinyl', label: t('settings.tabs.vinyl'), icon: Disc3 },
    { id: 'addons', label: t('settings.tabs.addons'), icon: Puzzle },
    { id: 'telemetry', label: t('settings.tabs.telemetry'), icon: Activity },
    { id: 'diagnostics', label: t('settings.tabs.diagnostics'), icon: ClipboardCheck },
    { id: 'security', label: t('settings.tabs.security'), icon: Shield },
    { id: 'about', label: t('settings.tabs.about'), icon: Info },
  ];

  const mobileCategories: SettingsCategory[] = [
    {
      id: 'fidelity',
      label: t('settings.categories.fidelity'),
      subtitle: t('settings.categories.fidelityDesc'),
      icon: Sliders,
      group: 'general',
    },
    {
      id: 'playback',
      label: t('settings.categories.playback'),
      subtitle: t('settings.categories.playbackDesc'),
      icon: Music,
      group: 'general',
    },
    {
      id: 'vault',
      label: t('settings.categories.vault'),
      subtitle: t('settings.categories.vaultDesc'),
      icon: Database,
      group: 'general',
    },
    {
      id: 'architect',
      label: t('settings.categories.architect'),
      subtitle: t('settings.categories.architectDesc'),
      icon: Palette,
      group: 'general',
    },
    {
      id: 'vinyl',
      label: t('settings.categories.vinyl'),
      subtitle: t('settings.categories.vinylDesc'),
      icon: Disc3,
      group: 'general',
    },
    {
      id: 'addons',
      label: t('settings.categories.addons'),
      subtitle: t('settings.categories.addonsDesc'),
      icon: Puzzle,
      group: 'system',
    },
    {
      id: 'telemetry',
      label: t('settings.categories.telemetry'),
      subtitle: t('settings.categories.telemetryDesc'),
      icon: Activity,
      group: 'advanced',
    },
    {
      id: 'diagnostics',
      label: t('settings.categories.diagnostics'),
      subtitle: t('settings.categories.diagnosticsDesc'),
      icon: ClipboardCheck,
      group: 'advanced',
    },
    {
      id: 'security',
      label: t('settings.categories.security'),
      subtitle: t('settings.categories.securityDesc'),
      icon: Shield,
      group: 'advanced',
    },
    {
      id: 'about',
      label: t('settings.categories.about'),
      subtitle: t('settings.categories.aboutDesc'),
      icon: Info,
      group: 'general',
    },
  ];

  const openMobileCategory = (id: SettingsCategoryId) => {
    setActiveTab(id);
    setMobileDrill(id);
  };

  const settingsStatusSnapshot = useMemo((): SettingsStatusSnapshot => ({
    fidelity,
    gapless,
    crossfade,
    capacity,
    lockerTrackCount,
    lockerSyncEnabled: lockerSync.enabled,
    themeToneLabel: themeToneDisplayLabel(themeTone, t),
    discoverEnabled: discoverStationEnabled,
    tier34Ok,
    networkSync,
    proAudio: audiophileEnabled,
  }), [
    fidelity,
    gapless,
    crossfade,
    capacity,
    lockerTrackCount,
    lockerSync.enabled,
    themeTone,
    t,
    discoverStationEnabled,
    tier34Ok,
    networkSync,
    audiophileEnabled,
  ]);

  const categoryStatusFor = useCallback(
    (id: SettingsCategoryId) => settingsCategoryStatusValue(id, settingsStatusSnapshot, t),
    [settingsStatusSnapshot, t],
  );

  const quickAccessNavItems = useMemo(
    () => [
      {
        id: 'fidelity',
        label: t('settings.quickAccess.audio'),
        value: categoryStatusFor('fidelity') ?? t('settings.status.fidelityStandard'),
        onOpen: () => openMobileCategory('fidelity'),
      },
      {
        id: 'vault',
        label: t('settings.quickAccess.storage'),
        value:
          categoryStatusFor('vault') ?? formatCapacityLabel(capacity),
        onOpen: () => openMobileCategory('vault'),
      },
      {
        id: 'architect',
        label: t('settings.quickAccess.theme'),
        value: categoryStatusFor('architect') ?? themeToneDisplayLabel(themeTone, t),
        onOpen: () => openMobileCategory('architect'),
      },
      {
        id: 'diagnostics',
        label: t('settings.quickAccess.server'),
        value:
          categoryStatusFor('diagnostics') ??
          (tier34Ok === true
            ? t('settings.status.serverOnline')
            : tier34Ok === false
              ? t('settings.status.serverOffline')
              : t('settings.status.healthCheck')),
        onOpen: () => openMobileCategory('diagnostics'),
      },
    ],
    [
      t,
      categoryStatusFor,
      capacity,
      themeTone,
      tier34Ok,
    ],
  );

  const mobileDrillLabel =
    mobileCategories.find((c) => c.id === mobileDrill)?.label ??
    subTabs.find((tab) => tab.id === mobileDrill)?.label ??
    t('settings.title');

  const showMobileRoot = isMobileLayout && mobileDrill === null;
  const showMobileDrill = isMobileLayout && mobileDrill !== null;
  const settingsSearchIndex = useMemo(() => buildSettingsSearchIndex(t), [t]);
  const settingsSearchResults = useMemo(
    () => filterSettingsSearch(settingsSearchIndex, settingsSearchQuery),
    [settingsSearchIndex, settingsSearchQuery],
  );
  const isSettingsSearching = settingsSearchQuery.trim().length > 0;

  const handleSettingsSearchSelect = (item: SettingsSearchItem) => {
    setActiveTab(item.categoryId);
    if (isMobileLayout) setMobileDrill(item.categoryId);
    setSettingsSearchQuery('');
    if (item.anchorId) setPendingSettingsAnchor(item.anchorId);
  };

  useEffect(() => {
    if (!pendingSettingsAnchor) return;
    const anchorId = pendingSettingsAnchor;
    const timer = window.setTimeout(() => {
      const anchor = document.querySelector(`[data-settings-anchor="${anchorId}"]`);
      if (anchor) {
        anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const section = anchor.closest('.settings-anchor-section');
        if (section) {
          section.classList.add('settings-anchor--highlight');
          window.setTimeout(() => section.classList.remove('settings-anchor--highlight'), 2000);
        }
      }
      setPendingSettingsAnchor(null);
    }, 100);
    return () => window.clearTimeout(timer);
  }, [pendingSettingsAnchor, activeTab, mobileDrill]);

  useEffect(() => {
    const isEditableTarget = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      return (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        (el as HTMLElement).isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(document.activeElement) && e.key !== 'Escape') return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        settingsSearchInputRef.current?.focus();
        settingsSearchInputRef.current?.select();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        settingsSearchInputRef.current?.focus();
        settingsSearchInputRef.current?.select();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const validationStatusClass = (status: 'pass' | 'fail' | 'skip'): string => {
    if (status === 'pass') return 'text-accent border-accent/40';
    if (status === 'fail') return 'text-red-400 border-red-400/40';
    return 'text-[var(--text-dim)] border-[var(--border)]';
  };

  const validationOverallClass = (overall: ValidationReport['overall']): string => {
    if (overall === 'pass') return 'text-accent border-accent/50';
    if (overall === 'partial') return 'text-amber-400 border-amber-400/50';
    return 'text-red-400 border-red-400/50';
  };

  const cacheEntries = getSearchCacheSnapshot();
  const providerScores = searchFeedback.getAllScores();

  const cardStyle = {
    backgroundColor: C.bg,
    borderColor: C.border,
    borderRadius,
  };

  return (
    <>
    <div
      className={`settings-view settings-page${isMobileLayout ? ' settings-view--mobile' : ''}`}
    >
      {showMobileDrill ? (
        <header className="settings-mobile-toolbar settings-mobile-toolbar--sticky">
          <button
            type="button"
            className="settings-mobile-back touch-manipulation"
            onClick={() => setMobileDrill(null)}
            aria-label={t('settings.back')}
          >
            <ChevronLeft className="w-6 h-6" aria-hidden />
          </button>
          <h1 className="settings-mobile-toolbar-title">{mobileDrillLabel}</h1>
        </header>
      ) : showMobileRoot ? (
        <header className="settings-mobile-title-header">
          <h1 className="settings-mobile-page-title">{t('settings.title')}</h1>
        </header>
      ) : (
        <header className="settings-header">
          <p className="font-mono text-[9px] uppercase tracking-[0.3em] mb-1" style={accentStyle}>
            {t('settings.controlPanel')}
          </p>
          <h2 className="font-display text-2xl sm:text-3xl font-black uppercase tracking-tight">
            {t('settings.title')}
          </h2>
          <p className="font-mono text-xs mt-1" style={{ color: C.textMid }}>
            {t('settings.subtitle')}
          </p>
        </header>
      )}

      <div
        className={`settings-shell${isMobileLayout ? ' settings-shell--mobile' : ''}${showMobileDrill ? ' settings-shell--mobile-drill' : ''}`}
      >
        <div className="settings-search-wrap">
          <SettingsSearchBar
            inputRef={settingsSearchInputRef}
            value={settingsSearchQuery}
            onChange={setSettingsSearchQuery}
            placeholder={t('settings.mobileSearch')}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                setSettingsSearchQuery('');
                settingsSearchInputRef.current?.blur();
              }
            }}
          />
        </div>

        {isSettingsSearching ? (
          <SettingsSearchResults
            items={settingsSearchResults}
            emptyLabel={t('settings.searchEmpty')}
            onSelect={handleSettingsSearchSelect}
          />
        ) : (
          <>
        {!isMobileLayout ? (
          <SettingsDesktopNav
            categories={mobileCategories}
            activeTab={activeTab}
            onSelect={setActiveTab}
            groupLabels={{
              general: t('settings.groups.general'),
              system: t('settings.groups.system'),
              advanced: t('settings.groups.advanced'),
            }}
            statusFor={categoryStatusFor}
            advancedOpen={advancedNavOpen}
            onAdvancedOpenChange={setAdvancedNavOpen}
            advancedToggleLabel={t('settings.desktopAdvancedToggle')}
          />
        ) : null}

        {showMobileRoot ? (
          <>
            <SettingsProfileHeader
              profileName={profileName}
              onSignOut={onSignOut}
              profileLabel={t('settings.profile')}
              signOutLabel={t('settings.signOut')}
            />
            <SettingsQuickAccess
              title={t('settings.quickAccess.title')}
              navItems={quickAccessNavItems}
              gaplessLabel={t('settings.playback.gaplessLabel')}
              gaplessDescription={t('settings.playback.gaplessDesc')}
              gaplessChecked={gapless}
              onGaplessChange={(v) => {
                setGapless(v);
                saveGaplessEnabled(v);
              }}
              crossfadeLabel={t('settings.playback.crossfadeLabel')}
              crossfadeDescription={t('settings.playback.crossfadeDesc')}
              crossfadeChecked={crossfade}
              onCrossfadeChange={(v) => {
                setCrossfade(v);
                saveCrossfadeEnabled(v);
              }}
            />
            <SettingsMobileRoot
              categories={mobileCategories}
              onSelect={openMobileCategory}
              groupLabels={{
                general: t('settings.groups.general'),
                system: t('settings.groups.system'),
                advanced: t('settings.groups.advanced'),
              }}
              statusFor={categoryStatusFor}
            />
          </>
        ) : (
        <div
          className={`settings-content${isMobileLayout ? ' settings-content--mobile-detail' : ''}`}
        >
          {activeTab === 'fidelity' && (
            <div className="space-y-6">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.fidelityQuality} />
                <p className="ui-subsection-title">
                  {t('settings.fidelity.title')}
                </p>
                <p className="ui-hint ui-hint--desc mt-1">
                  {t('settings.fidelity.hint')}
                </p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {(
                  [
                    { key: 'STANDARD', label: t('settings.fidelity.standard'), desc: t('settings.fidelity.standardDesc') },
                    { key: 'HIGH', label: t('settings.fidelity.high'), desc: t('settings.fidelity.highDesc') },
                    { key: 'LOSSLESS', label: t('settings.fidelity.lossless'), desc: t('settings.fidelity.losslessDesc') },
                  ] as const
                ).map((mode) => (
                  <button
                    key={mode.key}
                    type="button"
                    onClick={() => {
                      setFidelity(mode.key);
                      saveFidelityPolicy(mode.key);
                    }}
                    className={`p-4 text-left border min-h-[96px] flex flex-col justify-between touch-manipulation fidelity-card ${
                      fidelity === mode.key ? 'fidelity-card--selected' : 'fidelity-card--unselected'
                    }`}
                    style={cardStyle}
                  >
                    <span className="fidelity-card-label font-display font-semibold text-sm">
                      {mode.label}
                    </span>
                    <span className="fidelity-card-desc ui-hint--desc mt-2 block">
                      {mode.desc}
                    </span>
                  </button>
                ))}
              </div>
              <div className="settings-anchor-section border-t pt-4 space-y-3" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.fidelityCast} />
                <p className="ui-subsection-title">
                  {t('settings.fidelity.castTitle')}
                </p>
                <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                  <div>
                    <p className="font-mono text-xs font-semibold text-[var(--text)]">
                      {t('settings.fidelity.castSectionTitle')}
                    </p>
                    <p className="ui-hint">
                      {t('settings.fidelity.castHint', {
                        customReceiver: hasCustomCastReceiver()
                          ? t('settings.fidelity.castCustomReceiverSuffix')
                          : '',
                      })}
                    </p>
                  </div>
                  {isTauriDesktop() ? (
                    <div className="space-y-2">
                      {!tauriCastGuidanceDismissed ? (
                        <TauriCastGuidancePanel
                          onDismiss={() => setTauriCastGuidanceDismissed(true)}
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() =>
                              void openCastInExternalBrowser({ browser: loadCastBrowserChoice() })
                            }
                            className="inline-flex items-center gap-2 px-4 py-1.5 font-mono text-[10px] uppercase font-bold border touch-manipulation text-accent"
                            style={{ borderRadius, ...accentBorder, ...accentBgSoft }}
                          >
                            <Cast className="w-3.5 h-3.5" strokeWidth={2} />
                            {t('settings.fidelity.castOpenBrowser')}
                          </button>
                          <p className="ui-hint text-[var(--text-dim)]">
                            {t('settings.fidelity.castOpensUrl', { url: getCastBrowserUrl() })}
                          </p>
                        </>
                      )}
                    </div>
                  ) : castSdkAvailable ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {castMode !== 'remote_cast' ? (
                        <button
                          type="button"
                          disabled={castRequesting}
                          onClick={() => {
                            setCastRequesting(true);
                            setCastError(null);
                            void requestCinemaCast()
                              .then((result) => {
                                if (!result.ok) setCastError(result.error ?? t('settings.fidelity.castFailed'));
                              })
                              .finally(() => setCastRequesting(false));
                          }}
                          className="inline-flex items-center gap-2 px-4 py-1.5 font-mono text-[10px] uppercase font-bold border touch-manipulation"
                          style={{ borderRadius, ...accentBorder, ...accentBgSoft }}
                        >
                          {castRequesting ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                          ) : (
                            <Cast className="w-3.5 h-3.5" strokeWidth={2} />
                          )}
                          {t('settings.fidelity.castStart')}
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => stopCinemaCast()}
                            className="px-4 py-1.5 font-mono text-[10px] uppercase font-bold border touch-manipulation"
                            style={{ borderRadius, borderColor: C.border }}
                          >
                            {t('settings.fidelity.castStop')}
                          </button>
                          {castDevice ? (
                            <span className="font-mono text-[10px] uppercase text-accent">
                              {castDevice}
                            </span>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : castBlockedMessage ? (
                    <div className="space-y-2">
                      <p className="ui-hint text-[var(--danger)]">{castBlockedMessage}</p>
                      {showCastBrowserWorkaround ? (
                        <button
                          type="button"
                          onClick={() =>
                            void openCastInExternalBrowser({ browser: loadCastBrowserChoice() })
                          }
                          className="px-4 py-1.5 font-mono text-[10px] uppercase font-bold border touch-manipulation text-accent"
                          style={{ borderRadius, ...accentBorder }}
                        >
                          {t('settings.fidelity.castOpenChrome')}
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="ui-hint text-[var(--text-dim)]">
                      {t('settings.fidelity.castRequiresChrome')}
                    </p>
                  )}
                  {castError ? (
                    <p className="ui-hint text-[var(--danger)]">{castError}</p>
                  ) : null}
                  <div
                    className="flex flex-wrap items-center gap-2 pt-2 border-t"
                    style={{ borderColor: C.border }}
                  >
                    <p className="w-full font-mono text-[10px] uppercase text-[var(--text-dim)]">
                      {t('settings.fidelity.castScreenMirrorTitle')}
                    </p>
                    {castMode === 'idle' || castMode === 'remote_cast' ? (
                      <button
                        type="button"
                        onClick={() => void startScreenMirror()}
                        className="px-3 py-1.5 font-mono text-[10px] uppercase border touch-manipulation"
                        style={{ borderRadius, borderColor: C.border }}
                      >
                        {t('settings.fidelity.castMirrorOverlay')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => stopCinemaCast()}
                        className="px-3 py-1.5 font-mono text-[10px] uppercase border touch-manipulation"
                        style={{ borderRadius, borderColor: C.border }}
                      >
                        {t('settings.fidelity.castStopMirror')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openCinemaCastPopout()}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase border touch-manipulation text-[var(--text-mid)]"
                      style={{ borderRadius, borderColor: C.border }}
                    >
                      {t('settings.fidelity.castPopout')}
                    </button>
                    {castMode !== 'idle' && castMode !== 'remote_cast' ? (
                      <span className="font-mono text-[10px] uppercase text-[var(--text-dim)]">
                        {t('settings.fidelity.castActiveMode', { mode: castMode })}
                      </span>
                    ) : null}
                  </div>
                  {!hasCustomCastReceiver() ? (
                    <p className="ui-hint text-[var(--text-dim)] text-[10px]">
                      {t('settings.fidelity.customReceiverHint')}
                    </p>
                  ) : null}
                  <div
                    className="flex flex-col gap-3 pt-3 border-t"
                    style={{ borderColor: C.border }}
                  >
                    <div>
                      <p className="font-mono text-xs font-semibold text-[var(--text)]">
                        {t('settings.fidelity.networkSpeakersTitle')}
                      </p>
                      <p className="ui-hint">
                        {t('settings.fidelity.networkSpeakersHint')}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={networkScanning}
                      onClick={() => {
                        setNetworkScanning(true);
                        setNetworkScanError(null);
                        void tier34HealthOk()
                          .then(async (ok) => {
                            if (!ok) {
                              setNetworkScanError(t('settings.fidelity.castServerRequired'));
                              return;
                            }
                            const result = await tier34CastDiscover();
                            if (!result.ok) {
                              setNetworkScanError(
                                'error' in result ? result.error : t('settings.fidelity.castScanFailed'),
                              );
                              return;
                            }
                            const devices = result.data.devices;
                            setNetworkDevices(devices);
                            saveLastCastScan(devices);
                          })
                          .catch(() => {
                            setNetworkScanError(t('settings.fidelity.castServerRequired'));
                          })
                          .finally(() => setNetworkScanning(false));
                      }}
                      className="inline-flex items-center gap-2 px-4 py-1.5 font-mono text-[10px] uppercase font-bold border touch-manipulation w-fit focus-accent"
                      style={{ borderRadius, ...accentBorder, ...accentBgSoft }}
                    >
                      {networkScanning ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
                      ) : null}
                      {t('settings.fidelity.castScanSpeakers')}
                    </button>
                    {networkScanError ? (
                      <p className="ui-hint text-[var(--danger)]">{networkScanError}</p>
                    ) : null}
                    {networkDevices.length > 0 ? (
                      <ul className="space-y-1 max-h-32 overflow-y-auto music-scrollbar">
                        {networkDevices.map((d) => (
                          <li
                            key={d.id}
                            className="font-mono text-[9px] uppercase text-[var(--text-mid)] flex justify-between gap-2"
                          >
                            <span className="truncate">{d.name}</span>
                            <span className="shrink-0 text-accent">{d.type}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="ui-hint text-[var(--text-dim)]">
                        {networkScanning
                          ? t('settings.fidelity.castScanning')
                          : t('settings.fidelity.castNoScanResults')}
                      </p>
                    )}
                    <div className="space-y-2">
                      <label className="ui-field-label" htmlFor="default-cast-device">
                        {t('settings.fidelity.castDefaultDevice')}
                      </label>
                      <select
                        id="default-cast-device"
                        value={defaultCastDeviceId}
                        onChange={(e) => {
                          const id = e.target.value;
                          setDefaultCastDeviceId(id);
                          const device = networkDevices.find((d) => d.id === id) ?? null;
                          saveDefaultCastDevice(device);
                        }}
                        className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                        style={{ color: C.text }}
                      >
                        <option value="">{t('settings.fidelity.castNone')}</option>
                        {networkDevices.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} ({d.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="font-mono text-xs uppercase text-[var(--text)]">
                          {t('settings.fidelity.castAutoCastTitle')}
                        </p>
                        <p className="ui-hint text-[10px]">
                          {t('settings.fidelity.castAutoCastHint')}
                        </p>
                      </div>
                      <SandboxSwitch
                        checked={autoCastOnOpen}
                        disabled={!defaultCastDeviceId}
                        onChange={(checked) => {
                          setAutoCastOnOpen(checked);
                          saveAutoCastEnabled(checked);
                        }}
                        aria-label={t('settings.fidelity.castAutoCastAria')}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'playback' && (
            <div className="space-y-6">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackMain} />
                <p className="ui-subsection-title">
                  {t('settings.playback.title')}
                </p>
                <p className="ui-hint mt-1">
                  {t('settings.playback.hint')}
                </p>
              </div>
              {onOpenListening ? (
                <div
                  className="settings-anchor-section flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border rounded-xl"
                  style={cardStyle}
                >
                  <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackListening} />
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      YOUR LISTENING
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      Local Wrapped and listening stats — stored on this device only, never uploaded.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenListening}
                    className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation shrink-0 text-accent"
                    style={accentBorder}
                  >
                    Open insights
                  </button>
                </div>
              ) : null}
              <div className="settings-anchor-section p-4 border rounded-xl space-y-4" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackResolution} />
                <div>
                  <p className="font-mono text-sm font-semibold text-[var(--text)]">
                    {t('settings.playback.resolutionTitle')}
                  </p>
                  <p className="ui-hint ui-hint--desc mt-1">
                    {t('settings.playback.resolutionHint')}
                  </p>
                </div>
                <ul className="space-y-2 text-xs font-mono">
                  <li>
                    <span className="text-[var(--text-muted)]">{t('settings.playback.resolutionServerStatus')}: </span>
                    {getTier34BaseUrl().trim()
                      ? resolutionServerReachable
                        ? t('settings.playback.resolutionServerOnline')
                        : t('settings.playback.resolutionServerOffline')
                      : t('settings.playback.resolutionServerUnset')}
                  </li>
                  <li>
                    <span className="text-[var(--text-muted)]">{t('settings.playback.resolutionMobileStatus')}: </span>
                    {resolutionResolvers.filter((r) => r.enabled).length > 0
                      ? t('settings.playback.resolutionMobileEnabled', {
                          count: resolutionResolvers.filter((r) => r.enabled).length,
                        })
                      : t('settings.playback.resolutionMobileNone')}
                  </li>
                  <li>
                    <span className="text-[var(--text-muted)]">{t('settings.playback.resolutionCacheStatus')}: </span>
                    {t('settings.playback.resolutionCacheEntries', {
                      valid: resolutionUriCache.validCount,
                      total: resolutionUriCache.count,
                    })}
                  </li>
                </ul>
                <div>
                  <p className="ui-field-label mb-1">{t('settings.playback.resolutionOrderTitle')}</p>
                  <p className="ui-hint ui-hint--desc mb-2">{t('settings.playback.resolutionOrderHint')}</p>
                  <ol className="list-decimal list-inside space-y-1 text-xs font-mono text-[var(--text-muted)]">
                    {getResolutionOrder().map((step: ResolutionSource) => (
                      <li key={step}>
                        {step === 'locker' && t('settings.playback.resolutionOrderLocker')}
                        {step === 'cache' && t('settings.playback.resolutionOrderCache')}
                        {step === 'server' && t('settings.playback.resolutionOrderServer')}
                        {step === 'mobile' && t('settings.playback.resolutionOrderMobile')}
                        {step === 'preview' && t('settings.playback.resolutionOrderPreview')}
                      </li>
                    ))}
                  </ol>
                </div>
                <div>
                  <p className="ui-field-label mb-1">{t('settings.playback.resolutionLastSource')}</p>
                  {lastResolved ? (
                    <p className="text-xs font-mono">
                      {t('settings.playback.resolutionLastSourceDetail', {
                        source: lastResolved.source.toUpperCase(),
                        title: lastResolved.title,
                        artist: lastResolved.artist,
                      })}
                    </p>
                  ) : (
                    <p className="ui-hint ui-hint--desc">{t('settings.playback.resolutionLastSourceEmpty')}</p>
                  )}
                </div>
                {resolutionResolvers.length > 0 ? (
                  <div className="space-y-3">
                    {resolutionResolvers.map((resolver) => (
                      <div
                        key={resolver.id}
                        className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-t pt-3"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div>
                          <p className="font-mono text-xs uppercase">{resolver.name}</p>
                          {resolver.id === 'yt-dlp-mobile' ? (
                            <p className="ui-hint ui-hint--desc">{t('settings.playback.resolutionResolverStubHint')}</p>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3">
                          <label className="flex items-center gap-2 text-xs font-mono">
                            <input
                              type="checkbox"
                              data-testid="resolver-toggle-yt-dlp-mobile"
                              checked={resolver.enabled}
                              onChange={(e) => {
                                setMobileResolverEnabled(resolver.id, e.target.checked);
                                setResolutionResolvers(getMobileResolvers());
                              }}
                              aria-label={t('settings.playback.resolutionResolverEnable', { name: resolver.name })}
                            />
                            {t('settings.playback.resolutionResolverEnable', { name: resolver.name })}
                          </label>
                          <button
                            type="button"
                            className="font-mono text-[10px] uppercase text-[var(--text-muted)]"
                            onClick={() => {
                              if (resolver.manifestUrl) {
                                removeUserMobileResolver(resolver.id);
                              } else {
                                removeMobileResolver(resolver.id);
                              }
                              setResolutionResolvers(getMobileResolvers());
                            }}
                          >
                            {t('settings.playback.resolutionResolverRemove', { name: resolver.name })}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              {(() => {
                const playbackToggles = [
                  {
                    label: t('settings.playback.gaplessLabel'),
                    desc: t('settings.playback.gaplessDesc'),
                    checked: gapless,
                    set: (v: boolean) => {
                      setGapless(v);
                      saveGaplessEnabled(v);
                    },
                  },
                  {
                    label: t('settings.playback.crossfadeLabel'),
                    desc: t('settings.playback.crossfadeDesc'),
                    checked: crossfade,
                    set: (v: boolean) => {
                      setCrossfade(v);
                      saveCrossfadeEnabled(v);
                    },
                  },
                  {
                    label: t('settings.playback.multiDeviceLabel'),
                    desc: t('settings.playback.multiDeviceDesc'),
                    checked: networkSync,
                    set: (v: boolean) => {
                      if (v && !loadConnectSetupDone()) {
                        setConnectWizardOpen(true);
                        return;
                      }
                      setNetworkSync(v);
                      saveNetworkSyncEnabled(v);
                    },
                  },
                ] as const;
                if (isMobileLayout) {
                  return (
                    <SettingsGroup>
                      {playbackToggles.map((row) => (
                        <div key={row.label} role="presentation">
                          <SettingsToggleRow
                            label={row.label}
                            description={row.desc}
                            checked={row.checked}
                            onChange={row.set}
                          />
                        </div>
                      ))}
                    </SettingsGroup>
                  );
                }
                return playbackToggles.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-center justify-between p-4 border rounded-xl"
                    style={cardStyle}
                  >
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">{row.label}</p>
                      <p className="ui-hint ui-hint--desc">
                        {row.desc}
                      </p>
                    </div>
                    <SandboxSwitch
                      checked={row.checked}
                      onChange={row.set}
                      aria-label={row.label}
                    />
                  </div>
                ));
              })()}

              <div className="settings-anchor-section p-4 border rounded-xl space-y-4" style={cardStyle}>
                <div>
                  <p className="font-mono text-sm font-semibold text-[var(--text)]">
                    {t('settings.playback.scrobbleTitle')}
                  </p>
                  <p className="ui-hint ui-hint--desc mt-1">
                    {t('settings.playback.scrobbleHint')}
                  </p>
                  {isScrobbleBlockedByAirGap() ? (
                    <p className="ui-hint ui-hint--desc mt-2 text-[var(--text-mid)]">
                      {t('settings.playback.scrobbleAirGapHint')}
                    </p>
                  ) : null}
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-[var(--text)]">
                      {t('settings.playback.scrobbleLastfmLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.scrobbleLastfmDesc')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={scrobbleSettings.lastfmEnabled}
                    onChange={(checked) => {
                      const next = { ...scrobbleSettings, lastfmEnabled: checked };
                      setScrobbleSettings(next);
                      saveScrobbleSettings({ lastfmEnabled: checked });
                    }}
                    aria-label={t('settings.playback.scrobbleLastfmLabel')}
                  />
                </div>
                {scrobbleSettings.lastfmEnabled ? (
                  <div className="space-y-2">
                    <input
                      type="password"
                      value={scrobbleSettings.lastfmApiKey}
                      placeholder={t('settings.playback.scrobbleLastfmApiKey')}
                      onChange={(e) => {
                        const next = { ...scrobbleSettings, lastfmApiKey: e.target.value };
                        setScrobbleSettings(next);
                        saveScrobbleSettings({ lastfmApiKey: e.target.value });
                      }}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs"
                      style={{ color: C.text, borderRadius }}
                    />
                    <input
                      type="text"
                      value={scrobbleSettings.lastfmUsername}
                      placeholder={t('settings.playback.scrobbleLastfmUsername')}
                      onChange={(e) => {
                        const next = { ...scrobbleSettings, lastfmUsername: e.target.value };
                        setScrobbleSettings(next);
                        saveScrobbleSettings({ lastfmUsername: e.target.value });
                      }}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs"
                      style={{ color: C.text, borderRadius }}
                    />
                    <input
                      type="password"
                      value={scrobbleSettings.lastfmSessionKey}
                      placeholder={t('settings.playback.scrobbleLastfmSessionKey')}
                      onChange={(e) => {
                        const next = { ...scrobbleSettings, lastfmSessionKey: e.target.value };
                        setScrobbleSettings(next);
                        saveScrobbleSettings({ lastfmSessionKey: e.target.value });
                      }}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs"
                      style={{ color: C.text, borderRadius }}
                    />
                    <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: C.border }}>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-accent">
                        {t('settings.playback.scrobbleLastfmSetupTitle')}
                      </p>
                      <p className="ui-hint ui-hint--desc">{t('settings.playback.scrobbleLastfmSetupStep1')}</p>
                      <p className="ui-hint ui-hint--desc">{t('settings.playback.scrobbleLastfmSetupStep2')}</p>
                      <p className="ui-hint ui-hint--desc">{t('settings.playback.scrobbleLastfmSetupStep3')}</p>
                      {scrobbleSettings.lastfmApiKey.trim() ? (
                        <a
                          href={getLastfmAuthUrl(scrobbleSettings.lastfmApiKey)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block font-mono text-[10px] uppercase tracking-wider text-accent underline"
                        >
                          {t('settings.playback.scrobbleLastfmOpenAuth')}
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-[var(--text)]">
                      {t('settings.playback.scrobbleListenbrainzLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.scrobbleListenbrainzDesc')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={scrobbleSettings.listenbrainzEnabled}
                    onChange={(checked) => {
                      const next = { ...scrobbleSettings, listenbrainzEnabled: checked };
                      setScrobbleSettings(next);
                      saveScrobbleSettings({ listenbrainzEnabled: checked });
                    }}
                    aria-label={t('settings.playback.scrobbleListenbrainzLabel')}
                  />
                </div>
                {scrobbleSettings.listenbrainzEnabled ? (
                  <input
                    type="password"
                    value={scrobbleSettings.listenbrainzToken}
                    placeholder={t('settings.playback.scrobbleListenbrainzToken')}
                    onChange={(e) => {
                      const next = { ...scrobbleSettings, listenbrainzToken: e.target.value };
                      setScrobbleSettings(next);
                      saveScrobbleSettings({ listenbrainzToken: e.target.value });
                    }}
                    className="input-elevated w-full px-4 py-3 font-mono text-xs"
                    style={{ color: C.text, borderRadius }}
                  />
                ) : null}
              </div>

              <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackSonic} />
                <div>
                  <p className="font-mono text-sm font-semibold text-[var(--text)]">
                    {t('settings.playback.sonicTitle')}
                  </p>
                  <p className="ui-hint ui-hint--desc mt-1">
                    {t('settings.playback.sonicHint')}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-[var(--text)]">
                      {t('settings.playback.sonicEnableLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.sonicEnableDesc')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={sandboxSonicEnabled}
                    onChange={(checked) => {
                      setSandboxSonicEnabled(checked);
                      saveSandboxSonicEnabled(checked);
                    }}
                    aria-label={t('settings.playback.sonicEnableLabel')}
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs font-semibold text-[var(--text)]">
                      {t('settings.playback.sonicEarSafeLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.sonicEarSafeDesc')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={earSafeListening}
                    disabled={!sandboxSonicEnabled}
                    onChange={(checked) => {
                      setEarSafeListening(checked);
                      saveEarSafeListeningEnabled(checked);
                    }}
                    aria-label={t('settings.playback.sonicEarSafeLabel')}
                  />
                </div>
                <div className="pt-2 border-t border-[var(--border)] space-y-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)]">
                      {t('settings.playback.sonicOutputOverrideLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.playback.sonicOutputOverrideHint')}
                    </p>
                  </div>
                  <div
                    className="grid grid-cols-2 sm:grid-cols-4 gap-2"
                    role="group"
                    aria-label={t('settings.playback.sonicOutputOverrideLabel')}
                  >
                    {SONIC_OUTPUT_OVERRIDE_OPTIONS.map((option) => {
                      const active = sonicOutputOverride === option;
                      return (
                        <button
                          key={option}
                          type="button"
                          disabled={!sandboxSonicEnabled}
                          onClick={() => {
                            setSonicOutputOverride(option);
                            saveSonicOutputOverride(option);
                          }}
                          className={`font-mono text-[10px] uppercase tracking-wider border rounded-sm px-2 py-2 touch-manipulation transition-colors ${
                            active ? 'text-accent' : 'text-[var(--text-mid)]'
                          } ${!sandboxSonicEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          style={active ? accentBorder : undefined}
                          aria-pressed={active}
                        >
                          {sonicOverrideLabel(option, t)}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="pt-2 border-t border-[var(--border)] space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold text-[var(--text)]">
                        {t('settings.playback.spatialEnableLabel')}
                      </p>
                      <p className="ui-hint ui-hint--desc">
                        {t('settings.playback.spatialEnableDesc')}
                      </p>
                    </div>
                    <SandboxSwitch
                      checked={sandboxSpatialEnabled}
                      disabled={!sandboxSonicEnabled}
                      onChange={(checked) => {
                        setSandboxSpatialEnabled(checked);
                        saveSandboxSpatialEnabled(checked);
                      }}
                      aria-label={t('settings.playback.spatialEnableLabel')}
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)]">
                        {t('settings.playback.spatialWidthLabel')}
                      </p>
                      <span className="font-mono text-[10px] text-accent">{spatialWidthPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={spatialWidthPct}
                      disabled={!sandboxSonicEnabled || !sandboxSpatialEnabled}
                      onChange={(e) => {
                        const pct = Number(e.target.value);
                        setSpatialWidthPct(pct);
                        saveSandboxSpatialWidth(pct / 100);
                      }}
                      className="w-full accent-[var(--accent)]"
                      aria-label={t('settings.playback.spatialWidthLabel')}
                    />
                    {!isHeadphoneSonicRoute(sonicOutputRoute) ? (
                      <p className="ui-hint ui-hint--desc">
                        {t('settings.playback.spatialHeadphoneNote')}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="pt-2 border-t border-[var(--border)] space-y-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)]">
                      {t('settings.playback.peqPresetLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.playback.peqPresetHint')}
                    </p>
                  </div>
                  <div
                    className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                    role="group"
                    aria-label={t('settings.playback.peqPresetLabel')}
                  >
                    {SONIC_PEQ_PRESETS.map((preset) => {
                      const active = sonicPeqPresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={!sandboxSonicEnabled}
                          onClick={() => {
                            setSonicPeqPresetId(preset.id);
                            saveSonicPeqPresetId(preset.id);
                          }}
                          className={`font-mono text-[10px] uppercase tracking-wider border rounded-sm px-2 py-2 touch-manipulation transition-colors text-left ${
                            active ? 'text-accent' : 'text-[var(--text-mid)]'
                          } ${!sandboxSonicEnabled ? 'opacity-50 cursor-not-allowed' : ''}`}
                          style={active ? accentBorder : undefined}
                          aria-pressed={active}
                          title={preset.description}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                  <p className="ui-hint ui-hint--desc">
                    {SONIC_PEQ_PRESETS.find((p) => p.id === sonicPeqPresetId)?.description ??
                      t('settings.playback.peqPresetHint')}
                  </p>
                </div>
                <div className="pt-2 border-t border-[var(--border)] space-y-1">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)]">
                    {t('settings.playback.sonicRouteLabel')}
                  </p>
                  <p className="font-mono text-xs text-accent">
                    {isAndroidNative()
                      ? androidAudioRoute === 'speaker'
                        ? t('settings.playback.audioOutputSpeaker')
                        : androidAudioRoute === 'bluetooth'
                          ? t('settings.playback.audioOutputBluetooth')
                          : androidAudioRoute === 'wired'
                            ? t('settings.playback.audioOutputWired')
                            : t('settings.playback.audioOutputUnknown')
                      : sonicRouteResolution.isManual
                        ? t('settings.playback.sonicRouteUsingManual', {
                            route: sonicRouteLabel(sonicOutputRoute, t),
                          })
                        : t('settings.playback.sonicRouteUsingAuto', {
                            route: sonicRouteLabel(sonicRouteResolution.autoRoute, t),
                          })}
                  </p>
                  {isAndroidNative() ? (
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.sonicRouteAndroidNote')}
                    </p>
                  ) : platformDiag.isDesktopLinux || platformDiag.desktopOs === 'windows' ? (
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.sonicRouteDesktopNote')}
                    </p>
                  ) : null}
                </div>
                <p className="ui-hint ui-hint--desc">
                  {t('settings.playback.sonicCastNote')}
                </p>
              </div>

              <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackAudiophile} />
                <div>
                  <p className="font-mono text-sm font-semibold text-[var(--text)]">
                    {t('settings.playback.audiophileTitle')}
                  </p>
                  <p className="ui-hint ui-hint--desc">
                    {audiophilePlatform?.supported
                      ? audiophilePlatform.message
                      : audiophilePlatform?.message ??
                        t('settings.playback.audiophileHintUnsupported')}
                  </p>
                </div>
                {!isTauriDesktop() ? (
                  <p className="ui-hint ui-hint--desc">
                    {t('settings.playback.audiophileDesktopOnly')}
                  </p>
                ) : audiophilePlatform === null ? (
                  <p className="ui-hint ui-hint--desc">Checking platform support…</p>
                ) : !audiophilePlatform.supported ? (
                  <p className="ui-hint ui-hint--desc text-amber-500/90">
                    {audiophilePlatform.message}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-xs font-semibold text-[var(--text)]">
                          {t('settings.playback.audiophileEnableLabel')}
                        </p>
                        <p className="ui-hint ui-hint--desc">
                          {t('settings.playback.audiophileEnableDesc')}
                        </p>
                      </div>
                      <SandboxSwitch
                        checked={audiophileEnabled}
                        onChange={(checked) => {
                          setAudiophileEnabled(checked);
                          saveAudiophileEnabled(checked);
                          void syncAudiophileSettingsToBackend();
                        }}
                        aria-label={t('settings.playback.audiophileEnableAria')}
                      />
                    </div>
                    {audiophileEnabled ? (
                      <>
                        <div className="space-y-1">
                          <label
                            htmlFor="audiophile-device"
                            className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)]"
                          >
                            {t('settings.playback.audiophileOutputDevice')}
                          </label>
                          <select
                            id="audiophile-device"
                            value={audiophileDeviceId}
                            onChange={(e) => {
                              const v = e.target.value;
                              setAudiophileDeviceId(v);
                              saveAudiophileDeviceId(v || null);
                              void syncAudiophileSettingsToBackend();
                            }}
                            className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                            style={{ color: C.text }}
                          >
                            <option value="">{t('settings.playback.audiophileSystemDefault')}</option>
                            {audiophileDevices.map((d) => (
                              <option key={d.id} value={d.id}>
                                {d.name}
                                {d.isDefault ? t('settings.playback.audiophileDefaultSuffix') : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                        {audiophilePlatform?.exclusiveAvailable ? (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="font-mono text-xs font-semibold text-[var(--text)]">
                                {t('settings.playback.audiophileExclusiveLabel')}
                              </p>
                              <p className="ui-hint ui-hint--desc">
                                {t('settings.playback.audiophileExclusiveDesc')}
                              </p>
                            </div>
                            <SandboxSwitch
                              checked={audiophileExclusive}
                              onChange={(checked) => {
                                setAudiophileExclusive(checked);
                                saveAudiophileExclusiveMode(checked);
                                void syncAudiophileSettingsToBackend();
                              }}
                              aria-label={t('settings.playback.audiophileExclusiveAria')}
                            />
                          </div>
                        ) : null}
                        <div key={audiophileDiagTick} className="pt-2 border-t border-[var(--border)]">
                          <p className="font-mono text-[10px] uppercase tracking-wider text-[var(--text-mid)] mb-2">
                            {t('settings.playback.audiophileDiagTitle')}
                          </p>
                          {nativePlaybackDiag ? (
                            <ul className="font-mono text-[10px] uppercase space-y-1 text-[var(--text-mid)]">
                              <li>state: {nativePlaybackDiag.state}</li>
                              <li>
                                sample rate:{' '}
                                {nativePlaybackDiag.sampleRateHz > 0
                                  ? `${nativePlaybackDiag.sampleRateHz} Hz`
                                  : '—'}
                              </li>
                              <li>codec: {nativePlaybackDiag.codec || '—'}</li>
                              <li>
                                bit depth:{' '}
                                {nativePlaybackDiag.bitsPerSample > 0
                                  ? `${nativePlaybackDiag.bitsPerSample}-bit`
                                  : '—'}
                              </li>
                              <li>channels: {nativePlaybackDiag.channels || '—'}</li>
                              <li>
                                exclusive: {nativePlaybackDiag.exclusiveMode ? 'yes' : 'no'}
                              </li>
                              <li>
                                resampling: {nativePlaybackDiag.resampling ? 'yes' : 'no'}
                              </li>
                            </ul>
                          ) : (
                            <p className="ui-hint ui-hint--desc">{t('settings.playback.audiophileNoStream')}</p>
                          )}
                          <p className="ui-hint ui-hint--desc mt-2">
                            {t('settings.playback.audiophileDecodeNote')}
                          </p>
                        </div>
                      </>
                    ) : null}
                  </>
                )}
              </div>

              {(() => {
                void sleepTimerTick;
                const sleep = getSleepTimerSnapshot();
                const countdown = formatSleepRemaining(
                  sleep.remainingSeconds,
                  sleep.isEventBased,
                  sleep.preset,
                );
                return (
                  <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                    <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackSleep} />
                    <div className="flex items-start gap-3">
                      <div className="sleep-timer-clock-icon shrink-0 scale-90 origin-top-left">
                        <AlarmClock className="w-5 h-5" strokeWidth={1.75} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold text-[var(--text)]">
                          SLEEP TIMER
                        </p>
                        <p className="ui-hint ui-hint--desc">
                          Pause playback after a preset duration, when the current track ends, or
                          when the queue finishes.
                        </p>
                      </div>
                    </div>
                    {sleep.active ? (
                      <div className="sleep-timer-countdown-card">
                        <p className="font-mono text-[10px] uppercase tracking-widest text-accent">
                          {sleep.preset ? presetLabel(sleep.preset) : 'Active'}
                        </p>
                        <p className="sleep-timer-countdown-display font-mono tabular-nums text-2xl">
                          {countdown}
                        </p>
                        <button
                          type="button"
                          onClick={cancelSleepTimer}
                          className="sleep-timer-cancel-btn touch-manipulation max-w-xs"
                        >
                          Cancel Timer
                        </button>
                      </div>
                    ) : null}
                    <div className="sleep-timer-preset-grid">
                      {SLEEP_TIMER_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => startSleepTimer(p.id)}
                          className={`sleep-timer-preset-btn touch-manipulation ${
                            sleep.active && sleep.preset === p.id
                              ? 'sleep-timer-preset-btn--active'
                              : ''
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {isAndroidNative() ? (
                <div className="p-4 border rounded-xl space-y-2" style={cardStyle}>
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.playback.audioOutputLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.playback.audioOutputHint')}
                    </p>
                  </div>
                  <p className="font-mono text-xs text-accent">
                    {androidAudioRoute === 'speaker'
                      ? t('settings.playback.audioOutputSpeaker')
                      : androidAudioRoute === 'bluetooth'
                        ? t('settings.playback.audioOutputBluetooth')
                        : androidAudioRoute === 'wired'
                          ? t('settings.playback.audioOutputWired')
                          : t('settings.playback.audioOutputUnknown')}
                  </p>
                </div>
              ) : null}

              {isAndroidNative() ? (
                <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                  <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackMini} />
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.playback.miniPlayerLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.playback.miniPlayerHint')}
                    </p>
                  </div>
                  <label className="block">
                    <span className="sr-only">{t('settings.playback.miniPlayerLabel')}</span>
                    <select
                      value={androidMiniPlayerMode}
                      onChange={(e) => {
                        const mode = e.target.value as AndroidMiniPlayerMode;
                        setAndroidMiniPlayerMode(mode);
                        saveAndroidMiniPlayerMode(mode);
                        void syncAndroidMiniPlayerMode(mode);
                      }}
                      className="w-full font-mono text-xs border rounded-lg px-3 py-2 bg-[var(--surface)] text-[var(--text)]"
                      aria-label={t('settings.playback.miniPlayerLabel')}
                    >
                      <option value="off">{t('settings.playback.miniPlayerOff')}</option>
                      <option value="pip">{t('settings.playback.miniPlayerPip')}</option>
                      <option value="topBar">{t('settings.playback.miniPlayerTopBar')}</option>
                    </select>
                  </label>
                  <p className="ui-hint ui-hint--desc">
                    {t('settings.playback.miniPlayerTopBarNote')}
                  </p>
                </div>
              ) : null}

              {isAndroidNative() ? (
                <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        {t('settings.playback.batterySaverLabel')}
                      </p>
                      <p className="ui-hint ui-hint--desc mt-1">
                        {t('settings.playback.batterySaverDesc')}
                      </p>
                    </div>
                    <SandboxSwitch
                      checked={batterySaver}
                      onChange={(checked) => {
                        setBatterySaver(checked);
                        saveBatterySaverEnabled(checked);
                        window.dispatchEvent(new Event('sandbox-settings-change'));
                      }}
                      aria-label={t('settings.playback.batterySaverLabel')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        {t('settings.playback.nativePlaybackLabel')}
                      </p>
                      <p className="ui-hint ui-hint--desc mt-1">
                        {t('settings.playback.nativePlaybackDesc')}
                      </p>
                    </div>
                    <SandboxSwitch
                      checked={androidNativePlayback}
                      onChange={(checked) => {
                        setAndroidNativePlayback(checked);
                        saveAndroidNativePlaybackEnabled(checked);
                      }}
                      aria-label={t('settings.playback.nativePlaybackLabel')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        {t('settings.playback.webViewCrossfadeLabel')}
                      </p>
                      <p className="ui-hint ui-hint--desc mt-1">
                        {t('settings.playback.webViewCrossfadeDesc')}
                      </p>
                    </div>
                    <SandboxSwitch
                      checked={androidWebViewCrossfade}
                      onChange={(checked) => {
                        setAndroidWebViewCrossfade(checked);
                        saveAndroidWebViewCrossfadeEnabled(checked);
                      }}
                      aria-label={t('settings.playback.webViewCrossfadeLabel')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        {t('settings.playback.usbBitPerfectLabel')}
                      </p>
                      <p className="ui-hint ui-hint--desc mt-1">
                        {t('settings.playback.usbBitPerfectDesc')}
                      </p>
                      {androidUsbBitPerfectProbe ? (
                        <p className="ui-hint ui-hint--desc mt-1">
                          {androidUsbBitPerfectProbe.active
                            ? t('settings.playback.usbBitPerfectActive')
                            : androidUsbBitPerfectProbe.available &&
                                androidUsbBitPerfectProbe.usbDacConnected
                              ? t('settings.playback.usbBitPerfectReady')
                              : t('settings.playback.usbBitPerfectUnavailable')}
                        </p>
                      ) : null}
                    </div>
                    <SandboxSwitch
                      checked={androidUsbBitPerfect}
                      disabled={androidUsbBitPerfectProbe?.available === false}
                      onChange={(checked) => {
                        setAndroidUsbBitPerfect(checked);
                        saveAndroidUsbBitPerfectEnabled(checked);
                        void nativeExoSetBitPerfectEnabled(checked);
                      }}
                      aria-label={t('settings.playback.usbBitPerfectLabel')}
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        {t('settings.playback.wiredDacStabilityLabel')}
                      </p>
                      <p className="ui-hint ui-hint--desc mt-1">
                        {t('settings.playback.wiredDacStabilityDesc')}
                      </p>
                      {androidAudioRoute === 'wired' ? (
                        <p className="ui-hint ui-hint--desc mt-1">
                          {t('settings.playback.wiredDacStabilityActive')}
                        </p>
                      ) : null}
                    </div>
                    <SandboxSwitch
                      checked={androidWiredDacStability}
                      onChange={(checked) => {
                        setAndroidWiredDacStability(checked);
                        saveAndroidWiredDacStabilityEnabled(checked);
                        void syncWiredDacStabilityNative();
                      }}
                      aria-label={t('settings.playback.wiredDacStabilityLabel')}
                    />
                  </div>
                  {androidNativePlaybackStatus ? (
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.nativePlaybackStatusNote', {
                        message: androidNativePlaybackStatus.message,
                      })}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {(() => {
                const carActive = isCarModeActive();
                return (
                  <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                    <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackCar} />
                    <div className="flex items-start gap-3">
                      <Car className="w-5 h-5 shrink-0 text-accent" strokeWidth={1.75} />
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-sm font-semibold text-[var(--text)]">
                          {t('settings.playback.carModeTitle')}
                        </p>
                        <p className="ui-hint ui-hint--desc">
                          {t('settings.playback.carModeHint')}
                        </p>
                      </div>
                    </div>
                    {isAndroidNative() ? (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="font-mono text-xs font-semibold text-[var(--text)]">
                            {t('settings.playback.carModeSuggestLabel')}
                          </p>
                          <p className="ui-hint ui-hint--desc">
                            {t('settings.playback.carModeSuggestDesc')}
                          </p>
                        </div>
                        <SandboxSwitch
                          checked={carAutoOffer}
                          onChange={(v) => {
                            setCarAutoOffer(v);
                            saveCarModeAutoOffer(v);
                          }}
                          aria-label={t('settings.playback.carModeSuggestAria')}
                        />
                      </div>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        if (carActive) exitCarMode();
                        else enterCarMode();
                      }}
                      className="w-full min-h-[2.75rem] rounded-lg font-mono text-xs font-bold uppercase tracking-wider touch-manipulation btn-car-mode"
                    >
                      {carActive ? t('settings.playback.carModeExit') : t('settings.playback.carModeEnter')}
                    </button>
                  </div>
                );
              })()}

              <div key={playbackDiagTick} className="p-4 border rounded-xl space-y-2" style={cardStyle}>
                <p className="font-mono text-sm font-semibold text-[var(--text)]">
                  {t('settings.playback.replayGainDiagnosticsTitle')}
                </p>
                <p className="ui-hint ui-hint--desc">
                  {t('settings.playback.replayGainDiagnosticsHint')}
                </p>
                {(() => {
                  const d = getPlaybackDiagnostics();
                  return (
                    <ul className="font-mono text-[10px] uppercase space-y-1 text-[var(--text-mid)]">
                      <li>replayGainDb: {d.replayGainDb.toFixed(2)} dB</li>
                      <li>calculatedMultiplier: {d.calculatedMultiplier.toFixed(4)}</li>
                      <li>finalUserVolume: {d.finalUserVolume.toFixed(3)}</li>
                      <li>sonicRoute: {d.sonicRoute ?? '—'}</li>
                      <li>earSafetyGain: {d.earSafetyGain.toFixed(3)}</li>
                      <li>envelope: {d.envelopeId ?? '—'}</li>
                    </ul>
                  );
                })()}
              </div>

              {networkSync ? (
                <div className="settings-anchor-section p-4 border rounded-xl space-y-3" style={cardStyle}>
                  <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.playbackConnect} />
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        {t('settings.playback.multiDeviceTitle')}
                      </p>
                      <p className="ui-hint ui-hint--desc">
                        {t('settings.playback.multiDeviceSetupHint')}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setConnectWizardOpen(true)}
                      className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation shrink-0 text-accent"
                      style={accentBorder}
                    >
                      {t('settings.playback.setupMultiDevice')}
                    </button>
                  </div>
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.playback.roleLabel')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.playback.roleHint')}{' '}
                      <span className="text-accent">{resolveConnectRole(connectRole)}</span>
                    </p>
                  </div>
                  {connectOfflineHint({
                    browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
                    airGap: airGapEnabled,
                    tier34Ok: tier34Ok === false ? false : tier34Ok,
                    meilisearchOk: null,
                  }) ? (
                    <OfflineStatusBanner
                      className="mt-1"
                      label="Connect limited"
                      message={
                        connectOfflineHint({
                          browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
                          airGap: airGapEnabled,
                          tier34Ok: tier34Ok === false ? false : tier34Ok,
                          meilisearchOk: null,
                        })!
                      }
                    />
                  ) : null}
                  <select
                    value={connectRole}
                    onChange={(e) => {
                      const v = e.target.value as ConnectRolePref;
                      setConnectRole(v);
                      saveConnectRolePref(v);
                    }}
                    className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent text-[var(--text)]"
                    aria-label={t('settings.playback.multiDeviceTitle')}
                  >
                    <option value="auto">{t('settings.playback.roleAuto')}</option>
                    <option value="host">{t('settings.playback.roleHost')}</option>
                    <option value="remote">{t('settings.playback.roleRemote')}</option>
                  </select>
                  <div>
                    <label className="ui-field-label">{t('settings.playback.deviceNameLabel')}</label>
                    <input
                      type="text"
                      value={connectDeviceName}
                      onChange={(e) => {
                        setConnectDeviceName(e.target.value);
                        saveConnectDeviceName(e.target.value);
                      }}
                      placeholder={t('settings.playback.deviceNamePlaceholder')}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {activeTab === 'addons' && (
            <div className="space-y-5">
              <div className="settings-anchor-section space-y-3">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.addonsBuiltin} />
                <p className="ui-subsection-title text-accent">{t('settings.addons.builtinStationsTitle')}</p>
                <p className="ui-hint">{t('settings.addons.builtinStationsHint')}</p>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.djConsoleTitle')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.djConsoleDesc')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={isProAudio}
                    onChange={(checked) => {
                      setIsProAudio(checked);
                      prefsSetItem(PRO_AUDIO_KEY, String(checked));
                      onProAudioChange?.(checked);
                      window.dispatchEvent(new Event('sandbox-settings-change'));
                    }}
                    aria-label="DJ Console"
                  />
                </div>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.djAudioRoutingTitle')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.djAudioRoutingDesc')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={djAudioRouting}
                    onChange={(checked) => {
                      setDjAudioRouting(checked);
                      setDjAudioRoutingEnabled(checked);
                    }}
                    aria-label="DJ audio routing"
                  />
                </div>
                {tier34Ok && demucsAvailable === false ? (
                  <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] space-y-1">
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.stemSeparationTitle')}
                    </p>
                    <p className="ui-hint ui-hint--desc">{t('settings.addons.stemSeparationUnavailable')}</p>
                  </div>
                ) : null}
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      PODCASTS STATION
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      Subscribe to RSS feeds, stream episodes, and show podcast matches in search.
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={podcastsEnabled}
                    onChange={(checked) => {
                      setPodcastsEnabled(checked);
                      savePodcastsEnabled(checked);
                      onPodcastsChange?.(checked);
                    }}
                    aria-label="Podcasts station"
                  />
                </div>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      AUDIOBOOKS STATION
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      Scan Books / Audiobooks on this phone and play them without touching the music
                      locker or podcast library.
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={audiobooksEnabled}
                    onChange={(checked) => {
                      setAudiobooksEnabled(checked);
                      saveAudiobooksEnabled(checked);
                      onAudiobooksChange?.(checked);
                    }}
                    aria-label="Audiobooks station"
                  />
                </div>
                {podcastsEnabled ? (
                  <div
                    className="p-4 border rounded-xl space-y-4"
                    style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.25)' }}
                  >
                    <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
                      Podcast playback
                    </p>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-semibold text-[var(--text)]">
                          Auto-save on Wi‑Fi only
                        </p>
                        <p className="ui-hint ui-hint--desc mt-1">
                          Default for per-show auto-save — skips cellular when caching episodes
                          offline.
                        </p>
                      </div>
                      <SandboxSwitch
                        checked={podcastWifiOnlyAutoSave}
                        onChange={(checked) => {
                          setPodcastWifiOnlyAutoSave(checked);
                          savePodcastAutoDownloadWifiOnly(checked);
                        }}
                        aria-label="Auto-save podcasts on Wi-Fi only"
                      />
                    </div>
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">
                        Skip interval
                      </p>
                      <p className="ui-hint ui-hint--desc mt-1 mb-2">
                        Seconds forward/back in the podcast player and lock-screen controls.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {PODCAST_SEEK_INTERVALS.map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            className={`h-9 px-3 rounded-lg border font-mono text-[10px] uppercase touch-manipulation transition-colors ${
                              podcastSeekInterval === sec
                                ? 'border-accent text-accent bg-[var(--accent-brand)]/10'
                                : 'border-[var(--border)] text-[var(--text-mid)] hover:border-accent'
                            }`}
                            onClick={() => {
                              setPodcastSeekInterval(sec);
                              savePodcastSeekIntervalSeconds(sec);
                            }}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.sonicLockerStation')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.sonicLockerStationHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={sonicLockerEnabled}
                    onChange={(checked) => {
                      setSonicLockerEnabled(checked);
                      saveSonicLockerStationEnabled(checked);
                      onSonicLockerChange?.(checked);
                    }}
                    aria-label={t('settings.addons.sonicLockerStation')}
                  />
                </div>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.discoverStation')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.discoverStationHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={discoverStationEnabled}
                    onChange={(checked) => {
                      setDiscoverStationEnabled(checked);
                      saveDiscoverStationEnabled(checked);
                      onDiscoverChange?.(checked);
                    }}
                    aria-label={t('settings.addons.discoverStation')}
                  />
                </div>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.libraryStation')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.libraryStationHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={libraryStationEnabled}
                    onChange={(checked) => {
                      setLibraryStationEnabled(checked);
                      saveLibraryStationEnabled(checked);
                      onLibraryChange?.(checked);
                    }}
                    aria-label={t('settings.addons.libraryStation')}
                  />
                </div>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.lockerAutoFollow')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.lockerAutoFollowHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={lockerAutoFollowEnabled}
                    onChange={(checked) => {
                      setLockerAutoFollowEnabled(checked);
                      saveLockerAutoFollowEnabled(checked);
                      if (checked) void syncLockerAutoFollow();
                    }}
                    aria-label={t('settings.addons.lockerAutoFollow')}
                  />
                </div>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={{ ...cardStyle, borderColor: 'rgba(232,80,10,0.35)' }}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.followedReleaseNotif')}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-1">
                      {t('settings.addons.followedReleaseNotifHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={followedReleaseNotifEnabled}
                    onChange={(checked) => {
                      setFollowedReleaseNotifEnabled(checked);
                      saveFollowedReleaseNotifEnabled(checked);
                    }}
                    aria-label={t('settings.addons.followedReleaseNotif')}
                  />
                </div>
              </div>

              <div className="settings-anchor-section space-y-3">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.addonsAcquisition} />
                <p className="ui-subsection-title text-accent">{t('settings.addons.acquisitionTitle')}</p>
                <p className="ui-hint">{t('settings.addons.acquisitionHint')}</p>
                <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                  <div>
                    <label className="ui-field-label">{t('settings.addons.serverUrlLabel')}</label>
                    <p className="ui-hint ui-hint--desc mb-2">{t('settings.addons.serverUrlOptionalHint')}</p>
                    {isCapacitorNative() ? (
                      <p className="font-mono text-[0.65rem] text-[var(--text-dim)] mb-2 leading-relaxed">
                        {t('settings.addons.serverUrlMobileHint')}
                      </p>
                    ) : null}
                    {detectTVPlatform() ? (
                      <p className="font-mono text-[0.65rem] text-[var(--text-dim)] mb-2 leading-relaxed">
                        TV: set this Remote URL once (same LAN IP or overlay as phone/PC). API keys
                        sync from the server — enter keys on Windows or phone; Shield pulls them
                        automatically when Sync keys is enabled in Settings → Security.
                      </p>
                    ) : null}
                    <input
                      type="url"
                      value={backendUrl}
                      onChange={(e) => setBackendUrl(e.target.value)}
                      onBlur={(e) => saveTier34BackendUrl(e.target.value)}
                      placeholder={isCapacitorNative() ? 'Optional — http://192.168.1.10:3001' : 'http://localhost:3001'}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                  </div>
                  <div>
                    <p className="ui-field-label">{t('settings.addons.acquisitionTierTitle')}</p>
                    <p className="ui-hint ui-hint--desc mb-2">{t('settings.addons.acquisitionTierHint')}</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {(
                        [
                          {
                            key: 'best' as const,
                            label: t('settings.addons.acquisitionTierBest'),
                            desc: t('settings.addons.acquisitionTierBestDesc'),
                          },
                          {
                            key: 'proxy' as const,
                            label: t('settings.addons.acquisitionTierProxy'),
                            desc: t('settings.addons.acquisitionTierProxyDesc'),
                          },
                          {
                            key: 'debrid' as const,
                            label: t('settings.addons.acquisitionTierDebrid'),
                            desc: t('settings.addons.acquisitionTierDebridDesc'),
                          },
                        ] satisfies Array<{
                          key: DownloadTierPreference;
                          label: string;
                          desc: string;
                        }>
                      ).map((tier) => (
                        <button
                          key={tier.key}
                          type="button"
                          onClick={() => onDownloadTierChange?.(tier.key)}
                          className={`p-4 text-left border min-h-[96px] flex flex-col justify-between touch-manipulation fidelity-card ${
                            downloadTierPreference === tier.key
                              ? 'fidelity-card--selected'
                              : 'fidelity-card--unselected'
                          }`}
                          style={cardStyle}
                        >
                          <span className="fidelity-card-label font-display font-semibold text-sm">
                            {tier.label}
                          </span>
                          <span className="ui-hint ui-hint--desc text-[10px] mt-2">{tier.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="border rounded-xl p-3 space-y-2" style={{ borderColor: C.border }}>
                    <p className="font-mono text-xs uppercase font-bold" style={accentStyle}>
                      {t('settings.addons.sandboxIndexerTitle')}
                    </p>
                    <p className="ui-hint text-[10px]">{t('settings.addons.sandboxIndexerHint')}</p>
                    <p className="font-mono text-[10px] uppercase" style={{ color: C.textMid }}>
                      {indexerStatus?.sources?.length
                        ? t('settings.addons.sandboxIndexerSources', {
                            sources: indexerStatus.sources.join(', '),
                          })
                        : tier34Ok
                          ? t('settings.addons.sandboxIndexerChecking')
                          : t('settings.addons.sandboxIndexerOffline')}
                    </p>
                    <button
                      type="button"
                      disabled={!tier34Ok}
                      onClick={() => {
                        setIndexerTest('testing…');
                        void testSandboxIndexerBackend().then((r) => {
                          setIndexerTest(
                            r.ok
                              ? t('settings.addons.testOk', { detail: r.detail })
                              : t('settings.addons.testFailed', { detail: r.detail }),
                          );
                        });
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                      style={{ ...accentBorder, borderColor: C.border }}
                    >
                      {t('settings.addons.testSandboxIndexer')}
                    </button>
                    {indexerTest ? (
                      <p className="font-mono text-[10px] uppercase" style={{ color: C.textMid }}>
                        {t('settings.addons.sandboxIndexerResult')} {indexerTest}
                      </p>
                    ) : null}
                    <details className="text-[10px]">
                      <summary className="font-mono uppercase cursor-pointer touch-manipulation text-[var(--text-dim)]">
                        {t('settings.addons.torznabAdvanced')}
                      </summary>
                      <p className="ui-hint mt-2 mb-1">{t('settings.addons.torznabHint')}</p>
                      <textarea
                        value={torznabConfigJson}
                        onChange={(e) => setTorznabConfigJson(e.target.value)}
                        rows={4}
                        className="input-elevated w-full px-3 py-2 font-mono text-[10px] focus-accent"
                        style={{ color: C.text }}
                        placeholder='[{"name":"Jackett","url":"http://127.0.0.1:9117/api/v2.0/indexers/all/results/torznab/api","apiKey":"..."}]'
                      />
                      <button
                        type="button"
                        disabled={!tier34Ok || torznabSaving}
                        onClick={() => {
                          setTorznabSaving(true);
                          try {
                            const parsed = JSON.parse(torznabConfigJson) as Array<{
                              name?: string;
                              url?: string;
                              apiKey?: string;
                              hasApiKey?: boolean;
                            }>;
                            if (!Array.isArray(parsed)) throw new Error('Must be a JSON array');
                            void tier34IndexerConfigure(
                              parsed.map((e) => ({
                                name: e.name ?? 'Indexer',
                                url: e.url ?? '',
                                apiKey: e.apiKey,
                              })),
                            )
                              .then((r) => {
                                if (r.ok) {
                                  setCacheTick((t) => t + 1);
                                  setTorznabSaving(false);
                                } else {
                                  setIndexerTest(
                                    t('settings.addons.testFailed', {
                                      detail: r.error ?? 'configure failed',
                                    }),
                                  );
                                  setTorznabSaving(false);
                                }
                              })
                              .catch(() => setTorznabSaving(false));
                          } catch {
                            setIndexerTest(
                              t('settings.addons.testFailed', { detail: 'Invalid JSON array' }),
                            );
                            setTorznabSaving(false);
                          }
                        }}
                        className="mt-2 px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                        style={{ ...accentBorder, borderColor: C.border }}
                      >
                        {torznabSaving
                          ? t('settings.addons.savingTorznab')
                          : t('settings.addons.saveTorznab')}
                      </button>
                    </details>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowAcquisitionKeys((v) => !v)}
                    className="font-mono text-[10px] uppercase tracking-wider text-accent underline touch-manipulation"
                  >
                    {showAcquisitionKeys
                      ? t('settings.addons.hideAcquisitionKeys')
                      : t('settings.addons.showAcquisitionKeys')}
                  </button>
                  {showAcquisitionKeys ? (
                  <>
                  <p className="ui-hint text-[10px]">{t('settings.addons.externalIndexerHint')}</p>
                  <div>
                    <label className="ui-field-label">{t('settings.addons.externalIndexerUrl')}</label>
                    <input
                      type="url"
                      value={prowlarrUrl}
                      onChange={(e) => {
                        setProwlarrUrl(e.target.value);
                        savePlaybackEngineSettings({ prowlarrUrl: e.target.value });
                      }}
                      placeholder={PROWLARR_URL_PLACEHOLDER}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                  </div>
                  <div>
                    <label className="ui-field-label">{t('settings.addons.externalIndexerKey')}</label>
                    <input
                      type="password"
                      value={prowlarrApiKey}
                      onChange={(e) => {
                        setProwlarrApiKey(e.target.value);
                        savePlaybackEngineSettings({ prowlarrApiKey: e.target.value });
                      }}
                      placeholder={t('settings.addons.podcastIndexerKeyPlaceholder')}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                  </div>
                  <div>
                    <label className="ui-field-label">{t('settings.addons.premiumDownloadsKey')}</label>
                    <input
                      type="password"
                      value={realDebridApiKey}
                      onChange={(e) => {
                        setRealDebridApiKey(e.target.value);
                        savePlaybackEngineSettings({ realDebridApiKey: e.target.value });
                      }}
                      placeholder={t('settings.addons.premiumDownloadsKeyPlaceholder')}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                  </div>
                  <div>
                    <label className="ui-field-label">{t('settings.addons.discogsApiToken')}</label>
                    <input
                      type="password"
                      value={discogsApiToken}
                      onChange={(e) => {
                        setDiscogsApiToken(e.target.value);
                        savePlaybackEngineSettings({ discogsApiToken: e.target.value });
                      }}
                      placeholder={t('settings.addons.discogsApiTokenPlaceholder')}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                    <p className="ui-hint text-[10px] mt-1">{t('settings.addons.discogsApiTokenHint')}</p>
                  </div>
                  </>
                  ) : null}
                  <p className="ui-hint">
                    Real-Debrid in Sandbox is not a FUSE/library mount like Jellyfin or Plex. Sandbox Server
                    unrestricts a magnet or URL at play time and passes a direct ephemeral stream URL
                    to the player. Optional Acquire copies the file into your Locker — it does not
                    expose RD as a browsable server folder.
                  </p>
                  <p className="ui-hint">
                    {t('settings.addons.serverSetupHint')}
                  </p>
                  {deviceSecretSyncEnabled && backendUrl.trim() ? (
                    <p className="ui-hint text-[10px]">
                      Keys entered here sync to other devices via Sandbox Server (
                      {backendUrl.replace(/\/$/, '')}). Toggle in Settings → Security.
                    </p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setYtdlpTest('testing…');
                        void testYtdlpBackend(backendUrl).then((r) => {
                          setYtdlpTest(
                            r.ok
                              ? t('settings.addons.testOk', { detail: r.detail })
                              : t('settings.addons.testFailed', { detail: r.detail }),
                          );
                          setCacheTick((t) => t + 1);
                        });
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation"
                      style={{ ...accentBorder, borderColor: C.border }}
                    >
                      {t('settings.addons.testDownloadHelper')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProwlarrTest('testing…');
                        void testProwlarrBackend().then((r) => {
                          setProwlarrTest(
                            r.ok
                              ? t('settings.addons.testOk', { detail: r.detail })
                              : t('settings.addons.testFailed', { detail: r.detail }),
                          );
                        });
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation"
                      style={{ ...accentBorder, borderColor: C.border }}
                    >
                      {t('settings.addons.testExternalIndexer')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRdTest('testing…');
                        void testRealDebridBackend().then((r) => {
                          setRdTest(
                            r.ok
                              ? t('settings.addons.testOk', { detail: r.detail })
                              : t('settings.addons.testFailed', { detail: r.detail }),
                          );
                        });
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation"
                      style={{ ...accentBorder, borderColor: C.border }}
                    >
                      {t('settings.addons.testPremiumDownloads')}
                    </button>
                  </div>
                  <p className="font-mono text-[10px] font-bold uppercase" style={accentStyle}>
                    {t('settings.addons.downloadHelperStatus')}{' '}
                    {ytdlpTest ??
                      (tier34Ok === null
                        ? t('settings.addons.downloadHelperChecking')
                        : tier34Ok
                          ? t('settings.addons.downloadHelperOnline')
                          : t('settings.addons.downloadHelperOffline'))}
                  </p>
                  {prowlarrTest ? (
                    <p className="font-mono text-[10px] uppercase" style={{ color: C.textMid }}>
                      {t('settings.addons.externalIndexerResult')} {prowlarrTest}
                    </p>
                  ) : null}
                  {rdTest ? (
                    <p className="font-mono text-[10px] uppercase" style={{ color: C.textMid }}>
                      {t('settings.addons.premiumDownloadsResult')} {rdTest}
                    </p>
                  ) : null}
                  <div className="border-t pt-3 mt-1" style={{ borderColor: C.border }}>
                    <p className="font-mono text-xs uppercase mb-1" style={accentStyle}>
                      {t('settings.addons.lockerSearchTitle')}
                    </p>
                    <p className="ui-hint mb-2">
                      {t('settings.addons.lockerSearchHint', {
                        status: meiliStatus ?? t('settings.addons.lockerSearchChecking'),
                      })}{' '}
                      <span className="text-[var(--text-dim)]">
                        {t('settings.addons.lockerSearchFootnote')}
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled={!tier34Ok || meiliReindexing}
                      onClick={() => {
                        setMeiliReindexing(true);
                        void tier34ReindexSearch()
                          .then((r) => {
                            if ('error' in r) {
                              setMeiliStatus(r.error);
                            } else if (r.data.ok) {
                              setMeiliStatus(`Reindexed ${r.data.indexed ?? 0} tracks`);
                            } else {
                              setMeiliStatus(r.data.error ?? 'Reindex failed');
                            }
                            setCacheTick((t) => t + 1);
                          })
                          .finally(() => setMeiliReindexing(false));
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                      style={{ ...accentBorder, borderColor: C.border }}
                    >
                      {meiliReindexing ? t('settings.addons.reindexing') : t('settings.addons.reindexLockerSearch')}
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-anchor-section space-y-3">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.addonsMobileResolvers} />
                <p className="ui-subsection-title text-accent">MOBILE RESOLVERS</p>
                <p className="ui-hint">
                  On-device stream resolution when Sandbox Server is unreachable. Register external
                  runtimes via HTTPS manifest — no extraction libraries are bundled in Sandbox Music.
                </p>
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="url"
                    value={mobileResolverUrl}
                    onChange={(e) => {
                      setMobileResolverUrl(e.target.value);
                      if (mobileResolverStatus) setMobileResolverStatus('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void installMobileResolver();
                    }}
                    placeholder="Paste mobile resolver manifest URL…"
                    className="input-elevated flex-1 px-4 py-3 text-sm focus-accent"
                  />
                  <button
                    type="button"
                    onClick={() => void installMobileResolver()}
                    disabled={mobileResolverInstalling}
                    className="h-11 px-5 rounded-full btn-accent font-mono text-xs font-bold uppercase flex items-center justify-center gap-2 touch-manipulation shrink-0"
                  >
                    {mobileResolverInstalling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4" />
                    )}
                    Register
                  </button>
                </div>
                {mobileResolverStatus ? (
                  <p className="ui-hint text-accent">{mobileResolverStatus}</p>
                ) : null}
                <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] space-y-2">
                  <p className="font-mono text-[10px] uppercase text-[var(--text-dim)]">
                    Interface specification
                  </p>
                  <pre className="ui-hint p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-void)] overflow-x-auto text-[var(--text-mid)] whitespace-pre-wrap">
                    {MOBILE_RESOLVER_INTERFACE_SPEC}
                  </pre>
                  <p className="ui-hint text-[10px] leading-relaxed">
                    Installing a resolver means you accept responsibility for how it resolves streams.
                    Sandbox Music does not include or endorse any specific resolver.
                  </p>
                </div>
                <ul className="space-y-2">
                  {resolutionResolvers
                    .filter((r) => r.id !== 'yt-dlp-mobile' || r.enabled)
                    .map((resolver) => (
                      <li
                        key={resolver.id}
                        className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]"
                      >
                        <div className="min-w-0">
                          <p className="font-bold text-[var(--text)] truncate">{resolver.name}</p>
                          <span className="text-sm text-[var(--text-mid)] block">
                            {resolver.version ? `v${resolver.version}` : resolver.id}
                          </span>
                          {resolver.manifestUrl ? (
                            <span className="ui-hint block truncate mt-0.5">{resolver.manifestUrl}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <SandboxSwitch
                            checked={resolver.enabled}
                            data-testid={
                              resolver.id === 'yt-dlp-mobile'
                                ? 'resolver-toggle-yt-dlp-mobile'
                                : `resolver-toggle-${resolver.id}`
                            }
                            onChange={(checked) => {
                              setMobileResolverEnabled(resolver.id, checked);
                              setResolutionResolvers(getMobileResolvers());
                            }}
                            aria-label={`Enable ${resolver.name}`}
                          />
                          {resolver.manifestUrl || getUserMobileResolverManifests().some((m) => m.id === resolver.id) ? (
                            <button
                              type="button"
                              onClick={() => {
                                removeUserMobileResolver(resolver.id);
                                setResolutionResolvers(getMobileResolvers());
                                setMobileResolverStatus(`Removed ${resolver.name}.`);
                              }}
                              className="text-sm font-bold uppercase text-[var(--danger)] touch-manipulation px-2 py-1"
                            >
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </li>
                    ))}
                  {resolutionResolvers.length === 0 ? (
                    <p className="text-center py-6 ui-hint">
                      No mobile resolvers registered — paste a manifest URL above.
                    </p>
                  ) : null}
                </ul>
              </div>

              <div className="settings-anchor-section space-y-3">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.addonsExperimental} />
                <p className="ui-subsection-title text-accent">{t('settings.addons.experimentalTitle')}</p>
                <p className="ui-hint">{t('settings.addons.experimentalHint')}</p>
                <div
                  className="flex items-center justify-between p-4 border rounded-xl"
                  style={cardStyle}
                >
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.addons.showExperimentalIntegrations')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      {t('settings.addons.experimentalHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={showExperimentalIntegrations}
                    onChange={(checked) => {
                      setShowExperimentalIntegrations(checked);
                      saveShowExperimentalIntegrations(checked);
                    }}
                    aria-label="Show experimental integrations"
                  />
                </div>
              </div>

              {showExperimentalIntegrations ? (
              <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] space-y-3">
                <p className="font-mono text-sm font-semibold text-[var(--text)]">{t('settings.addons.personalAddonPack')}</p>
                <p className="ui-hint">
                  {t('settings.addons.personalAddonPackHint')}
                </p>
                <ul className="space-y-2">
                  {installedAddons
                    .filter((a) => a.builtIn && isStubAddon(a))
                    .map((addon) => {
                      const status = getAddonStatus(addon);
                      return (
                        <li
                          key={addon.id}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl border border-[var(--border)]"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-bold text-[var(--text)]">{addon.name}</p>
                              <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border border-accent text-accent">
                                {t('settings.addons.builtInBadge')}
                              </span>
                              {isStubAddon(addon) ? (
                                <span className="text-[9px] font-mono uppercase px-2 py-0.5 rounded border border-accent/50 text-accent bg-accent/5">
                                  DEV
                                </span>
                              ) : null}
                              <span
                                className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border ${addonStatusBadgeClass(status)}`}
                              >
                                {addonStatusLabel(status, t)}
                              </span>
                            </div>
                            <span className="text-sm text-[var(--text-mid)] block">
                              Search level {addon.tier} · v{addon.version}
                            </span>
                            {isStubAddon(addon) ? (
                              <span className="ui-hint block mt-0.5">
                                {t('settings.addons.devBadgeHint')}
                              </span>
                            ) : null}
                            {addon.note ? (
                              <span className="ui-hint block mt-0.5">{addon.note}</span>
                            ) : null}
                            {addon.id === 'builtin-soundcloud' && (
                              <input
                                type="text"
                                value={addon.config?.client_id ?? ''}
                                onChange={(e) => {
                                  setAddonConfig(addon.id, { client_id: e.target.value });
                                  setInstalledAddons(loadAddons());
                                }}
                                placeholder="SoundCloud client_id (optional)"
                                className="input-elevated mt-2 w-full px-4 py-3 font-mono text-xs focus-accent"
                                style={{ color: C.text }}
                              />
                            )}
                            {addon.id === 'builtin-audius' && (
                              <div className="mt-2 space-y-2">
                                <input
                                  type="text"
                                  value={addon.config?.app_name ?? 'SandboxMusic'}
                                  onChange={(e) => {
                                    setAddonConfig(addon.id, { app_name: e.target.value });
                                    setInstalledAddons(loadAddons());
                                  }}
                                  placeholder="Audius app_name (optional)"
                                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                                  style={{ color: C.text }}
                                />
                                <input
                                  type="password"
                                  value={addon.config?.api_key ?? ''}
                                  onChange={(e) => {
                                    setAddonConfig(addon.id, { api_key: e.target.value });
                                    setInstalledAddons(loadAddons());
                                  }}
                                  placeholder="Audius API key (optional)"
                                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                                  style={{ color: C.text }}
                                />
                              </div>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setAddonEnabled(addon.id, !addon.enabled);
                              setInstalledAddons(loadAddons());
                            }}
                            className="text-sm font-bold uppercase touch-manipulation px-3 py-1 shrink-0"
                            style={accentStyle}
                          >
                            {addon.enabled ? 'Disable' : 'Enable'}
                          </button>
                        </li>
                      );
                    })}
                </ul>
              </div>
              ) : (
                <p className="ui-hint">
                  {t('settings.addons.experimentalHiddenHint')}
                </p>
              )}

              <p className="ui-hint leading-relaxed">
                Install community search and playback extensions from a manifest URL.
              </p>

              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  ref={addonUrlInputRef}
                  type="url"
                  value={addonUrl}
                  onChange={(e) => {
                    setAddonUrl(e.target.value);
                    if (addonStatus) setAddonStatus('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void installAddon();
                  }}
                  placeholder="Paste manifest URL to install…"
                  className="input-elevated flex-1 px-4 py-3 text-sm focus-accent"
                />
                <button
                  type="button"
                  onClick={() => void installAddon()}
                  disabled={addonInstalling}
                  className="h-11 px-5 rounded-full btn-accent font-mono text-xs font-bold uppercase flex items-center justify-center gap-2 touch-manipulation shrink-0"
                >
                  {addonInstalling ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Plus className="w-4 h-4" />
                  )}
                  Add addon
                </button>
              </div>

              {addonStatus ? (
                <p className="ui-hint text-accent">{addonStatus}</p>
              ) : null}

              <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2">
                <select
                  value={addonFilter}
                  onChange={(e) => setAddonFilter(e.target.value as 'installed' | 'all')}
                  className="input-elevated px-4 py-3 text-sm focus-accent min-w-[8rem]"
                >
                  <option value="installed">Installed</option>
                  <option value="all">All</option>
                </select>
                <div className="relative flex-1 min-w-0">
                  <input
                    type="search"
                    value={addonSearch}
                    onChange={(e) => setAddonSearch(e.target.value)}
                    placeholder="Search addons"
                    className="input-elevated w-full pl-4 pr-10 py-3 text-sm focus-accent"
                  />
                  <SearchIcon className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)] pointer-events-none" />
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowAddonGuide((v) => !v)}
                className="addon-manifest-cta touch-manipulation"
              >
                <span>{showAddonGuide ? 'Hide manifest guide' : 'How to build an addon manifest'}</span>
                <span aria-hidden>{showAddonGuide ? '↑' : '→'}</span>
              </button>
              {showAddonGuide && (
                <div className="p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] space-y-2">
                  <p className="ui-hint">
                    Host a JSON file over HTTPS. User manifests can do everything builtins do: set{' '}
                    <code className="text-[var(--text)]">tier</code>, <code className="text-[var(--text)]">defaults.provider</code>,{' '}
                    POST <code className="text-[var(--text)]">search.bodyTemplate</code>, and return{' '}
                    <code className="text-[var(--text)]">provider</code> / <code className="text-[var(--text)]">transport</code> per row.
                    Point <code className="text-[var(--text)]">search.endpoint</code> at your Sandbox Server host or any public HTTPS API.
                    Builtins are dev-test only — release users add their own manifests.
                  </p>
                  <pre className="ui-hint p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-void)] overflow-x-auto text-[var(--text-mid)]">
                    {ADDON_MANIFEST_EXAMPLE}
                  </pre>
                </div>
              )}

              <ul className="space-y-2">
                {installedAddons
                  .filter((a) => !a.builtIn)
                  .filter((a) =>
                    addonSearch
                      ? a.name.toLowerCase().includes(addonSearch.toLowerCase())
                      : true,
                  )
                  .map((addon) => {
                    const status = getAddonStatus(addon);
                    return (
                      <li
                        key={addon.id}
                        className="flex items-center justify-between gap-3 p-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-bold text-[var(--text)] truncate">{addon.name}</p>
                            <span
                              className={`text-[9px] font-mono uppercase px-2 py-0.5 rounded border ${addonStatusBadgeClass(status)}`}
                            >
                              {addonStatusLabel(status, t)}
                            </span>
                          </div>
                          <span className="text-sm text-[var(--text-mid)] block">
                            Tier {addon.tier} · v{addon.version}
                          </span>
                          {addon.manifestUrl ? (
                            <span className="ui-hint block truncate mt-0.5">{addon.manifestUrl}</span>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            removeUserAddon(addon.id);
                            setInstalledAddons(loadAddons());
                            setAddonStatus(`Removed ${addon.name}.`);
                          }}
                          className="text-sm font-bold uppercase text-[var(--danger)] touch-manipulation px-3 py-1 shrink-0"
                        >
                          Remove
                        </button>
                      </li>
                    );
                  })}
                {installedAddons.filter((a) => !a.builtIn).length === 0 && (
                  <p className="text-center py-8 ui-hint">
                    No community addons — paste a manifest URL above.
                  </p>
                )}
              </ul>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.securityMain} />
                <p className="ui-subsection-title">{t('settings.security.title')}</p>
                <p className="ui-hint mt-1">
                  {t('settings.security.hint')}
                </p>
              </div>
              <div
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border rounded-xl"
                style={cardStyle}
              >
                <div>
                  <p className="font-mono text-sm font-semibold text-[var(--text)]">{t('settings.security.airGapLabel')}</p>
                  <p className="ui-hint ui-hint--desc">
                    {t('settings.security.airGapHint')}
                  </p>
                </div>
                <SandboxSwitch
                  checked={airGapEnabled}
                  onChange={(checked) => setAirGap(checked)}
                  aria-label="Air-Gap Mode"
                />
              </div>
              <div
                className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border rounded-xl"
                style={cardStyle}
              >
                <div>
                  <p className="font-mono text-sm font-semibold text-[var(--text)]">{t('settings.security.lanPartyLabel')}</p>
                  <p className="ui-hint ui-hint--desc">
                    {t('settings.security.lanPartyHint')}
                  </p>
                </div>
                <SandboxSwitch
                  checked={lanPartyEnabled}
                  onChange={(checked) => {
                    setLanPartyEnabled(checked);
                    if (checked) setLanPartyMode(true);
                    else setLanPartyMode(false);
                    setAirGapEnabled(isAirGapEnabled());
                  }}
                  aria-label="LAN Party Mode"
                />
              </div>
              <div className="space-y-3">
                {(
                  [
                    {
                      key: 'ephemeralChamber' as const,
                      label: t('settings.security.ephemeralChamberLabel'),
                      hint: t('settings.security.ephemeralChamberHint'),
                    },
                    {
                      key: 'ghostProtocol' as const,
                      label: t('settings.security.ghostProtocolLabel'),
                      hint: t('settings.security.ghostProtocolHint'),
                    },
                    {
                      key: 'defenseProtocol' as const,
                      label: t('settings.security.defenseProtocolLabel'),
                      hint: `${t('settings.security.defenseProtocolHint')} ${t('settings.security.defenseProtocolFootnote')}`,
                    },
                    {
                      key: 'dataPersistence' as const,
                      label: t('settings.security.dataPersistenceLabel'),
                      hint: t('settings.security.dataPersistenceHint'),
                    },
                  ] as const
                ).map((row) => (
                  <div
                    key={row.key}
                    className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 border rounded-xl"
                    style={cardStyle}
                  >
                    <div>
                      <p className="font-mono text-sm font-semibold text-[var(--text)]">{row.label}</p>
                      <p className="ui-hint ui-hint--desc">{row.hint}</p>
                    </div>
                    <SandboxSwitch
                      checked={security[row.key]}
                      disabled={row.key === 'defenseProtocol' && defenseProtocolBusy}
                      onChange={(checked) => {
                        const next = { ...security, [row.key]: checked };
                        setSecurity(next);
                        saveSecuritySettings({ [row.key]: checked });
                        if (row.key === 'defenseProtocol') {
                          setDefenseProtocolBusy(true);
                          void tier34SetDefenseProtocol(checked).finally(() => {
                            setDefenseProtocolBusy(false);
                          });
                        }
                      }}
                      aria-label={row.label}
                    />
                  </div>
                ))}
              </div>
              <div className="p-4 rounded-xl border space-y-3" style={cardStyle}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      Sync keys via Sandbox Server
                    </p>
                    <p className="ui-hint mt-1">
                      API keys saved on one device are stored on your Sandbox Server host and merged into
                      other clients using the same server URL. Keys live on your self-hosted server
                      (not Sandbox Music cloud). Set SANDBOX_DEVICE_SYNC_SECRET on the server for
                      extra auth. Disabled automatically when air-gapped without a LAN server.
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={deviceSecretSyncEnabled}
                    disabled={!backendUrl.trim()}
                    onChange={(checked) => {
                      setDeviceSecretSyncEnabled(checked);
                      saveDeviceSyncEnabled(checked);
                    }}
                    aria-label="Sync API keys via Sandbox Server"
                  />
                </div>
              </div>
              <div className="p-4 rounded-xl border space-y-3" style={cardStyle}>
                <p className="font-mono text-xs uppercase" style={accentStyle}>
                  {t('settings.security.serverKeysTitle')}
                </p>
                <p className="ui-hint">
                  {t('settings.security.serverKeysHint')}
                </p>
                <button
                  type="button"
                  onClick={() =>
                    openAcquisitionKeysPanel(
                      setActiveTab,
                      setMobileDrill,
                      setShowAcquisitionKeys,
                      setPendingSettingsAnchor,
                      isMobileLayout,
                    )
                  }
                  className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation text-accent"
                  style={accentBorder}
                >
                  {t('settings.security.configureAcquisitionKeys')}
                </button>
              </div>
            </div>
          )}

          {activeTab === 'diagnostics' && (
            <div className="space-y-6">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.diagnosticsMain} />
                <p className="font-mono text-xs font-bold uppercase tracking-widest mb-1 text-accent">
                  {t('settings.diagnostics.title')}
                </p>
                <p className="ui-hint ui-hint--desc">
                  {t('settings.diagnostics.hint')}
                </p>
              </div>
              <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-xs uppercase tracking-widest text-accent">
                      {t('settings.diagnostics.sovereignStatusTitle')}
                    </p>
                    <p className="ui-hint mt-1">
                      {t('settings.diagnostics.sovereignStatusHint')}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={sovereignRefreshing}
                    onClick={runSovereignStatusRefresh}
                    className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation shrink-0 text-accent disabled:opacity-50"
                    style={accentBorder}
                    aria-busy={sovereignRefreshing}
                  >
                    {sovereignRefreshing ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t('settings.diagnostics.checking')}
                      </span>
                    ) : (
                      t('settings.diagnostics.runDiagnostics')
                    )}
                  </button>
                </div>
                {sovereignRefreshing || sovereignRefreshSummary ? (
                  <div
                    role="status"
                    aria-live="polite"
                    className={`rounded-lg border px-4 py-3 font-mono text-[10px] uppercase tracking-wider ${
                      sovereignRefreshing
                        ? 'border-accent/40 text-accent bg-accent/8'
                        : sovereignRefreshIsError
                          ? 'border-[var(--danger)]/50 text-[var(--danger)] bg-[var(--danger)]/8'
                          : 'border-accent/50 text-accent bg-accent/10'
                    }`}
                  >
                    {sovereignRefreshing ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t('settings.diagnostics.sovereignChecking')}
                      </span>
                    ) : (
                      sovereignRefreshSummary
                    )}
                  </div>
                ) : null}
                <ul className={`space-y-2 ${sovereignRefreshing ? 'opacity-75' : ''}`}>
                  {SOVEREIGN_SERVICE_ORDER.map((id) => {
                    const row = sovereignSnapshot?.services[id];
                    const state = row?.state ?? 'offline';
                    const label = row?.label ?? id.toUpperCase();
                    const checkedAt = row?.checkedAt ?? sovereignSnapshot?.checkedAt;
                    const rowChanged = sovereignChangedIds.includes(id);
                    return (
                      <li
                        key={id}
                        className={`p-3 border rounded-lg space-y-1 transition-all duration-500 ${
                          rowChanged ? 'border-accent/60 bg-accent/10 ring-1 ring-accent/40' : ''
                        }`}
                        style={{ borderColor: rowChanged ? undefined : C.border }}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--text)]">
                            {label}
                          </span>
                          <span
                            className={`inline-flex px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider border rounded-sm ${
                              sovereignRefreshing
                                ? 'border-[var(--border)] text-[var(--text-dim)] animate-pulse'
                                : sovereignStatusBadgeClass(state)
                            }`}
                          >
                            {sovereignRefreshing
                              ? 'Checking…'
                              : formatSovereignStateLabel(state)}
                          </span>
                        </div>
                        <p
                          className={`font-mono text-[9px] uppercase ${
                            rowChanged ? 'text-accent' : 'text-[var(--text-dim)]'
                          }`}
                        >
                          Last check:{' '}
                          {checkedAt ? formatSovereignCheckedAt(checkedAt) : 'Pending…'}
                        </p>
                        {row?.failureReason &&
                        (state === 'offline' || state === 'error') ? (
                          <p className="font-mono text-[9px] uppercase text-[var(--danger)]">
                            {row.failureReason}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="ui-hint">{t('settings.diagnostics.sovereignValidationLink')}</p>
                {sovereignSnapshot?.services.tier34 &&
                (sovereignSnapshot.services.tier34.state === 'offline' ||
                  sovereignSnapshot.services.tier34.state === 'error') ? (
                  <p className="ui-hint ui-hint--desc font-mono text-[10px] uppercase text-[var(--warn)]">
                    {isAndroid()
                      ? t('settings.diagnostics.serverUnreachableAndroid')
                      : isTauri() || !isCapacitorNative()
                        ? t('settings.diagnostics.serverUnreachableDesktop')
                        : t('settings.diagnostics.serverUnreachableAndroid')}
                  </p>
                ) : null}
              </div>
              <div className="p-4 border rounded-xl space-y-2" style={cardStyle}>
                <p className="font-mono text-sm font-semibold text-[var(--text)]">
                  RUNTIME PLATFORM
                </p>
                <p className="ui-hint ui-hint--desc">
                  Detected shell from Tauri, Capacitor, and TV heuristics. Also on{' '}
                  <code className="text-accent">document.documentElement[data-platform]</code>.
                </p>
                <ul className="font-mono text-[10px] uppercase space-y-1 text-[var(--text-mid)]">
                  <li>platform: {platformDiag.platform}</li>
                  <li>label: {platformDiag.label}</li>
                  <li>capacitor: {platformDiag.capacitorPlatform ?? 'n/a'}</li>
                  <li>tauri: {platformDiag.isTauri ? 'yes' : 'no'}</li>
                  <li>capacitor native: {platformDiag.isCapacitorNative ? 'yes' : 'no'}</li>
                  <li>android: {platformDiag.isAndroid ? 'yes' : 'no'}</li>
                  <li>android tv: {platformDiag.isAndroidTv ? 'yes' : 'no'}</li>
                  <li>web: {platformDiag.isWeb ? 'yes' : 'no'}</li>
                  <li>desktop os: {platformDiag.desktopOs ?? 'n/a'}</li>
                  <li>linux: {platformDiag.isLinux ? 'yes' : 'no'}</li>
                  <li>desktop linux: {platformDiag.isDesktopLinux ? 'yes' : 'no'}</li>
                </ul>
              </div>
              <div className="p-4 border rounded-xl space-y-4" style={cardStyle}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-mono text-sm font-semibold text-[var(--text)]">
                      {t('settings.diagnostics.validationSuiteTitle')}
                    </p>
                    <p className="ui-hint ui-hint--desc">
                      Target:{' '}
                      <span className="font-mono text-[10px] text-accent">{backendUrl}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={validationRunning}
                    onClick={runTier34Validation}
                    className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation shrink-0 text-accent disabled:opacity-40"
                    style={accentBorder}
                  >
                    {validationRunning ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Running…
                      </span>
                    ) : (
                      'Run validation'
                    )}
                  </button>
                </div>
                {validationError ? (
                  <p className="font-mono text-[10px] uppercase text-red-400">{validationError}</p>
                ) : null}
                {validationReport ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <span
                        className={`inline-flex items-center px-2 py-1 font-mono text-[9px] uppercase tracking-wider border rounded-sm ${validationOverallClass(validationReport.overall)}`}
                      >
                        {validationOverallLabel(validationReport.overall)}
                      </span>
                      <span className="font-mono text-[10px] uppercase text-[var(--text-mid)]">
                        {formatValidationTimestamp(validationReport.runAt)}
                      </span>
                      {validationReport.telemetry ? (
                        <span className="font-mono text-[10px] uppercase text-[var(--text-dim)]">
                          pass {validationReport.telemetry.passCount} · skip{' '}
                          {validationReport.telemetry.skipCount} · fail{' '}
                          {validationReport.telemetry.failCount}
                        </span>
                      ) : null}
                    </div>
                    <ul className="space-y-2 max-h-[28rem] overflow-y-auto music-scrollbar">
                      {validationReport.scenarios.map((scenario) => (
                        <li
                          key={scenario.id}
                          className="p-3 rounded border space-y-1"
                          style={{ borderColor: C.border, backgroundColor: C.bg }}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-[10px] uppercase text-[var(--text)]">
                              {scenario.name}
                            </span>
                            <span
                              className={`font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 border rounded-sm ${validationStatusClass(scenario.status)}`}
                            >
                              {scenario.status}
                            </span>
                          </div>
                          <p className="ui-hint text-[11px] leading-relaxed">{scenario.message}</p>
                          {scenario.durationMs != null ? (
                            <p className="font-mono text-[9px] uppercase text-[var(--text-dim)]">
                              {scenario.durationMs} ms
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="ui-hint">
                    {t('settings.diagnostics.validationIdleHint')}{' '}
                    {t('settings.diagnostics.validationFootnote')}
                  </p>
                )}
              </div>
              <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-accent">
                    {t('settings.diagnostics.clearCacheTitle')}
                  </p>
                  <p className="ui-hint mt-1">{t('settings.diagnostics.clearCacheHint')}</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      clearAllAppCaches();
                      setCacheClearMessage(t('settings.diagnostics.clearCacheDone'));
                    }}
                    className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation text-accent"
                    style={accentBorder}
                  >
                    {t('settings.diagnostics.clearCacheButton')}
                  </button>
                  {cacheClearMessage ? (
                    <p className="text-sm text-[var(--text-mid)]" role="status">
                      {cacheClearMessage}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'telemetry' && (
            <div className="space-y-8">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.telemetryMain} />
                <p className="text-xs font-bold uppercase tracking-widest mb-1 text-accent">
                  {t('settings.telemetry.title')}
                </p>
                <p className="text-sm text-[var(--text-mid)] mb-4">
                  {t('settings.telemetry.hint')}
                </p>
                <p className="ui-hint mb-3">
                  Cache entries: {lruCache.size}
                </p>
                <p className="ui-hint mb-3">
                  Size: {lruCache.size} entries
                </p>
                <ul className="max-h-40 overflow-y-auto music-scrollbar space-y-1 mb-3">
                  {cacheEntries.map((e) => (
                    <li
                      key={e.key}
                      className="font-mono text-[9px] flex justify-between gap-2 p-2 rounded border"
                      style={{ borderColor: C.border, color: C.textMid }}
                    >
                      <span className="truncate">{e.key}</span>
                      <span className="shrink-0 text-[var(--text-dim)]">
                        exp {new Date(e.expiresAt).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    lruCache.clear();
                    setCacheTick((t) => t + 1);
                  }}
                  className="px-4 py-2 rounded-lg btn-accent-outline font-mono text-[10px] font-bold uppercase touch-manipulation"
                >
                  Clear Cache
                </button>
              </div>
              <div key={tierLogTick}>
                <p className="font-mono text-xs font-bold uppercase tracking-widest mb-3" style={accentStyle}>
                  {t('settings.telemetry.sourceResolutionLog')}
                </p>
                <ul className="max-h-48 overflow-y-auto music-scrollbar space-y-1 mb-3">
                  {getTierResolutionLog().map((entry, i) => (
                    <li
                      key={`${entry.at}-${i}`}
                      className="font-mono text-[9px] flex justify-between gap-2 p-2 rounded border"
                      style={{ borderColor: C.border, color: C.textMid }}
                    >
                      <span className="truncate">
                        T{entry.tier} {entry.provider} · {entry.outcome}
                        {entry.detail ? ` — ${entry.detail}` : ''}
                      </span>
                      <span className="shrink-0 text-[var(--text-dim)]">
                        {new Date(entry.at).toLocaleTimeString()}
                      </span>
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={() => {
                    clearTierResolutionLog();
                    setTierLogTick((t) => t + 1);
                  }}
                  className="px-4 py-2 rounded-lg btn-accent-outline font-mono text-[10px] font-bold uppercase touch-manipulation mb-6"
                >
                  {t('settings.telemetry.clearSourceLog')}
                </button>
              </div>
              <div key={cacheTick}>
                <p className="font-mono text-xs font-bold uppercase tracking-widest mb-3" style={accentStyle}>
                  {t('settings.telemetry.providerReliability')}
                </p>
                <ul className="space-y-3">
                  {providerScores.map(({ provider, score }) => {
                    const pct = Math.round(score * 100);
                    const barOpacity = score > 0.7 ? 1 : score > 0.4 ? 0.65 : 0.35;
                    const barColor = `hsl(var(--accent-h) var(--accent-s) var(--accent-l) / ${barOpacity})`;
                    return (
                      <li key={provider}>
                        <div className="flex justify-between font-mono text-[10px] uppercase mb-1">
                          <span style={{ color: C.textMid }}>{provider}</span>
                          <span style={accentStyle}>{score.toFixed(2)}</span>
                        </div>
                        <div
                          className="h-2 rounded-full overflow-hidden"
                          style={{ backgroundColor: C.bg }}
                        >
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${pct}%`, backgroundColor: barColor }}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <div className="p-4 rounded-xl border space-y-3" style={cardStyle}>
                <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
                  {t('settings.telemetry.collectionTitle')}
                </p>
                {!tier34Ok ? (
                  <p className="ui-hint">{t('settings.telemetry.collectionIdle')}</p>
                ) : graphStats ? (
                  <>
                    <ul className="grid grid-cols-2 gap-2 font-mono text-[10px] uppercase">
                      <li>Envelopes: {graphStats.envelopes}</li>
                      <li>Sources: {graphStats.sources}</li>
                      <li>Hashes: {graphStats.hashes}</li>
                      <li>Stored files: {(graphStats.dedupedBytes / (1024 * 1024)).toFixed(1)} MB</li>
                    </ul>
                    {graphStats.duplicateHashes && graphStats.duplicateHashes.length > 0 ? (
                      <div>
                        <p className="ui-hint mb-2">Duplicate hashes (dedup candidates):</p>
                        <ul className="max-h-32 overflow-y-auto music-scrollbar space-y-1">
                          {graphStats.duplicateHashes.map((row) => (
                            <li
                              key={row.hash}
                              className="font-mono text-[9px] truncate p-1.5 rounded border"
                              style={{ borderColor: C.border, color: C.textMid }}
                            >
                              {row.hash.slice(0, 16)}… · refs {row.refCount}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : (
                      <p className="ui-hint">No duplicate content hashes detected.</p>
                    )}
                    <p className="ui-hint">
                      {t('settings.telemetry.collectionHealHint')}
                    </p>
                  </>
                ) : (
                  <p className="ui-hint">{t('settings.telemetry.collectionLoading')}</p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'vault' && (
            <div className="space-y-6">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultCapacity} />
                <p className="ui-subsection-title">
                  {t('settings.vault.title')}
                </p>
                <p className="ui-hint mt-1">
                  {t('settings.vault.hint')}
                </p>
              </div>

              {isTauri() && deviceFingerprint ? (
                <div className="settings-anchor-section p-5 rounded-xl border space-y-3" style={cardStyle}>
                  <div>
                    <p className="font-mono text-xs uppercase">{t('settings.vault.deviceIdentityTitle')}</p>
                    <p className="ui-hint mt-1">{t('settings.vault.deviceIdentityHint')}</p>
                  </div>
                  <p
                    className="font-mono text-sm tracking-wider select-all"
                    style={{ color: 'var(--text-mid)' }}
                    aria-readonly="true"
                  >
                    {deviceFingerprint}
                  </p>
                </div>
              ) : null}

              <div className="settings-anchor-section p-5 rounded-xl border space-y-4" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultSandboxServer} />
                <div>
                  <p className="font-mono text-xs uppercase">{t('settings.vault.sandboxServerTitle')}</p>
                  <p className="ui-hint mt-1">{t('settings.vault.sandboxServerHint')}</p>
                </div>
                <ServerDiscovery
                  variant="settings"
                  showSubsections
                  onModeApplied={() => {
                    const synced = syncTier34BackendUrlFromServerMode();
                    setBackendUrl(synced ?? '');
                    setCacheTick((x) => x + 1);
                  }}
                  onHealthChange={(ok) => {
                    setTier34Ok(ok);
                    if (ok) setCacheTick((x) => x + 1);
                  }}
                />
                <div className="space-y-3 pt-1 border-t" style={{ borderColor: C.border }}>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs" style={{ color: C.textMid }}>
                      {t('settings.vault.sandboxServerDownloadToLocker')}
                    </span>
                    <SandboxSwitch
                      checked={sandboxServerDownloadToLocker}
                      onChange={(enabled) => {
                        setSandboxServerDownloadToLocker(enabled);
                        saveSandboxServerDownloadToLocker(enabled);
                      }}
                      aria-label={t('settings.vault.sandboxServerDownloadToLocker')}
                    />
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl border space-y-4" style={cardStyle}>
                <div className="flex justify-between items-center gap-4">
                  <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                    {t('settings.vault.maxAllocatedSpace')}
                  </span>
                  <select
                    value={capacity}
                    onChange={(e) => onCapacityChange(e.target.value as DeviceCapacity)}
                    className="input-elevated font-mono text-xs px-3 py-1 border rounded-lg"
                    style={{ color: C.text, borderRadius }}
                  >
                    {DEVICE_CAPACITY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="ui-field-label mb-1.5">
                    {t('settings.vault.storageUsed')}
                  </span>
                  <div className="h-2 w-full rounded overflow-hidden" style={{ backgroundColor: C.bg }}>
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${usagePct}%`,
                        backgroundColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))',
                      }}
                    />
                  </div>
                  <div className="flex justify-between ui-hint mt-1">
                    <span>
                      Occupied: {formatLockerMb(lockerUsageBytes)} ({lockerTrackCount} tracks)
                      {capacity !== 'UNLIMITED' ? ` · ${usagePct}%` : ''}
                    </span>
                    <span>Buffer ceiling: {formatCapacityLabel(capacity)}</span>
                  </div>
                </div>
              </div>

              <div className="p-5 rounded-xl border space-y-4" style={cardStyle}>
                <div>
                  <p className="font-mono text-xs uppercase">{t('settings.vault.downloadStorageTitle')}</p>
                  <p className="ui-hint mt-1">
                    {t('settings.vault.downloadStorageHint')}
                  </p>
                  {acquireOfflineHint({
                    browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
                    airGap: airGapEnabled,
                    tier34Ok: tier34Ok === false ? false : tier34Ok,
                    meilisearchOk: null,
                  }) ? (
                    <OfflineStatusBanner
                      className="mt-3"
                      label="Downloads limited"
                      message={
                        acquireOfflineHint({
                          browserOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
                          airGap: airGapEnabled,
                          tier34Ok: tier34Ok === false ? false : tier34Ok,
                          meilisearchOk: null,
                        })!
                      }
                    />
                  ) : null}
                </div>
                <div className="space-y-2">
                  <p className="ui-field-label">{t('settings.vault.lockerLocationLabel')}</p>
                  <p className="ui-hint">
                    {isCapacitorNative()
                      ? t('settings.vault.lockerLocationHintNative')
                      : t('settings.vault.lockerLocationHint')}
                  </p>
                  {isCapacitorNative() ? (
                    <p className="font-mono text-[10px]" style={{ color: C.textMid }}>
                      {t('settings.vault.lockerLocationNativeLabel')}
                    </p>
                  ) : null}
                  <p className="font-mono text-[10px]" style={{ color: C.textMid }}>
                    {lockerTrackCount} track(s) · {formatLockerMb(lockerUsageBytes)} used
                  </p>
                  {durabilityReport ? (
                    <p className="font-mono text-[10px] mt-1" style={{ color: C.textMid }}>
                      Offline library: {durabilityReport.playableTracks} playable
                      {durabilityReport.native
                        ? ` · ${formatDurabilityGb(
                            durabilityReport.native.durableBlobBytes +
                              durabilityReport.native.durableYtdlpBytes,
                          )} durable on device (${durabilityReport.native.durableBlobCount} native blobs, ${
                            durabilityReport.native.cacheBlobCount +
                            durabilityReport.native.cacheYtdlpCount
                          } in cache)`
                        : ''}
                    </p>
                  ) : null}
                </div>
                <div className="settings-anchor-section">
                  <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultMetadata} />
                  <MetadataRepairPanel />
                </div>
                <div className="settings-anchor-section">
                  <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultLockerRepair} />
                  <LockerRepairPanel />
                </div>
                <div className="space-y-2">
                  <p className="ui-field-label">{t('settings.vault.serverStoragePathLabel')}</p>
                  {tier34Ok && tier34StorageInfo ? (
                    <>
                      <p className="font-mono text-[10px] break-all" style={{ color: C.textMid }}>
                        {displayTier34StoragePath(tier34StorageInfo.blobsDir)}
                      </p>
                      <p className="ui-hint">
                        {t('settings.vault.serverStorageHint')}
                      </p>
                    </>
                  ) : (
                    <p className="ui-hint">
                      {t('settings.vault.serverStorageIdle')}
                    </p>
                  )}
                </div>
                <div className="settings-anchor-section space-y-2">
                  <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultNetworkSpeakers} />
                  <p className="ui-field-label">{t('settings.vault.networkSpeakersSection')}</p>
                  {tier34Ok && dlnaSettings ? (
                    <>
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="font-mono text-sm font-semibold text-[var(--text)]">
                            {t('settings.vault.networkSpeakersBrowse')}
                          </p>
                          <p className="ui-hint ui-hint--desc mt-1">
                            {t('settings.vault.networkSpeakersHint')}
                          </p>
                        </div>
                        <SandboxSwitch
                          checked={dlnaSettings.enabled}
                          disabled={dlnaSaving || !tier34Ok}
                          onChange={(enabled) => {
                            setDlnaSaving(true);
                            void tier34SetDlnaEnabled(enabled)
                              .then((result) => {
                                if (result.ok) {
                                  setDlnaSettings((prev) =>
                                    prev ? { ...prev, enabled: result.data.enabled } : prev,
                                  );
                                }
                                setCacheTick((t) => t + 1);
                              })
                              .finally(() => setDlnaSaving(false));
                          }}
                          aria-label={t('settings.vault.networkSpeakersSection')}
                        />
                      </div>
                      {dlnaSettings.enabled ? (
                        <p className="font-mono text-[10px] break-all" style={{ color: C.textMid }}>
                          {dlnaSettings.friendlyName} · {dlnaSettings.baseUrl}
                        </p>
                      ) : null}
                      {dlnaSettings.envEnabled && dlnaSettings.runtimeOverride === null ? (
                        <p className="ui-hint">
                          {t('settings.vault.networkSpeakersEnvHint')}
                        </p>
                      ) : (
                        <p className="ui-hint">
                          {t('settings.vault.networkSpeakersRuntimeHint')}
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="ui-hint">
                      {t('settings.vault.networkSpeakersIdle')}
                    </p>
                  )}
                </div>
                <div className="space-y-1">
                  <p className="ui-field-label">{t('settings.vault.defaultDownloadBehavior')}</p>
                  <p className="ui-hint">
                    {t('settings.vault.defaultDownloadSaveTo', {
                      target: t('settings.vault.defaultDownloadLockerTarget'),
                    })}
                    {lockerSync.enabled && lockerSync.mode === 'full' && lockerSync.provider === 'tier34'
                      ? t('settings.vault.defaultDownloadMirrorSuffix')
                      : t('settings.vault.defaultDownloadSyncHint')}
                  </p>
                  <p className="ui-hint">
                    {t('settings.vault.defaultDownloadImportHint', {
                      watchFolder: t('settings.vault.watchFolderLink'),
                    })}
                  </p>
                </div>
              </div>

              <div className="settings-anchor-section p-5 rounded-xl border space-y-4" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultStreamCache} />
                <div>
                  <p className="font-mono text-xs uppercase">{t('settings.vault.streamCacheTitle')}</p>
                  <p className="ui-hint mt-1">
                    {t('settings.vault.streamCacheDesc')}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                    {t('settings.vault.streamCacheEnable')}
                  </span>
                  <SandboxSwitch
                    checked={streamCacheEnabled}
                    onChange={(enabled) => {
                      setStreamCacheEnabled(enabled);
                      saveStreamCacheEnabled(enabled);
                    }}
                    aria-label="Enable stream cache"
                  />
                </div>
                <div className="flex justify-between items-center gap-4">
                  <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                    {t('settings.vault.streamCacheSizeLimit')}
                  </span>
                  <select
                    value={streamCacheLimitMb}
                    disabled={!streamCacheEnabled}
                    onChange={(e) => {
                      const mb = parseInt(e.target.value, 10) as StreamCacheLimitMb;
                      setStreamCacheLimitMb(mb);
                      saveStreamCacheLimitMb(mb);
                    }}
                    className="input-elevated font-mono text-xs px-3 py-1 border rounded-lg"
                    style={{
                      color: C.text,
                      borderRadius,
                      opacity: streamCacheEnabled ? 1 : 0.6,
                    }}
                  >
                    {STREAM_CACHE_LIMIT_OPTIONS.map((mb) => (
                      <option key={mb} value={mb}>
                        {mb} MB
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="ui-field-label mb-1.5">{t('settings.vault.streamCacheUsed')}</span>
                  <div className="h-2 w-full rounded overflow-hidden" style={{ backgroundColor: C.bg }}>
                    <div
                      className="h-full rounded transition-all"
                      style={{
                        width: `${streamCacheUsagePct}%`,
                        backgroundColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))',
                      }}
                    />
                  </div>
                  <div className="flex justify-between ui-hint mt-1">
                    <span>
                      Occupied: {formatStreamCacheMb(streamCacheUsageBytes)} ({streamCacheTrackCount}{' '}
                      tracks) · {streamCacheUsagePct}%
                    </span>
                    <span>Limit: {streamCacheLimitMb} MB</span>
                  </div>
                </div>
                <button
                  type="button"
                  disabled={!streamCacheEnabled || streamCacheTrackCount === 0}
                  onClick={() => {
                    void clearStreamCache().then(refreshStreamCacheUsage);
                  }}
                  className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                  style={{ ...accentBorder, borderColor: C.border }}
                >
                  {t('settings.vault.streamCacheClear')}
                </button>
                <div className="pt-3 border-t space-y-4" style={{ borderColor: C.border }}>
                  <div>
                    <p className="font-mono text-xs uppercase">{t('settings.vault.aggressiveCacheTitle')}</p>
                    <p className="ui-hint mt-1">
                      {t('settings.vault.aggressiveCacheHint')}
                    </p>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                      {t('settings.vault.aggressiveCacheToggle')}
                    </span>
                    <SandboxSwitch
                      checked={aggressiveCacheEnabled}
                      disabled={!streamCacheEnabled}
                      onChange={(enabled) => {
                        setAggressiveCacheEnabled(enabled);
                        saveAggressiveOfflineCacheEnabled(enabled);
                      }}
                      aria-label={t('settings.vault.aggressiveCacheToggle')}
                    />
                  </div>
                  <div className="flex justify-between items-center gap-4">
                    <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                      {t('settings.vault.aggressiveCacheMaxSize')}
                    </span>
                    <select
                      value={aggressiveCacheMaxMb}
                      disabled={!streamCacheEnabled || !aggressiveCacheEnabled}
                      onChange={(e) => {
                        const mb = parseInt(e.target.value, 10) as AggressiveCacheMaxMb;
                        setAggressiveCacheMaxMb(mb);
                        saveAggressiveCacheMaxMb(mb);
                      }}
                      className="input-elevated font-mono text-xs px-3 py-1 border rounded-lg"
                      style={{
                        color: C.text,
                        borderRadius,
                        opacity: streamCacheEnabled && aggressiveCacheEnabled ? 1 : 0.6,
                      }}
                    >
                      {AGGRESSIVE_CACHE_MAX_OPTIONS.map((mb) => (
                        <option key={mb} value={mb}>
                          {mb} MB
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="settings-anchor-section p-5 rounded-xl border space-y-4" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultWatchFolder} />
                <div>
                  <p className="font-mono text-xs uppercase">{t('settings.vault.watchFolderTitle')}</p>
                  <p className="ui-hint mt-1">
                    {t('settings.vault.watchFolderHint')}{' '}
                    {t('settings.vault.ingestionGraphHint')}{' '}
                    (e.g. <span className="font-mono">D:\Music</span> on Windows).
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                    {t('settings.vault.watchFolderEnable')}
                  </span>
                  <SandboxSwitch
                    checked={Boolean(ingestionWatch?.enabled && ingestionWatch?.watching)}
                    disabled={!tier34Ok || watchSaving}
                    onChange={(enabled) => {
                      const path = watchPathInput.trim() || ingestionWatch?.path;
                      if (enabled && !path) {
                        setWatchStatusMsg('Set a watch path first, then enable.');
                        return;
                      }
                      setWatchSaving(true);
                      void tier34SetIngestionWatchDetailed({
                        enabled,
                        path,
                      })
                        .then((result) => {
                          if ('error' in result) {
                            setWatchStatusMsg(result.error);
                            return;
                          }
                          setIngestionWatch(result.data);
                          setWatchStatusMsg(
                            result.data.watching
                              ? `Watching ${sanitizePathForDisplay(result.data.path)}`
                              : 'Watch stopped',
                          );
                        })
                        .finally(() => setWatchSaving(false));
                    }}
                    aria-label="Enable folder watch ingestion"
                  />
                </div>
                <div className="space-y-2">
                  <label className="ui-field-label" htmlFor="watch-folder-path">
                    WATCH PATH
                  </label>
                  <input
                    id="watch-folder-path"
                    type="text"
                    value={watchPathInput}
                    disabled={!tier34Ok}
                    onChange={(e) => setWatchPathInput(e.target.value)}
                    placeholder="D:\Music or /home/user/Music"
                    className="input-elevated w-full px-4 py-3 font-mono text-xs"
                    style={{ color: C.text, borderRadius }}
                  />
                  <button
                    type="button"
                    disabled={!tier34Ok || watchSaving || !watchPathInput.trim()}
                    onClick={() => {
                      const path = watchPathInput.trim();
                      if (!path) return;
                      setWatchSaving(true);
                      void tier34SetIngestionWatchDetailed({
                        path,
                        enabled: ingestionWatch?.enabled ?? false,
                      })
                        .then((result) => {
                          if ('error' in result) {
                            setWatchStatusMsg(result.error);
                            return;
                          }
                          setIngestionWatch(result.data);
                          setWatchStatusMsg('Watch path saved');
                        })
                        .finally(() => setWatchSaving(false));
                    }}
                    className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                    style={{ ...accentBorder, borderColor: C.border }}
                  >
                    {watchSaving ? 'Saving…' : 'Save path'}
                  </button>
                </div>
                {ingestionWatch ? (
                  <p className="ui-hint">
                    Status:{' '}
                    {ingestionWatch.watching ? (
                      <span style={accentStyle}>watching</span>
                    ) : (
                      'stopped'
                    )}
                    {ingestionWatch.path
                      ? ` · ${sanitizePathForDisplay(ingestionWatch.path)}`
                      : ''}
                    {' · '}
                    {ingestionWatch.filesProcessed} imported, {ingestionWatch.filesSkipped} skipped
                    (hash dedup)
                  </p>
                ) : null}
                {watchStatusMsg ? (
                  <p className="text-xs font-mono" style={accentStyle}>
                    {watchStatusMsg}
                  </p>
                ) : null}
                {!tier34Ok ? (
                  <p className="ui-hint">Start your Sandbox Server to configure ingestion.</p>
                ) : !isLocalTier34Backend(backendUrl) && ingestionWatch?.path ? (
                  <p className="ui-hint">
                    Watch folder is configured on the Sandbox Server host; path details are hidden for
                    privacy.
                  </p>
                ) : null}
                <p className="ui-hint text-[10px]">
                  {t('settings.vault.watchFolderPickerHint')}
                </p>
              </div>

              <div className="settings-anchor-section p-5 rounded-xl border space-y-3" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultLockerSync} />
                <div>
                  <p className="font-mono text-xs uppercase">{t('settings.vault.syncTitle')}</p>
                  <p className="ui-hint mt-1">
                    {t('settings.vault.syncHint')}
                  </p>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                    ENABLE LOCKER METADATA SYNC
                  </span>
                  <SandboxSwitch
                    checked={lockerSync.enabled}
                    disabled={!isLockerSyncAvailable()}
                    onChange={(enabled) => {
                      const next = saveLockerSyncSettings({
                        enabled,
                        mode: enabled ? 'full' : 'off',
                      });
                      setLockerSync(next);
                    }}
                    aria-label="Cross-device locker sync"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                      BACKGROUND SYNC
                    </span>
                    <p className="ui-hint text-[10px]">
                      Pull new uploads every few minutes and when you return to the app — no manual Sync now.
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={lockerSync.backgroundSync !== false}
                    disabled={!lockerSync.enabled}
                    onChange={(backgroundSync) => {
                      const next = saveLockerSyncSettings({ backgroundSync });
                      setLockerSync(next);
                    }}
                    aria-label="Background locker sync"
                  />
                </div>
                <LockerSyncConflictsPanel />
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                      WI-FI ONLY FILE SYNC
                    </span>
                    <p className="ui-hint text-[10px]">Skip cellular sync when Network Information API reports mobile.</p>
                  </div>
                  <SandboxSwitch
                    checked={lockerSync.wifiOnly}
                    disabled={!lockerSync.enabled}
                    onChange={(wifiOnly) => {
                      const next = saveLockerSyncSettings({ wifiOnly });
                      setLockerSync(next);
                    }}
                    aria-label="Wi-Fi only locker sync"
                  />
                </div>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                      SELECTIVE ALBUM SYNC
                    </span>
                    <p className="ui-hint text-[10px]">
                      {t('settings.vault.syncSelectiveHint')}
                    </p>
                  </div>
                  <SandboxSwitch
                    checked={lockerSync.selectiveSync}
                    disabled={!lockerSync.enabled}
                    onChange={(selectiveSync) => {
                      const next = saveLockerSyncSettings({ selectiveSync });
                      setLockerSync(next);
                    }}
                    aria-label="Selective album sync"
                  />
                </div>
                <div className="flex justify-between items-center gap-4">
                  <span className="font-mono text-xs uppercase" style={{ color: C.textMid }}>
                    SYNC PROVIDER
                  </span>
                  <select
                    value={lockerSync.provider}
                    disabled={!lockerSync.enabled}
                    onChange={(e) => {
                      const provider = e.target.value as LockerSyncProvider;
                      const next = saveLockerSyncSettings({
                        provider,
                        mode: provider === 'tier34' ? 'full' : 'metadata-only',
                      });
                      setLockerSync(next);
                    }}
                    className="input-elevated font-mono text-xs px-3 py-1 border rounded-lg"
                    style={{
                      color: C.text,
                      borderRadius,
                      opacity: lockerSync.enabled ? 1 : 0.6,
                    }}
                  >
                    {(
                      [
                        ['none', 'Off (file export)'],
                        ['webdav', t('settings.vault.syncProviderWebdav')],
                        ['s3', 'S3-compatible (export only)'],
                        ['tier34', 'Sandbox Server'],
                      ] as const satisfies ReadonlyArray<[LockerSyncProvider, string]>
                    ).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <p className="sync-tier34-note">
                    Requires the Sandbox Server running on the host machine
                  </p>
                </div>
                {lockerSync.provider === 'webdav' && lockerSync.enabled ? (
                  <div>
                    <label className="ui-field-label">{t('settings.vault.cloudFolderUrl')}</label>
                    <input
                      type="url"
                      value={lockerSync.remoteBaseUrl}
                      onChange={(e) => {
                        const next = saveLockerSyncSettings({ remoteBaseUrl: e.target.value });
                        setLockerSync(next);
                      }}
                      placeholder="https://cloud.example.com/remote.php/dav/files/user"
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    />
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={!lockerSync.enabled}
                    onClick={() => {
                      setLockerSyncStatus('Exporting…');
                      void exportLockerManifest()
                        .then(() => {
                          setLockerSync(loadLockerSyncSettings());
                          setLockerSyncStatus('Library list exported.');
                        })
                        .catch((err) => {
                          const msg = err instanceof Error ? err.message : 'Export failed';
                          recordLockerSyncResult(false, msg);
                          setLockerSync(loadLockerSyncSettings());
                          setLockerSyncStatus(msg);
                        });
                    }}
                    className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                    style={{ ...accentBorder, borderColor: C.border }}
                  >
                    Export library list
                  </button>
                  <button
                    type="button"
                    disabled={!lockerSync.enabled}
                    onClick={() => lockerImportRef.current?.click()}
                    className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                    style={{ ...accentBorder, borderColor: C.border }}
                  >
                    Import library list
                  </button>
                  {lockerSync.provider === 'webdav' && lockerSync.remoteBaseUrl.trim() ? (
                    <>
                      <button
                        type="button"
                        disabled={!lockerSync.enabled}
                        onClick={() => {
                          setLockerSyncStatus(t('settings.vault.syncPushCloudStatus'));
                          void exportLockerManifest()
                            .then((m) => pushManifestToWebdav(m, lockerSync.remoteBaseUrl))
                            .then(() => {
                              setLockerSync(loadLockerSyncSettings());
                              setLockerSyncStatus(t('settings.vault.syncPushCloudOk'));
                            })
                            .catch((err) => {
                              const msg = err instanceof Error ? err.message : t('settings.vault.syncPushCloudFailed');
                              recordLockerSyncResult(false, msg);
                              setLockerSync(loadLockerSyncSettings());
                              setLockerSyncStatus(msg);
                            });
                        }}
                        className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                        style={{ ...accentBorder, borderColor: C.border }}
                      >
                        {t('settings.vault.syncPushCloud')}
                      </button>
                      <button
                        type="button"
                        disabled={!lockerSync.enabled}
                        onClick={() => {
                          setLockerSyncStatus(t('settings.vault.syncPullCloudStatus'));
                          void pullManifestFromWebdav(lockerSync.remoteBaseUrl)
                            .then((m) => importLockerManifest(m))
                            .then((r) => {
                              setLockerSync(loadLockerSyncSettings());
                              const pl = formatPlaylistSyncStats(r);
                              setLockerSyncStatus(
                                `Updated ${r.updated}, new ${r.imported}, skipped ${r.skipped}.${pl ? ` ${pl}` : ''}`,
                              );
                            })
                            .catch((err) => {
                              const msg = err instanceof Error ? err.message : t('settings.vault.syncPullCloudFailed');
                              recordLockerSyncResult(false, msg);
                              setLockerSync(loadLockerSyncSettings());
                              setLockerSyncStatus(msg);
                            });
                        }}
                        className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                        style={{ ...accentBorder, borderColor: C.border }}
                      >
                        {t('settings.vault.syncPullCloud')}
                      </button>
                    </>
                  ) : null}
                  {(lockerSync.provider === 'tier34' || lockerSync.provider === 'webdav') &&
                  lockerSync.enabled ? (
                    <button
                      type="button"
                      disabled={!lockerSync.enabled}
                      onClick={() => {
                        setLockerSyncStatus('Syncing…');
                        void pullAndMergeLockerManifest()
                          .then((r) => {
                            setLockerSync(loadLockerSyncSettings());
                            const pl = formatPlaylistSyncStats(r);
                            const blobPart =
                              r.pulled > 0 || r.skipped > 0 || r.deleted > 0
                                ? `Music files: ${r.pulled} pulled, ${r.skipped} skipped${r.deleted > 0 ? `, ${r.deleted} deleted` : ''}. `
                                : '';
                            setLockerSyncStatus(`${blobPart}${pl || 'Sync complete.'}`.trim());
                          })
                          .catch((err) => {
                            const msg = err instanceof Error ? err.message : 'Sync failed';
                            recordLockerSyncResult(false, msg);
                            setLockerSync(loadLockerSyncSettings());
                            setLockerSyncStatus(msg);
                          });
                      }}
                      className="px-3 py-1.5 font-mono text-[10px] uppercase font-bold border rounded-lg touch-manipulation disabled:opacity-40"
                      style={{ ...accentBorder, borderColor: C.border }}
                    >
                      Sync now
                    </button>
                  ) : null}
                </div>
                <input
                  ref={lockerImportRef}
                  type="file"
                  accept="application/json,.json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    setLockerSyncStatus('Importing…');
                    void parseManifestFile(file)
                      .then((m) => importLockerManifest(m))
                      .then((r) => {
                        setLockerSync(loadLockerSyncSettings());
                        const pl = formatPlaylistSyncStats(r);
                        setLockerSyncStatus(
                          `Updated ${r.updated}, new ${r.imported}, skipped ${r.skipped}.${pl ? ` ${pl}` : ''}`,
                        );
                      })
                      .catch((err) => {
                        const msg = err instanceof Error ? err.message : 'Import failed';
                        recordLockerSyncResult(false, msg);
                        setLockerSync(loadLockerSyncSettings());
                        setLockerSyncStatus(msg);
                      });
                  }}
                />
                <p className="sync-status-note">
                  {lockerSyncStatus ||
                    (lockerSync.lastSyncedAt
                      ? `Last sync: ${new Date(lockerSync.lastSyncedAt).toLocaleString()}`
                      : 'Enable sync + Sandbox Server provider for audio replication')}
                </p>
                {lastPlaylistSyncStats &&
                (lastPlaylistSyncStats.playlistsImported > 0 ||
                  lastPlaylistSyncStats.playlistsMerged > 0 ||
                  lastPlaylistSyncStats.playlistsDeleted > 0 ||
                  lastPlaylistSyncStats.conflictsResolved > 0) ? (
                  <p className="font-mono text-[10px] text-[var(--text-mid)]">
                    {formatPlaylistSyncStats(lastPlaylistSyncStats)}
                  </p>
                ) : null}
              </div>

              <div className="settings-anchor-section p-5 rounded-xl border space-y-3" style={cardStyle}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.vaultTasteRecipes} />
                <TasteRecipePanel stationName="Shared taste station" />
              </div>

              <div className="border-t pt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3" style={{ borderColor: C.border }}>
                <span className="ui-field-label ui-field-label--inline">
                  DANGER ZONE VAULT ACTIONS
                </span>
                <button
                  type="button"
                  onClick={() => setFlushVaultConfirmOpen(true)}
                  className="px-4 py-2 font-mono text-xs uppercase border touch-manipulation"
                  style={{
                    borderRadius,
                    color: '#ef4444',
                    borderColor: 'rgba(239,68,68,0.3)',
                    backgroundColor: 'rgba(127,29,29,0.2)',
                  }}
                >
                  Flush Local Locker Databases
                </button>
              </div>
            </div>
          )}

          {activeTab === 'architect' && (
            <div className="space-y-6">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectPresets} />
                <p className="ui-subsection-title">
                  {t('settings.architect.panelTitle')}
                </p>
                <p className="ui-hint mt-1">
                  {t('settings.architect.panelHint')}
                </p>
              </div>
              <div className="settings-anchor-section p-4 border rounded-xl" style={cardStyle}>
                <NavPinTabsSettings />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {THEME_PRESETS.map((preset) => (
                  <button
                    key={preset.toneKey}
                    type="button"
                    onClick={() => {
                      setThemeTone(preset.toneKey);
                      setBorderRadius(preset.radius);
                      prefsSetItem(RADIUS_KEY, preset.radius);
                      const nextFontId = architectFontToPlatformId(preset.font);
                      setFontId(nextFontId);
                      applyPlatformTypography(nextFontId, fontSizePx);
                      const next = applyThemePreset(preset.toneKey, {
                        h: preset.focusH,
                        s: preset.focusS,
                        l: preset.focusL,
                        hex: preset.focusHex,
                      });
                      setAccentHex(preset.focusHex);
                      setHue(next.h);
                      setAccentS(next.s);
                      setAccentL(next.l);
                      setIntensity(next.intensity);
                    }}
                    className="p-3 border text-left touch-manipulation"
                    style={{
                      borderRadius,
                      borderColor: themeTone === preset.toneKey ? 'var(--accent-focus)' : C.border,
                      ...(themeTone === preset.toneKey ? accentBgSoft : {}),
                    }}
                  >
                    <p className="font-mono text-xs font-bold uppercase truncate">
                      {t(`settings.architect.presets.${preset.presetKey}`)}
                    </p>
                    <p className="ui-card-meta line-clamp-2">
                      {t(preset.descriptionKey)}
                    </p>
                  </button>
                ))}
              </div>

              <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectTypography} />
                <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
                  {t('settings.architect.readability')}
                </p>
                <p className="ui-hint">
                  {t('settings.architect.readabilityHint')}
                </p>
                <div className="p-4 rounded-xl border space-y-4" style={cardStyle}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(Object.keys(PLATFORM_FONTS) as PlatformFontId[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setFontId(id);
                          applyPlatformTypography(id, fontSizePx);
                        }}
                        className="px-4 py-3 text-left border rounded-xl touch-manipulation"
                        style={{
                          borderColor:
                            fontId === id
                              ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))'
                              : C.border,
                          ...(fontId === id ? accentBgSoft : {}),
                          fontFamily: PLATFORM_FONTS[id].stack,
                        }}
                      >
                        <span className="font-bold text-[var(--text)] block">
                          {t(ARCHITECT_FONT_LABEL_KEYS[id])}
                        </span>
                      </button>
                    ))}
                  </div>
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="ui-field-label ui-field-label--inline">
                        {t('settings.architect.textSize')}
                      </label>
                      <span className="font-mono text-sm font-bold" style={accentStyle}>
                        {fontSizePx}px
                      </span>
                    </div>
                    <input
                      type="range"
                      min={12}
                      max={24}
                      step={1}
                      value={fontSizePx}
                      onChange={(e) => {
                        const px = parseInt(e.target.value, 10);
                        setFontSizePx(px);
                        applyPlatformTypography(fontId, px);
                      }}
                      className="w-full accent-accent"
                    />
                    <div className="flex justify-between ui-hint mt-1">
                      <span>12</span>
                      <span>24</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectLanguage} />
                <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
                  {t('settings.language.title')}
                </p>
                <p className="ui-hint">
                  {t('settings.language.hint')}
                </p>
                <div className="p-4 rounded-xl border space-y-3" style={cardStyle}>
                  <label className="ui-field-label ui-field-label--inline">
                    {t('settings.language.interfaceLabel')}
                  </label>
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2 max-h-48 overflow-y-auto pr-1">
                    {LANGUAGE_OPTIONS.map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setLanguage(opt.id);
                          saveLanguage(opt.id);
                        }}
                        className="px-3 py-2 font-mono text-[10px] font-bold border touch-manipulation text-center"
                        style={{
                          borderRadius,
                          borderColor:
                            language === opt.id
                              ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))'
                              : C.border,
                          ...(language === opt.id ? accentBgSoft : {}),
                          color: language === opt.id ? C.text : C.textMid,
                        }}
                      >
                        {opt.nativeLabel}
                      </button>
                    ))}
                  </div>
                  <p className="ui-hint">
                    {t('settings.language.active', { code: language.toUpperCase() })}
                  </p>
                </div>
              </div>

              <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectEngine} />
                <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
                  {t('settings.architect.engineTheming')}
                </p>
                <p className="ui-hint">
                  {t('settings.architect.engineHint')}
                </p>
                <div className="p-4 rounded-xl border space-y-4" style={cardStyle}>
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="ui-field-label ui-field-label--inline">
                        {t('settings.architect.hueSpectrum')}
                      </label>
                      <span className="font-mono text-[10px] font-bold" style={accentStyle}>
                        {hue}°
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={hue}
                      onChange={(e) => {
                        enterCustomTheme();
                        setHue(parseInt(e.target.value, 10));
                      }}
                      className="w-full h-2 rounded-lg cursor-pointer accent-accent"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(INTENSITY_PRESETS) as IntensityId[]).map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setIntensityPreset(id)}
                        className="px-4 py-2 font-mono text-[10px] uppercase font-bold border touch-manipulation"
                        style={{
                          borderRadius,
                          borderColor:
                            intensity === id
                              ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))'
                              : C.border,
                          ...(intensity === id ? accentBgSoft : {}),
                          color: intensity === id ? C.text : C.textMid,
                        }}
                      >
                        {t(`settings.architect.intensity.${id}`)}
                      </button>
                    ))}
                  </div>
                  <div
                    className="h-10 rounded-lg border"
                    style={{
                      backgroundColor: 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))',
                      borderColor: C.border,
                    }}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 border-t pt-4" style={{ borderColor: C.border }}>
                <div>
                  <label className="ui-field-label">
                    {t('settings.architect.chassisAccent')}
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="color"
                      value={accentHex}
                      onChange={(e) => {
                        enterCustomTheme();
                        setAccentHex(e.target.value);
                        prefsSetItem(ACCENT_HEX_KEY, e.target.value);
                      }}
                      className="w-10 h-8 rounded border cursor-pointer"
                      style={{ borderColor: C.border }}
                    />
                    <input
                      type="text"
                      value={accentHex}
                      onChange={(e) => {
                        enterCustomTheme();
                        setAccentHex(e.target.value);
                        prefsSetItem(ACCENT_HEX_KEY, e.target.value);
                      }}
                      className="flex-1 px-2 font-mono text-xs border"
                      style={{ ...cardStyle, color: C.text }}
                    />
                  </div>
                </div>
                <div>
                  <label className="ui-field-label">
                    {t('settings.architect.borderRadius')}
                  </label>
                  <select
                    value={borderRadius}
                    onChange={(e) => {
                      setBorderRadius(e.target.value);
                      prefsSetItem(RADIUS_KEY, e.target.value);
                    }}
                    className="w-full px-3 py-1.5 font-mono text-xs border"
                    style={{ ...cardStyle, color: C.text }}
                  >
                    {BORDER_RADIUS_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {t(opt.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <span className="ui-field-label">
                    {t('settings.architect.activePreset')}
                  </span>
                  <div className="p-2.5 border font-mono text-[10px] uppercase flex justify-between" style={cardStyle}>
                    <span className="ui-hint uppercase">{t('settings.architect.activeSystemSignal')}</span>
                    <span className="font-bold" style={accentStyle}>
                      {themeToneDisplayLabel(themeTone, t).toUpperCase()}
                    </span>
                  </div>
                </div>
              </div>

              <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectHero} />
                <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
                  {t('settings.architect.heroDisplayTitle')}
                </p>
                <p className="ui-hint">{t('settings.architect.heroDisplayHint')}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(
                    [
                      {
                        id: 'album-cover' as const,
                        labelKey: 'settings.architect.heroDisplayAlbumCover',
                        hintKey: 'settings.architect.heroDisplayAlbumCoverDesc',
                      },
                      {
                        id: 'vinyl-shades' as const,
                        labelKey: 'settings.architect.heroDisplayVinylShades',
                        hintKey: 'settings.architect.heroDisplayVinylShadesDesc',
                      },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => {
                        setHeroDisplay(opt.id);
                        saveHeroDisplayMode(opt.id);
                      }}
                      className="p-4 rounded-xl border text-left touch-manipulation transition-colors"
                      style={{
                        borderRadius,
                        borderColor:
                          heroDisplay === opt.id
                            ? 'hsl(var(--accent-h), var(--accent-s), var(--accent-l))'
                            : C.border,
                        ...(heroDisplay === opt.id ? accentBgSoft : cardStyle),
                      }}
                    >
                      <p
                        className="font-mono text-xs font-bold uppercase"
                        style={heroDisplay === opt.id ? accentStyle : { color: C.text }}
                      >
                        {t(opt.labelKey)}
                      </p>
                      <p className="ui-hint mt-1">{t(opt.hintKey)}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectCardScale} />
                <div className="flex justify-between mb-2">
                  <label className="ui-field-label ui-field-label--inline">
                    {t('settings.architect.albumCardSize')}
                  </label>
                  <span className="font-mono text-xs font-bold" style={accentStyle}>
                    {cardScale.toFixed(2)}x
                  </span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={cardScale}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setCardScale(v);
                    prefsSetItem(CARD_SCALE_KEY, String(v));
                  }}
                  className="w-full accent-accent"
                />
                <p className="ui-hint mt-2">
                  {t('settings.architect.albumCardHint')}
                </p>
              </div>

              <div className="settings-anchor-section border-t pt-6 space-y-4" style={{ borderColor: C.border }}>
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectShortcuts} />
                <p className="font-mono text-xs font-bold uppercase tracking-widest" style={accentStyle}>
                  {t('settings.architect.controlsTitle')}
                </p>
                <p className="ui-hint">{t('settings.architect.controlsHint')}</p>
                <div className="p-4 rounded-xl border space-y-4" style={cardStyle}>
                  <div className="space-y-3">
                    <div>
                      <p className="font-mono text-xs uppercase">{t('settings.architect.shortcutsTitle')}</p>
                      <p className="ui-hint">{t('settings.architect.shortcutsHint')}</p>
                    </div>
                    <ul className="space-y-2">
                      {SHORTCUT_LEGEND.map((entry) => (
                        <li
                          key={entry.keys}
                          className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 py-1.5 border-b border-[var(--border)] last:border-0"
                        >
                          <span className="font-mono text-[10px] uppercase text-accent">{entry.keys}</span>
                          <span className="text-xs text-[var(--text-mid)]">{entry.action}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="settings-anchor-section border-t pt-4 space-y-3" style={{ borderColor: C.border }}>
                    <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.architectSearchSort} />
                    <div>
                      <p className="font-mono text-xs uppercase">{t('settings.architect.searchSortTitle')}</p>
                      <p className="ui-hint">{t('settings.architect.searchSortHint')}</p>
                    </div>
                    <select
                      value={searchSortOrder}
                      onChange={(e) => {
                        const next = e.target.value as SearchSortOrder;
                        setSearchSortOrder(next);
                        saveSearchSortOrder(next);
                      }}
                      className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent"
                      style={{ color: C.text }}
                    >
                      <option value="newest">Newest first</option>
                      <option value="oldest">Oldest first</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'vinyl' && (
            <VinylSettingsPanel
              vinylVisuals={vinylVisuals}
              onPatchVinylVisual={patchVinylVisual}
              onSetVinylVisuals={(next) => {
                setVinylVisuals(next);
                saveVinylVisualSettings(next);
              }}
              displayMode={vinylDisplayMode}
              onDisplayModeChange={setVinylDisplayMode}
              officialPresets={getOfficialPresets()}
              communityPacks={communityPacks}
              activeRecordPlayerAddonId={activeRecordPlayerAddonId}
              onSetActivePreset={setActiveRecordPlayerAddon}
              onRemoveCommunityPack={(id) => {
                removeRecordPlayerAddon(id);
                refreshRecordPlayerAddons();
                setRecordPlayerAddonStatus(
                  t('settings.vinyl.presetRemoved', {
                    name: communityPacks.find((p) => p.id === id)?.name ?? id,
                  }),
                );
              }}
              recordPlayerAddonUrl={recordPlayerAddonUrl}
              onRecordPlayerAddonUrlChange={(url) => {
                setRecordPlayerAddonUrl(url);
                if (recordPlayerAddonStatus) setRecordPlayerAddonStatus('');
              }}
              onInstallFromUrl={() => void installRecordPlayerAddon()}
              onInstallCatalogEntry={(entry) => void installCatalogPack(entry)}
              onBrowseCatalog={() => void browseRecordPlayerCatalog()}
              onImportClipboard={() => void importRecordPlayerAddonClipboard()}
              recordPlayerAddonStatus={recordPlayerAddonStatus}
              recordPlayerAddonInstalling={recordPlayerAddonInstalling}
              recordPlayerCatalog={recordPlayerCatalog}
              recordPlayerCatalogLoading={recordPlayerCatalogLoading}
              recordPlayerAddonUrlRef={recordPlayerAddonUrlRef}
              borderRadius={borderRadius}
              cardStyle={cardStyle}
            />
          )}

          {activeTab === 'about' && (
            <div className="space-y-5">
              <div className="settings-anchor-section">
                <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.aboutMain} />
                <p className="ui-subsection-title">{t('settings.about.title')}</p>
                <p className="ui-hint ui-hint--desc mt-1">{t('settings.about.hint')}</p>
              </div>

              <div className="p-4 border rounded-xl space-y-2" style={cardStyle}>
                <p className="font-mono text-sm font-semibold text-[var(--text)]">
                  {t('login.appName')}
                </p>
                <p className="ui-hint ui-hint--desc">{t('settings.about.version', { version: '1.0.0' })}</p>
                <p className="ui-hint ui-hint--desc">{t('settings.about.tagline')}</p>
              </div>

              <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                <p className="font-mono text-sm font-semibold text-[var(--text)]">
                  {t('settings.about.gettingStartedTitle')}
                </p>
                <ul className="ui-hint ui-hint--desc space-y-2 list-disc pl-4">
                  <li>{t('settings.about.gettingStartedLocker')}</li>
                  <li>{t('settings.about.gettingStartedServer')}</li>
                  <li>{t('settings.about.gettingStartedConnect')}</li>
                  <li>{t('settings.about.gettingStartedCar')}</li>
                </ul>
              </div>

              <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                <p className="font-mono text-sm font-semibold text-[var(--text)]">
                  {t('settings.about.addonGuideTitle')}
                </p>
                <p className="ui-hint ui-hint--desc">{t('settings.about.addonGuideHint')}</p>
                <pre className="ui-hint p-3 rounded-lg border border-[var(--border)] bg-[var(--bg-void)] overflow-x-auto text-[var(--text-mid)]">
                  {ADDON_MANIFEST_EXAMPLE}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('addons');
                    if (isMobileLayout) setMobileDrill('addons');
                    setShowAddonGuide(true);
                  }}
                  className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation text-accent"
                  style={accentBorder}
                >
                  {t('settings.about.openAddonsPanel')}
                </button>
              </div>

              <div className="p-4 border rounded-xl space-y-3" style={cardStyle}>
                <p className="font-mono text-sm font-semibold text-[var(--text)]">
                  {t('settings.about.connectTitle')}
                </p>
                <p className="ui-hint ui-hint--desc">{t('settings.about.connectHint')}</p>
                <button
                  type="button"
                  onClick={() => {
                    setActiveTab('playback');
                    if (isMobileLayout) setMobileDrill('playback');
                  }}
                  className="font-mono text-[10px] uppercase tracking-wider border px-4 py-2 rounded-sm touch-manipulation text-accent"
                  style={accentBorder}
                >
                  {t('settings.about.openPlaybackPanel')}
                </button>
              </div>
            </div>
          )}
        </div>
        )}
          </>
        )}
      </div>

      {!(isMobileLayout && showMobileRoot) ? (
      <section
        className={`settings-anchor-section settings-profile rounded-xl border p-4 mt-6${isMobileLayout ? ' settings-profile--mobile' : ''}`}
        style={{ backgroundColor: C.card, borderColor: C.border }}
      >
        <SettingsSectionAnchor id={SETTINGS_SEARCH_ANCHORS.profileSignOut} />
        <p className="ui-hint uppercase tracking-widest mb-2">
          {t('settings.profile')}
        </p>
        <p className="font-mono text-sm font-bold uppercase">{profileName}</p>
        <button
          type="button"
          onClick={onSignOut}
          className="settings-sign-out mt-4 flex items-center gap-2 font-mono text-[10px] uppercase font-bold tracking-wider touch-manipulation"
          style={accentStyle}
        >
          <LogOut className="w-4 h-4" />
          {t('settings.signOut')}
        </button>
      </section>
      ) : null}
    </div>
    <ConnectSetupWizard
      open={connectWizardOpen}
      onClose={() => setConnectWizardOpen(false)}
      onComplete={() => {
        setNetworkSync(true);
        setConnectRole(loadConnectRolePref());
        setConnectDeviceName(loadConnectDeviceName());
      }}
    />
    <ConfirmDialog
      open={flushVaultConfirmOpen}
      onClose={() => {
        if (flushVaultBusy) return;
        setFlushVaultConfirmOpen(false);
      }}
      onConfirm={() => {
        setFlushVaultBusy(true);
        void clearLockerVault({ userConfirmed: LOCKER_USER_DELETE_CONFIRMED })
          .then(() => {
            setFlushVaultConfirmOpen(false);
            setFlushVaultSuccessOpen(true);
          })
          .finally(() => setFlushVaultBusy(false));
      }}
      title={t('settings.vault.flushConfirmTitle')}
      message={t('settings.vault.flushConfirmMessage')}
      confirmLabel={t('settings.vault.flushConfirmAction')}
      danger
      confirming={flushVaultBusy}
    />
    <AlertDialog
      open={flushVaultSuccessOpen}
      onClose={() => setFlushVaultSuccessOpen(false)}
      title={t('settings.vault.flushSuccessTitle')}
      message={t('settings.vault.flushSuccessMessage')}
    />
    </>
  );
}
