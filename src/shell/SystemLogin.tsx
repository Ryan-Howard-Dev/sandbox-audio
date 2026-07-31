/**
 * Profile chooser shown before the shell mounts.
 *
 * Lifted out of sandboxLayer3 (R-011). It is a whole component with its own state that happened
 * to live in the shell file; it takes three props, touches nothing else, and is the last piece
 * above the shell body that can move without unpicking component state.
 */

import React, { useState } from 'react';
import { User } from 'lucide-react';
import type { useProfile } from '../sandboxLayer1';
import { useTranslation } from '../i18n';

export default function SystemLogin({
  profiles,
  onEnter,
  onSelect,
}: {
  profiles: ReturnType<typeof useProfile>['profiles'];
  onEnter: (name: string) => void;
  onSelect: (id: string) => void;
}) {
  const [name, setName] = useState('');
  const { t } = useTranslation();

  return (
    <div className="h-screen overflow-hidden flex flex-col items-center justify-center px-6 bg-[var(--bg-void)] text-[var(--text)]">
      <div className="w-full max-w-sm space-y-8">
        <div className="text-center space-y-2">
          <p className="font-display text-2xl font-black uppercase tracking-[0.2em] text-accent">
            {t('login.appName')}
          </p>
          <p className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-mid)]">
            {t('login.title')}
          </p>
        </div>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onEnter(name.trim());
          }}
        >
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('login.placeholder')}
            className="w-full h-12 px-4 rounded-lg font-mono text-sm border border-[var(--border)] bg-[var(--bg-surface)] focus-accent"
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full h-12 rounded-lg font-mono text-xs font-bold uppercase tracking-wider disabled:opacity-40 btn-accent touch-manipulation"
          >
            {t('login.enterStation')}
          </button>
        </form>
        {profiles.length > 0 && (
          <ul className="space-y-1.5 max-h-48 overflow-y-auto music-scrollbar">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSelect(p.id)}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] font-mono text-xs uppercase touch-manipulation"
                >
                  <User className="w-4 h-4 shrink-0 text-accent" />
                  <span className="truncate text-[var(--text-mid)]">{p.displayName}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
