//! Local Identity Authority — foundation scaffold.
//!
//! One cryptographic identity per Sandbox installation. Future device-to-device trust
//! will build on signed payloads exchanged between peers.
//!
//! ## Planned implementation
//! - **Signing**: [`ed25519-dalek`](https://docs.rs/ed25519-dalek) for Ed25519 key pairs and signatures.
//! - **Key vault**: Tauri Stronghold for secure at-rest key material.
//! - **Scope**: One identity per Sandbox installation; no cloud identity provider.
//!
//! No cryptography is implemented in this scaffold.
//!
//! **Product scope:** Sovereign mesh identity (sign/verify, peer trust) is deferred until
//! it becomes an explicit product goal. Desktop Tauri builds expose a separate installation
//! fingerprint via `identity.rs`; this module is infrastructure-only — do not surface in UI
//! until `profile()`, `sign()`, and `verify()` are implemented.

use serde::{Deserialize, Serialize};

/// Profile metadata bound to the local installation identity.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IdentityProfile {
    pub display_name: String,
    pub installation_id: String,
}

/// Device-scoped identity handle (public key reference only in scaffold).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DeviceIdentity {
    pub device_id: String,
    pub public_key_ref: String,
}

/// Opaque signed payload envelope for future trust and sync protocols.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SignedPayload {
    pub payload: Vec<u8>,
    pub signature_ref: String,
}

/// Local identity authority — placeholder API surface.
#[derive(Debug, Clone, Default)]
pub struct IdentityAuthority;

impl IdentityAuthority {
    pub fn new() -> Self {
        Self
    }

    /// Load or create the installation identity profile (not implemented).
    pub fn profile(&self) -> Option<IdentityProfile> {
        None
    }

    /// Return the device identity handle (not implemented).
    pub fn device_identity(&self) -> Option<DeviceIdentity> {
        None
    }

    /// Sign arbitrary bytes (not implemented).
    pub fn sign(&self, _payload: &[u8]) -> Option<SignedPayload> {
        None
    }

    /// Verify a signed payload (not implemented).
    pub fn verify(&self, _signed: &SignedPayload) -> bool {
        false
    }
}
