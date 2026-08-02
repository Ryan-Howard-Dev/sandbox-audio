/**
 * Finding Chromecasts on the network.
 *
 * The rest of casting here is SSDP: UPnP renderers and Sonos both announce themselves that way,
 * and node-ssdp finds them. Chromecast does not use SSDP. It advertises over multicast DNS as
 * _googlecast._tcp, which is a different protocol on a different port, so this needs its own
 * discovery rather than another M-SEARCH.
 *
 * The interesting part of a Chromecast's mDNS record is its TXT data. The service name is a UUID
 * and useless to a person; "fn" carries the name the owner actually gave it in the Google Home app,
 * and "md" is the hardware model. Without reading those the device list is a column of hex.
 *
 * Discovery is a listen, not a request: responses arrive over a window rather than all at once, so
 * this collects for a fixed period and returns whatever answered. A device that is asleep may take
 * two attempts to appear, which is why the browser is left running between calls.
 */

import { Bonjour, type Service } from 'bonjour-service';
import type { CastDevice } from '../routes/cast.js';

/**
 * How long to collect responses.
 *
 * Long enough for a device across a domestic network to answer, short enough that the device list
 * does not feel broken. Sonos discovery in this codebase uses a comparable window.
 */
const DISCOVERY_WINDOW_MS = 3_000;

/**
 * The port a single Chromecast listens on, used only when a device does not say.
 *
 * Not a constant to rely on. A lone device answers on 8009, but a Google Home speaker group picks
 * a high port — 32065 and friends — and changes it. Each device advertises its real port in the
 * mDNS SRV record, so that is what gets used; this is the fallback for a malformed answer. Wiring
 * 8009 in would mean casting worked to single speakers and silently failed to every group.
 */
export const CHROMECAST_DEFAULT_PORT = 8009;

/** A discovered device, with the address details the transport needs to dial it. */
interface DiscoveredChromecast {
  device: CastDevice;
  host: string;
  port: number;
}

/**
 * One browser for the process rather than one per request.
 *
 * mDNS is a shared cache: a browser that has been listening already knows about devices that
 * answered before it was asked, so keeping it alive makes the second call to /api/cast/discover
 * much better than the first. Creating one per request also leaks sockets, which on a long-running
 * server eventually exhausts the descriptor table.
 */
let bonjour: Bonjour | null = null;
let browser: ReturnType<Bonjour['find']> | null = null;
const seen = new Map<string, DiscoveredChromecast>();

/**
 * A Chromecast's advertised name, preferring what its owner called it.
 *
 * TXT keys are lowercase by convention but not by guarantee, and a device that omits "fn" still
 * has to appear as something. Falling back through the model to the service name means the list
 * degrades from "Kitchen speaker" to "Chromecast Audio" to a UUID, rather than to nothing.
 */
export function chromecastName(txt: Record<string, string> | undefined, fallback: string): string {
  const record = txt ?? {};
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === 'fn' && record[key]?.trim()) return record[key].trim();
  }
  for (const key of Object.keys(record)) {
    if (key.toLowerCase() === 'md' && record[key]?.trim()) return record[key].trim();
  }
  return fallback;
}

/**
 * Pick a usable address from an mDNS answer.
 *
 * A device answers with every address it holds, which includes IPv6 link-local ones that need a
 * scope id to dial and would fail later with a confusing error. IPv4 is preferred for that reason
 * rather than out of principle.
 */
export function preferredAddress(service: {
  addresses?: string[];
  referer?: { address?: string };
}): string | null {
  const addresses = service.addresses ?? [];
  const ipv4 = addresses.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a));
  if (ipv4) return ipv4;
  const referer = service.referer?.address;
  if (referer && /^\d+\.\d+\.\d+\.\d+$/.test(referer)) return referer;
  return addresses[0] ?? null;
}

/**
 * Turn an mDNS answer into the device shape the cast routes already use.
 *
 * Returns null rather than a partial device when there is no address: a device that cannot be
 * dialled is not a device the picker should offer, and showing it produces a failure at the point
 * where someone has already chosen it.
 */
export function serviceToDevice(service: Service): DiscoveredChromecast | null {
  const ip = preferredAddress(service);
  if (!ip) return null;
  const txt = service.txt as Record<string, string> | undefined;
  /*
   * The advertised port, not a fixed one. Speaker groups answer on a high port that changes, so
   * taking 8009 on faith casts fine to a single speaker and fails to every group in the house.
   */
  const port = Number.isInteger(service.port) && service.port > 0
    ? service.port
    : CHROMECAST_DEFAULT_PORT;
  return {
    device: {
      // The mDNS instance name is the device's stable UUID, surviving a rename and a reboot.
      id: `chromecast:${service.name ?? ip}`,
      name: chromecastName(txt, service.name ?? ip),
      ip,
      type: 'chromecast',
    },
    host: ip,
    port,
  };
}

function ensureBrowser(): void {
  if (browser) return;
  bonjour = new Bonjour();
  browser = bonjour.find({ type: 'googlecast', protocol: 'tcp' });
  browser.on('up', (service: Service) => {
    const found = serviceToDevice(service);
    if (found) seen.set(found.device.id, found);
  });
  browser.on('down', (service: Service) => {
    const found = serviceToDevice(service);
    if (found) seen.delete(found.device.id);
  });
}

/**
 * Devices found on this network, as the cast routes expect them.
 *
 * Never throws. Discovery failing is a network being unhelpful, not an error worth a 500 — the
 * caller wants the devices that did answer, and an empty list says the same thing to a person as
 * a stack trace does not.
 */
export async function discoverChromecasts(
  windowMs = DISCOVERY_WINDOW_MS,
): Promise<CastDevice[]> {
  try {
    ensureBrowser();
    // Re-ask on every call. Devices that answered earlier are already in `seen`, so this is about
    // catching the ones that were asleep, not about rebuilding the list.
    browser?.update();
    await new Promise((resolve) => setTimeout(resolve, windowMs));
    return Array.from(seen.values(), (found) => found.device);
  } catch {
    return [];
  }
}

/**
 * Where to dial a device found earlier, so control routes take an id rather than an address.
 *
 * Returns the port the device advertised rather than a fixed one, which is what makes casting to
 * a speaker group work.
 */
export function chromecastAddress(deviceId: string): { host: string; port: number } | null {
  const found = seen.get(deviceId);
  return found ? { host: found.host, port: found.port } : null;
}

/** Shut the browser down. Called when the server stops, so sockets do not outlive it. */
export function stopChromecastDiscovery(): void {
  try {
    browser?.stop();
    bonjour?.destroy();
  } catch {
    // Already gone.
  }
  browser = null;
  bonjour = null;
  seen.clear();
}
