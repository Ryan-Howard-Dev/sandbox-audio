# Status

> **This file is deprecated as a session log.** Last detailed playback session notes were from 2026-07-08.

For current project state, use:

| Document | Purpose |
|----------|---------|
| [CHANGELOG.md](./CHANGELOG.md) | Shipped fixes and features by version (latest: **0.2.0-beta**, 2026-07-09) |
| [CODEBASE_HEALTH.md](./CODEBASE_HEALTH.md) | Line counts, test/tsc health, `sandboxLayer3.tsx` split plan |
| [docs/CHRONICLE.md](./docs/CHRONICLE.md) | Long-form design history and session index |

**Quick build (Android):**

```bash
npm run build:client && npx cap sync android && cd android && ./gradlew assembleDebug
```

**Quick test (playback-focused):**

```bash
npx vitest run src/playbackSession.test.ts src/podcastPlayback.test.ts src/play/ensureLockerPlayable.test.ts
```
