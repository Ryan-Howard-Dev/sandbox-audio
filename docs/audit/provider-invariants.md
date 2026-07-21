# Pass 2 — Provider System & Model Routing Invariants

Subsystem scope: tier-ordered media source selection (search + playback resolve), addon/manifest providers, fidelity policy, mobile resolvers, tier34 server resolve adapters. **Code-only audit — 2026-07-21.**

**Out of scope:** playback FSM (`sandboxLayer1`), queue advance (`src/play/*`), locker Meilisearch indexing (`tier34-server/lib/meilisearchIndexer.ts`), album-cover art providers (`albumCoverProviders.ts`).

---

| Invariant | Why it matters | Evidence | Violation risk |
|-----------|----------------|----------|----------------|
| Catalog-track playback must not accept tier hits whose resolved artist/title/duration diverge beyond dice/duration thresholds | Prevents playing a different recording than the iTunes/catalog row the user tapped | `resolvedStreamMatchesCatalog` rejects artist sim <0.55, title sim below dynamic min, duration ratio outside 0.72–1.28 when catalog duration >45s; `catalogTierMatchesPlayback` gates `executeTrack` and `resolveSandboxServerStream` | **High** — `resolutionSource === 'mobile'` bypasses catalog match checks; short-title threshold (≤6 chars) uses 0.92 title sim |
| LOSSLESS fidelity policy must try debrid tier before racing proxy/addons | Users expecting lossless should not get lossy proxy wins when debrid is available | `resolveTiersForQuery`: when `loadFidelityPolicy() === 'LOSSLESS'`, `tryTierStep(debridStep)` runs first; only on miss does `raceTierHits([proxyStep, ...addonSteps])` | **Medium** — debrid timeout (10s) then parallel race may still pick proxy if debrid slow-errors |
| Preview URLs (`audio-ssl`) must never become full-stream candidates in tier resolve | iTunes 30s previews are not album playback; treating them as full streams misleads UI and cache | `rowToCandidate` in `searchProviders.ts` returns null when `isCatalogPreviewUrl(url)`; `pickBestPlayCandidate` filters `isCatalogPreviewUrl`; server `addonResolve.isPreviewUrl` filters | **Low** — catalog search envelopes still carry preview URLs in metadata until play-time resolve |
| Full-stream playback requires reachable Sandbox Server when envelope needs proxy/debrid transport | Offline clients must not attach unplayable `/api/proxy/stream` relative URLs | `withProxiedUrl` clears URL when `needsProxyStream` and `!serverOnline`; `executeTrack` skips cache when `cachedNeedsServer && !isTier34ReachableCached()`; `canResolveFullStreams()` requires base URL + cached health | **High** — stale `isTier34ReachableCached()` can allow proxy URL attachment briefly after server loss |
| Air-gap mode must block all remote tier34 resolve/search addon calls | LAN-party / offline policy must not leak queries to network providers | `isAirGapEnabled()` early-returns `[]` in `searchProxy`, `searchDebrid`, `searchSandboxIndexer`, `searchUserManifestAddons`, `postAddonResolve`, `fetchWebSearchEnvelopes` | **Medium** — direct client calls to archive.org/iTunes in `sandboxLayer2.searchArchive` / `searchCatalogProvider` are not air-gap gated |
| Experimental builtin addons must not run unless Settings experimental toggle is ON | Dev-test pack (SoundCloud, WebTorrent, IPFS, etc.) should not surprise production users | `searchBuiltinPackAddons` checks `loadShowExperimentalIntegrations()`; `buildTierSteps` only adds `addons-builtin` when toggle on; `isExperimentalAddonActive` per-addon gate | **Low** — user manifest addons are always active when enabled (by design) |
| User manifest addon search endpoints must be public HTTPS only | Prevents browser-initiated SSRF to localhost/private IPs from malicious manifests | `isAllowedAddonSearchEndpoint` requires `https:` and blocks localhost/private IPv4/`.local`/`.internal` | **Medium** — validation is client-side only; no server-side manifest proxy |
| Mobile resolver registry must prefer fresh on-device resolve when tier34 unreachable on native | Android offline playback depends on yt-dlp-mobile, not stale CDN cache | `preferFreshMobileResolve()` true when native + active resolvers + (no base URL OR `!isServerReachableCached()`); `resolvePlaybackSource` runs mobile before cache/server in that mode | **Medium** — `tryMobileResolve` still uses file:// mobile cache hits when preferring fresh |
| Parallel tier query resolution must return first catalog-matching hit within deadline | Multi-query album-qualified searches need bounded latency | `firstResolvedTierQuery` races up to N queries with `PARALLEL_QUERY_DEADLINE_MS` (18s); first resolved envelope passing `catalogTierMatchesPlayback` wins | **Medium** — all queries may timeout → null; no partial merge |
| `raceTierHits` first successful tier step wins; slower in-flight steps are not cancelled | Avoids double-resolve but wastes work; first hit may not be globally best quality | `raceTierHits` resolves on first `tryTierStep` hit; losing promises still run to completion | **Medium** — lower-quality proxy can beat debrid if proxy responds first under STANDARD policy |
| Playback downgrade from full stream to catalog preview for same `envelopeId` must be blocked | User who already has full stream must not be replaced by 30s preview on re-resolve | `isPlaybackDowngrade` in `playbackPipeline.ts`; used by playback shell (per Pass 1 deps) | **High** if callers bypass — not enforced inside `resolvePlaybackSource` alone |
| Prowlarr/Real-Debrid credentials travel client → tier34 in JSON POST bodies | Server-side debrid resolve needs keys; exposure surface is the tier34 host and browser memory | `searchDebrid` posts `prowlarrUrl`, `prowlarrApiKey`, `realDebridApiKey` from `loadPlaybackEngineSettings()` to `/api/debrid/resolve`; `tier34IndexerSearch` passes Prowlarr query params | **High** — tier34 must be trusted; cleartext HTTP to tier34 would expose secrets |
| Tier resolution observability is in-memory only (max 80 entries) | Signal Bench debug log must not persist sensitive URLs across sessions | `tierResolutionLog.ts`: `MAX_ENTRIES = 80`, module-level array, no persistence | **Low** — URLs may appear in `detail` strings during session |
| No LLM model-routing layer exists for playback or search provider selection | Audit scope "Model Routing" must not assume Gemini/OpenAI routers in resolve path | Grep: `@google/genai` only in `server.ts` and playlist curation; `MediaProvider` includes `'gemini-curate'` but playback pipeline has no LLM branch | **N/A** — negative evidence; playlist curation is separate feature |

---

## Evidence index (representative)

```yaml
evidence:
  files:
    - src/playbackPipeline.ts
    - src/hybridResolution.ts
    - src/addons/searchProviders.ts
    - src/sandboxLayer2.ts
    - src/mobileResolverRegistry.ts
    - src/fidelityPolicy.ts
    - src/catalogDirect.ts
    - src/addons/addonUrlValidation.ts
    - tier34-server/lib/proxyResolve.ts
    - tier34-server/lib/debridResolve.ts
    - tier34-server/lib/addonResolve.ts
    - server.ts
  symbols:
    - executeTrack
    - resolvePlaybackSource
    - buildTierSteps
    - raceTierHits
    - resolvedStreamMatchesCatalog
    - searchDebrid
    - resolveProxyCandidates
  confidence: High
  evidence_type:
    - implementation
```
