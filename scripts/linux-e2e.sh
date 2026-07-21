#!/usr/bin/env bash
# Sandbox Music - Linux (WSL) Tauri desktop smoke E2E
# Usage: ./scripts/linux-e2e.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

EXE="$ROOT/src-tauri/target/release/sandbox-music-console"
ALT="$ROOT/src-tauri/target/release/Sandbox Music"
SERVER_LOG="$ROOT/.e2e-linux-server.log"

pass_area() { echo "[PASS] $1${2:+ - $2}"; }
fail_area() { echo "[FAIL] $1${2:+ - $2}"; }

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 2
  fi
}

echo "=== Linux E2E prerequisites ==="
MISSING=0
for cmd in node npm; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "ok $cmd ($($cmd --version 2>/dev/null | head -1))"
  else
    echo "missing $cmd"; MISSING=1
  fi
done
if command -v rustc >/dev/null 2>&1; then
  echo "ok rustc ($(rustc --version))"
else
  echo "missing rustc (install via rustup for Tauri Linux builds)"; MISSING=1
fi
if command -v cargo >/dev/null 2>&1; then
  echo "ok cargo ($(cargo --version))"
else
  echo "missing cargo"; MISSING=1
fi
if dpkg -s libwebkit2gtk-4.1-dev >/dev/null 2>&1 || dpkg -s libwebkit2gtk-4.0-dev >/dev/null 2>&1; then
  echo "ok webkit2gtk dev headers"
else
  echo "missing libwebkit2gtk-4.1-dev (sudo apt install libwebkit2gtk-4.1-dev ...)"; MISSING=1
fi
if dpkg -s libasound2-dev >/dev/null 2>&1; then
  echo "ok libasound2-dev (ALSA)"
else
  echo "missing libasound2-dev (sudo apt install libasound2-dev)"; MISSING=1
fi

if [[ "$MISSING" -ne 0 ]]; then
  echo ""
  echo "Linux Tauri build not feasible in this WSL environment without the packages above."
  exit 2
fi

# node_modules may have been installed on Windows — ensure Linux Tauri CLI native binding.
if ! node -e "require('@tauri-apps/cli-linux-x64-gnu')" >/dev/null 2>&1; then
  echo "Installing Linux Tauri CLI native binding for WSL ..."
  npm install --no-save @tauri-apps/cli-linux-x64-gnu >/dev/null 2>&1 || {
    echo "Failed to install @tauri-apps/cli-linux-x64-gnu (run npm install in WSL)"
    exit 2
  }
fi

if [[ ! -x "$EXE" && ! -f "$ALT" ]]; then
  echo "Building Tauri desktop (release) ..."
  rm -rf dist
  npm run build:desktop
fi
BIN=""
if [[ -x "$EXE" ]]; then BIN="$EXE"; elif [[ -f "$ALT" ]]; then BIN="$ALT"; else echo "No Linux release binary found"; exit 1; fi
pass_area "Desktop binary" "$BIN"

npx --yes kill-port 3001 >/dev/null 2>&1 || true
PORT=3001 npx tsx tier34-server/index.ts >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT

deadline=$((SECONDS+60))
until curl -sf http://127.0.0.1:3001/health >/dev/null; do
  if (( SECONDS > deadline )); then echo "tier34 failed to start"; exit 1; fi
  sleep 2
done
pass_area "Tier34 health" "http://127.0.0.1:3001/health"

"$BIN" >/dev/null 2>&1 &
APP_PID=$!
sleep 8
if kill -0 "$APP_PID" 2>/dev/null; then pass_area "App process" "pid=$APP_PID"; else fail_area "App process"; exit 1; fi

if curl -sf http://127.0.0.1:3001/api/feed >/dev/null; then pass_area "Tier34 feed API" "/api/feed"; else fail_area "Tier34 feed API"; exit 1; fi

kill "$APP_PID" 2>/dev/null || true
echo "=== LINUX E2E SUMMARY: PASS ==="
