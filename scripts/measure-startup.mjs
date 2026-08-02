#!/usr/bin/env node
/**
 * Where the app's startup time actually goes.
 *
 * `adb shell am start -W` reports how long Android took to put the activity on screen, which on
 * this app is around 600ms and is not the part anyone is waiting for. Everything a user experiences
 * as "slow to open" happens after that, inside the WebView: fetching and parsing the bundle,
 * evaluating it, opening IndexedDB, hydrating the locker, and finally painting something.
 *
 * That interval is invisible to every Android-side tool, so this reads it from the WebView itself
 * over the Chrome DevTools Protocol. No app changes and no instrumentation build: the numbers come
 * from the Navigation Timing and Paint Timing the engine already records.
 *
 * Usage:
 *   node scripts/measure-startup.mjs            # assumes the app is running
 *   node scripts/measure-startup.mjs --relaunch # force-stop and cold start first
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PACKAGE = 'rd.sheepskin.sandboxmusic';
const PORT = 9333;

function findAdb() {
  const candidates = [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools', 'adb.exe'),
    process.env.ANDROID_SDK_ROOT && join(process.env.ANDROID_SDK_ROOT, 'platform-tools', 'adb.exe'),
    join(homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'),
    join(homedir(), 'Library', 'Android', 'sdk', 'platform-tools', 'adb'),
    '/usr/bin/adb',
  ].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  // On PATH, or not installed — let the first call report it.
  return 'adb';
}

const adb = findAdb();
const sh = (args, opts = {}) =>
  execFileSync(adb, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...opts });

function relaunch() {
  sh(['shell', 'am', 'force-stop', PACKAGE]);
  // A cold start is the case worth measuring; a warm one hides the bundle parse entirely.
  execFileSync(adb, ['shell', 'monkey', '-p', PACKAGE, '-c', 'android.intent.category.LAUNCHER', '1'], {
    stdio: 'ignore',
  });
}

function webviewSocket() {
  const unix = sh(['shell', 'cat', '/proc/net/unix']);
  const match = unix.match(/webview_devtools_remote_\d+/g);
  if (!match?.length) throw new Error('no WebView devtools socket — is the app running?');
  return [...new Set(match)][0];
}

async function pageTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const pages = await res.json();
  const page = pages.find((p) => p.type === 'page' && p.webSocketDebuggerUrl);
  if (!page) throw new Error('no page target in the WebView');
  return page.webSocketDebuggerUrl;
}

/**
 * Evaluate an expression in the page and return its value.
 *
 * Hand-rolled rather than pulling in a CDP client: one request/response over a websocket does not
 * justify a dependency, and the app has enough of those.
 */
async function evaluate(wsUrl, expression) {
  const { WebSocket } = await import('node:worker_threads').then(() => globalThis);
  const ws = new WebSocket(wsUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('devtools evaluate timed out'));
    }, 15_000);
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }),
      );
    };
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== 1) return;
      clearTimeout(timer);
      ws.close();
      if (msg.result?.exceptionDetails) {
        reject(new Error(msg.result.exceptionDetails.text ?? 'evaluate threw'));
        return;
      }
      resolve(msg.result?.result?.value);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('devtools socket error'));
    };
  });
}

/** Read straight off the engine's own timing, so nothing here can invent a number. */
const PROBE = `(() => {
  const nav = performance.getEntriesByType('navigation')[0] ?? {};
  const paints = Object.fromEntries(
    performance.getEntriesByType('paint').map((p) => [p.name, Math.round(p.startTime)]),
  );
  const scripts = performance
    .getEntriesByType('resource')
    .filter((r) => r.initiatorType === 'script' || /\\.(js|mjs)(\\?|$)/.test(r.name))
    .map((r) => ({
      name: r.name.split('/').pop().slice(0, 44),
      startMs: Math.round(r.startTime),
      durationMs: Math.round(r.duration),
      kb: Math.round((r.transferSize || r.encodedBodySize || 0) / 1024),
    }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 8);
  const marks = performance
    .getEntriesByType('mark')
    .map((m) => ({ name: m.name, atMs: Math.round(m.startTime) }));
  return {
    responseEndMs: Math.round(nav.responseEnd ?? 0),
    domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd ?? 0),
    loadEventMs: Math.round(nav.loadEventEnd ?? 0),
    domInteractiveMs: Math.round(nav.domInteractive ?? 0),
    paints,
    scripts,
    marks,
    scriptCount: performance.getEntriesByType('resource').filter((r) => /\\.(js|mjs)(\\?|$)/.test(r.name)).length,
    totalScriptKb: Math.round(
      performance.getEntriesByType('resource')
        .filter((r) => /\\.(js|mjs)(\\?|$)/.test(r.name))
        .reduce((sum, r) => sum + (r.transferSize || r.encodedBodySize || 0), 0) / 1024,
    ),
  };
})()`;

function row(label, value) {
  console.log(`  ${String(label).padEnd(30)} ${value}`);
}

async function main() {
  if (process.argv.includes('--relaunch')) {
    console.log('[startup] cold start…');
    relaunch();
    // The WebView needs to exist before its socket does, and the app needs to finish booting
    // before the timings mean anything.
    await new Promise((r) => setTimeout(r, 20_000));
  }

  const socket = webviewSocket();
  sh(['forward', `tcp:${PORT}`, `localabstract:${socket}`]);
  const wsUrl = await pageTarget();
  const t = await evaluate(wsUrl, PROBE);

  console.log('\n[startup] WebView timing, from the engine itself\n');
  row('HTML delivered', `${t.responseEndMs} ms`);
  row('DOM interactive', `${t.domInteractiveMs} ms`);
  row('DOMContentLoaded', `${t.domContentLoadedMs} ms`);
  row('load event', `${t.loadEventMs} ms`);
  row('first paint', `${t.paints['first-paint'] ?? '—'} ms`);
  row('first contentful paint', `${t.paints['first-contentful-paint'] ?? '—'} ms`);
  console.log();
  row('scripts fetched', `${t.scriptCount}`);
  row('script bytes', `${t.totalScriptKb} KB`);

  if (t.scripts.length) {
    console.log('\n  slowest scripts');
    for (const s of t.scripts) {
      console.log(
        `    ${String(s.durationMs + 'ms').padStart(7)}  ${String(s.kb + 'KB').padStart(7)}  ` +
          `@${String(s.startMs).padStart(5)}ms  ${s.name}`,
      );
    }
  }

  if (t.marks.length) {
    console.log('\n  app marks');
    for (const m of t.marks) console.log(`    ${String(m.atMs + 'ms').padStart(8)}  ${m.name}`);
  } else {
    console.log('\n  app marks: none — nothing in the app calls performance.mark()');
  }

  console.log();
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(`[startup] ${err.message}`);
    process.exit(1);
  });
