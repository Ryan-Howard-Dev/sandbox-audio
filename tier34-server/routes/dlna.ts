/**
 * DLNA/UPnP MediaServer HTTP routes — device description, SCPD, SOAP control.
 */

import type { Express, Request, Response } from 'express';
import express from 'express';
import {
  applyDlnaEnabled,
  browseContentDirectory,
  escapeXml,
  getDeviceUdn,
  getDlnaRuntimeOverride,
  getFriendlyName,
  getSystemUpdateId,
  isDlnaEnabled,
  isDlnaEnvEnabled,
  resolveDlnaBaseUrl,
  startDlnaSsdp,
  stopDlnaSsdp,
} from '../lib/dlnaMediaServer.js';

const CONTENT_DIRECTORY_NS = 'urn:schemas-upnp-org:service:ContentDirectory:1';
const CONNECTION_MANAGER_NS = 'urn:schemas-upnp-org:service:ConnectionManager:1';

const CONTENT_DIRECTORY_SCPD = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>Browse</name>
      <argumentList>
        <argument><name>ObjectID</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_ObjectID</relatedStateVariable></argument>
        <argument><name>BrowseFlag</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_BrowseFlag</relatedStateVariable></argument>
        <argument><name>Filter</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Filter</relatedStateVariable></argument>
        <argument><name>StartingIndex</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Index</relatedStateVariable></argument>
        <argument><name>RequestedCount</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>SortCriteria</name><direction>in</direction><relatedStateVariable>A_ARG_TYPE_SortCriteria</relatedStateVariable></argument>
        <argument><name>Result</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Result</relatedStateVariable></argument>
        <argument><name>NumberReturned</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>TotalMatches</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_Count</relatedStateVariable></argument>
        <argument><name>UpdateID</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_UpdateID</relatedStateVariable></argument>
      </argumentList>
    </action>
    <action>
      <name>GetSystemUpdateID</name>
      <argumentList>
        <argument><name>Id</name><direction>out</direction><relatedStateVariable>SystemUpdateID</relatedStateVariable></argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_ObjectID</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_BrowseFlag</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Filter</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Index</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Count</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_SortCriteria</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_Result</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_UpdateID</name><dataType>ui4</dataType></stateVariable>
    <stateVariable sendEvents="yes"><name>SystemUpdateID</name><dataType>ui4</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

const CONNECTION_MANAGER_SCPD = `<?xml version="1.0"?>
<scpd xmlns="urn:schemas-upnp-org:service-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <actionList>
    <action>
      <name>GetProtocolInfo</name>
      <argumentList>
        <argument><name>Source</name><direction>out</direction><relatedStateVariable>SourceProtocolInfo</relatedStateVariable></argument>
        <argument><name>Sink</name><direction>out</direction><relatedStateVariable>SinkProtocolInfo</relatedStateVariable></argument>
      </argumentList>
    </action>
    <action>
      <name>GetCurrentConnectionIDs</name>
      <argumentList>
        <argument><name>ConnectionIDs</name><direction>out</direction><relatedStateVariable>A_ARG_TYPE_ConnectionIDList</relatedStateVariable></argument>
      </argumentList>
    </action>
  </actionList>
  <serviceStateTable>
    <stateVariable sendEvents="no"><name>SourceProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>SinkProtocolInfo</name><dataType>string</dataType></stateVariable>
    <stateVariable sendEvents="no"><name>A_ARG_TYPE_ConnectionIDList</name><dataType>string</dataType></stateVariable>
  </serviceStateTable>
</scpd>`;

function soapParam(body: string, name: string): string {
  const patterns = [
    new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'),
    new RegExp(`<u:${name}>([\\s\\S]*?)</u:${name}>`, 'i'),
    new RegExp(`<[^:]+:${name}>([\\s\\S]*?)</[^:]+:${name}>`, 'i'),
  ];
  for (const re of patterns) {
    const match = body.match(re);
    if (match?.[1] !== undefined) return match[1].trim();
  }
  return '';
}

