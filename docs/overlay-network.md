# Overlay network (self-hosted remote access)

Remote phones (OnePlus, cellular) need a path to your home **tier34** Sandbox Server without port-forwarding through CGNAT. This project ships a **self-hosted overlay** — not Tailscale SaaS, not a third-party public relay.

## Honest limitations

| Claim | Reality |
|-------|---------|
| "Bypass CGNAT with zero config" | **Impossible.** Some coordination endpoint is always required (STUN, DERP, lighthouse, or port-forward). |
| "No public relay" | **Achievable** with Headscale or Nebula — you run the coordination plane. |
| "Works on every carrier" | **No guarantee.** UDP blocking, IPv6-only CGNAT, or aggressive NAT timeouts can still break P2P. |
| Overlay + aggressive prefetch | Prefetch helps **after** the first successful download; it does not fix unreachable servers. |

## Recommended: Headscale + Tailscale sidecar

The repo includes `docker-compose.overlay.yml`, which extends the base stack with:

1. **Headscale** — open-source Tailscale control server (you own it).
2. **tier34-tailscale** — Tailscale client in the same network namespace as tier34, so `http://<overlay-ip>:3001` reaches the API.

### Setup (Linux host or NAS)

```bash
cp overlay/headscale/config.example.yaml overlay/headscale/config.yaml
cp .env.overlay.example .env.overlay
# Edit .env.overlay — set TAILSCALE_AUTHKEY after step 3

docker compose -f docker-compose.yml -f docker-compose.overlay.yml --env-file .env.overlay up -d

# Create Headscale user + reusable auth key
docker exec sandbox-headscale headscale users create sandbox
docker exec sandbox-headscale headscale preauthkeys create --user sandbox --reusable --expiration 720h
# Paste key into .env.overlay → TAILSCALE_AUTHKEY, then:
docker compose -f docker-compose.yml -f docker-compose.overlay.yml --env-file .env.overlay up -d tier34-tailscale
```

### Client (Windows / Android)

1. Install [Tailscale](https://tailscale.com/download) and point it at your Headscale URL (custom login server — see [Headscale docs](https://headscale.net/stable/)).
2. In Sandbox Music: **Settings → Vault → Sandbox Server → Server on another device**.
3. Set **Remote URL** to the overlay address, e.g.:
   - `http://100.x.x.x:3001` (Tailscale IP), or
   - `http://sandbox-tier34:3001` (MagicDNS if enabled in Headscale config).

tier34 binds `0.0.0.0:3001` — it is reachable on the overlay interface via the sidecar.

## Alternative: Nebula lighthouse

Uncomment `nebula-lighthouse` in `docker-compose.overlay.yml` and provide certs under `overlay/nebula/`. Nebula uses a **lighthouse** you host (same honesty: coordination is required, but you own it).

## Alternative: WireGuard + port forward

If you have a public IP or can forward UDP 51820:

1. Run WireGuard on the tier34 host.
2. Forward the port on your router.
3. Set the client Remote URL to the WireGuard tunnel IP, e.g. `http://10.8.0.1:3001`.

No Docker overlay required; document your keys outside the repo.

## Aggressive prefetch + overlay

With **Settings → Vault → Aggressive offline cache** enabled, the client downloads the full track via:

- `GET /api/stream/:id/full` (locker tracks)
- `GET /api/stream/full?url=…` (proxy streams, size-capped)

Playback uses a local blob URL after prefetch — useful when cellular drops briefly **after** the file is local.

## tmpfs stage cache + HTTP/3 gateway

- **tmpfs**: tier34 copies locker blobs to `/cache` (512 MB default) when the client POSTs `/api/cache/stage-queue` on playback. Streams check RAM first (`X-Sandbox-Tmpfs-Cache: 1`). See compose `tmpfs` mount and `TIER34_TMPFS_CACHE`.
- **HTTP/3**: optional `tier34-gateway` (Caddy) in overlay compose terminates QUIC on UDP/TCP 443. See [http3-quic.md](./http3-quic.md).
- **TCP BBR** on Linux host: [linux-tcp-bbr.md](./linux-tcp-bbr.md) — complements overlay; does not affect QUIC.

## Testing notes

| Platform | What to verify |
|----------|----------------|
| **Windows (first)** | Tailscale/Headscale connected; Settings health shows tier34 ONLINE; play a tier 3/4 track with aggressive cache; confirm prefetch toast then playback. |
| **OnePlus 12 (Android)** | Same Remote URL on cellular (Wi‑Fi off); aggressive prefetch on a ~5 MB track; airplane-mode playback of cached track. |
| **NVIDIA Shield** | Remote URL on LAN or overlay; DLNA optional; prefetch less critical on stable LAN. |

## Files

- `docker-compose.overlay.yml` — Headscale + tier34 Tailscale sidecar + Caddy HTTP/3 gateway
- `overlay/caddy/Caddyfile` — QUIC/TLS reverse proxy to tier34
- `.env.overlay.example` — overlay environment template
- `overlay/headscale/config.example.yaml` — Headscale config starter
- `docs/http3-quic.md`, `docs/linux-tcp-bbr.md` — gateway and host tuning
