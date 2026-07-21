import React from 'react';
import { useTranslation } from '../i18n';

export interface MobileTabItem<T extends string> {
  id: T;
  label: string;
  /** Shorter dock label (e.g. Podcasts → Pods) — full label stays on aria-label. */
  shortLabel?: string;
  icon: React.ElementType;
}

interface MobileBottomNavProps<T extends string> {
  items: MobileTabItem<T>[];
  activeId: T;
  onNavigate: (id: T) => void;
  badgeById?: Partial<Record<T, number>>;
  /** Icons only — used inside combined mini-player pill. */
  compact?: boolean;
  /** Show abbreviated labels even in compact dock mode. */
  showLabels?: boolean;
}

export default function MobileBottomNav<T extends string>({
  items,
  activeId,
  onNavigate,
  badgeById,
  compact = false,
  showLabels = false,
}: MobileBottomNavProps<T>) {
  const { t } = useTranslation();

  const tabCount = items.length;
  const dockLabel = (item: MobileTabItem<T>) =>
    compact && showLabels && item.shortLabel ? item.shortLabel : item.label;

  return (
    <nav
      className={`mobile-bottom-nav${compact ? ' mobile-bottom-nav--compact' : ''}${showLabels ? ' mobile-bottom-nav--labeled' : ''}`}
      data-tab-count={tabCount}
      style={{ '--mobile-tab-count': tabCount } as React.CSSProperties}
      aria-label={t('shell.mobileNav')}
    >
      <div className="mobile-bottom-nav-inner">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeId === item.id;
          const badge = badgeById?.[item.id] ?? 0;
          const badgeLabel =
            badge > 0
              ? t('shell.navBadge', { label: item.label, count: badge })
              : item.label;
          return (
            <button
              key={item.id}
              type="button"
              data-testid={`nav-tab-${item.id}`}
              className={`mobile-bottom-nav-item touch-manipulation${isActive ? ' mobile-bottom-nav-item--active' : ''}`}
              aria-current={isActive ? 'page' : undefined}
              aria-label={badgeLabel}
              onClick={() => onNavigate(item.id)}
            >
              <span className="mobile-bottom-nav-pill" aria-hidden={!isActive}>
                <span className="mobile-bottom-nav-icon-wrap">
                  <Icon className="mobile-bottom-nav-icon" strokeWidth={isActive ? 2.25 : 1.75} />
                  {badge > 0 ? (
                    <span className="mobile-bottom-nav-badge" aria-hidden>
                      {badge > 9 ? '9+' : badge}
                    </span>
                  ) : null}
                </span>
                {!compact || showLabels ? (
                  <span className="mobile-bottom-nav-label">{dockLabel(item)}</span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
