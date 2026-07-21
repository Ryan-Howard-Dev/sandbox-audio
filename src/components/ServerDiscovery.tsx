import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, Loader2, Radar, Wifi } from 'lucide-react';
import { useTranslation } from '../i18n';
import {
  canHostSandboxServerAnchor,
  getServerCapability,
  getServerCapabilityMessage,
} from '../platformEnv';
import { detectSandboxServerLanUrl } from '../sandboxLanBridge';
import {
  loadRecentServerUrls,
  rememberRecentServerUrl,
} from '../serverDiscoveryStorage';
import {
  DEFAULT_SANDBOX_SERVER_REMOTE_URL,
  loadSandboxServerAutoStart,
  loadSandboxServerMode,
  loadSandboxServerRemoteUrl,
  SANDBOX_SERVER_ANCHOR_URL,
  saveSandboxServerAutoStart,
  saveSandboxServerMode,
  saveSandboxServerRemoteUrl,
  syncTier34BackendUrlFromServerMode,
  type SandboxServerMode,
} from '../sandboxSettings';
import {
  startLocalSandboxServer,
  stopLocalSandboxServer,
  waitForTier34Health,
  isSandboxServerDesktop,
} from '../sandboxServerBridge';
import { tier34HealthOk, setOAuthToken } from '../tier34/client';
import { probeTier34ServerUrl } from '../tier34ServerProbe';
import { detectLocalIpv4 } from '../sandboxLanBridge';

export type ServerDiscoveryMode = 'local-device' | 'local-network' | 'remote' | 'locker-only';

export type ServerDiscoveryVariant = 'settings' | 'onboarding' | 'setup';

export interface ServerDiscoveryProps {
  variant?: ServerDiscoveryVariant;
  /** Show subsection headers (Settings layout). */
  showSubsections?: boolean;
  onModeApplied?: (mode: SandboxServerMode) => void;
  onHealthChange?: (ok: boolean | null) => void;
}

function modeToSandboxServerMode(discovery: ServerDiscoveryMode): SandboxServerMode {
  if (discovery === 'local-device') return 'anchor';
  if (discovery === 'locker-only') return 'off';
  return 'remote';
}

function sandboxModeToDiscovery(mode: SandboxServerMode): ServerDiscoveryMode {
  if (mode === 'anchor') return 'local-device';
  if (mode === 'off') return 'locker-only';
  return 'local-network';
}

/** Limited LAN scan — probes /health on same /24 subnet. Full mDNS pending. */
async function scanLanForSandboxServers(localIp: string | null): Promise<string[]> {
  if (!localIp) return [];
  const parts = localIp.split('.');
  if (parts.length !== 4) return [];
  const prefix = parts.slice(0, 3).join('.');
  const hostOctet = Number(parts[3]);
  const offsets = new Set<number>([
    1, 2, 10, 20, 50, 100, 101, 102, hostOctet,
    ...Array.from({ length: 12 }, (_, i) => i + 1),
  ]);
  const targets = [...offsets]
    .filter((n) => n >= 1 && n <= 254 && n !== hostOctet)
    .slice(0, 24)
    .map((n) => `http://${prefix}.${n}:3001`);

  const found: string[] = [];
  await Promise.all(
    targets.map(async (base) => {
      const result = await probeTier34ServerUrl(base);
      if (result.ok) found.push(base);
    }),
  );
  return found;
}

