//! Universal Event Bus — foundation scaffold.
//!
//! Cross-station pub/sub for Music, Builder, Reef, Vault, AI, and future modules.
//!
//! ## Transport split
//! - **Frontend**: Tauri Events (`AppHandle::emit` / JS `listen`) for UI and webview layers.
//! - **Backend**: Tokio `broadcast` channels for async Rust subscribers (not wired yet).
//!
//! No routing, filtering, or persistence logic in this scaffold.

use serde::{Deserialize, Serialize};

/// Named event channels shared across Sandbox stations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum EventChannel {
    #[default]
    Playback,
    Locker,
    Sync,
    Downloads,
    Builder,
    Reef,
    Ai,
}

impl EventChannel {
    pub const ALL: [Self; 7] = [
        Self::Playback,
        Self::Locker,
        Self::Sync,
        Self::Downloads,
        Self::Builder,
        Self::Reef,
        Self::Ai,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Playback => "playback",
            Self::Locker => "locker",
            Self::Sync => "sync",
            Self::Downloads => "downloads",
            Self::Builder => "builder",
            Self::Reef => "reef",
            Self::Ai => "ai",
        }
    }
}

/// Opaque event envelope for future typed payloads.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BusEvent {
    pub channel: EventChannel,
    pub name: String,
    pub payload: serde_json::Value,
}

/// Lightweight pub/sub surface — placeholder methods only.
pub trait EventBusPublisher {
    fn publish(&self, _event: BusEvent) {}
}

pub trait EventBusSubscriber {
    fn subscribe(&self, _channel: EventChannel) {}
    fn unsubscribe(&self, _channel: EventChannel) {}
}

/// In-process event bus placeholder.
#[derive(Debug, Clone, Default)]
pub struct EventBus;

impl EventBus {
    pub fn new() -> Self {
        Self
    }

    pub fn publish(&self, _event: BusEvent) {}

    pub fn subscribe(&self, _channel: EventChannel) {}

    pub fn unsubscribe(&self, _channel: EventChannel) {}
}

impl EventBusPublisher for EventBus {
    fn publish(&self, event: BusEvent) {
        EventBus::publish(self, event);
    }
}

impl EventBusSubscriber for EventBus {
    fn subscribe(&self, channel: EventChannel) {
        EventBus::subscribe(self, channel);
    }

    fn unsubscribe(&self, channel: EventChannel) {
        EventBus::unsubscribe(self, channel);
    }
}
