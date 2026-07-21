# Linux network bonding (LAN + cellular tether)

Host-level configuration for a **Pop!_OS / Ubuntu** tier34 machine that has:

- Primary **Ethernet/Wi‑Fi** (home LAN)
- **USB tether** or **phone hotspot** (cellular gateway)

Goal: **active-backup failover** — prefer low-latency LAN, fall back to cellular when LAN drops. This is **not** embedded in the Tauri app; configure NetworkManager on the host.

## Related tuning

- **TCP BBR** on the same host: [linux-tcp-bbr.md](./linux-tcp-bbr.md) — helps TCP streams to tier34; QUIC uses separate congestion control.
- **HTTP/3 gateway**: [http3-quic.md](./http3-quic.md) — optional Caddy in overlay compose.

## Honest limitations

- Bonding does not bypass CGNAT for inbound remote clients — pair with [overlay-network.md](./overlay-network.md) for phone → home access.
- USB tether interface names vary (`enx…`, `rndis…`, `usb0`).
- Metered cellular: failover may consume mobile data when LAN flaps.
- Lowest-latency routing across two active paths needs policy routing; active-backup is simpler and recommended here.

## Prerequisites

```bash
sudo apt install network-manager
# optional helper script in repo:
# sudo ./scripts/linux-network-bonding.sh
```

## 1. Identify interfaces

```bash
nmcli device status
# Example:
#   enp3s0    ethernet   connected   Wired connection 1
#   enx0c5b…  ethernet   disconnected  —
```

Note your **LAN** iface (e.g. `enp3s0`) and **tether** iface (plug phone in, then re-run `nmcli device status`).

## 2. Create bond (active-backup)

```bash
BOND=bond-sandbox
LAN=enp3s0
CELL=enx0c5b8f4e1a2b   # replace with your tether iface

sudo nmcli connection add type bond ifname "$BOND" con-name "$BOND" \
  bond.options "mode=active-backup,miimon=100,primary=$LAN"

sudo nmcli connection add type ethernet ifname "$LAN" con-name "${BOND}-lan" \
  master "$BOND" slave-type bond

sudo nmcli connection add type ethernet ifname "$CELL" con-name "${BOND}-cell" \
  master "$BOND" slave-type bond
```

Bring up:

```bash
sudo nmcli connection up "${BOND}-lan"
sudo nmcli connection up "${BOND}-cell"
sudo nmcli connection up "$BOND"
```

Verify:

```bash
cat /proc/net/bonding/bond-sandbox
# Primary Slave (primary_reselect): enp3s0
```

## 3. DHCP / static on the bond

If LAN used DHCP, clone IPv4 settings onto the bond master:

```bash
sudo nmcli connection modify "$BOND" ipv4.method auto
sudo nmcli connection down "$LAN" 2>/dev/null || true
sudo nmcli connection up "$BOND"
```

For static LAN, set `ipv4.method manual` and addresses on `$BOND` instead of the physical LAN port.

## 4. Prefer LAN metrics (optional)

Lower route metric on LAN slave connection:

```bash
sudo nmcli connection modify "${BOND}-lan" ipv4.route-metric 50
sudo nmcli connection modify "${BOND}-cell" ipv4.route-metric 200
sudo nmcli connection reload
```

## 5. tier34 binding

tier34 already listens on `0.0.0.0:3001`. With bonding, outbound debrid/proxy traffic uses the active slave — no app change required.

## 6. Tear down

```bash
sudo nmcli connection delete "${BOND}-lan"
sudo nmcli connection delete "${BOND}-cell"
sudo nmcli connection delete "$BOND"
```

## Helper script

`scripts/linux-network-bonding.sh` wraps the steps above (read-only documentation aid — run as root on the host).

## Testing

1. Start tier34; confirm `curl http://127.0.0.1:3001/health`.
2. Unplug Ethernet — bond should fail over to tether (`/proc/net/bonding/bond-sandbox`).
3. Play a track with aggressive offline cache from a client on another network (overlay URL).
