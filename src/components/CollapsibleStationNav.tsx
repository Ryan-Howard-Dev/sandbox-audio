import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListMusic } from 'lucide-react';
import { useDismissableOverlay } from '../hooks/useDismissableOverlay';
import { isTabletViewport } from '../hooks/mobileShellLayout';
import { useTranslation } from '../i18n';

const DOCK_HIDE_DELAY_MS = 300;

function prefersAlwaysVisibleDock(): boolean {
  if (typeof window === 'undefined') return false;
  if (isTabletViewport()) return true;
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export interface NavItem<T extends string> {
  id: T;
  label: string;
  icon: React.ElementType;
}

interface CollapsibleStationNavProps<T extends string> {
  items: NavItem<T>[];
  activeId: T;
  onNavigate: (id: T) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resumeQueueCount?: number;
  onResumeQueue?: () => void;
  /** Primary dock icons (default: home, locker, discover). */
  primaryDockIds?: Set<string>;
  /** Keep icon rail visible (tablets / touch) — no hover-to-reveal. */
  alwaysVisible?: boolean;
}

const DEFAULT_PRIMARY_DOCK_IDS = new Set(['home', 'locker', 'discover']);
const TRAILING_DOCK_IDS = new Set(['settings', 'profile']);

export function StationMenuButton({
  onClick,
  active,
  className = '',
}: {
  onClick: () => void;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`station-dock-btn station-dock-btn--menu touch-manipulation ${active ? 'station-dock-btn--active' : ''} ${className}`}
      aria-label="Stations"
      aria-expanded={active}
    >
      <span className="station-dock-menu-bars" aria-hidden>
        <span />
        <span />
        <span />
      </span>
    </button>
  );
}

function DockIconButton<T extends string>({
  item,
  isActive,
  onSelect,
}: {
  item: NavItem<T>;
  isActive: boolean;
  onSelect: (id: T) => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className={`station-dock-btn touch-manipulation ${isActive ? 'station-dock-btn--active' : ''}`}
      aria-current={isActive ? 'page' : undefined}
      aria-label={item.label}
      title={item.label}
    >
      <Icon className="station-dock-icon" strokeWidth={isActive ? 2.1 : 1.75} />
      {isActive ? <span className="station-dock-active-dot" aria-hidden /> : null}
    </button>
  );
}

