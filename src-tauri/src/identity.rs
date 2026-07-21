use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::sync::OnceLock;
use tauri::{AppHandle, Manager};

const KEY_FILE: &str = "device_identity.key";

static PUBLIC_KEY: OnceLock<Vec<u8>> = OnceLock::new();

fn key_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(KEY_FILE)
}

fn load_or_generate_secret(app: &AppHandle) -> Result<[u8; 32], String> {
    let path = key_path(app);
    if path.exists() {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.len() == 32 {
            let mut secret = [0u8; 32];
            secret.copy_from_slice(&bytes);
            return Ok(secret);
        }
    }

    let signing_key = SigningKey::generate(&mut OsRng);
    let secret = signing_key.to_bytes();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    // TODO: Migrate private key to Tauri Stronghold enclave
    std::fs::write(&path, secret).map_err(|e| e.to_string())?;

    Ok(secret)
}

/// Ensure a device Ed25519 keypair exists in the app local data directory.
pub fn init_device_identity(app: &AppHandle) -> Result<(), String> {
    if PUBLIC_KEY.get().is_some() {
        return Ok(());
    }
    let secret = load_or_generate_secret(app)?;
    let signing_key = SigningKey::from_bytes(&secret);
    let public_key = signing_key.verifying_key().to_bytes().to_vec();
    let _ = PUBLIC_KEY.set(public_key);
    Ok(())
}

/// SHA-256 hash of the public key, first 12 hex characters.
pub fn get_device_fingerprint() -> Result<String, String> {
    let public_key = PUBLIC_KEY
        .get()
        .ok_or_else(|| "Device identity not initialized".to_string())?;
    let digest = Sha256::digest(public_key);
    let full_hex = hex::encode(digest);
    Ok(full_hex[..12].to_string())
}
