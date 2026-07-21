# Linux TCP BBR for tier34 hosts

Host-level **TCP congestion control** tuning for Pop!_OS / Ubuntu machines running tier34 (Docker or bare metal). This improves **TCP** throughput and latency — especially on mobile uplinks and bufferbloat-heavy paths.

## Honest scope

| Protocol | BBR applies? |
|----------|----------------|
| HTTP/1.1 / HTTP/2 to tier34 or Caddy | **Yes** (kernel TCP) |
| WebSocket peer-sync | **Yes** |
| Meilisearch, Headscale control plane | **Yes** |
| **HTTP/3 (QUIC)** | **No** — QUIC has its own CC (see [http3-quic.md](./http3-quic.md)) |
| tmpfs stage cache | **N/A** (local RAM reads) |

Enable BBR on the **Linux host**, not inside the tier34 Node process.

## Quick apply (runtime)

```bash
sudo ./scripts/linux-tcp-bbr.sh
```

Or manually:

```bash
sudo sysctl -w net.core.default_qdisc=fq
sudo sysctl -w net.ipv4.tcp_congestion_control=bbr
```

Verify:

```bash
sysctl net.ipv4.tcp_congestion_control
# bbr

sysctl net.core.default_qdisc
# fq
```

## Persist across reboot (Pop!_OS / Ubuntu)

The script writes `/etc/sysctl.d/99-sandbox-bbr.conf`:

```
net.core.default_qdisc=fq
net.ipv4.tcp_congestion_control=bbr
```

Apply after edit:

```bash
sudo sysctl --system
```

## Prerequisites

- Linux kernel **4.9+** (BBR v1). Pop!_OS 22.04+ and Ubuntu 22.04+ include `tcp_bbr`.
- Load module if missing: `sudo modprobe tcp_bbr`

Check available algorithms:

```bash
sysctl net.ipv4.tcp_available_congestion_control
# should list bbr
```

## Pair with network bonding

For LAN + USB tether failover on the same host, configure bonding first ([linux-network-bonding.md](./linux-network-bonding.md)), then BBR. BBR operates per-TCP-flow on whichever interface carries traffic.

## Windows / Docker Desktop

Docker Desktop on Windows runs Linux VMs for containers, but **host TCP BBR on your Windows PC does not apply** to tier34 in Docker the same way. For Windows-first testing:

- Use default Windows TCP (CUBIC) for client → server paths.
- Run BBR on the **Linux server** (Pop!_OS box, VPS, or Shield-adjacent NAS) where tier34 actually listens.

## Testing impact

1. Before/after `iperf3 -c <tier34-host>` over cellular tether (TCP only).
2. Compare time-to-first-byte on large `/api/stream/:id/full` over **HTTP/2 HTTPS** (not QUIC).
3. QUIC paths: measure separately — BBR sysctl will not change QUIC RTT.

## Rollback

```bash
sudo rm /etc/sysctl.d/99-sandbox-bbr.conf
sudo sysctl -w net.ipv4.tcp_congestion_control=cubic
sudo sysctl -w net.core.default_qdisc=fq_codel
```

Or: `sudo ./scripts/linux-tcp-bbr.sh --teardown`