export default function CollapsibleStationNav<T extends string>({
  items,
  activeId,
  onNavigate,
  open,
  onOpenChange,
  resumeQueueCount = 0,
  onResumeQueue,
  primaryDockIds = DEFAULT_PRIMARY_DOCK_IDS,
  alwaysVisible: alwaysVisibleProp,
}: CollapsibleStationNavProps<T>) {
  const { t } = useTranslation();
  const close = () => onOpenChange(false);
  useDismissableOverlay(open, close);
  const showResumeQueue = resumeQueueCount > 0 && onResumeQueue;
  const resumeQueueSubtitle =
    resumeQueueCount === 1
      ? t('home.tracksInQueue', { count: resumeQueueCount })
      : t('home.tracksInQueuePlural', { count: resumeQueueCount });
  const [hoveredId, setHoveredId] = useState<T | null>(null);
  const [alwaysVisible, setAlwaysVisible] = useState(
    () => alwaysVisibleProp ?? prefersAlwaysVisibleDock(),
  );
  const [revealed, setRevealed] = useState(() => alwaysVisibleProp ?? prefersAlwaysVisibleDock());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (alwaysVisibleProp != null) {
      setAlwaysVisible(alwaysVisibleProp);
      if (alwaysVisibleProp) setRevealed(true);
      return;
    }
    const sync = () => {
      const next = prefersAlwaysVisibleDock();
      setAlwaysVisible(next);
      if (next) setRevealed(true);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [alwaysVisibleProp]);

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const showDock = useCallback(() => {
    clearHideTimer();
    setRevealed(true);
  }, [clearHideTimer]);

  const scheduleHide = useCallback(() => {
    if (open || alwaysVisible) return;
    clearHideTimer();
    hideTimerRef.current = setTimeout(() => setRevealed(false), DOCK_HIDE_DELAY_MS);
  }, [open, alwaysVisible, clearHideTimer]);

  useEffect(() => {
    if (open || alwaysVisible) {
      showDock();
    }
  }, [open, alwaysVisible, showDock]);

  useEffect(() => () => clearHideTimer(), [clearHideTimer]);

  const { primaryDockItems, trailingDockItems, extraItems } = useMemo(() => {
    const primary = items.filter((item) => primaryDockIds.has(item.id));
    const trailing = items.filter((item) => TRAILING_DOCK_IDS.has(item.id));
    const extra = items.filter(
      (item) => !primaryDockIds.has(item.id) && !TRAILING_DOCK_IDS.has(item.id),
    );
    return { primaryDockItems: primary, trailingDockItems: trailing, extraItems: extra };
  }, [items, primaryDockIds]);

  const hasExtra = extraItems.length > 0;
  const showDockDivider = primaryDockItems.length > 0 && trailingDockItems.length > 0;

  const handleSelect = (id: T) => {
    onNavigate(id);
    onOpenChange(false);
  };

  const handleMenuToggle = () => {
    onOpenChange(!open);
  };

  return (
    <div
      className={`station-dock-zone${open ? ' station-dock-zone--expanded' : ''}${revealed || alwaysVisible ? ' station-dock-zone--revealed' : ''}${alwaysVisible ? ' station-dock-zone--pinned' : ''}`}
      data-has-extra={hasExtra ? 'true' : 'false'}
      data-dock-pinned={alwaysVisible ? 'true' : 'false'}
      onMouseEnter={alwaysVisible ? undefined : showDock}
      onMouseLeave={alwaysVisible ? undefined : scheduleHide}
    >
      <div className="station-dock-edge-trigger" aria-hidden />

      <nav className="station-dock" aria-label="Stations">
        <StationMenuButton active={open} onClick={handleMenuToggle} />

        {primaryDockItems.map((item) => (
          <React.Fragment key={item.id}>
            <DockIconButton
              item={item}
              isActive={activeId === item.id}
              onSelect={handleSelect}
            />
          </React.Fragment>
        ))}

        {showDockDivider ? <div className="station-dock-divider" aria-hidden /> : null}

        {trailingDockItems.map((item) => (
          <React.Fragment key={item.id}>
            <DockIconButton
              item={item}
              isActive={activeId === item.id}
              onSelect={handleSelect}
            />
          </React.Fragment>
        ))}
      </nav>

      {open ? (
        <>
          <button
            type="button"
            className="station-dock-backdrop"
            aria-label="Close stations"
            onClick={close}
          />

          <aside
            className="station-dock-expanded"
            role="dialog"
            aria-modal="true"
            aria-label="All stations"
          >
            <nav className="station-dock-expanded-nav music-scrollbar">
              {showResumeQueue ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onResumeQueue();
                      onOpenChange(false);
                    }}
                    className="station-dock-expanded-item touch-manipulation"
                  >
                    <span className="station-dock-expanded-icon-wrap text-accent">
                      <ListMusic className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                    <span className="station-dock-expanded-item-text">
                      <span className="station-dock-expanded-label station-rail-label">
                        {t('home.resumeQueue')}
                      </span>
                      <span className="station-dock-expanded-sublabel">{resumeQueueSubtitle}</span>
                    </span>
                  </button>
                  <div className="station-dock-expanded-divider" aria-hidden />
                </>
              ) : null}
              {items.map((item) => {
                const Icon = item.icon;
                const isActive = activeId === item.id;
                const isHovered = hoveredId === item.id;

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelect(item.id)}
                    onMouseEnter={() => setHoveredId(item.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    className={`station-dock-expanded-item touch-manipulation ${isActive ? 'station-dock-expanded-item--active' : ''}`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <span
                      className={`station-dock-expanded-icon-wrap ${
                        isActive
                          ? 'text-accent'
                          : isHovered
                            ? 'text-[var(--text-mid)]'
                            : 'text-[var(--text-dim)]'
                      }`}
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
                    </span>
                    <span
                      className={`station-dock-expanded-label ${
                        isActive ? 'station-rail-label' : 'station-rail-label-inactive'
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                );
              })}
            </nav>
          </aside>
        </>
      ) : null}
    </div>
  );
}