export default function ServerDiscovery({
  variant = 'settings',
  showSubsections = variant === 'settings',
  onModeApplied,
  onHealthChange,
}: ServerDiscoveryProps) {
  const { t } = useTranslation();
  const capability = useMemo(() => getServerCapability(), []);
  const canAnchor = canHostSandboxServerAnchor();

  const [discoveryMode, setDiscoveryMode] = useState<ServerDiscoveryMode>(() =>
    sandboxModeToDiscovery(loadSandboxServerMode()),
  );
  const [manualUrl, setManualUrl] = useState(
    () => loadSandboxServerRemoteUrl() || DEFAULT_SANDBOX_SERVER_REMOTE_URL,
  );
  const [remoteToken, setRemoteToken] = useState('');
  const [recentUrls, setRecentUrls] = useState<string[]>(() => loadRecentServerUrls());
  const [lanUrl, setLanUrl] = useState<string | null>(null);
  const [healthOk, setHealthOk] = useState<boolean | null>(null);
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [serverBusy, setServerBusy] = useState(false);
  const [serverMsg, setServerMsg] = useState<string | null>(null);
  const [copiedLan, setCopiedLan] = useState(false);
  const [autoStart, setAutoStart] = useState(loadSandboxServerAutoStart);

  const refreshHealth = useCallback(async () => {
    syncTier34BackendUrlFromServerMode();
    const ok = await tier34HealthOk();
    setHealthOk(ok);
    onHealthChange?.(ok);
    return ok;
  }, [onHealthChange]);

  useEffect(() => {
    void refreshHealth();
    if (canAnchor) {
      void detectSandboxServerLanUrl().then(setLanUrl);
    }
    setRecentUrls(loadRecentServerUrls());
  }, [canAnchor, refreshHealth]);

  const applyMode = useCallback(
    (mode: ServerDiscoveryMode, url?: string) => {
      setDiscoveryMode(mode);
      const sandboxMode = modeToSandboxServerMode(mode);
      saveSandboxServerMode(sandboxMode);
      if (mode === 'remote' || mode === 'local-network') {
        const nextUrl = (url ?? manualUrl).trim();
        if (nextUrl) {
          saveSandboxServerRemoteUrl(nextUrl);
          setManualUrl(nextUrl);
          rememberRecentServerUrl(nextUrl);
          setRecentUrls(loadRecentServerUrls());
        }
      }
      if (remoteToken.trim()) setOAuthToken(remoteToken.trim());
      syncTier34BackendUrlFromServerMode();
      onModeApplied?.(sandboxMode);
      void refreshHealth();
    },
    [manualUrl, onModeApplied, refreshHealth, remoteToken],
  );

  const testConnection = async () => {
    setProbeBusy(true);
    setProbeMessage(null);
    try {
      const result = await probeTier34ServerUrl(manualUrl);
      setProbeMessage(result.message);
      if (result.ok) {
        rememberRecentServerUrl(manualUrl);
        setRecentUrls(loadRecentServerUrls());
        applyMode(discoveryMode === 'remote' ? 'remote' : 'local-network', manualUrl);
      }
    } finally {
      setProbeBusy(false);
    }
  };

  const runLanScan = async () => {
    setScanBusy(true);
    setScanResults([]);
    setScanNote(t('serverDiscovery.scanning'));
    try {
      const localIp = lanUrl
        ? new URL(lanUrl).hostname
        : await detectLocalIpv4();
      const found = await scanLanForSandboxServers(localIp);
      setScanResults(found);
      setScanNote(
        found.length > 0
          ? t('serverDiscovery.scanFound', { count: String(found.length) })
          : t('serverDiscovery.scanEmpty'),
      );
    } finally {
      setScanBusy(false);
    }
  };

  const copyLanUrl = async () => {
    const text = lanUrl ?? SANDBOX_SERVER_ANCHOR_URL;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedLan(true);
      window.setTimeout(() => setCopiedLan(false), 2000);
    } catch {
      /* ignore */
    }
  };

  const startServer = async () => {
    if (!isSandboxServerDesktop()) return;
    setServerBusy(true);
    setServerMsg(null);
    try {
      if (await tier34HealthOk()) {
        await refreshHealth();
        return;
      }
      await startLocalSandboxServer();
      await waitForTier34Health();
      await refreshHealth();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setServerMsg(msg);
    } finally {
      setServerBusy(false);
    }
  };

  const stopServer = async () => {
    if (!isSandboxServerDesktop()) return;
    setServerBusy(true);
    try {
      await stopLocalSandboxServer();
      setHealthOk(false);
      onHealthChange?.(false);
    } finally {
      setServerBusy(false);
    }
  };

  const cardClass = (selected: boolean) =>
    `p-4 text-left border min-h-[96px] flex flex-col justify-between touch-manipulation fidelity-card ${
      selected ? 'fidelity-card--selected' : 'fidelity-card--unselected'
    }`;

  const modeCards: Array<{
    id: ServerDiscoveryMode;
    title: string;
    hint: string;
    hidden?: boolean;
  }> = [
    {
      id: 'local-device',
      title: t('serverDiscovery.localDeviceTitle'),
      hint: t('serverDiscovery.localDeviceHint'),
      hidden: !canAnchor,
    },
    {
      id: 'local-network',
      title: t('serverDiscovery.localNetworkTitle'),
      hint: t('serverDiscovery.localNetworkHint'),
    },
    {
      id: 'remote',
      title: t('serverDiscovery.remoteTitle'),
      hint: t('serverDiscovery.remoteHint'),
    },
    {
      id: 'locker-only',
      title: t('serverDiscovery.lockerOnlyTitle'),
      hint: t('serverDiscovery.lockerOnlyHint'),
      hidden: variant === 'settings' && canAnchor,
    },
  ];

  const Subsection = ({
    id,
    title,
    children,
  }: {
    id: string;
    title: string;
    children: React.ReactNode;
  }) =>
    showSubsections ? (
      <section id={id} className="server-discovery-section space-y-3">
        <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-accent">{title}</p>
        {children}
      </section>
    ) : (
      <div className="space-y-3">{children}</div>
    );

  return (
    <div className="server-discovery space-y-5">
      <p className="ui-hint">{getServerCapabilityMessage(capability)}</p>

      <Subsection id="server-discovery-mode" title={t('serverDiscovery.subsectionNetwork')}>
        <div className={`grid gap-3 ${canAnchor ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2'}`}>
          {modeCards
            .filter((c) => !c.hidden)
            .map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => applyMode(card.id)}
                className={cardClass(discoveryMode === card.id)}
              >
                <span className="fidelity-card-label font-display font-semibold text-sm">{card.title}</span>
                <span className="ui-hint ui-hint--desc text-[10px] mt-2">{card.hint}</span>
              </button>
            ))}
        </div>
      </Subsection>

      {discoveryMode === 'local-device' && canAnchor ? (
        <Subsection id="server-discovery-status" title={t('serverDiscovery.subsectionStatus')}>
          <div className="space-y-3">
            <div>
              <p className="ui-field-label">{t('serverDiscovery.localAddress')}</p>
              <p className="font-mono text-[10px] break-all mt-1 text-[var(--text-mid)]">
                {SANDBOX_SERVER_ANCHOR_URL}
              </p>
            </div>
            {lanUrl ? (
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-mono text-[10px] break-all text-[var(--text-mid)]">
                  {t('serverDiscovery.lanShareUrl')}: {lanUrl}
                </p>
                <button
                  type="button"
                  onClick={() => void copyLanUrl()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border font-mono text-[9px] uppercase touch-manipulation"
                >
                  <Copy className="w-3 h-3" />
                  {copiedLan ? t('serverDiscovery.copied') : t('serverDiscovery.copyLan')}
                </button>
              </div>
            ) : (
              <p className="ui-hint ui-hint--desc">{t('serverDiscovery.lanDetecting')}</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={serverBusy}
                onClick={() => void startServer()}
                className="px-4 py-2 rounded-lg btn-accent font-mono text-[10px] font-bold uppercase touch-manipulation disabled:opacity-50"
              >
                {t('settings.vault.sandboxServerStart')}
              </button>
              <button
                type="button"
                disabled={serverBusy}
                onClick={() => void stopServer()}
                className="px-4 py-2 rounded-lg btn-accent-outline font-mono text-[10px] font-bold uppercase touch-manipulation disabled:opacity-50"
              >
                {t('settings.vault.sandboxServerStop')}
              </button>
            </div>
            <p className="font-mono text-[10px] uppercase text-[var(--text-mid)]">
              {healthOk === null
                ? t('serverDiscovery.statusChecking')
                : healthOk
                  ? t('serverDiscovery.statusActive')
                  : t('settings.vault.sandboxServerStatusInactive')}
            </p>
            {serverMsg ? <p className="ui-hint text-accent">{serverMsg}</p> : null}
            <div className="flex items-center justify-between gap-4 pt-2 border-t border-[var(--border)]">
              <span className="font-mono text-xs text-[var(--text-mid)]">
                {t('settings.vault.sandboxServerAutoStart')}
              </span>
              <input
                type="checkbox"
                checked={autoStart}
                onChange={(e) => {
                  setAutoStart(e.target.checked);
                  saveSandboxServerAutoStart(e.target.checked);
                }}
                aria-label={t('settings.vault.sandboxServerAutoStart')}
              />
            </div>
          </div>
        </Subsection>
      ) : null}

      {(discoveryMode === 'local-network' || discoveryMode === 'remote') && (
        <Subsection id="server-discovery-connect" title={t('serverDiscovery.subsectionDiscovery')}>
          <div className="space-y-3">
            {discoveryMode === 'local-network' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={scanBusy}
                  onClick={() => void runLanScan()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border font-mono text-[10px] uppercase touch-manipulation disabled:opacity-50"
                >
                  {scanBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Radar className="w-3.5 h-3.5" />}
                  {scanBusy ? t('serverDiscovery.scanning') : t('serverDiscovery.scanLan')}
                </button>
                <p className="ui-hint ui-hint--desc">{t('serverDiscovery.scanStubNote')}</p>
                {scanNote ? <p className="ui-hint">{scanNote}</p> : null}
                {scanResults.length > 0 ? (
                  <ul className="space-y-1">
                    {scanResults.map((url) => (
                      <li key={url}>
                        <button
                          type="button"
                          onClick={() => {
                            setManualUrl(url);
                            applyMode('local-network', url);
                          }}
                          className="font-mono text-[10px] text-accent underline touch-manipulation"
                        >
                          {url}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div>
              <label className="ui-field-label">
                {discoveryMode === 'remote'
                  ? t('serverDiscovery.remoteUrlLabel')
                  : t('settings.vault.sandboxServerRemoteUrl')}
              </label>
              <input
                type="url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                onBlur={() => saveSandboxServerRemoteUrl(manualUrl)}
                placeholder={t('settings.vault.sandboxServerRemoteUrlPlaceholder')}
                className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent mt-1.5"
              />
              {discoveryMode === 'remote' ? (
                <p className="ui-hint mt-1.5">{t('settings.vault.sandboxServerOverlayHint')}</p>
              ) : (
                <p className="ui-hint mt-1.5">{t('onboarding.server.lanIpHelper')}</p>
              )}
            </div>

            {discoveryMode === 'remote' ? (
              <div>
                <label className="ui-field-label">{t('serverDiscovery.remoteTokenLabel')}</label>
                <input
                  type="password"
                  value={remoteToken}
                  onChange={(e) => setRemoteToken(e.target.value)}
                  placeholder={t('serverDiscovery.remoteTokenPlaceholder')}
                  className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent mt-1.5"
                  autoComplete="off"
                />
                <p className="ui-hint mt-1">{t('serverDiscovery.remoteTokenHint')}</p>
              </div>
            ) : null}

            {recentUrls.length > 0 ? (
              <div>
                <p className="ui-field-label">{t('serverDiscovery.recentUrls')}</p>
                <ul className="flex flex-wrap gap-2 mt-1">
                  {recentUrls.map((url) => (
                    <li key={url}>
                      <button
                        type="button"
                        onClick={() => {
                          setManualUrl(url);
                          applyMode(discoveryMode, url);
                        }}
                        className="px-2 py-1 rounded border font-mono text-[9px] touch-manipulation"
                      >
                        {url.replace(/^https?:\/\//, '')}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => void testConnection()}
              disabled={probeBusy || !manualUrl.trim()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg btn-accent-outline font-mono text-[10px] font-bold uppercase touch-manipulation disabled:opacity-50"
            >
              {probeBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {probeBusy ? t('onboarding.server.testingConnection') : t('onboarding.server.testConnection')}
            </button>
            {probeMessage ? (
              <p className={`ui-hint${probeMessage.includes('Connected') ? ' text-accent' : ''}`} role="status">
                {probeMessage}
              </p>
            ) : null}
          </div>
        </Subsection>
      )}

      {discoveryMode === 'locker-only' ? (
        <Subsection id="server-discovery-locker" title={t('serverDiscovery.subsectionStatus')}>
          <p className="ui-hint">{t('serverDiscovery.lockerOnlyStatus')}</p>
        </Subsection>
      ) : null}

      {showSubsections && discoveryMode !== 'locker-only' ? (
        <>
          <Subsection id="server-discovery-storage" title={t('serverDiscovery.subsectionStorage')}>
            <p className="ui-hint">{t('serverDiscovery.storageHint')}</p>
          </Subsection>
          <Subsection id="server-discovery-performance" title={t('serverDiscovery.subsectionPerformance')}>
            <p className="ui-hint">{t('serverDiscovery.performanceHint')}</p>
          </Subsection>
          <Subsection id="server-discovery-logs" title={t('serverDiscovery.subsectionLogs')}>
            <p className="ui-hint">{t('serverDiscovery.logsHint')}</p>
          </Subsection>
        </>
      ) : null}
    </div>
  );
}
