/**
 * Tauri bridge for device identity (Ed25519 fingerprint).
 *
 * Sovereign mesh signing (`infrastructure::identity_authority`) is not product-ready;
 * only the desktop installation fingerprint is exposed here.
 */

import { isTauri } from './platformEnv';

export async function fetchDeviceIdentity(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('fetch_identity');
}
