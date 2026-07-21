/**
 * Builds all locale JSON files from embedded translation tables.
 * Run: node scripts/build-all-locales.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const en = JSON.parse(fs.readFileSync(path.join(localesDir, 'en.json'), 'utf8'));

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

function unflatten(flat) {
  const out = {};
  for (const [k, v] of Object.entries(flat)) {
    const parts = k.split('.');
    let cur = out;
    for (let i = 0; i < parts.length - 1; i++) {
      cur[parts[i]] = cur[parts[i]] ?? {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = v;
  }
  return out;
}

const flatEn = flatten(en);

/** Load flat overrides from i18n-data/*.json and zh from generate script output */
const dataDir = path.join(__dirname, 'i18n-data');
const overrides = {};

if (fs.existsSync(path.join(localesDir, 'zh.json'))) {
  overrides.zh = flatten(JSON.parse(fs.readFileSync(path.join(localesDir, 'zh.json'), 'utf8')));
}

if (fs.existsSync(dataDir)) {
  for (const file of fs.readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
    const locale = file.replace('.json', '');
    overrides[locale] = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  }
}

// Machine-readable locale packs inlined (es, pt, de, fr, ja, ko, ru, ar, it, nl, pl, tr, id, vi, th, hi, bn)
import { LOCALE_PACKS } from './locale-packs.mjs';
import { SETTINGS_EXT } from './settings-ext-i18n.mjs';

for (const [locale, pack] of Object.entries(LOCALE_PACKS)) {
  overrides[locale] = { ...overrides[locale], ...pack };
}

for (const [locale, pack] of Object.entries(SETTINGS_EXT)) {
  if (locale === 'en') continue;
  overrides[locale] = { ...overrides[locale], ...pack };
}

for (const [locale, pack] of Object.entries(overrides)) {
  const flat = { ...flatEn, ...pack };
  fs.writeFileSync(
    path.join(localesDir, `${locale}.json`),
    JSON.stringify(unflatten(flat), null, 2) + '\n',
  );
  const translated = Object.keys(pack).filter((k) => pack[k] !== flatEn[k]).length;
  console.log(`${locale}.json — ${translated} translated keys`);
}

console.log(`Source: ${Object.keys(flatEn).length} keys`);
