//! Internal service registry — holds placeholders for all Sandbox infrastructure layers.
//!
//! Stations (Music, Builder, Reef, Vault, AI, future modules) obtain shared services
//! through this registry rather than constructing layers independently.

use super::{
    event_bus::EventBus, identity_authority::IdentityAuthority, sandbox_data_layer::SandboxDataLayer,
    sandbox_runtime::SandboxRuntime,
};

/// Central registry for Sandbox infrastructure layers.
#[derive(Debug, Clone, Default)]
pub struct InfrastructureRegistry {
    pub identity: IdentityAuthority,
    pub event_bus: EventBus,
    pub sandbox_runtime: SandboxRuntime,
    pub data_layer: SandboxDataLayer,
}

impl InfrastructureRegistry {
    pub fn new() -> Self {
        Self {
            identity: IdentityAuthority::new(),
            event_bus: EventBus::new(),
            sandbox_runtime: SandboxRuntime::new(),
            data_layer: SandboxDataLayer::new(),
        }
    }
}
