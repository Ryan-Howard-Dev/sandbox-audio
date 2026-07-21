import React, { useCallback, useEffect, useState } from 'react';
import { Cast, Loader2, Speaker, Volume2 } from 'lucide-react';
import ModalOverlay from '../stations/ModalOverlay';
import {
  getCastState,
  loadDefaultCastDevice,
  saveDefaultCastDevice,
  saveLastCastScan,
  setSpeakerCastVolume,
  startCastToDevice,
  stopSpeakerCast,
  subscribeCastState,
  type CastState,
} from '../castState';
import type { MediaEnvelope } from '../sandboxLayer1';
import {
  canOpenCastInBrowser,
  getCastBrowserUrl,
  isNativeAndroidCastRuntime,
  isTauriDesktop,
  loadCastBrowserChoice,
  openCastInExternalBrowser,
  resolveCastBrowserUrl,
} from '../castPlatform';
import { useTranslation } from '../i18n';
import { shouldShowTauriCastGuidancePanel } from '../sandboxSettings';
import TauriCastGuidancePanel from './TauriCastGuidancePanel';
import {
  getCastSessionState,
  initCastSender,
  isCastSdkSupported,
  subscribeCastSession,
} from '../castSender';
import {
  getCastUnsupportedMessage,
  requestCinemaCast,
  warmCastSdk,
} from '../cinemaCast';
import { tier34CastDiscover, tier34HealthOk, type CastDevice } from '../tier34/client';

function deviceBadge(type: CastDevice['type']): string {
  if (type === 'sonos') return 'SONOS';
  if (type === 'remote_cast') return 'SANDBOX CAST';
  return 'UPNP';
}

function mergeRemoteCastDevices(devices: CastDevice[]): CastDevice[] {
  if (!isCastSdkSupported()) return devices;
  const cc = getCastSessionState();
  if (!cc.connected || !cc.deviceName) return devices;
  const ip = 'remote_cast';
  if (devices.some((d) => d.type === 'remote_cast' && d.name === cc.deviceName)) {
    return devices;
  }
  return [
    ...devices,
    {
      id: `remote_cast-${cc.deviceName}`,
      name: cc.deviceName,
      ip,
      type: 'remote_cast' as const,
    },
  ];
}

export interface CastPickerProps {
  open: boolean;
  onClose: () => void;
  envelope: MediaEnvelope | null;
  title: string;
  artist: string;
  artworkUrl?: string;
  isPlaying: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
}

