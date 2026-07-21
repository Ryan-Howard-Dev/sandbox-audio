/**
 * Network speaker casting — UPnP/DLNA discovery, Sonos SOAP, locker stream proxy.
 */

import type { Express, Request, Response } from 'express';
import { createReadStream, statSync } from 'node:fs';
import nodeSsdp from 'node-ssdp';
const { Client } = nodeSsdp;
import {
  blobExists,
  loadMasterManifest,
  sha256HexFile,
} from '../lib/lockerStorage.js';
import { blobPathForHash } from '../lib/lockerPaths.js';

export type CastDeviceType = 'upnp' | 'sonos' | 'remote_cast';

export type CastDevice = {
  id: string;
  name: string;
  ip: string;
  type: CastDeviceType;
  location?: string;
};

const HASH_RE = /^[a-f0-9]{64}$/i;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sonosControlUrl(ip: string, service: 'AVTransport' | 'RenderingControl'): string {
  return `http://${ip}:1400/MediaRenderer/${service}/Control`;
}

async function sonosSoap(
  ip: string,
  service: 'AVTransport' | 'RenderingControl',
  action: string,
  bodyInner: string,
): Promise<void> {
  const envelope = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    ${bodyInner}
  </s:Body>
</s:Envelope>`;

  const namespace =
    service === 'AVTransport'
      ? 'urn:schemas-upnp-org:service:AVTransport:1'
      : 'urn:schemas-upnp-org:service:RenderingControl:1';

  const res = await fetch(sonosControlUrl(ip, service), {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"${namespace}#${action}"`,
    },
    body: envelope,
    signal: AbortSignal.timeout(8_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Sonos ${action} failed (${res.status})${detail ? `: ${detail.slice(0, 120)}` : ''}`);
  }
}

export async function isSonos(ip: string): Promise<boolean> {
  try {
    const res = await fetch(`http://${ip}:1400/xml/device_description.xml`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes('Sonos');
  } catch {
    return false;
  }
}

