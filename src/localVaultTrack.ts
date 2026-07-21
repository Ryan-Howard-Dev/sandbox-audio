import type { MediaEnvelope } from './sandboxLayer1';

/** True when track resolves from locker blob / local vault (offline-capable). */
export function isLocalVaultEnvelope(env: MediaEnvelope): boolean {
  const provider = env.provider?.trim();
  if (provider === 'local-vault' || provider === 'indexeddb' || provider === 'blob') return true;
  return Boolean(env.url?.trim().startsWith('blob:'));
}
