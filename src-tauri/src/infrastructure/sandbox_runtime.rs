//! WASM Execution Sandbox — foundation scaffold.
//!
//! Isolated plugin execution for Builder, Reef, and future station extensions.
//!
//! ## Planned runtime
//! [Wasmtime](https://docs.wasmtime.dev/) will host guest modules with capability-based
//! permissions. No Wasmtime dependency or execution logic exists in this scaffold.
//!
//! Extension points (filesystem, network, database, AI service) are declared as enums
//! and traits only — no host calls are implemented.

use serde::{Deserialize, Serialize};

/// Registered sandbox plugin descriptor (metadata only).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SandboxPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
}

/// Capability granted to a plugin for host resource access.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SandboxPermission {
    FilesystemRead,
    FilesystemWrite,
    NetworkOutbound,
    DatabaseRead,
    DatabaseWrite,
    AiServiceInvoke,
}

/// Execution context passed when invoking a plugin (placeholder).
#[derive(Debug, Clone, Default)]
pub struct SandboxExecutionContext {
    pub plugin: SandboxPlugin,
    pub permissions: Vec<SandboxPermission>,
}

/// Host extension point: filesystem access boundary.
pub trait SandboxFilesystemAccess {
    fn read_path(&self, _path: &str) -> Option<Vec<u8>> {
        None
    }

    fn write_path(&self, _path: &str, _data: &[u8]) -> bool {
        false
    }
}

/// Host extension point: network access boundary.
pub trait SandboxNetworkAccess {
    fn request(&self, _url: &str) -> Option<Vec<u8>> {
        None
    }
}

/// Host extension point: database access boundary.
pub trait SandboxDatabaseAccess {
    fn query(&self, _statement: &str) -> Option<serde_json::Value> {
        None
    }
}

/// Host extension point: AI service access boundary.
pub trait SandboxAiServiceAccess {
    fn invoke(&self, _model: &str, _input: &str) -> Option<String> {
        None
    }
}

/// Sandbox runtime coordinator — no execution yet.
#[derive(Debug, Clone, Default)]
pub struct SandboxRuntime;

impl SandboxRuntime {
    pub fn new() -> Self {
        Self
    }

    pub fn register_plugin(&self, _plugin: SandboxPlugin) {}

    pub fn execute(
        &self,
        _context: SandboxExecutionContext,
        _entry: &str,
        _input: &[u8],
    ) -> Option<Vec<u8>> {
        None
    }
}
