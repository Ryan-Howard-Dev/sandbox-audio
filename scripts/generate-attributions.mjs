#!/usr/bin/env node
/**
 * Collect the licences of everything this app ships.
 *
 * Most of the licences here ask for the same two things: keep the copyright notice, and pass the
 * licence text along to whoever receives the software. Apache-2.0 goes further and asks that any
 * NOTICE file travels with the work. None of that is onerous, but all of it is easy to forget, and
 * the way it gets forgotten is by being written by hand once and never updated.
 *
 * So it is generated. `npm ls` knows the real dependency tree, which is the only source that
 * cannot drift from what actually ships.
 *
 * Production dependencies only. Everything under devDependencies is used to build the app and is
 * not distributed in it, so attributing it would pad the list with a few hundred packages nobody
 * received.
 *
 * Licence texts are stored once per licence rather than once per package. Four hundred copies of
 * the MIT licence is not more compliant than one, and it is the difference between a screen that
 * loads and a megabyte of JSON.
 *
 * Usage:  node scripts/generate-attributions.mjs [--check]
 *         --check fails when the committed file is out of date, for CI.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputJson = join(root, 'src', 'generated', 'attributions.json');
const outputNotice = join(root, 'NOTICE');

/** Files a package might put its licence in. Case varies; extensions vary more. */
const LICENCE_FILENAMES = /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i;
const NOTICE_FILENAMES = /^notice(\.(md|txt|markdown))?$/i;

function readTree() {
  const raw = execFileSync('npm', ['ls', '--omit=dev', '--all', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    // npm exits non-zero on peer-dependency warnings while still printing a complete tree, so the
    // output is used regardless and only a genuinely unparseable answer is treated as failure.
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(raw);
}

function collectPackages(tree) {
  const found = new Map();
  const walk = (node) => {
    for (const [name, entry] of Object.entries(node.dependencies ?? {})) {
      const version = entry.version ?? '0.0.0';
      const key = `${name}@${version}`;
      if (!found.has(key)) found.set(key, { name, version });
      walk(entry);
    }
  };
  walk(tree);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function findFile(dir, pattern) {
  if (!existsSync(dir)) return null;
  try {
    for (const entry of readdirSync(dir)) {
      if (pattern.test(entry)) {
        const text = readFileSync(join(dir, entry), 'utf8').trim();
        if (text) return text;
      }
    }
  } catch {
    // A package directory we cannot read contributes nothing; it is not worth failing over.
  }
  return null;
}

/**
 * The licence a package declares.
 *
 * `license` is the modern field. `licenses` is the deprecated array form, still present in older
 * packages, and reading only the first is deliberate: a package offering a choice is satisfied by
 * honouring one of them.
 */
function declaredLicence(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license?.type) return manifest.license.type;
  if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
    return manifest.licenses[0]?.type ?? 'UNKNOWN';
  }
  return 'UNKNOWN';
}

function repositoryUrl(manifest) {
  const repo = manifest.repository;
  const url = typeof repo === 'string' ? repo : repo?.url;
  if (!url) return undefined;
  return url
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/\.git$/, '');
}

function build() {
  const packages = collectPackages(readTree());
  const licenceTexts = {};
  const notices = {};
  const rows = [];

  for (const { name, version } of packages) {
    const dir = join(root, 'node_modules', ...name.split('/'));
    const manifestPath = join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    } catch {
      continue;
    }

    const licence = declaredLicence(manifest);
    rows.push({ name, version, license: licence, repository: repositoryUrl(manifest) });

    // One canonical copy per licence. The first package to ship full text supplies it.
    if (!licenceTexts[licence]) {
      const text = findFile(dir, LICENCE_FILENAMES);
      if (text) licenceTexts[licence] = text;
    }

    /*
     * Apache-2.0 section 4 asks that a NOTICE file travels with the work, so these are kept per
     * package rather than deduplicated. Their whole purpose is to name a specific author.
     */
    const notice = findFile(dir, NOTICE_FILENAMES);
    if (notice) notices[name] = notice;
  }

  return {
    // Deliberately not a timestamp. A generated file that changes on every run shows up as a diff
    // in every commit, and then nobody reads its diffs at all.
    packageCount: rows.length,
    packages: rows,
    licenseTexts: licenceTexts,
    notices,
  };
}

function renderNotice(data) {
  const byLicence = new Map();
  for (const row of data.packages) {
    if (!byLicence.has(row.license)) byLicence.set(row.license, []);
    byLicence.get(row.license).push(`${row.name}@${row.version}`);
  }

  const lines = [
    'Sandbox Audio',
    '',
    'This product bundles third-party software. The components below are listed with the',
    'licence each is distributed under. Full licence texts are shown in the app under',
    'Settings, About, Open source licences.',
    '',
    'Native components compiled into the Android build (sherpa-onnx, ONNX Runtime, espeak-ng,',
    'the Piper voice, ffmpeg and Python) are listed in src/attributions.ts, since they do not',
    'come through npm and cannot be discovered from the dependency tree.',
    '',
  ];

  for (const licence of [...byLicence.keys()].sort()) {
    const names = byLicence.get(licence).sort();
    lines.push(`## ${licence} (${names.length})`, '');
    lines.push(...names.map((n) => `  ${n}`));
    lines.push('');
  }

  const noticed = Object.keys(data.notices).sort();
  if (noticed.length > 0) {
    lines.push('## NOTICE files, reproduced as Apache-2.0 section 4 requires', '');
    for (const name of noticed) {
      lines.push(`### ${name}`, '', data.notices[name], '');
    }
  }

  return lines.join('\n') + '\n';
}

function main() {
  const check = process.argv.includes('--check');
  const data = build();
  const json = `${JSON.stringify(data, null, 2)}\n`;
  const notice = renderNotice(data);

  if (check) {
    const staleJson = !existsSync(outputJson) || readFileSync(outputJson, 'utf8') !== json;
    const staleNotice = !existsSync(outputNotice) || readFileSync(outputNotice, 'utf8') !== notice;
    if (staleJson || staleNotice) {
      console.error('[attributions] out of date — run `npm run build:attributions`');
      return 1;
    }
    console.log(`[attributions] up to date (${data.packageCount} packages)`);
    return 0;
  }

  mkdirSync(dirname(outputJson), { recursive: true });
  writeFileSync(outputJson, json);
  writeFileSync(outputNotice, notice);
  const licences = Object.keys(data.licenseTexts).length;
  console.log(
    `[attributions] ${data.packageCount} packages, ${licences} licence texts, ` +
      `${Object.keys(data.notices).length} NOTICE files`,
  );
  return 0;
}

process.exit(main());
