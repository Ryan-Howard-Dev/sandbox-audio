#!/usr/bin/env bash
# beets-watch-sync.sh — verify TIER34_WATCH_PATH and print beets ↔ Sandbox folder-watch workflow.
# Usage: TIER34_WATCH_PATH=/path/to/incoming bash scripts/beets-watch-sync.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WATCH_PATH="${TIER34_WATCH_PATH:-${SANDBOX_WATCH_PATH:-}}"

echo "=== Sandbox Music · beets → folder watch ==="
echo ""

if [[ -z "${WATCH_PATH}" ]]; then
  echo "ERROR: TIER34_WATCH_PATH is not set."
  echo ""
  echo "Set it to the directory where beets should copy/move imported files, e.g.:"
  echo "  export TIER34_WATCH_PATH=\"\$HOME/Music/SandboxIncoming\""
  echo "  npm run dev:tier34"
  echo ""
  echo "See docs/beets-integration.md"
  exit 1
fi

if [[ ! -d "${WATCH_PATH}" ]]; then
  echo "Creating watch directory: ${WATCH_PATH}"
  mkdir -p "${WATCH_PATH}"
fi

if [[ ! -r "${WATCH_PATH}" || ! -w "${WATCH_PATH}" ]]; then
  echo "ERROR: Watch path is not readable/writable: ${WATCH_PATH}"
  exit 1
fi

echo "Watch path: ${WATCH_PATH}"
echo "Tier34 repo: ${ROOT}"
echo ""
echo "Beets config snippet (~/.config/beets/config.yaml):"
echo ""
cat <<YAML
import:
  copy: yes
  write: yes
  destination: ${WATCH_PATH}
YAML
echo ""
echo "Import example:"
echo "  beet import -C \"${WATCH_PATH}\" /path/to/albums"
echo ""
echo "Start tier34 with watch enabled:"
echo "  cd \"${ROOT}\" && TIER34_WATCH_PATH=\"${WATCH_PATH}\" npm run dev:tier34"
echo ""
echo "Doc: docs/beets-integration.md"
