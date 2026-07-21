import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Square, X } from 'lucide-react';
import { APP_WINDOW_TITLE } from '../buildId';

function showWindowsTitleBar(): boolean {
  return false;
}

export default function WindowsTitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!showWindowsTitleBar()) return;

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (cancelled) return;

      setMaximized(await win.isMaximized());
      unlisten = await win.onResized(async () => {
        if (cancelled) return;
        setMaximized(await win.isMaximized());
      });
    })();

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  const withWindow = useCallback(
    (action: (win: import('@tauri-apps/api/window').Window) => void | Promise<void>) => {
      void (async () => {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        await action(getCurrentWindow());
      })();
    },
    [],
  );

  if (!showWindowsTitleBar() || typeof document === 'undefined') return null;

  return createPortal(
    <header className="windows-titlebar" aria-label="Window title bar">
      <div className="windows-titlebar-drag" data-tauri-drag-region>
        <span className="windows-titlebar-title">{APP_WINDOW_TITLE}</span>
      </div>
      <div className="windows-titlebar-controls">
        <button
          type="button"
          className="windows-titlebar-btn"
          aria-label="Minimize"
          onClick={() => withWindow((win) => win.minimize())}
        >
          <Minus className="windows-titlebar-icon" aria-hidden />
          <span className="windows-titlebar-glyph" aria-hidden>
            −
          </span>
        </button>
        <button
          type="button"
          className="windows-titlebar-btn"
          aria-label={maximized ? 'Restore' : 'Maximize'}
          onClick={() => withWindow((win) => win.toggleMaximize())}
        >
          <Square className="windows-titlebar-icon" aria-hidden />
          <span className="windows-titlebar-glyph" aria-hidden>
            □
          </span>
        </button>
        <button
          type="button"
          className="windows-titlebar-btn windows-titlebar-btn--close"
          aria-label="Close"
          onClick={() => withWindow((win) => win.close())}
        >
          <X className="windows-titlebar-icon" aria-hidden />
          <span className="windows-titlebar-glyph" aria-hidden>
            ×
          </span>
        </button>
      </div>
    </header>,
    document.body,
  );
}
