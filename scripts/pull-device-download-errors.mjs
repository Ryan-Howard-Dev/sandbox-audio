#!/usr/bin/env node
/**
 * Pull download job errors from a connected Android device (adb).
 * Reads WebView Local Storage LevelDB + recent logcat for acquisition failures.
 *
 * Usage: node scripts/pull-device-download-errors.mjs [device-serial]
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_ID = 'rd.sheepskin.sandboxmusic';
const QUEUE_KEY = 'sandbox_download_queue_v1';
const LEVELDB_DIR = 'app_webview/Default/Local Storage/leveldb';

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function resolveAdb() {
  const candidates = [
    process.env.ADB,
    path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    path.join(process.env.HOME ?? '', 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    'adb',
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      execSync(`"${p}" version`, { stdio: 'pipe' });
      return p;
    } catch {
      /* try next */
    }
  }
  throw new Error('adb not found — set ADB or install Android platform-tools');
}

function adbShell(adb, serial, cmd) {
  const args = serial ? ['-s', serial, 'shell', cmd] : ['shell', cmd];
  const r = spawnSync(adb, args, { encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) {
    const err = (r.stderr ?? Buffer.alloc(0)).toString('utf8').trim();
    throw new Error(err || `adb shell failed (${r.status})`);
  }
  return r.stdout ?? Buffer.alloc(0);
}

function listLevelDbFiles(adb, serial) {
  const out = adbShell(
    adb,
    serial,
    `run-as ${APP_ID} ls ${shellQuote(LEVELDB_DIR)}`,
  ).toString('utf8');
  return out
    .split(/\s+/)
    .map((s) => s.trim())
    .filter((s) => s && (s.endsWith('.ldb') || s.endsWith('.log')));
}

function readLevelDbFile(adb, serial, name) {
  const filePath = `${LEVELDB_DIR}/${name}`;
  return adbShell(adb, serial, `run-as ${APP_ID} cat ${shellQuote(filePath)}`);
}

function extractJsonArrays(text) {
  const hits = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[') continue;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          const slice = text.slice(i, j + 1);
          if (slice.includes('"status"') && (slice.includes('dl-') || slice.includes('totalTracks'))) {
            try {
              hits.push(JSON.parse(slice));
            } catch {
              /* not valid JSON */
            }
          }
          i = j;
          break;
        }
      }
    }
  }
  return hits;
}

function summarizeJobs(jobs) {
  const errors = [];
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const failedTracks = Object.values(job.tracks ?? {}).filter((t) => t?.status === 'error');
    const jobErrored = job.status === 'error' || failedTracks.length > 0;
    if (!jobErrored) continue;
    errors.push({
      id: job.id,
      label: job.label,
      artist: job.artist,
      album: job.albumTitle,
      status: job.status,
      progress: job.progress,
      completedTracks: job.completedTracks,
      totalTracks: job.totalTracks,
      jobError: job.error,
      failedTracks: failedTracks.map((t) => ({
        title: t.title,
        error: t.errorMessage,
      })),
    });
  }
  return errors;
}

function pullLogcat(adb, serial) {
  const args = serial
    ? ['-s', serial, 'logcat', '-d', '-t', '500']
    : ['logcat', '-d', '-t', '500'];
  const r = spawnSync(adb, args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const text = r.stdout ?? '';
  const patterns = [
    /SandboxE2E.*RESULT=FAIL[^\n]*/gi,
    /\[mobileAcquisition\][^\n]*/gi,
    /\[acquisition\][^\n]*/gi,
    /download-track[^\n]*FAIL[^\n]*/gi,
  ];
  const lines = new Set();
  for (const re of patterns) {
    for (const m of text.matchAll(re)) lines.add(m[0].trim());
  }
  return [...lines].slice(-40);
}

function main() {
  const serial = process.argv[2]?.trim() || null;
  const adb = resolveAdb();

  const devices = execSync(`"${adb}" devices`, { encoding: 'utf8' })
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((p) => p[1] === 'device')
    .map((p) => p[0]);

  const target = serial ?? devices[0];
  if (!target) {
    console.error('No Android device attached.');
    process.exit(1);
  }

  console.log(`Device: ${target}`);
  console.log('--- Download queue errors (WebView localStorage) ---');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-ls-'));
  let allJobs = [];

  try {
    const files = listLevelDbFiles(adb, target);
    for (const file of files) {
      const buf = readLevelDbFile(adb, target, file);
      const outPath = path.join(tmpDir, file);
      fs.writeFileSync(outPath, buf);
      const latin = buf.toString('latin1');
      if (!latin.includes(QUEUE_KEY) && !latin.includes('dl-') && !latin.includes('totalTracks')) {
        continue;
      }
      for (const arr of extractJsonArrays(latin)) {
        if (Array.isArray(arr) && arr.length > 0 && arr[0]?.id?.startsWith?.('dl-')) {
          allJobs = arr;
        }
      }
    }
  } catch (err) {
    console.warn('LevelDB read failed:', err instanceof Error ? err.message : err);
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  if (allJobs.length === 0) {
    console.log('No download queue snapshot found (queue may be empty or cleared).');
    let errorSnippets = 0;
    for (const file of listLevelDbFiles(adb, target)) {
      const latin = readLevelDbFile(adb, target, file).toString('latin1');
      if (latin.includes('errorMessage')) errorSnippets += 1;
      if (latin.includes('No mobile source')) {
        console.log(`Hint: found "No mobile source" in ${file} (older failed resolve).`);
      }
    }
    if (errorSnippets > 0) {
      console.log(`Found errorMessage in ${errorSnippets} LevelDB file(s) but could not parse queue JSON.`);
    }
  } else {
    console.log(`Jobs in queue: ${allJobs.length}`);
    const errors = summarizeJobs(allJobs);
    if (errors.length === 0) {
      console.log('No errored jobs in persisted queue.');
      const active = allJobs.filter((j) => j.status !== 'done');
      if (active.length) {
        console.log('Active jobs:', JSON.stringify(active.map((j) => ({ label: j.label, status: j.status, progress: j.progress })), null, 2));
      }
    } else {
      console.log(JSON.stringify(errors, null, 2));
    }
  }

  console.log('\n--- Recent acquisition logcat ---');
  const logLines = pullLogcat(adb, target);
  if (logLines.length === 0) {
    console.log('No recent acquisition failure lines in logcat (last 500 lines).');
  } else {
    for (const line of logLines) console.log(line);
  }
}

main();
