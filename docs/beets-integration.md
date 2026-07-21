# Beets → Sandbox Locker (folder watch)

Use [beets](https://beets.io/) to tag and organize files on disk; Sandbox Music picks them up automatically via the Tier 3/4 **folder watch** importer.

## Flow

```
beets import  →  copy/move into watch folder  →  tier34 watcher  →  locker blobs
```

1. **beets** runs `import` and writes tagged audio into a directory you choose.
2. That directory must match **`TIER34_WATCH_PATH`** on the tier34 host (see `.env.example`).
3. The tier34 **ingestion watcher** (`tier34-server/lib/ingestionWatcher.ts`) queues `ingest-file` jobs for new/changed audio.
4. Tracks appear in the Sandbox **Locker** after ingest completes (same path as manual import).

No beets plugin is required — this is filesystem handoff only.

## Prerequisites

- Tier 3/4 server running: `npm run dev:tier34` (or your deployed host).
- Folder watch enabled with a path the tier34 process can read.

## 1. Set the watch path

On the machine running tier34, set in `.env` (repo root or tier34 env):

```bash
TIER34_WATCH_PATH=/home/you/Music/SandboxIncoming
```

Restart tier34 after changing env. On boot, tier34 auto-starts the watcher when `TIER34_WATCH_PATH` is set (see `bootIngestionWatcher()`).

You can also persist watch config under tier34 storage (`watch-config.json`) via the tier34 API / Settings when exposed.

## 2. Point beets at the same directory

In `~/.config/beets/config.yaml` (paths vary by OS):

```yaml
directory: /home/you/Music/BeetsLibrary   # beets' canonical library (optional)
import:
  copy: yes                               # or move: yes to avoid duplicates
  write: yes
  # Send imported files into the Sandbox watch folder:
  destination: /home/you/Music/SandboxIncoming
```

Alternatively, import with an explicit path:

```bash
beet import -C /home/you/Music/SandboxIncoming /path/to/new/albums
```

Use **`copy`** or **`move`** so files physically land in `TIER34_WATCH_PATH`. In-place tagging without copy/move will not trigger watch events on a different path.

## 3. Verify sync

Helper script (checks env and prints next steps):

```bash
npm run beets:watch-sync
# or: bash scripts/beets-watch-sync.sh
```

After import:

1. Confirm tier34 logs show watcher events (`[tier34] ingestion watcher` / ingest jobs).
2. Open Sandbox Music → **Locker** — new albums should appear after processing.
3. Optional: enable Meilisearch on tier34 for full-text locker search once indexed.

## Supported formats

Same as tier34 folder watch: `.mp3`, `.flac`, `.ogg`, `.wav`, `.m4a`, `.opus`, `.aac`, `.webm`.

## Troubleshooting

| Issue | Check |
| --- | --- |
| Files not appearing | `TIER34_WATCH_PATH` matches beets destination; tier34 running; file extensions supported |
| Duplicate tracks | beets `move` vs `copy`; locker dedup by content hash on ingest |
| Permission errors | tier34 user can read watch directory |
| Watch not started | `echo $TIER34_WATCH_PATH`; restart tier34; inspect `watch-config.json` under tier34 storage |

## Related docs

- [TIER34.md](../TIER34.md) — backend setup
- [docs/sandbox-architecture.md](./sandbox-architecture.md) — `TIER34_WATCH_PATH` env reference
- [LOCKER_SYNC.md](../LOCKER_SYNC.md) — cross-device locker sync after import
