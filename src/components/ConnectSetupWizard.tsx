import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import ModalOverlay from '../stations/ModalOverlay';
import { C } from '../stations/theme';
import { prefsSetItem } from '../prefsStorage';
import {
  getOrCreateConnectDeviceId,
  loadConnectDeviceName,
  loadConnectRolePref,
  resolveConnectRole,
  saveConnectDeviceName,
  saveConnectRolePref,
  saveConnectSetupDone,
  saveNetworkSyncEnabled,
} from '../sandboxSettings';
import {
  getTier34BaseUrl,
  peerSyncWsUrl,
  pollSelfHostStatus,
  TIER34_BACKEND_KEY,
  TIER34_DEFAULT_URL,
} from '../tier34/client';
import type { ConnectRolePref } from '../tier34/connectProtocol';
import { t as translate, useTranslation } from '../i18n';
import type { AppLanguage } from '../languageSettings';
import { loadLanguage } from '../languageSettings';

const STEP_KEYS = ['connect.steps.hostUrl', 'connect.steps.role', 'connect.steps.device'] as const;

function validateTier34Url(url: string, lang: AppLanguage = loadLanguage()): string | null {
  const trimmed = url.trim();
  if (!trimmed) return translate('connect.urlRequired', lang);
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return translate('connect.urlProtocol', lang);
    }
    if (!parsed.hostname) return translate('connect.urlHost', lang);
    return null;
  } catch {
    return translate('connect.urlInvalid', lang);
  }
}

async function testTier34Connection(
  baseUrl: string,
  lang: AppLanguage = loadLanguage(),
): Promise<{ ok: boolean; detail: string }> {
  const base = baseUrl.trim().replace(/\/$/, '');
  try {
    const status = await pollSelfHostStatus(base);
    if (status.tier34 !== 'ONLINE') {
      return { ok: false, detail: translate('connect.healthFailed', lang) };
    }
  } catch {
    return { ok: false, detail: translate('connect.cannotReach', lang) };
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean, detail: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve({ ok, detail });
    };

    const timer = window.setTimeout(() => {
      finish(true, translate('connect.healthOkRelayTimeout', lang));
    }, 6000);

    try {
      const ws = new WebSocket(peerSyncWsUrl('sandbox-room'));
      ws.onopen = () => {
        ws.close();
        finish(true, translate('connect.connected', lang));
      };
      ws.onerror = () => {
        finish(true, translate('connect.healthOkWsFailed', lang));
      };
    } catch {
      finish(true, translate('connect.healthOkWsBlocked', lang));
    }
  });
}

export interface ConnectSetupWizardProps {
  open: boolean;
  onClose: () => void;
  onComplete: () => void;
}

