//! Unified Data Layer — foundation scaffold.
//!
//! Common storage provider interfaces for all Sandbox stations. Stations request
//! providers through [`SandboxDataLayer`] rather than ad-hoc storage.
//!
//! ## Planned backends
//! - **Metadata**: SQLite (structured records, indexes, migrations).
//! - **Blobs**: Filesystem object store (audio, artwork, exports).
//! - **Vectors**: Qdrant or SurrealDB for embeddings and semantic search.
//!
//! Does not install databases or migrate existing frontend `lockerStorage` (IndexedDB).

use serde::{Deserialize, Serialize};

/// Structured metadata provider (SQLite planned).
pub trait MetadataStore {
    fn get(&self, _key: &str) -> Option<serde_json::Value> {
        None
    }

    fn put(&self, _key: &str, _value: serde_json::Value) -> bool {
        false
    }

    fn delete(&self, _key: &str) -> bool {
        false
    }
}

/// Binary blob provider (filesystem planned).
pub trait BlobStore {
    fn read(&self, _id: &str) -> Option<Vec<u8>> {
        None
    }

    fn write(&self, _id: &str, _data: &[u8]) -> bool {
        false
    }

    fn delete(&self, _id: &str) -> bool {
        false
    }
}

/// Vector embedding provider (Qdrant / SurrealDB planned).
pub trait VectorStore {
    fn upsert(&self, _id: &str, _vector: &[f32], _metadata: serde_json::Value) -> bool {
        false
    }

    fn search(&self, _vector: &[f32], _limit: usize) -> Vec<VectorMatch> {
        Vec::new()
    }
}

/// Vector search result placeholder.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct VectorMatch {
    pub id: String,
    pub score: f32,
}

/// Placeholder in-memory metadata store.
#[derive(Debug, Clone, Default)]
pub struct PlaceholderMetadataStore;

impl MetadataStore for PlaceholderMetadataStore {}

/// Placeholder in-memory blob store.
#[derive(Debug, Clone, Default)]
pub struct PlaceholderBlobStore;

impl BlobStore for PlaceholderBlobStore {}

/// Placeholder in-memory vector store.
#[derive(Debug, Clone, Default)]
pub struct PlaceholderVectorStore;

impl VectorStore for PlaceholderVectorStore {}

/// Unified data layer — resolves storage providers for stations.
#[derive(Debug, Clone, Default)]
pub struct SandboxDataLayer {
    metadata: PlaceholderMetadataStore,
    blobs: PlaceholderBlobStore,
    vectors: PlaceholderVectorStore,
}

impl SandboxDataLayer {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn metadata(&self) -> &dyn MetadataStore {
        &self.metadata
    }

    pub fn blobs(&self) -> &dyn BlobStore {
        &self.blobs
    }

    pub fn vectors(&self) -> &dyn VectorStore {
        &self.vectors
    }
}