function soapActionName(req: Request): string {
  const header = String(req.headers.soapaction ?? req.headers.SOAPAction ?? '');
  const match = header.match(/#(\w+)"/);
  return match?.[1] ?? '';
}

function soapEnvelope(bodyInner: string): string {
  return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    ${bodyInner}
  </s:Body>
</s:Envelope>`;
}

function deviceDescriptionXml(baseUrl: string): string {
  const udn = getDeviceUdn();
  const friendly = escapeXml(getFriendlyName());
  return `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <specVersion><major>1</major><minor>0</minor></specVersion>
  <URLBase>${escapeXml(baseUrl)}</URLBase>
  <device>
    <deviceType>urn:schemas-upnp-org:device:MediaServer:1</deviceType>
    <friendlyName>${friendly}</friendlyName>
    <manufacturer>Sandbox Music</manufacturer>
    <manufacturerURL>https://github.com/</manufacturerURL>
    <modelDescription>Sovereign Music Console Tier34 DLNA MediaServer</modelDescription>
    <modelName>Sovereign Tier34</modelName>
    <modelNumber>1</modelNumber>
    <serialNumber>1</serialNumber>
    <UDN>${escapeXml(udn)}</UDN>
    <dlna:X_DLNADOC xmlns:dlna="urn:schemas-dlna-org:device-1-0">DMS1.5</dlna:X_DLNADOC>
    <serviceList>
      <service>
        <serviceType>${CONTENT_DIRECTORY_NS}</serviceType>
        <serviceId>urn:upnp-org:serviceId:ContentDirectory</serviceId>
        <SCPDURL>/dlna/ContentDirectory/scpd.xml</SCPDURL>
        <controlURL>/dlna/ContentDirectory/control</controlURL>
        <eventSubURL>/dlna/ContentDirectory/events</eventSubURL>
      </service>
      <service>
        <serviceType>${CONNECTION_MANAGER_NS}</serviceType>
        <serviceId>urn:upnp-org:serviceId:ConnectionManager</serviceId>
        <SCPDURL>/dlna/ConnectionManager/scpd.xml</SCPDURL>
        <controlURL>/dlna/ConnectionManager/control</controlURL>
        <eventSubURL>/dlna/ConnectionManager/events</eventSubURL>
      </service>
    </serviceList>
  </device>
</root>`;
}

function handleContentDirectoryControl(req: Request, res: Response, baseUrl: string): void {
  const action = soapActionName(req);
  const body = typeof req.body === 'string' ? req.body : '';

  res.setHeader('Content-Type', 'text/xml; charset="utf-8"');
  res.setHeader('EXT', '');

  if (action === 'GetSystemUpdateID') {
    const id = getSystemUpdateId();
    res.send(
      soapEnvelope(
        `<u:GetSystemUpdateIDResponse xmlns:u="${CONTENT_DIRECTORY_NS}">
          <Id>${id}</Id>
        </u:GetSystemUpdateIDResponse>`,
      ),
    );
    return;
  }

  if (action === 'Browse') {
    const objectId = soapParam(body, 'ObjectID') || '0';
    const startingIndex = Math.max(0, parseInt(soapParam(body, 'StartingIndex') || '0', 10) || 0);
    const requestedCount = Math.max(0, parseInt(soapParam(body, 'RequestedCount') || '0', 10) || 0);
    const result = browseContentDirectory(objectId, startingIndex, requestedCount, baseUrl);

    res.send(
      soapEnvelope(
        `<u:BrowseResponse xmlns:u="${CONTENT_DIRECTORY_NS}">
          <Result>${escapeXml(result.didl)}</Result>
          <NumberReturned>${result.numberReturned}</NumberReturned>
          <TotalMatches>${result.totalMatches}</TotalMatches>
          <UpdateID>${result.updateId}</UpdateID>
        </u:BrowseResponse>`,
      ),
    );
    return;
  }

  res.status(500).send(
    soapEnvelope(
      `<s:Fault>
        <faultcode>s:Client</faultcode>
        <faultstring>Unknown action: ${escapeXml(action)}</faultstring>
      </s:Fault>`,
    ),
  );
}

function handleConnectionManagerControl(req: Request, res: Response): void {
  const action = soapActionName(req);
  res.setHeader('Content-Type', 'text/xml; charset="utf-8"');
  res.setHeader('EXT', '');

  if (action === 'GetProtocolInfo') {
    const sink =
      'http-get:*:audio/mpeg:*,http-get:*:audio/flac:*,http-get:*:audio/ogg:*,http-get:*:application/octet-stream:*';
    res.send(
      soapEnvelope(
        `<u:GetProtocolInfoResponse xmlns:u="${CONNECTION_MANAGER_NS}">
          <Source></Source>
          <Sink>${escapeXml(sink)}</Sink>
        </u:GetProtocolInfoResponse>`,
      ),
    );
    return;
  }

  if (action === 'GetCurrentConnectionIDs') {
    res.send(
      soapEnvelope(
        `<u:GetCurrentConnectionIDsResponse xmlns:u="${CONNECTION_MANAGER_NS}">
          <ConnectionIDs>0</ConnectionIDs>
        </u:GetCurrentConnectionIDsResponse>`,
      ),
    );
    return;
  }

  res.status(500).send(
    soapEnvelope(
      `<s:Fault>
        <faultcode>s:Client</faultcode>
        <faultstring>Unknown action: ${escapeXml(action)}</faultstring>
      </s:Fault>`,
    ),
  );
}

export function registerDlnaRoutes(app: Express, port: number): boolean {
  const enabled = isDlnaEnabled();
  const baseUrl = resolveDlnaBaseUrl(port);
  const soapParser = express.text({ type: ['text/xml', 'application/soap+xml', '*/*'], limit: '1mb' });

  app.get('/dlna/device.xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset="utf-8"');
    res.send(deviceDescriptionXml(baseUrl));
  });

  app.get('/dlna/ContentDirectory/scpd.xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset="utf-8"');
    res.send(CONTENT_DIRECTORY_SCPD);
  });

  app.get('/dlna/ConnectionManager/scpd.xml', (_req, res) => {
    res.setHeader('Content-Type', 'application/xml; charset="utf-8"');
    res.send(CONNECTION_MANAGER_SCPD);
  });

  app.post('/dlna/ContentDirectory/control', soapParser, (req, res) => {
    handleContentDirectoryControl(req, res, baseUrl);
  });

  app.post('/dlna/ConnectionManager/control', soapParser, (req, res) => {
    handleConnectionManagerControl(req, res);
  });

  app.get('/dlna/status', (_req, res) => {
    res.json({
      enabled: isDlnaEnabled(),
      baseUrl,
      friendlyName: getFriendlyName(),
      udn: getDeviceUdn(),
      systemUpdateId: getSystemUpdateId(),
    });
  });

  app.get('/api/dlna/settings', (_req, res) => {
    res.json({
      enabled: isDlnaEnabled(),
      envEnabled: isDlnaEnvEnabled(),
      runtimeOverride: getDlnaRuntimeOverride() ?? null,
      requiresRestart: false,
      baseUrl,
      friendlyName: getFriendlyName(),
    });
  });

  app.post('/api/dlna/enable', (req, res) => {
    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled boolean required' });
    }
    applyDlnaEnabled(port, enabled);
    res.json({ ok: true, enabled: isDlnaEnabled() });
  });

  if (enabled) {
    startDlnaSsdp(port, baseUrl);
    process.on('exit', () => stopDlnaSsdp());
  }

  return enabled;
}