export default function ConnectSetupWizard({
  open,
  onClose,
  onComplete,
}: ConnectSetupWizardProps) {
  const { t, lang } = useTranslation();
  const [step, setStep] = useState(0);
  const [backendUrl, setBackendUrl] = useState(TIER34_DEFAULT_URL);
  const [urlError, setUrlError] = useState('');
  const [role, setRole] = useState<ConnectRolePref>(loadConnectRolePref());
  const [deviceName, setDeviceName] = useState(loadConnectDeviceName());
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; detail: string } | null>(null);

  const roleOptions = useMemo(
    () =>
      [
        { value: 'auto' as const, title: t('connect.roleAuto'), hint: t('connect.roleAutoHint') },
        { value: 'host' as const, title: t('connect.roleHost'), hint: t('connect.roleHostHint') },
        { value: 'remote' as const, title: t('connect.roleRemote'), hint: t('connect.roleRemoteHint') },
      ] as const,
    [t],
  );

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setBackendUrl(getTier34BaseUrl());
    setUrlError('');
    setRole(loadConnectRolePref());
    setDeviceName(loadConnectDeviceName());
    setTesting(false);
    setTestResult(null);
  }, [open]);

  const handleTest = useCallback(async () => {
    const err = validateTier34Url(backendUrl, lang);
    if (err) {
      setUrlError(err);
      setTestResult(null);
      return;
    }
    setUrlError('');
    setTesting(true);
    setTestResult(null);
    prefsSetItem(TIER34_BACKEND_KEY, backendUrl.trim());
    const result = await testTier34Connection(backendUrl, lang);
    setTestResult(result);
    setTesting(false);
  }, [backendUrl, lang]);

  const handleDone = useCallback(() => {
    const err = validateTier34Url(backendUrl, lang);
    if (err) {
      setUrlError(err);
      setStep(0);
      return;
    }
    prefsSetItem(TIER34_BACKEND_KEY, backendUrl.trim());
    saveConnectRolePref(role);
    saveConnectDeviceName(deviceName.trim() || loadConnectDeviceName());
    getOrCreateConnectDeviceId();
    saveNetworkSyncEnabled(true);
    saveConnectSetupDone(true);
    onComplete();
    onClose();
  }, [backendUrl, role, deviceName, onComplete, onClose, lang]);

  const goNext = () => {
    if (step === 0) {
      const err = validateTier34Url(backendUrl, lang);
      if (err) {
        setUrlError(err);
        return;
      }
      setUrlError('');
      prefsSetItem(TIER34_BACKEND_KEY, backendUrl.trim());
    }
    setStep((s) => Math.min(s + 1, STEP_KEYS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <ModalOverlay
      open={open}
      onClose={onClose}
      title={t('connect.title')}
      maxWidth="max-w-lg"
      borderAccent
      panelClassName="connect-setup-wizard"
    >
      <div className="space-y-5 connect-setup-wizard-body">
        <div className="flex gap-2">
          {STEP_KEYS.map((key, i) => (
            <div
              key={key}
              className="flex-1 text-center font-mono text-[9px] uppercase tracking-wider py-1 border rounded-sm"
              style={{
                borderColor: i === step ? C.accent : C.border,
                color: i === step ? C.accent : 'var(--text-mid)',
                backgroundColor: i === step ? 'rgba(232,80,10,0.08)' : 'transparent',
              }}
            >
              {i + 1}. {t(key)}
            </div>
          ))}
        </div>

        {step === 0 && (
          <div className="space-y-3">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
                {t('connect.hostUrlTitle')}
              </p>
              <p className="ui-hint ui-hint--desc mt-1">{t('connect.hostUrlHint')}</p>
            </div>
            <input
              type="url"
              value={backendUrl}
              onChange={(e) => {
                setBackendUrl(e.target.value);
                setUrlError('');
                setTestResult(null);
              }}
              placeholder="http://192.168.1.10:3001"
              className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent text-[var(--text)]"
              autoFocus
            />
            {urlError ? (
              <p className="font-mono text-[10px] text-[var(--danger)]">{urlError}</p>
            ) : null}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
                {t('connect.roleTitle')}
              </p>
              <p className="ui-hint ui-hint--desc mt-1">{t('connect.roleHint')}</p>
            </div>
            <div className="space-y-2">
              {roleOptions.map((opt) => {
                const selected = role === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setRole(opt.value)}
                    className="w-full text-left p-3 rounded-lg border transition-colors touch-manipulation"
                    style={{
                      borderColor: selected ? C.accent : C.border,
                      backgroundColor: selected ? 'rgba(232,80,10,0.08)' : C.card,
                    }}
                  >
                    <p
                      className="font-mono text-xs font-bold uppercase tracking-wider"
                      style={{ color: selected ? C.accent : 'var(--text)' }}
                    >
                      {opt.title}
                    </p>
                    <p className="ui-hint ui-hint--desc mt-0.5 text-[var(--text-mid)]">{opt.hint}</p>
                  </button>
                );
              })}
            </div>
            <p className="font-mono text-[10px] uppercase text-[var(--text-dim)]">
              {t('connect.effectiveRole')}{' '}
              <span className="text-accent">{resolveConnectRole(role)}</span>
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <p className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--text)]">
                {t('connect.deviceTitle')}
              </p>
              <p className="ui-hint ui-hint--desc mt-1">{t('connect.deviceHint')}</p>
            </div>
            <input
              type="text"
              value={deviceName}
              onChange={(e) => setDeviceName(e.target.value)}
              placeholder={t('connect.devicePlaceholder')}
              className="input-elevated w-full px-4 py-3 font-mono text-xs focus-accent text-[var(--text)]"
            />
            <div className="pt-1 space-y-2">
              <button
                type="button"
                onClick={() => void handleTest()}
                disabled={testing}
                className="w-full min-h-[2.75rem] rounded-lg font-mono text-xs font-bold uppercase tracking-wider touch-manipulation border"
                style={{ borderColor: C.accent, color: C.accent }}
              >
                {testing ? (
                  <span className="inline-flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('connect.testing')}
                  </span>
                ) : (
                  t('connect.testConnection')
                )}
              </button>
              {testResult ? (
                <p
                  className="font-mono text-[10px]"
                  style={{ color: testResult.ok ? C.accent : 'var(--danger)' }}
                >
                  {testResult.detail}
                </p>
              ) : null}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-2">
          {step > 0 ? (
            <button
              type="button"
              onClick={goBack}
              className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg font-mono text-xs uppercase tracking-wider border touch-manipulation"
              style={{ borderColor: C.border, color: 'var(--text-mid)' }}
            >
              <ChevronLeft className="w-4 h-4" />
              {t('common.back')}
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg font-mono text-xs uppercase tracking-wider border touch-manipulation"
              style={{ borderColor: C.border, color: 'var(--text-mid)' }}
            >
              {t('common.cancel')}
            </button>
          )}
          <div className="flex-1" />
          {step < STEP_KEYS.length - 1 ? (
            <button
              type="button"
              onClick={goNext}
              className="flex items-center justify-center gap-1 px-4 py-2.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider touch-manipulation btn-accent"
            >
              {t('common.next')}
              <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={handleDone}
              className="px-4 py-2.5 rounded-lg font-mono text-xs font-bold uppercase tracking-wider touch-manipulation btn-accent"
            >
              {t('common.done')}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}
