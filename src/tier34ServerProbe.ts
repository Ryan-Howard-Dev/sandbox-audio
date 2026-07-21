/**
 * Probe a Sandbox Server URL — used in mobile onboarding and setup wizard.
 */

import { appendSandboxClientQuery } from './tier34/client';

export interface Tier34ProbeResult {
  ok: boolean;
  message: string;
  latencyMs?: number;
}

/** Normalize user-entered LAN URL (trim, strip trailing slash, ensure http scheme). */
export function normalizeTier34ServerUrl(raw: string): string {
  let url = raw.trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) {
    url = `http://${url}`;
  }
  return url.replace(/\/$/, '');
}

/** GET /health on the given base URL (does not persist settings). */
export async function probeTier34ServerUrl(rawUrl: string): Promise<Tier34ProbeResult> {
  const base = normalizeTier34ServerUrl(rawUrl);
  if (!base) {
    return {
      ok: false,
      message: 'Enter your Sandbox Server address first (e.g. http://192.168.1.10:3001).',
    };
  }

  const healthUrl = appendSandboxClientQuery(`${base}/health`);
  const started = Date.now();
  try {
    const res = await fetch(healthUrl, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      return {
        ok: false,
        message: `Server responded ${res.status} — check that Sandbox Server is running at this address.`,
        latencyMs,
      };
    }
    return {
      ok: true,
      message: `Connected (${latencyMs}ms) — full catalog playback is ready.`,
      latencyMs,
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const hint =
      err instanceof Error && err.name === 'TimeoutError'
        ? 'Timed out — device and server must be on the same network (or use a remote overlay URL).'
        : 'Cannot reach server — verify IP, port 3001, and firewall on the server host.';
    return { ok: false, message: hint, latencyMs };
  }
}
