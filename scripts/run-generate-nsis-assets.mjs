/**
 * Runs generate-nsis-assets.py when Python is available (optional step).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "generate-nsis-assets.py");

if (!existsSync(script)) {
  console.warn("[nsis-assets] Skipping: scripts/generate-nsis-assets.py not found");
  process.exit(0);
}

const result = spawnSync("python", [script], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error?.code === "ENOENT") {
  console.warn("[nsis-assets] Skipping: python not found on PATH");
  process.exit(0);
}

process.exit(result.status ?? 1);