export default function CastPicker({
  open,
  onClose,
  envelope,
  title,
  artist,
  artworkUrl,
  isPlaying,
  currentTimeSeconds,
  durationSeconds,
}: CastPickerProps) {
  const { t } = useTranslation();
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<CastDevice[]>([]);
  const [scanDone, setScanDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [castState, setCastState] = useState<CastState>(getCastState);
  const [castingId, setCastingId] = useState<string | null>(null);
  const [castRequesting, setCastRequesting] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone: 'error' | 'info' } | null>(null);
  const castSdkAvailable = isCastSdkSupported();
  const castBlockedMessage = getCastUnsupportedMessage();
  const showCastBrowserWorkaround = canOpenCastInBrowser();
  const nativeAndroidCast = isNativeAndroidCastRuntime();
  const tauriCastFallback = isTauriDesktop();
  const [castGuidanceDismissed, setCastGuidanceDismissed] = useState(
    () => !shouldShowTauriCastGuidancePanel(),
  );
  const [castBrowserUrlHint, setCastBrowserUrlHint] = useState(getCastBrowserUrl);

  useEffect(() => {
    if (!open || !tauriCastFallback) return;
    void resolveCastBrowserUrl().then((url) => setCastBrowserUrlHint(url));
  }, [open, tauriCastFallback]);

  const showCastToast = useCallback((text: string, tone: 'error' | 'info' = 'error') => {
    setToast({ text, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 8000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => subscribeCastState(setCastState), []);

  useEffect(() => {
    if (!open) return;
    warmCastSdk();
    if (castSdkAvailable) {
      void initCastSender().then((result) => {
        if (!result.ok && result.error) {
          setError(result.error);
          showCastToast(result.error);
        }
      });
    }
    const unsub = subscribeCastSession(() => {
      setDevices((prev) => mergeRemoteCastDevices(prev));
    });
    return unsub;
  }, [open, castSdkAvailable, showCastToast]);

  const runScan = useCallback(async () => {
    setScanning(true);
    setError(null);
    setScanDone(false);
    try {
      const online = await tier34HealthOk();
      if (!online) {
        setError('Start your Sandbox Server to enable speaker streaming');
        setDevices([]);
        setScanDone(true);
        return;
      }
      const result = await tier34CastDiscover();
      if (!result.ok) {
        setError('error' in result ? result.error : 'Discovery failed');
        setDevices([]);
      } else {
        const found = mergeRemoteCastDevices(result.data.devices);
        setDevices(found);
        saveLastCastScan(found);
      }
      setScanDone(true);
    } catch {
      setError('Start your Sandbox Server to enable speaker streaming');
      setDevices([]);
      setScanDone(true);
    } finally {
      setScanning(false);
    }
  }, []);

  const handleCast = useCallback(
    async (device: CastDevice) => {
      setCastingId(device.id);
      setError(null);
      const result = await startCastToDevice(device, envelope, {
        title,
        artist,
        artworkUrl,
        isPlaying,
        currentTimeSeconds,
        durationSeconds,
      });
      setCastingId(null);
      if (!result.ok) {
        setError(result.error ?? 'Cast failed');
        return;
      }
      saveDefaultCastDevice(device);
    },
    [envelope, title, artist, artworkUrl, isPlaying, currentTimeSeconds, durationSeconds],
  );

  const handleStop = useCallback(async () => {
    await stopSpeakerCast();
  }, []);

  const handleConnectCastDevice = useCallback(async () => {
    if (!castSdkAvailable) {
      const msg =
        castBlockedMessage ??
        'Sandbox Cast is not available here. Use Chrome on the same Wi‑Fi as your TV.';
      setError(msg);
      showCastToast(msg);
      return;
    }

    setCastRequesting(true);
    setError(null);
    try {
      const session = await requestCinemaCast();
      if (!session.ok) {
        const msg = session.error ?? 'Could not connect to Sandbox Cast device';
        setError(msg);
        if (session.code !== 'cancelled') showCastToast(msg);
        else showCastToast(msg, 'info');
        return;
      }

      const cc = getCastSessionState();
      if (!cc.connected || !cc.deviceName) {
        const msg = 'Connected but device name unavailable. Try again.';
        setError(msg);
        showCastToast(msg);
        return;
      }

      const remoteCastDevice: CastDevice = {
        id: `remote_cast-${cc.deviceName}`,
        name: cc.deviceName,
        ip: 'remote_cast',
        type: 'remote_cast',
      };
      setDevices((prev) => mergeRemoteCastDevices(prev));
      showCastToast(`Connected to ${cc.deviceName}`, 'info');

      if (!envelope) return;

      setCastingId(remoteCastDevice.id);
      const result = await startCastToDevice(remoteCastDevice, envelope, {
        title,
        artist,
        artworkUrl,
        isPlaying,
        currentTimeSeconds,
        durationSeconds,
      });
      setCastingId(null);
      if (!result.ok) {
        const msg = result.error ?? 'Cast failed';
        setError(msg);
        showCastToast(msg);
        return;
      }
      saveDefaultCastDevice(remoteCastDevice);
    } finally {
      setCastRequesting(false);
    }
  }, [
    castSdkAvailable,
    castBlockedMessage,
    envelope,
    title,
    artist,
    artworkUrl,
    isPlaying,
    currentTimeSeconds,
    durationSeconds,
    showCastToast,
  ]);

  const activeId =
    castState.isActive && castState.deviceIp
      ? devices.find(
          (d) =>
            d.ip === castState.deviceIp ||
            (castState.deviceType === 'remote_cast' && d.type === 'remote_cast'),
        )?.id ?? null
      : null;

  const defaultDevice = loadDefaultCastDevice();

  return (
    <ModalOverlay
      open={open}
      onClose={onClose}
      title="SANDBOX CAST"
      maxWidth="max-w-md"
      borderAccent
    >
      <div className="space-y-4 font-mono text-[10px] uppercase tracking-wider">
        {toast ? (
          <div
            role="alert"
            className={`px-3 py-2 border rounded-sm text-[9px] normal-case tracking-normal leading-relaxed ${
              toast.tone === 'error'
                ? 'border-[var(--danger)]/50 text-[var(--danger)] bg-[var(--danger)]/10'
                : 'border-accent/50 text-accent bg-accent/10'
            }`}
          >
            {toast.text}
          </div>
        ) : null}

        {tauriCastFallback ? (
          <div className="space-y-2">
            {!castGuidanceDismissed ? (
              <TauriCastGuidancePanel onDismiss={() => setCastGuidanceDismissed(true)} />
            ) : (
              <div className="space-y-2 p-3 border border-accent/40 rounded-sm bg-accent/5">
                <button
                  type="button"
                  onClick={() =>
                    void openCastInExternalBrowser({ browser: loadCastBrowserChoice() })
                  }
                  className="w-full px-4 py-3 border-2 border-accent bg-accent/15 text-accent font-bold touch-manipulation focus-accent"
                >
                  <span className="inline-flex items-center justify-center gap-2">
                    <Cast className="w-4 h-4" strokeWidth={2} />
                    {t('shell.tauriCastBannerOpen')}
                  </span>
                </button>
                <p className="text-[var(--text-dim)] text-[8px] normal-case tracking-normal leading-relaxed">
                  {t('settings.fidelity.castOpensUrl', { url: castBrowserUrlHint })}
                </p>
              </div>
            )}
          </div>
        ) : castSdkAvailable ? (
          <button
            type="button"
            onClick={() => void handleConnectCastDevice()}
            disabled={castRequesting || castingId !== null}
            className="w-full px-4 py-3 border-2 border-accent bg-accent/15 text-accent font-bold touch-manipulation disabled:opacity-50 focus-accent"
          >
            {castRequesting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} />
                OPENING SANDBOX CAST PICKER…
              </span>
            ) : (
              <span className="inline-flex items-center justify-center gap-2">
                <Cast className="w-4 h-4" strokeWidth={2} />
                {nativeAndroidCast ? 'CONNECT SANDBOX CAST (NATIVE)' : 'CONNECT SANDBOX CAST'}
              </span>
            )}
          </button>
        ) : castBlockedMessage ? (
          <div className="space-y-2 p-3 border border-[var(--danger)]/40 rounded-sm bg-[var(--danger)]/5">
            <p className="text-[var(--danger)] text-[9px] normal-case tracking-normal leading-relaxed">
              {castBlockedMessage}
            </p>
            {showCastBrowserWorkaround ? (
              <button
                type="button"
                onClick={() => void openCastInExternalBrowser()}
                className="w-full px-3 py-2 border border-accent/60 text-accent font-bold touch-manipulation focus-accent"
              >
                OPEN IN CHROME FOR SANDBOX CAST
              </button>
            ) : null}
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void runScan()}
          disabled={scanning}
          className="w-full px-4 py-2.5 border border-accent/60 text-accent font-bold touch-manipulation disabled:opacity-50 focus-accent"
        >
          {scanning ? (
            <span className="inline-flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2} />
              SCANNING NETWORK
            </span>
          ) : (
            'SCAN NETWORK (SONOS / UPNP)'
          )}
        </button>

        <p className="text-center text-[var(--text-dim)] text-[9px] leading-relaxed normal-case tracking-normal">
          {tauriCastFallback
            ? 'Sonos / UPnP: scan below (Sandbox Server required). Chromecast: use Open in Browser above (Chrome or Edge recommended).'
            : castSdkAvailable
            ? nativeAndroidCast
              ? 'Native Sandbox Cast discovers TVs and receivers on your Wi‑Fi. Scan below finds Sonos / UPnP only.'
              : 'Scan finds Sonos / UPnP only. For TV or receiver casting, use Sandbox Cast — phone and TV must be on the same Wi‑Fi.'
            : 'Network scan finds Sonos / UPnP speakers only. TV/receiver casting uses Sandbox Cast (not UPnP).'}
        </p>

        {error ? (
          <p className="text-center text-[var(--danger)] py-2">{error}</p>
        ) : null}

        {!tauriCastFallback && !scanDone && !scanning ? (
          <p className="text-center text-[var(--text-dim)] py-4">
            {castSdkAvailable
              ? 'PICK A SANDBOX CAST DEVICE ABOVE, OR SCAN FOR SONOS / UPNP SPEAKERS'
              : 'TAP SCAN TO FIND SPEAKERS ON YOUR NETWORK'}
          </p>
        ) : null}

        {scanDone && !scanning && devices.length === 0 && !error ? (
          <p className="text-center text-[var(--text-dim)] py-4 leading-relaxed">
            {tauriCastFallback
              ? 'NO SONOS / UPNP SPEAKERS FOUND. TAP SCAN TO SEARCH YOUR NETWORK.'
              : castSdkAvailable
                ? 'NO SONOS / UPNP SPEAKERS FOUND. FOR TV / RECEIVER CASTING, USE SANDBOX CAST ABOVE.'
                : 'NO SPEAKERS FOUND. MAKE SURE DEVICES ARE ON THE SAME WIFI NETWORK.'}
          </p>
        ) : null}

        {defaultDevice ? (
          <p className="text-[var(--text-dim)] text-[9px]">
            DEFAULT: {defaultDevice.name} ({deviceBadge(defaultDevice.type)})
          </p>
        ) : null}

        <ul className="space-y-2 max-h-64 overflow-y-auto music-scrollbar">
          {devices.map((device) => {
            const isActive =
              activeId === device.id ||
              (castState.isActive &&
                castState.deviceName === device.name &&
                castState.deviceType === device.type);
            const Icon = device.type === 'remote_cast' ? Cast : Speaker;
            return (
              <li
                key={device.id}
                className={`p-3 border rounded-sm space-y-2 ${
                  isActive ? 'border-accent bg-accent/10' : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className="w-4 h-4 shrink-0 text-accent" strokeWidth={2} />
                    <div className="min-w-0">
                      <p className="text-[var(--text)] truncate">{device.name}</p>
                      <p className="text-[var(--text-dim)] text-[8px]">{device.ip}</p>
                    </div>
                  </div>
                  <span className="shrink-0 px-1.5 py-0.5 border border-accent/40 text-accent text-[8px]">
                    {deviceBadge(device.type)}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {isActive ? (
                    <>
                      <span className="px-1.5 py-0.5 border border-emerald-600/50 text-emerald-500 text-[8px]">
                        CASTING
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleStop()}
                        className="ml-auto px-3 py-1 border border-[var(--border)] text-[var(--text-mid)] touch-manipulation focus-accent"
                      >
                        STOP
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={castingId === device.id || (!envelope && device.type !== 'remote_cast')}
                      onClick={() => void handleCast(device)}
                      className="ml-auto px-3 py-1 border border-accent/60 text-accent font-bold touch-manipulation disabled:opacity-40 focus-accent"
                    >
                      {castingId === device.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" strokeWidth={2} />
                      ) : (
                        'CAST'
                      )}
                    </button>
                  )}
                </div>

                {isActive && device.type !== 'remote_cast' ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Volume2 className="w-3.5 h-3.5 text-[var(--text-dim)]" strokeWidth={2} />
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={castState.volume}
                      onChange={(e) => void setSpeakerCastVolume(parseInt(e.target.value, 10))}
                      className="flex-1 accent-accent touch-manipulation"
                      aria-label={`Volume for ${device.name}`}
                    />
                    <span className="text-[var(--text-dim)] w-8 text-right">{castState.volume}</span>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </div>
    </ModalOverlay>
  );
}
