import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreVertical } from 'lucide-react';

export interface LockerMenuAction {
  id: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Highlight as the currently selected option (radio-style) */
  active?: boolean;
  /** Draw a divider immediately before this item */
  divider?: boolean;
  /** Secondary line (e.g. bit depth detail, active sleep timer label) */
  subtitle?: string;
  /** Read-only row — no click action */
  info?: boolean;
  /** Optional section label — shown once before the first item in each group */
  section?: string;
  /** Close the mobile sheet after the next tick (use when opening another overlay) */
  deferSheetClose?: boolean;
}

interface LockerMoreMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actions: LockerMenuAction[];
  ariaLabel: string;
  /** Always show ⋮ (GPM mobile style); default shows on hover */
  alwaysVisible?: boolean;
  align?: 'left' | 'right';
  /** Pin portaled panel to the left screen edge instead of the trigger X position. */
  viewportAnchor?: 'trigger' | 'left-edge';
  /** Render menu in a body portal so it is not clipped by overflow:hidden parents */
  portaled?: boolean;
  /** Extra class on the dropdown panel (e.g. catalog theme border) */
  panelClassName?: string;
  /** Cap portaled menu height (default 28rem / 448px) */
  maxHeightCapPx?: number;
}

const MENU_GAP_PX = 6;
const VIEWPORT_PAD_PX = 8;

let cachedSafeAreaInsets: {
  top: number;
  bottom: number;
  left: number;
  right: number;
} | null = null;

function readSafeAreaInsets(): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (cachedSafeAreaInsets) return cachedSafeAreaInsets;
  if (typeof document === 'undefined' || !document.body) {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  try {
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.paddingTop = 'env(safe-area-inset-top, 0px)';
    probe.style.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
    probe.style.paddingLeft = 'env(safe-area-inset-left, 0px)';
    probe.style.paddingRight = 'env(safe-area-inset-right, 0px)';
    document.body.appendChild(probe);
    const cs = getComputedStyle(probe);
    cachedSafeAreaInsets = {
      top: parseFloat(cs.paddingTop || '0') || 0,
      bottom: parseFloat(cs.paddingBottom || '0') || 0,
      left: parseFloat(cs.paddingLeft || '0') || 0,
      right: parseFloat(cs.paddingRight || '0') || 0,
    };
    probe.remove();
  } catch {
    cachedSafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  }
  return cachedSafeAreaInsets;
}

/** Invalidate after rotation / resize. */
export function clearSafeAreaInsetCacheForTests(): void {
  cachedSafeAreaInsets = null;
}

/** Bottom tab bar + inline player dock — keep menus above mobile chrome. */
function getMobileBottomChromePx(): number {
  if (typeof document === 'undefined') return 0;
  let chrome = 0;
  for (const selector of ['.mobile-bottom-nav', '.mobile-player-dock']) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) continue;
    if (rect.bottom >= window.innerHeight - 4) {
      chrome += rect.height;
    }
  }
  return chrome;
}

export function computePortaledMenuStyle(
  trigger: DOMRect,
  menuEl: HTMLElement | null,
  align: 'left' | 'right',
  maxHeightCapPx = 448,
  viewportAnchor: 'trigger' | 'left-edge' = 'trigger',
): React.CSSProperties {
  const menuWidth = menuEl?.offsetWidth ?? 216;
  const menuHeight = menuEl?.offsetHeight ?? 280;

  const insets = readSafeAreaInsets();
  const safeTop = VIEWPORT_PAD_PX + insets.top;
  const safeBottom = VIEWPORT_PAD_PX + insets.bottom + getMobileBottomChromePx();
  const safeLeft = VIEWPORT_PAD_PX + insets.left;
  const safeRight = VIEWPORT_PAD_PX + insets.right;
  const viewportBottom = window.innerHeight - safeBottom;
  const viewportTop = safeTop;

  let top = trigger.bottom + MENU_GAP_PX;
  let transform: string | undefined;

  const spaceBelow = viewportBottom - trigger.bottom - MENU_GAP_PX;
  const spaceAbove = trigger.top - MENU_GAP_PX - viewportTop;
  const openAbove =
    menuHeight > spaceBelow && spaceAbove > spaceBelow && spaceAbove > 120;
  if (openAbove) {
    top = trigger.top - MENU_GAP_PX;
    transform = 'translateY(-100%)';
  }

  const available = openAbove ? spaceAbove : spaceBelow;
  const maxHeight = Math.min(
    Math.max(available, 140),
    window.innerHeight - safeTop - safeBottom,
    window.innerHeight * 0.72,
    maxHeightCapPx,
  );

  if (!openAbove) {
    const maxTop = viewportBottom - maxHeight;
    top = Math.min(Math.max(top, viewportTop), Math.max(viewportTop, maxTop));
  } else {
    const minTop = viewportTop + maxHeight;
    top = Math.max(top, minTop);
  }

  const style: React.CSSProperties = {
    position: 'fixed',
    top,
    transform,
    zIndex: 110,
    maxHeight,
    overflowY: 'auto',
    WebkitOverflowScrolling: 'touch',
  };

  if (viewportAnchor === 'left-edge') {
    style.left = safeLeft;
    style.right = 'auto';
    style.maxWidth = Math.min(
      menuWidth,
      window.innerWidth - safeLeft - safeRight,
    );
  } else if (align === 'right') {
    let right = window.innerWidth - trigger.right;
    const leftEdge = window.innerWidth - right - menuWidth;
    if (leftEdge < safeLeft) {
      right = window.innerWidth - menuWidth - safeRight;
    }
    style.right = Math.max(safeRight, right);
  } else {
    let left = trigger.left;
    if (left + menuWidth > window.innerWidth - safeRight) {
      left = window.innerWidth - menuWidth - safeRight;
    }
    style.left = Math.max(safeLeft, left);
  }

  return style;
}

