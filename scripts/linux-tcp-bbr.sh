#!/usr/bin/env bash
# Sandbox Music — enable TCP BBR + fq qdisc on Linux hosts
# Run as root on Pop!_OS / Ubuntu. See docs/linux-tcp-bbr.md
set -euo pipefail

SYSCTL_FILE="${SYSCTL_FILE:-/etc/sysctl.d/99-sandbox-bbr.conf}"

usage() {
  cat <<'EOF'
Usage: sudo ./scripts/linux-tcp-bbr.sh [--status|--teardown]

Applies:
  net.core.default_qdisc=fq
  net.ipv4.tcp_congestion_control=bbr

Persists to /etc/sysctl.d/99-sandbox-bbr.conf (override with SYSCTL_FILE=…).
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
  echo "tcp_congestion_control=$(sysctl -n net.ipv4.tcp_congestion_control 2>/dev/null || echo '?')"
  echo "default_qdisc=$(sysctl -n net.core.default_qdisc 2>/dev/null || echo '?')"
  echo "available=$(sysctl -n net.ipv4.tcp_available_congestion_control 2>/dev/null || echo '?')"
  if [[ -f "$SYSCTL_FILE" ]]; then
    echo "--- $SYSCTL_FILE ---"
    cat "$SYSCTL_FILE"
  fi
  exit 0
fi

if [[ "${1:-}" == "--teardown" ]]; then
  rm -f "$SYSCTL_FILE"
  sysctl -w net.ipv4.tcp_congestion_control=cubic 2>/dev/null || true
  sysctl -w net.core.default_qdisc=fq_codel 2>/dev/null || true
  echo "Removed $SYSCTL_FILE and reverted to cubic/fq_codel."
  exit 0
fi

if ! sysctl net.ipv4.tcp_available_congestion_control 2>/dev/null | grep -q bbr; then
  modprobe tcp_bbr 2>/dev/null || true
fi

if ! sysctl net.ipv4.tcp_available_congestion_control 2>/dev/null | grep -q bbr; then
  echo "tcp_bbr not available on this kernel." >&2
  exit 1
fi

cat >"$SYSCTL_FILE" <<'EOF'
# Sandbox Music tier34 — TCP BBR for outbound streaming (TCP only; QUIC uses its own CC)
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
EOF

sysctl --system >/dev/null 2>&1 || {
  sysctl -w net.core.default_qdisc=fq
  sysctl -w net.ipv4.tcp_congestion_control=bbr
}

echo "BBR enabled (persisted in $SYSCTL_FILE)."
sysctl net.ipv4.tcp_congestion_control
sysctl net.core.default_qdisc