export async function fetchSonosFriendlyName(ip: string): Promise<string | null> {
  try {
    const res = await fetch(`http://${ip}:1400/xml/device_description.xml`, {
      signal: AbortSignal.timeout(2_000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function streamToSonos(
  ip: string,
  streamUrl: string,
  title: string,
  artist: string,
): Promise<void> {
  const safeTitle = escapeXml(title);
  const safeArtist = escapeXml(artist);
  const safeUrl = escapeXml(streamUrl);

  const meta = escapeXml(
    `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns="urn:schemas-upnp-org:metadata-1-0/">
      <item id="0" parentID="0" restricted="1">
        <dc:title>${safeTitle}</dc:title>
        <dc:creator>${safeArtist}</dc:creator>
        <res protocolInfo="http-get:*:audio/mpeg:*">${safeUrl}</res>
      </item>
    </DIDL-Lite>`,
  );

  await sonosSoap(
    ip,
    'AVTransport',
    'SetAVTransportURI',
    `<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <CurrentURI>${safeUrl}</CurrentURI>
      <CurrentURIMetaData>${meta}</CurrentURIMetaData>
    </u:SetAVTransportURI>`,
  );

  await sonosSoap(
    ip,
    'AVTransport',
    'Play',
    `<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
      <Speed>1</Speed>
    </u:Play>`,
  );
}

export async function pauseSonos(ip: string): Promise<void> {
  await sonosSoap(
    ip,
    'AVTransport',
    'Pause',
    `<u:Pause xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">
      <InstanceID>0</InstanceID>
    </u:Pause>`,
  );
}

export async function setSonosVolume(ip: string, volume: number): Promise<void> {
  const vol = Math.max(0, Math.min(100, Math.round(volume)));
  await sonosSoap(
    ip,
    'RenderingControl',
    'SetVolume',
    `<u:SetVolume xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1">
      <InstanceID>0</InstanceID>
      <Channel>Master</Channel>
      <DesiredVolume>${vol}</DesiredVolume>
    </u:SetVolume>`,
  );
}

async function fetchUpnpFriendlyName(location: string): Promise<string | null> {
  try {
    const res = await fetch(location, { signal: AbortSignal.timeout(2_500) });
    if (!res.ok) return null;
    const text = await res.text();
    const match = text.match(/<friendlyName>([^<]+)<\/friendlyName>/i);
    return match?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

export async function discoverUPnPDevices(): Promise<CastDevice[]> {
  return new Promise((resolve) => {
    const client = new Client();
    const byIp = new Map<string, CastDevice>();

    client.on('response', (headers: Record<string, string>, _statusCode: number, rinfo: { address: string }) => {
      const location = headers.LOCATION ?? headers.location;
      if (!location || !rinfo?.address) return;
      const ip = rinfo.address;
      if (byIp.has(ip)) return;
      byIp.set(ip, {
        id: ip,
        name: headers.SERVER?.split('/')[0]?.trim() || ip,
        ip,
        type: 'upnp',
        location,
      });
    });

    try {
      client.search('urn:schemas-upnp-org:device:MediaRenderer:1');
      client.search('urn:schemas-upnp-org:device:MediaServer:1');
    } catch {
      /* search may fail on some hosts */
    }

    setTimeout(() => {
      try {
        client.stop();
      } catch {
        /* ignore */
      }
      resolve([...byIp.values()]);
    }, 3_000);
  });
}

async function enhanceDiscoveredDevices(devices: CastDevice[]): Promise<CastDevice[]> {
  const enhanced = await Promise.all(
    devices.map(async (device) => {
      const sonos = await isSonos(device.ip);
      if (sonos) {
        const friendly = await fetchSonosFriendlyName(device.ip);
        return {
          ...device,
          type: 'sonos' as const,
          name: friendly ?? `Sonos (${device.ip})`,
        };
      }
      if (device.location) {
        const friendly = await fetchUpnpFriendlyName(device.location);
        if (friendly) return { ...device, name: friendly };
      }
      return device;
    }),
  );

  const deduped = new Map<string, CastDevice>();
  for (const device of enhanced) {
    if (!deduped.has(device.ip)) deduped.set(device.ip, device);
  }
  return [...deduped.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function resolveTrackHash(trackId: string): string | null {
  const id = trackId.trim().toLowerCase();
  if (HASH_RE.test(id)) {
    return blobExists(id) ? id : null;
  }

  const manifest = loadMasterManifest();
  const entry = manifest.entries.find((e) => e.id === trackId || e.id.toLowerCase() === id);
  if (!entry?.contentHash) return null;
  const hash = entry.contentHash.toLowerCase();
  return blobExists(hash) ? hash : null;
}

async function detectContentType(filePath: string): Promise<string> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { start: 0, end: 11 });
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      const buf = Buffer.concat(chunks);
      if (buf.slice(0, 4).toString() === 'fLaC') resolve('audio/flac');
      else if (buf.slice(0, 4).toString() === 'OggS') resolve('audio/ogg');
      else if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) resolve('audio/mpeg');
      else if (buf.slice(0, 3).toString() === 'ID3') resolve('audio/mpeg');
      else resolve('audio/mpeg');
    });
    stream.on('error', () => resolve('audio/mpeg'));
  });
}

function pipeRange(
  req: Request,
  res: Response,
  filePath: string,
  fileSize: number,
  contentType: string,
): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', contentType);

  const range = req.headers.range;
  if (!range) {
    res.setHeader('Content-Length', String(fileSize));
    createReadStream(filePath).pipe(res);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    res.status(416).end();
    return;
  }

  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

  if (Number.isNaN(start) || Number.isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
    return;
  }

  const chunkSize = end - start + 1;
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
  res.setHeader('Content-Length', String(chunkSize));
  createReadStream(filePath, { start, end }).pipe(res);
}

export function registerCastRoutes(app: Express): void {
  app.get('/api/cast/discover', async (_req, res) => {
    try {
      const raw = await discoverUPnPDevices();
      const devices = await enhanceDiscoveredDevices(raw);
      res.json({ devices });
    } catch (e) {
      console.error('[tier34] cast discover', e);
      res.status(500).json({ error: 'discovery failed', devices: [] });
    }
  });

  app.post('/api/cast/sonos/play', async (req, res) => {
    const ip = String(req.body?.ip ?? '').trim();
    const streamUrl = String(req.body?.streamUrl ?? '').trim();
    const title = String(req.body?.title ?? 'Unknown Track');
    const artist = String(req.body?.artist ?? 'Unknown Artist');

    if (!ip || !streamUrl) {
      return res.status(400).json({ error: 'ip and streamUrl required' });
    }
    if (streamUrl.startsWith('blob:')) {
      return res.status(400).json({ error: 'blob URLs cannot be cast to network speakers' });
    }
    if (!/^https?:\/\//i.test(streamUrl)) {
      return res.status(400).json({ error: 'streamUrl must be http(s)' });
    }

    try {
      await streamToSonos(ip, streamUrl, title, artist);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tier34] sonos play', e);
      res.status(502).json({ error: msg });
    }
  });

  app.post('/api/cast/sonos/pause', async (req, res) => {
    const ip = String(req.body?.ip ?? '').trim();
    if (!ip) return res.status(400).json({ error: 'ip required' });
    try {
      await pauseSonos(ip);
      res.json({ ok: true });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tier34] sonos pause', e);
      res.status(502).json({ error: msg });
    }
  });

  app.post('/api/cast/sonos/volume', async (req, res) => {
    const ip = String(req.body?.ip ?? '').trim();
    const volume = Number(req.body?.volume);
    if (!ip) return res.status(400).json({ error: 'ip required' });
    if (!Number.isFinite(volume)) return res.status(400).json({ error: 'volume required' });
    try {
      await setSonosVolume(ip, volume);
      res.json({ ok: true, volume: Math.max(0, Math.min(100, Math.round(volume))) });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[tier34] sonos volume', e);
      res.status(502).json({ error: msg });
    }
  });

  app.get('/api/cast/stream/:trackId', async (req, res) => {
    const trackId = String(req.params.trackId ?? '').trim();
    if (!trackId) return res.status(400).json({ error: 'trackId required' });

    const hash = resolveTrackHash(trackId);
    if (!hash) return res.status(404).json({ error: 'track not found' });

    const filePath = blobPathForHash(hash);

    try {
      const actualHash = await sha256HexFile(filePath);
      if (actualHash !== hash) {
        return res.status(409).json({ error: 'blob integrity mismatch' });
      }
    } catch (e) {
      console.error('[tier34] cast stream integrity', e);
      return res.status(500).json({ error: 'integrity check failed' });
    }

    let fileSize = 0;
    try {
      fileSize = statSync(filePath).size;
    } catch {
      return res.status(404).json({ error: 'blob missing' });
    }

    const contentType = await detectContentType(filePath);
    pipeRange(req, res, filePath, fileSize, contentType);
  });
}
