import React, { useEffect, useRef, useState } from 'react';
import { MoreVertical } from 'lucide-react';

export interface PageSectionOption<T extends string> {
  id: T;
  label: string;
  icon?: React.ElementType;
}

interface PageSectionMenuProps<T extends string> {
  sections: PageSectionOption<T>[];
  activeId: T;
  onSelect: (id: T) => void;
  ariaLabel?: string;
}

/** Orange ⋮ menu — section picker hidden until opened (TIDAL-style). */
export default function PageSectionMenu<T extends string>({
  sections,
  activeId,
  onSelect,
  ariaLabel = 'Sections',
}: PageSectionMenuProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative shrink-0 flex items-center gap-1.5">
      <span className="font-mono text-[10px] uppercase text-[var(--text-dim)] hidden sm:inline">
        View
      </span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`sandbox-menu-trigger touch-manipulation ${
          open ? 'sandbox-menu-trigger-open' : ''
        }`}
        aria-label={ariaLabel}
        title={`${ariaLabel} — Albums, Songs, Mixes, and more`}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical className="w-5 h-5" strokeWidth={2} />
      </button>

      {open && (
        <div
          role="menu"
          className="sandbox-menu-panel sandbox-menu-panel-sections sandbox-menu-panel-right"
        >
          {sections.map((item) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className={`sandbox-menu-item touch-manipulation ${
                  isActive ? 'sandbox-menu-item-active' : ''
                }`}
                onClick={() => {
                  onSelect(item.id);
                  setOpen(false);
                }}
              >
                {Icon ? (
                  <Icon className="w-[18px] h-[18px] shrink-0 opacity-80" strokeWidth={1.75} />
                ) : null}
                <span className="flex-1 text-left">{item.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
