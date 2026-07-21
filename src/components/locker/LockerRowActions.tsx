import React, { useState } from 'react';
import { MoreVertical } from 'lucide-react';
import LockerMoreMenu, { type LockerMenuAction } from '../LockerMoreMenu';
import MobileTrackActionSheet from '../../mobile/MobileTrackActionSheet';
import { useMobileShell } from '../../hooks/useMobileShell';
import { useNarrowViewport } from '../../hooks/useNarrowViewport';

export interface LockerRowActionsProps {
  menuKey: string;
  openMenuKey: string | null;
  onOpenMenuKeyChange: (key: string | null) => void;
  actions: LockerMenuAction[];
  ariaLabel: string;
  sheetTitle: string;
  sheetSubtitle?: string;
  alwaysVisible?: boolean;
  align?: 'left' | 'right';
  portaled?: boolean;
  panelClassName?: string;
  maxHeightCapPx?: number;
}

/**
 * Track/album row menu — bottom sheet on mobile, dropdown on desktop.
 * Reuses existing LockerMenuAction builders from LocalView.
 */
export default function LockerRowActions({
  menuKey,
  openMenuKey,
  onOpenMenuKeyChange,
  actions,
  ariaLabel,
  sheetTitle,
  sheetSubtitle,
  alwaysVisible = false,
  align = 'right',
  portaled = true,
  panelClassName,
  maxHeightCapPx,
}: LockerRowActionsProps) {
  const mobileShell = useMobileShell();
  const narrow = useNarrowViewport(767);
  const useSheet = mobileShell || narrow;
  const [sheetOpen, setSheetOpen] = useState(false);
  const open = openMenuKey === menuKey;

  if (useSheet) {
    return (
      <>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSheetOpen(true);
          }}
          className={`sandbox-menu-trigger touch-manipulation transition-opacity ${
            alwaysVisible
              ? 'opacity-100'
              : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'
          }`}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
        >
          <MoreVertical className="w-4 h-4" strokeWidth={2} />
        </button>
        <MobileTrackActionSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={sheetTitle}
          subtitle={sheetSubtitle}
          actions={actions}
          ariaLabel={ariaLabel}
        />
      </>
    );
  }

  return (
    <LockerMoreMenu
      open={open}
      onOpenChange={(next) => onOpenMenuKeyChange(next ? menuKey : null)}
      actions={actions}
      ariaLabel={ariaLabel}
      alwaysVisible={alwaysVisible}
      align={align}
      portaled={portaled}
      panelClassName={panelClassName}
      maxHeightCapPx={maxHeightCapPx}
    />
  );
}

/** Opens a bottom sheet programmatically (long-press). Desktop falls back to menu key. */
export function openLockerRowActions(
  mobileShell: boolean,
  narrow: boolean,
  menuKey: string,
  onOpenMenuKeyChange: (key: string | null) => void,
  openSheet: () => void,
): void {
  if (mobileShell || narrow) {
    openSheet();
    return;
  }
  onOpenMenuKeyChange(menuKey);
}
