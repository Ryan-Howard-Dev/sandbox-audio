# Tier34 validation suite

Operator-facing end-to-end checks for locker sync, acquire worker, media graph, Connect peer-sync, and cast stream resolution.

## Run from the UI

1. Start tier34: `npm run dev:tier34` (or `npm run dev:all`).
2. Open **Settings → Diagnostics**.
3. Confirm the tier34 URL matches your backend (default `http://localhost:3001`).
4. Click **Run validation**.

Results show per-scenario pass / fail / skip, overall health, and a timestamp. Skips are expected on a single machine when LAN cast URLs or yt-dlp are unavailable.

## Scenarios

| ID | What it tests | Single-device behavior |
| --- | --- | --- |
| `acquire` | `/health`, `/api/acquire`, `/api/acquire/status/:id` | Enqueue only when yt-dlp offline |
| `blob-replication` | PUT + GET `/api/locker/blob/:hash` | Server simulates Device B |
| `metadata-replication` | Manifest POST/GET merge + media graph stats | Server simulates Device B |
| `playlist-replication` | Playlist rows on manifest | Phase 3 playlist sync |
| `queue-replication` | Dual WebSocket clients, `sync_state` relay | Simulated host + remote |
| `connect-commands` | Remote `PAUSE` → host via peer-sync | Simulated host + remote |
| `cast-stream` | GET `/api/cast/stream/:id` on LAN base URL | Skip if URL not LAN-accessible |
| `deletion-propagation` | Playlist tombstone merge | Tombstone on server manifest |
| `corrupt-blob-repair` | `blob-integrity` / `heal-blob` features + probe GET | Non-destructive; no corrupt write |

## Programmatic

```ts
import { runTier34ValidationSuite } from './tier34ValidationSuite';

const report = await runTier34ValidationSuite('http://localhost:3001');
```

## CI note

Designed for one client + tier34. No second physical device required; multi-device replication is validated via server roundtrips and in-browser dual WebSocket clients.