function MenuItems({
  actions,
  onOpenChange,
}: {
  actions: LockerMenuAction[];
  onOpenChange: (open: boolean) => void;
}) {
  const showSections = actions.some((a) => a.section);
  let lastSection = '';

  return (
    <>
      {actions.map((action) => {
        const showSection =
          showSections && action.section && action.section !== lastSection;
        if (action.section) lastSection = action.section;

        return (
        <React.Fragment key={action.id}>
          {action.divider && <div className="sandbox-menu-divider" role="separator" />}
          {showSection ? (
            <div className="sandbox-menu-section-header" role="presentation">
              {action.section}
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={action.disabled || action.info}
            onClick={(e) => {
              e.stopPropagation();
              if (action.info) return;
              action.onClick();
              onOpenChange(false);
            }}
            className={`sandbox-menu-item touch-manipulation ${
              action.danger ? 'sandbox-menu-item-danger' : ''
            } ${action.active ? 'sandbox-menu-item-active' : ''} ${
              action.info ? 'sandbox-menu-item-info' : ''
            }`}
          >
            <span className="sandbox-menu-item-label">
              <span>{action.label}</span>
              {action.subtitle ? (
                <span className="sandbox-menu-item-subtitle">{action.subtitle}</span>
              ) : null}
            </span>
          </button>
        </React.Fragment>
        );
      })}
    </>
  );
}

export default function LockerMoreMenu({
  open,
  onOpenChange,
  actions,
  ariaLabel,
  alwaysVisible = false,
  align = 'right',
  viewportAnchor = 'trigger',
  portaled = false,
  panelClassName = '',
  maxHeightCapPx = 448,
}: LockerMoreMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const updateMenuPosition = useCallback(() => {
    if (!portaled || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setMenuStyle(
      computePortaledMenuStyle(
        rect,
        menuRef.current,
        align,
        maxHeightCapPx,
        viewportAnchor,
      ),
    );
  }, [portaled, align, maxHeightCapPx, viewportAnchor]);

  useLayoutEffect(() => {
    if (!open || !portaled) return;
    updateMenuPosition();
    const raf = requestAnimationFrame(updateMenuPosition);
    return () => cancelAnimationFrame(raf);
  }, [open, portaled, actions.length, updateMenuPosition]);

  useEffect(() => {
    if (!open || !portaled) return;
    let raf = 0;
    const onScrollOrResize = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateMenuPosition();
      });
    };
    const onResize = () => {
      cachedSafeAreaInsets = null;
      onScrollOrResize();
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, portaled, updateMenuPosition]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        rootRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
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

  const panelClasses = [
    'sandbox-menu-panel',
    align === 'right' ? 'sandbox-menu-panel-right' : 'sandbox-menu-panel-left',
    portaled ? 'sandbox-menu-panel-portaled' : '',
    panelClassName,
  ]
    .filter(Boolean)
    .join(' ');

  const menuPanel = open ? (
    <div
      ref={menuRef}
      role="menu"
      className={panelClasses}
      style={portaled ? menuStyle : undefined}
    >
      <MenuItems actions={actions} onOpenChange={onOpenChange} />
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
        className={`sandbox-menu-trigger touch-manipulation transition-opacity ${
          alwaysVisible
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
        } ${open ? 'sandbox-menu-trigger-open' : ''}`}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreVertical className="w-5 h-5" strokeWidth={2} />
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
