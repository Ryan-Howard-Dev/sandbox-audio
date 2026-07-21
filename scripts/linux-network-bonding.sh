#!/usr/bin/env bash
# Sandbox Music — NetworkManager active-backup bond (LAN + cellular tether)
# Run as root on Pop!_OS / Ubuntu host. See docs/linux-network-bonding.md
set -euo pipefail

BOND="${BOND_NAME:-bond-sandbox}"
LAN="${LAN_IFACE:-}"
CELL="${CELL_IFACE:-}"

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/linux-network-bonding.sh [--status|--teardown]

Env:
  LAN_IFACE   Primary Ethernet/Wi‑Fi (e.g. enp3s0)
  CELL_IFACE  USB tether iface (e.g. enx…)
  BOND_NAME   Bond master name (default: bond-sandbox)

Without flags: creates bond + slaves when LAN_IFACE and CELL_IFACE are set.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ "${EUID:-}" -ne 0 ]]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

if [[ "${1:-}" == "--status" ]]; then
  nmcli device status
  if [[ -f "/proc/net/bonding/${BOND}" ]]; then
    cat "/proc/net/bonding/${BOND}"
  fi
  exit 0
fi

if [[ "${1:-}" == "--teardown" ]]; then
  nmcli connection delete "${BOND}-lan" 2>/dev/null || true
  nmcli connection delete "${BOND}-cell" 2>/dev/null || true
  nmcli connection delete "$BOND" 2>/dev/null || true
  echo "Removed bond connections for ${BOND}."
  exit 0
fi

if [[ -z "$LAN" || -z "$CELL" ]]; then
  echo "Set LAN_IFACE and CELL_IFACE. Current devices:" >&2
  nmcli device status >&2
  usage >&2
  exit 1
fi

nmcli connection add type bond ifname "$BOND" con-name "$BOND" \
  bond.options "mode=active-backup,miimon=100,primary=${LAN}" 2>/dev/null || true

nmcli connection add type ethernet ifname "$LAN" con-name "${BOND}-lan" \
  master "$BOND" slave-type bond 2>/dev/null || true

nmcli connection add type ethernet ifname "$CELL" con-name "${BOND}-cell" \
  master "$BOND" slave-type bond 2>/dev/null || true

nmcli connection modify "$BOND" ipv4.method auto
nmcli connection modify "${BOND}-lan" ipv4.route-metric 50
nmcli connection modify "${BOND}-cell" ipv4.route-metric 200

nmcli connection up "${BOND}-lan"
nmcli connection up "${BOND}-cell"
nmcli connection up "$BOND"

echo "Bond ${BOND} up (primary=${LAN}, backup=${CELL})."
cat "/proc/net/bonding/${BOND}" 2>/dev/null || true
