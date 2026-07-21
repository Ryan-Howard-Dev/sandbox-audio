import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '../i18n';

type LoadInDjMenuProps = {
  trackId: string;
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLoad: (deck: 'A' | 'B', trackId: string) => void;
  alwaysVisible?: boolean;
  portaled?: boolean;
};

export default function LoadInDjMenu({
  trackId,
  title,
  open,
  onOpenChange,
  onLoad,
  alwaysVisible = false,
  portaled = true,
}: LoadInDjMenuProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updateMenuPosition = useCallback(() => {
    if (!portaled || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 88;
    const top = Math.min(rect.bottom + 4, window.innerHeight - menuHeight - 8);
    setMenuStyle({
      position: 'fixed',
      top,
      right: Math.max(8, window.innerWidth - rect.right),
      zIndex: 9999,
    });
  }, [portaled]);

  useLayoutEffect(() => {
    if (!open || !portaled) return;
    updateMenuPosition();
    const raf = requestAnimationFrame(updateMenuPosition);
    return () => cancelAnimationFrame(raf);
  }, [open, portaled, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onOpenChange(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const menuPanel = open ? (
    <div
      ref={menuRef}
      role="menu"
      className="sandbox-menu-panel sandbox-menu-panel-right sandbox-menu-panel-portaled min-w-[11rem]"
      style={portaled ? menuStyle : undefined}
    >
      <button
        type="button"
        role="menuitem"
        className="sandbox-menu-item w-full text-left touch-manipulation"
        onClick={() => {
          onLoad('A', trackId);
          onOpenChange(false);
        }}
      >
        {t('locker.menu.loadInDjDeckA')}
      </button>
      <button
        type="button"
        role="menuitem"
        className="sandbox-menu-item w-full text-left touch-manipulation"
        onClick={() => {
          onLoad('B', trackId);
          onOpenChange(false);
        }}
      >
        {t('locker.menu.loadInDjDeckB')}
      </button>
    </div>
  ) : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpenChange(!open);
        }}
        className={`search-results-action touch-manipulation transition-opacity ${
          alwaysVisible
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        } ${open ? 'search-results-action--active' : ''}`}
        aria-label={t('locker.loadInDjAria', { title })}
        aria-expanded={open}
        aria-haspopup="menu"
        title={t('locker.loadInDj')}
      >
        <SlidersHorizontal className="w-4 h-4" />
      </button>

      {open && portaled
        ? createPortal(
            <>
              <button
                type="button"
                className="sandbox-menu-backdrop"
                aria-label="Close menu"
                onClick={() => onOpenChange(false)}
              />
              {menuPanel}
            </>,
            document.body,
          )
        : menuPanel}
    </div>
  );
}
