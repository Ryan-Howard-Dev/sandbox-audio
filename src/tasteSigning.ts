/**
 * Ed25519 taste-manifest signing — local keypair, verify on import (cross-device).
 * Falls back to device fingerprint label when Tauri identity is available.
 */

import { fetchDeviceIdentity } from './identityBridge';
import { prefsGetItem, prefsSetItem } from './prefsStorage';

const TASTE_SIGNING_JWK_KEY = 'sandbox_taste_signing_jwk_v1';
const TASTE_USER_KEY_KEY = 'sandbox_taste_user_signing_key_v1';

export type TasteSigningMeta = {
  publicKeySpki: string;
  keyId: string;
  deviceFingerprint: string | null;
};

type StoredSigningJwk = {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
  createdAt: number;
};

let cachedKeyPair: CryptoKeyPair | null = null;
let cachedMeta: TasteSigningMeta | null = null;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

async function sha256Hex(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function readStoredJwk(): StoredSigningJwk | null {
  const raw = prefsGetItem(TASTE_SIGNING_JWK_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredSigningJwk;
    if (!parsed?.publicKey || !parsed?.privateKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredJwk(jwk: StoredSigningJwk): void {
  prefsSetItem(TASTE_SIGNING_JWK_KEY, JSON.stringify(jwk));
}

async function importKeyPair(stored: StoredSigningJwk): Promise<CryptoKeyPair> {
  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.importKey('jwk', stored.publicKey, { name: 'Ed25519' }, true, ['verify']),
    crypto.subtle.importKey('jwk', stored.privateKey, { name: 'Ed25519' }, true, ['sign']),
  ]);
  return { publicKey, privateKey };
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', pair.privateKey);
  writeStoredJwk({
    publicKey,
    privateKey,
    createdAt: Date.now(),
  });
  return pair;
}

export function getTasteUserSigningKey(): string | null {
  const raw = prefsGetItem(TASTE_USER_KEY_KEY);
  return raw?.trim() || null;
}

export function setTasteUserSigningKey(value: string | null): void {
  const trimmed = value?.trim();
  if (trimmed) {
    prefsSetItem(TASTE_USER_KEY_KEY, trimmed);
  } else {
    prefsSetItem(TASTE_USER_KEY_KEY, '');
  }
  cachedKeyPair = null;
  cachedMeta = null;
}

async function userKeyMaterial(): Promise<Uint8Array | null> {
  const userKey = getTasteUserSigningKey();
  if (!userKey) return null;
  const encoded = new TextEncoder().encode(userKey);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return new Uint8Array(hash);
}

export async function getTasteSigningKeyPair(): Promise<CryptoKeyPair> {
  if (cachedKeyPair) return cachedKeyPair;
  const stored = readStoredJwk();
  cachedKeyPair = stored ? await importKeyPair(stored) : await generateKeyPair();
  return cachedKeyPair;
}

export async function getTasteSigningMeta(): Promise<TasteSigningMeta> {
  if (cachedMeta) return cachedMeta;
  const pair = await getTasteSigningKeyPair();
  const spki = await crypto.subtle.exportKey('spki', pair.publicKey);
  const spkiB64 = bytesToBase64(new Uint8Array(spki));
  const keyId = (await sha256Hex(new Uint8Array(spki))).slice(0, 16);
  let deviceFingerprint: string | null = null;
  try {
    deviceFingerprint = await fetchDeviceIdentity();
  } catch {
    deviceFingerprint = null;
  }
  cachedMeta = { publicKeySpki: spkiB64, keyId, deviceFingerprint };
  return cachedMeta;
}

export async function signTastePayload(canonicalUtf8: string): Promise<{
  signature: string;
  publicKeySpki: string;
  keyId: string;
  deviceFingerprint: string | null;
}> {
  const pair = await getTasteSigningKeyPair();
  const meta = await getTasteSigningMeta();
  const data = new TextEncoder().encode(canonicalUtf8);
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, data);
  let signature = bytesToBase64(new Uint8Array(sig));

  const userMaterial = await userKeyMaterial();
  if (userMaterial) {
    const combined = new Uint8Array(data.length + userMaterial.length);
    combined.set(data, 0);
    combined.set(userMaterial, data.length);
    const userSig = await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, combined);
    signature = `${signature}.${bytesToBase64(new Uint8Array(userSig))}`;
  }

  return {
    signature,
    publicKeySpki: meta.publicKeySpki,
    keyId: meta.keyId,
    deviceFingerprint: meta.deviceFingerprint,
  };
}

export async function verifyTasteSignature(
  canonicalUtf8: string,
  signature: string,
  publicKeySpki: string,
): Promise<boolean> {
  try {
    const keyBytes = base64ToBytes(publicKeySpki);
    const publicKey = await crypto.subtle.importKey(
      'spki',
      keyBytes,
      { name: 'Ed25519' },
      true,
      ['verify'],
    );
    const data = new TextEncoder().encode(canonicalUtf8);
    const parts = signature.split('.');
    const primary = base64ToBytes(parts[0] ?? signature);
    const primaryOk = await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, primary, data);
    if (primaryOk) return true;

    const userMaterial = await userKeyMaterial();
    if (userMaterial && parts[1]) {
      const combined = new Uint8Array(data.length + userMaterial.length);
      combined.set(data, 0);
      combined.set(userMaterial, data.length);
      return crypto.subtle.verify(
        { name: 'Ed25519' },
        publicKey,
        base64ToBytes(parts[1]!),
        combined,
      );
    }
    return false;
  } catch {
    return false;
  }
}
