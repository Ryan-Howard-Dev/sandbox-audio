import React from 'react';
import { createPortal } from 'react-dom';
import { ChevronRight, X } from 'lucide-react';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { useTranslation } from '../i18n';

export type MobileNavBrowseTone = 'accent' | 'accent-bright' | 'accent-deep';

export interface MobileNavMoreItem {
  id: string;
  label: string;
  subtitle: string;
  icon: React.ElementType;
  tone: MobileNavBrowseTone;
  badge?: number;
}

export interface MobileNavMoreSheetProps {
  open: boolean;
  onClose: () => void;
  items: MobileNavMoreItem[];
  activeId?: string;
  onSelect: (id: string) => void;
}

export default function MobileNavMoreSheet({
  open,
  onClose,
  items,
  activeId,
  onSelect,
}: MobileNavMoreSheetProps) {
  const { t } = useTranslation();
  useDismissableOverlay(open, onClose);

  if (!open) return null;

  return createPortal(
    <div
      className="mobile-browse-sheet-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mobile-browse-sheet-title"
    >
      <button
        type="button"
        className="mobile-browse-sheet-backdrop"
        aria-label={t('nav.browseClose')}
        onClick={onClose}
      />
      <div
        className="mobile-browse-sheet-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' || e.key === 'Back' || e.keyCode === 4) onClose();
        }}
      >
        <div className="mobile-browse-sheet-handle" aria-hidden />
        <header className="mobile-browse-sheet-head">
          <div className="mobile-browse-sheet-head-copy">
            <p className="mobile-browse-sheet-eyebrow">{t('nav.menu')}</p>
            <h2 id="mobile-browse-sheet-title" className="mobile-browse-sheet-title">
              {t('nav.menuSheetTitle')}
            </h2>
            <p className="mobile-browse-sheet-subtitle">{t('nav.menuSheetSubtitle')}</p>
          </div>
          <button
            type="button"
            className="mobile-browse-sheet-close touch-manipulation"
            onClick={onClose}
            aria-label={t('nav.browseClose')}
          >
            <X className="w-4 h-4" />
          </button>
        </header>
        <div className="mobile-browse-sheet-grid" role="list">
          {items.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeId === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className={`mobile-browse-card mobile-browse-card--${item.tone} touch-manipulation${
                  isActive ? ' is-active' : ''
                }${item.id === 'settings' ? ' mobile-browse-card--wide' : ''}`}
                style={{ animationDelay: `${index * 45}ms` }}
                onClick={() => {
                  onSelect(item.id);
                  onClose();
                }}
              >
                <span className="mobile-browse-card-glow" aria-hidden />
                <span className="mobile-browse-card-icon-wrap">
                  <Icon className="mobile-browse-card-icon" aria-hidden />
                </span>
                <span className="mobile-browse-card-copy">
                  <span className="mobile-browse-card-label">{item.label}</span>
                  <span className="mobile-browse-card-hint">{item.subtitle}</span>
                </span>
                {item.badge && item.badge > 0 ? (
                  <span className="mobile-browse-card-badge">{item.badge > 9 ? '9+' : item.badge}</span>
                ) : (
                  <ChevronRight className="mobile-browse-card-chevron" aria-hidden />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
