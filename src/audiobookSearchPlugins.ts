/**
 * User-configured audiobook search engine plugins (localStorage).
 */

import {
  applySearchUrlTemplate,
  validateAudiobookSearchPlugin,
  type AudiobookSearchPlugin,
} from '../tier34-server/lib/audiobookAcquireCore';

export type { AudiobookSearchPlugin };

const STORAGE_KEY = 'sandbox_audiobook_search_plugins';
const CHANGE_EVENT = 'sandbox-audiobook-search-plugins-change';

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function subscribeAudiobookSearchPlugins(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener();
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function loadAudiobookSearchPlugins(): AudiobookSearchPlugin[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AudiobookSearchPlugin[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((p) => validateAudiobookSearchPlugin(p))
      .filter((r): r is { ok: true; plugin: AudiobookSearchPlugin } => r.ok)
      .map((r) => r.plugin);
  } catch {
    return [];
  }
}

function saveRaw(plugins: AudiobookSearchPlugin[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(plugins));
  notify();
}

export function saveAudiobookSearchPlugins(plugins: AudiobookSearchPlugin[]): void {
  const validated = plugins
    .map((p) => validateAudiobookSearchPlugin(p))
    .filter((r): r is { ok: true; plugin: AudiobookSearchPlugin } => r.ok)
    .map((r) => r.plugin);
  saveRaw(validated);
}

export function getEnabledAudiobookSearchPlugins(): AudiobookSearchPlugin[] {
  return loadAudiobookSearchPlugins().filter((p) => p.enabled);
}

export function upsertAudiobookSearchPlugin(
  plugin: AudiobookSearchPlugin,
): { ok: true } | { ok: false; error: string } {
  const validated = validateAudiobookSearchPlugin(plugin);
  if (!validated.ok) return validated;
  const list = loadAudiobookSearchPlugins().filter((p) => p.id !== validated.plugin.id);
  saveRaw([...list, validated.plugin]);
  return { ok: true };
}

export function removeAudiobookSearchPlugin(id: string): void {
  saveRaw(loadAudiobookSearchPlugins().filter((p) => p.id !== id));
}

export function newAudiobookSearchPluginId(): string {
  return `ab-plugin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export { applySearchUrlTemplate, validateAudiobookSearchPlugin };
