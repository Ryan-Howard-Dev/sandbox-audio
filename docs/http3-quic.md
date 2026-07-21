# HTTP/3 (QUIC) gateway for Sandbox tier34

The optional **tier34-gateway** service (Caddy) terminates TLS and HTTP/3 on port **443** (TCP + UDP), then reverse-proxies to tier34 on `:3001`.

## Docker usage

```bash
# Base stack (tier34 + tmpfs cache, no QUIC gateway)
docker compose up -d

# Overlay stack: Headscale/Tailscale + Caddy HTTP/3 gateway
cp overlay/headscale/config.example.yaml overlay/headscale/config.yaml
cp .env.overlay.example .env.overlay
docker compose -f docker-compose.yml -f docker-compose.overlay.yml --env-file .env.overlay up -d
```

Gateway config: [`overlay/caddy/Caddyfile`](../overlay/caddy/Caddyfile).

Environment:

| Variable | Default | Purpose |
|----------|---------|---------|
| `TIER34_HTTPS_PORT` | `443` | Host port for HTTPS + QUIC (UDP) |
| `TIER34_TMPFS_CACHE_MAX_MB` | `512` | tmpfs size for in-RAM blob cache |

## Client configuration

1. Point **Settings → Sandbox Server URL** at `https://<host>:443` (not `http://:3001`) when using the gateway.
2. Accept the self-signed Caddy `tls internal` certificate on first visit (or replace with real certs in the Caddyfile).
3. Caddy sends `Alt-Svc: h3=":443"; ma=2592000` so supporting clients can upgrade to QUIC on later requests.

### Connection migration (Wi‑Fi ↔ cellular)

QUIC connection migration lets a client keep the same connection ID when the local IP changes (e.g. Wi‑Fi drops and phone falls back to LTE). Requirements:

- Client must use **HTTP/3 over QUIC** end-to-end (not plain HTTP/1.1).
- UDP to port 443 must reach the gateway (firewall/NAT must allow inbound UDP 443 or use overlay/Tailscale).
- Migration is handled by the **client QUIC stack**, not tier34 itself.

## Honest browser / `<audio>` limitations

| Client | QUIC / HTTP/3 for playback? |
|--------|----------------------------|
| Chrome (desktop) | `fetch()` can use H3 after Alt-Svc; **`<audio src>` often uses HTTP/1.1 or H2** via media pipeline — QUIC benefit may be limited for in-browser playback. |
| Android WebView / Capacitor | Same as Chrome; native **ExoPlayer** paths use HTTP stack separately — configure tier34 URL in app settings; ExoPlayer does not automatically pick up browser Alt-Svc. |
| Aggressive prefetch (`streamCache`) | Uses `fetch()` — **more likely to benefit from H3** than `<audio>` element streaming. |
| tmpfs stage cache | Server-side RAM read — helps **all** clients regardless of QUIC. |

Optional fetch hint (for code that uses `fetch`, not `<audio>`):

```typescript
// Browsers ignore this for <audio>; useful only for fetch()-based prefetch.
fetch(url, { priority: 'high', cache: 'default' });
```

There is no standard way to force `<audio>` onto HTTP/3.

## Verify HTTP/3

```bash
# Caddy access log (if enabled)
docker logs sandbox-tier34-gateway

# curl with HTTP/3 (needs curl built with nghttp3)
curl --http3-only -k https://localhost/health

# Chrome: chrome://net-export → reproduce playback → check altsvc / quic in log
```

## TCP vs QUIC congestion control

- **HTTP/3 (QUIC)** uses its own congestion control (typically Cubic or BBR inside QUIC). Host **TCP BBR** (see [linux-tcp-bbr.md](./linux-tcp-bbr.md)) does not change QUIC behavior.
- TCP BBR still helps: Meilisearch, WebSocket peer-sync, HTTP/1.1 fallback, and any client not on H3.

## Windows testing (first)

1. `docker compose -f docker-compose.yml -f docker-compose.overlay.yml up -d`
2. Browse `https://localhost/health` — trust self-signed cert.
3. Set app Remote URL to `https://<LAN-IP>` (port 443).
4. Play a locker track; check response headers on `/api/stream/...` for `X-Sandbox-Tmpfs-Cache: 1` after queue staging.
5. QUIC on Windows Docker: UDP 443 must be published; some corporate firewalls block QUIC — fall back to HTTPS/TCP still works.

## Android (OnePlus 12)

1. Same Remote URL over cellular (Wi‑Fi off).
2. Trust cert if prompted (or use Tailscale/overlay hostname).
3. Enable aggressive offline cache — prefetch uses `fetch` and benefits most from H3 + tmpfs.
4. `POST /api/cache/stage-queue` runs automatically when playback queue advances.

## NVIDIA Shield

LAN playback: tmpfs cache helps most; QUIC optional on stable Ethernet. DLNA pulls from tier34 HTTP — typically HTTP/1.1, not H3.
