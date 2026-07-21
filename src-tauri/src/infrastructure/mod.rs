//! Sandbox infrastructure layers shared by Music, Builder, Reef, Vault, AI, and future stations.
//!
//! STATUS: FOUNDATION SCAFFOLD — no production logic, crypto, databases, or plugin execution.
//!
//! See `docs/INFRASTRUCTURE.md` for architecture overview and extension guidance.

pub mod event_bus;
pub mod identity_authority;
pub mod registry;
pub mod sandbox_data_layer;
pub mod sandbox_runtime;

pub use event_bus::{BusEvent, EventBus, EventBusPublisher, EventBusSubscriber, EventChannel};
pub use identity_authority::{
    DeviceIdentity, IdentityAuthority, IdentityProfile, SignedPayload,
};
pub use registry::InfrastructureRegistry;
pub use sandbox_data_layer::{
    BlobStore, MetadataStore, PlaceholderBlobStore, PlaceholderMetadataStore,
    PlaceholderVectorStore, SandboxDataLayer, VectorMatch, VectorStore,
};
pub use sandbox_runtime::{
    SandboxAiServiceAccess, SandboxDatabaseAccess, SandboxExecutionContext,
    SandboxFilesystemAccess, SandboxNetworkAccess, SandboxPermission, SandboxPlugin,
    SandboxRuntime,
};
