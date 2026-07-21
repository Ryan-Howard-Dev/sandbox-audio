// cap sync can regenerate drawable-port-hdpi/splash.png alongside drawable/splash.xml.
// Keep the XML color splash; remove duplicate PNGs so Gradle does not pick both.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const resDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'android',
  'app',
  'src',
  'main',
  'res',
);

function removeSplashPngs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      removeSplashPngs(full);
      continue;
    }
    if (entry.name === 'splash.png') {
      fs.unlinkSync(full);
      console.log(`[cleanup-android-splash] removed ${path.relative(resDir, full)}`);
    }
  }
}

removeSplashPngs(resDir);
