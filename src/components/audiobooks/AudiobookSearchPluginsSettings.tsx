import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import SandboxSwitch from '../SandboxSwitch';
import { SETTINGS_SEARCH_ANCHORS } from '../settings/settingsSearchAnchors';
import {
  loadAudiobookSearchPlugins,
  newAudiobookSearchPluginId,
  removeAudiobookSearchPlugin,
  subscribeAudiobookSearchPlugins,
  upsertAudiobookSearchPlugin,
  validateAudiobookSearchPlugin,
  type AudiobookSearchPlugin,
} from '../../audiobookSearchPlugins';
import { useTranslation } from '../../i18n';

const EMPTY_DRAFT: AudiobookSearchPlugin = {
  id: '',
  name: '',
  enabled: true,
  searchUrlTemplate: '',
  parserHint: 'html-links',
};

export default function AudiobookSearchPluginsSettings() {
  const { t } = useTranslation();
  const [plugins, setPlugins] = useState<AudiobookSearchPlugin[]>(() => loadAudiobookSearchPlugins());
  const [draft, setDraft] = useState<AudiobookSearchPlugin>({ ...EMPTY_DRAFT, id: newAudiobookSearchPluginId() });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => subscribeAudiobookSearchPlugins(() => setPlugins(loadAudiobookSearchPlugins())), []);

  const resetDraft = useCallback(() => {
    setDraft({ ...EMPTY_DRAFT, id: newAudiobookSearchPluginId() });
    setEditingId(null);
    setError(null);
  }, []);

  const saveDraft = useCallback(() => {
    setSaving(true);
    setError(null);
    const validated = validateAudiobookSearchPlugin(draft);
    if (validated.ok === false) {
      setError(validated.error);
      setSaving(false);
      return;
    }
    const result = upsertAudiobookSearchPlugin(validated.plugin);
    if (result.ok === false) {
      setError(result.error);
      setSaving(false);
      return;
    }
    setPlugins(loadAudiobookSearchPlugins());
    resetDraft();
    setSaving(false);
  }, [draft, resetDraft]);

  const toggleEnabled = useCallback((plugin: AudiobookSearchPlugin, enabled: boolean) => {
    upsertAudiobookSearchPlugin({ ...plugin, enabled });
    setPlugins(loadAudiobookSearchPlugins());
  }, []);

  const startEdit = useCallback((plugin: AudiobookSearchPlugin) => {
    setDraft({ ...plugin });
    setEditingId(plugin.id);
    setError(null);
  }, []);

  const remove = useCallback((id: string) => {
    removeAudiobookSearchPlugin(id);
    setPlugins(loadAudiobookSearchPlugins());
    if (editingId === id) resetDraft();
  }, [editingId, resetDraft]);

  return (
    <div
      className="p-4 border rounded-xl space-y-4"
      style={{ borderColor: 'rgba(232,80,10,0.25)' }}
      data-settings-anchor={SETTINGS_SEARCH_ANCHORS.audiobookAcquirePlugins}
    >
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-accent">
          {t('audiobooks.acquirePluginsTitle')}
        </p>
        <p className="ui-hint ui-hint--desc mt-1">{t('audiobooks.acquirePluginsHint')}</p>
      </div>

      {plugins.length === 0 ? (
        <p className="font-mono text-xs text-[var(--text-dim)]">{t('audiobooks.acquirePluginsEmpty')}</p>
      ) : (
        <ul className="space-y-2">
          {plugins.map((plugin) => (
            <li
              key={plugin.id}
              className="flex items-center justify-between gap-3 p-3 rounded-lg border border-[var(--border)]"
            >
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm text-[var(--text)] truncate">{plugin.name}</p>
                <p className="font-mono text-[9px] text-[var(--text-dim)] truncate">
                  {plugin.searchUrlTemplate}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <SandboxSwitch
                  checked={plugin.enabled}
                  onChange={(checked) => toggleEnabled(plugin, checked)}
                  aria-label={t('audiobooks.acquirePluginToggle', { name: plugin.name })}
                />
                <button
                  type="button"
                  className="font-mono text-[10px] uppercase tracking-wider text-accent touch-manipulation px-2 py-1"
                  onClick={() => startEdit(plugin)}
                >
                  {t('audiobooks.acquirePluginEdit')}
                </button>
                <button
                  type="button"
                  className="touch-manipulation p-1 text-red-400"
                  onClick={() => remove(plugin.id)}
                  aria-label={t('audiobooks.acquirePluginRemove', { name: plugin.name })}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-3 pt-2 border-t border-[var(--border)]">
        <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-dim)]">
          {editingId ? t('audiobooks.acquirePluginEdit') : t('audiobooks.acquirePluginAdd')}
        </p>
        <label className="block">
          <span className="font-mono text-[10px] text-[var(--text-dim)]">{t('audiobooks.acquirePluginName')}</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] text-[var(--text-dim)]">
            {t('audiobooks.acquirePluginUrl')}
          </span>
          <input
            type="url"
            value={draft.searchUrlTemplate}
            onChange={(e) => setDraft((d) => ({ ...d, searchUrlTemplate: e.target.value }))}
            placeholder="https://example.com/search?q={query}"
            className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-sm"
          />
        </label>
        <label className="block">
          <span className="font-mono text-[10px] text-[var(--text-dim)]">
            {t('audiobooks.acquirePluginParser')}
          </span>
          <select
            value={draft.parserHint ?? 'html-links'}
            onChange={(e) =>
              setDraft((d) => ({
                ...d,
                parserHint: e.target.value as AudiobookSearchPlugin['parserHint'],
              }))
            }
            className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-sm"
          >
            <option value="html-links">{t('audiobooks.acquireParserHtml')}</option>
            <option value="json">{t('audiobooks.acquireParserJson')}</option>
            <option value="custom">{t('audiobooks.acquireParserCustom')}</option>
          </select>
        </label>
        {draft.parserHint === 'custom' || draft.parserHint === 'json' ? (
          <label className="block">
            <span className="font-mono text-[10px] text-[var(--text-dim)]">
              {t('audiobooks.acquirePluginSelector')}
            </span>
            <input
              type="text"
              value={draft.resultSelector ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, resultSelector: e.target.value }))}
              className="w-full mt-1 px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-sm"
            />
          </label>
        ) : null}
        {draft.parserHint === 'custom' ? (
          <div className="grid gap-2 sm:grid-cols-3">
            {(['titlePattern', 'magnetPattern', 'torrentUrlPattern'] as const).map((key) => (
              <label key={key} className="block">
                <span className="font-mono text-[9px] text-[var(--text-dim)]">{key}</span>
                <input
                  type="text"
                  value={draft[key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                  className="w-full mt-1 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] font-mono text-xs"
                />
              </label>
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="font-mono text-xs text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-accent touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider inline-flex items-center gap-2"
            onClick={saveDraft}
            disabled={saving}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {editingId ? t('audiobooks.acquirePluginSave') : t('audiobooks.acquirePluginAdd')}
          </button>
          {editingId ? (
            <button
              type="button"
              className="touch-manipulation h-10 px-4 rounded-lg font-mono text-[10px] uppercase tracking-wider border border-[var(--border)]"
              onClick={resetDraft}
            >
              {t('audiobooks.acquirePluginCancel')}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
