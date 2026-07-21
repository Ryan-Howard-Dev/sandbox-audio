# Sandbox Infrastructure

Foundational architecture shared by **Music**, **Builder**, **Reef**, **Vault**, **AI**, and future Sandbox stations.

All layers listed below are **STATUS: FOUNDATION SCAFFOLD** — placeholder types, traits, and registry wiring only. No production logic, cryptography, databases, or plugin execution.

Rust modules live under `src-tauri/src/infrastructure/`.

---

## 1. Local Identity Authority

**Module:** `infrastructure::identity_authority`  
**STATUS: FOUNDATION SCAFFOLD**

| Type | Role |
|------|------|
| `IdentityProfile` | Installation-scoped profile metadata |
| `DeviceIdentity` | Device handle with public key reference |
| `SignedPayload` | Opaque signed envelope for future trust protocols |
| `IdentityAuthority` | Placeholder service API |

**Planned implementation**

- **Signing:** [ed25519-dalek](https://docs.rs/ed25519-dalek) for Ed25519 key pairs and signatures.
- **Key vault:** Tauri Stronghold for secure at-rest key material.
- **Scope:** One identity per Sandbox installation.
- **Future:** Device-to-device trust via signed payload exchange.

**How to extend:** Implement `IdentityAuthority::profile`, `sign`, and `verify` backed by Stronghold; expose read-only identity commands to stations via Tauri when needed.

---

## 2. Universal Event Bus

**Module:** `infrastructure::event_bus`  
**STATUS: FOUNDATION SCAFFOLD**

| Type | Role |
|------|------|
| `EventChannel` | Named channels: `playback`, `locker`, `sync`, `downloads`, `builder`, `reef`, `ai` |
| `BusEvent` | Channel + name + JSON payload envelope |
| `EventBus` | In-process pub/sub placeholder |
| `EventBusPublisher` / `EventBusSubscriber` | Trait extension points |

**Transport split**

- **Frontend:** Tauri Events (`emit` / `listen`) for webview and UI layers.
- **Backend:** Tokio `broadcast` channels for async Rust subscribers (not wired yet).

**How to extend:** Add typed event structs per channel; bridge `EventBus::publish` to Tauri emit and Tokio broadcast senders in `InfrastructureRegistry`.

---

## 3. WASM Execution Sandbox

**Module:** `infrastructure::sandbox_runtime`  
**STATUS: FOUNDATION SCAFFOLD**

| Type | Role |
|------|------|
| `SandboxPlugin` | Plugin descriptor (id, name, version) |
| `SandboxPermission` | Capability flags (filesystem, network, database, AI) |
| `SandboxExecutionContext` | Plugin + granted permissions |
| `SandboxRuntime` | Coordinator placeholder |

**Extension point traits:** `SandboxFilesystemAccess`, `SandboxNetworkAccess`, `SandboxDatabaseAccess`, `SandboxAiServiceAccess`

**Planned runtime:** [Wasmtime](https://docs.wasmtime.dev/) — dependency not added yet.

**How to extend:** Add Wasmtime to `Cargo.toml`; implement host traits behind permission checks; register plugins via `SandboxRuntime::register_plugin`.

---

## 4. Unified Data Layer

**Module:** `infrastructure::sandbox_data_layer`  
**STATUS: FOUNDATION SCAFFOLD**

| Provider trait | Planned backend |
|----------------|-----------------|
| `MetadataStore` | SQLite |
| `BlobStore` | Filesystem object store |
| `VectorStore` | Qdrant or SurrealDB |

| Type | Role |
|------|------|
| `SandboxDataLayer` | Resolves `metadata()`, `blobs()`, `vectors()` for stations |
| `Placeholder*Store` | No-op in-memory stand-ins |

**How to extend:** Implement traits with real backends; inject into `SandboxDataLayer`; stations call `registry.data_layer.metadata()` instead of direct DB access. Does **not** migrate frontend `lockerStorage` (IndexedDB).

---

## Service Registry

**Module:** `infrastructure::registry`  
**Type:** `InfrastructureRegistry`

Holds shared references to all four layers:

```rust
InfrastructureRegistry {
    identity: IdentityAuthority,
    event_bus: EventBus,
    sandbox_runtime: SandboxRuntime,
    data_layer: SandboxDataLayer,
}
```

Wired in `src-tauri/src/lib.rs` as `mod infrastructure` with `pub use infrastructure::InfrastructureRegistry`.

**How to extend:** Manage `InfrastructureRegistry` in Tauri state when stations need backend access; pass `&InfrastructureRegistry` into new commands without modifying existing playback or locker behavior.

---

## Constraints (scaffold phase)

- Do not modify playback, Connect, queue, locker sync, or station TSX behavior.
- Rust modules + this document only until layers are implemented.
- No `ed25519-dalek`, Wasmtime, SQLite, or Qdrant dependencies until respective implementation phases.
