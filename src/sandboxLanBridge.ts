/**
 * Best-effort LAN IPv4 detection for Sandbox Server URL display (desktop anchor mode).
 * Uses WebRTC host candidates — no Tauri bridge required.
 */

const SANDBOX_SERVER_PORT = 3001;

export function formatSandboxServerLanUrl(ipv4: string): string {
  const host = ipv4.trim();
  if (!host) return '';
  return `http://${host}:${SANDBOX_SERVER_PORT}`;
}

/** Resolve local IPv4 via RTCPeerConnection ICE candidates (browser / WebView). */
export async function detectLocalIpv4(timeoutMs = 2500): Promise<string | null> {
  if (typeof window === 'undefined' || typeof RTCPeerConnection === 'undefined') {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      try {
        pc.close();
      } catch {
        /* ignore */
      }
      resolve(value);
    };

    const timer = window.setTimeout(() => finish(null), timeoutMs);
    const pc = new RTCPeerConnection({ iceServers: [] });
    const ips = new Set<string>();

    pc.createDataChannel('sandbox-lan-probe');
    pc.onicecandidate = (event) => {
      const candidate = event.candidate?.candidate ?? '';
      const match = /(\d{1,3}(?:\.\d{1,3}){3})/.exec(candidate);
      if (!match) return;
      const ip = match[1];
      if (
        ip.startsWith('127.') ||
        ip.startsWith('169.254.') ||
        ip.endsWith('.0') ||
        ip.endsWith('.255')
      ) {
        return;
      }
      ips.add(ip);
      finish(ip);
    };

    void pc
      .createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .catch(() => finish(null));

    pc.onicegatheringstatechange = () => {
      if (pc.iceGatheringState === 'complete' && ips.size > 0) {
        finish([...ips][0] ?? null);
      }
    };
  });
}

export async function detectSandboxServerLanUrl(): Promise<string | null> {
  const ip = await detectLocalIpv4();
  return ip ? formatSandboxServerLanUrl(ip) : null;
}
