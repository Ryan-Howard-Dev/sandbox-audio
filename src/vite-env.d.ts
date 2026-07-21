/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Injected at Android debug APK build time (vite define). */
declare const __SANDBOX_ANDROID_E2E__: boolean;

interface ImportMetaEnv {
  readonly VITE_JAMENDO_CLIENT_ID?: string;
  /** Google Cast Developer Console App ID for custom visualizer receiver. */
  readonly VITE_CAST_RECEIVER_APP_ID?: string;
  readonly VITE_E2E_BRIDGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface SandboxPlatformDiagnostics {
  platform: 'tauri' | 'android' | 'ios' | 'android-tv' | 'web';
  label: string;
  isTauri: boolean;
  isCapacitorNative: boolean;
  isAndroid: boolean;
  isWeb: boolean;
  isAndroidTv: boolean;
  isLinux: boolean;
  isDesktopLinux: boolean;
  desktopOs: 'windows' | 'linux' | 'macos' | 'chromeos' | 'other' | null;
  capacitorPlatform: string | null;
}

interface Window {
  /** Read-only runtime platform snapshot (set by initPlatformEnv). */
  __SANDBOX_PLATFORM__?: Readonly<SandboxPlatformDiagnostics>;
}
