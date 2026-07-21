import React, { useEffect, useRef } from 'react';
import { Home, HardDrive, Settings, Sliders, Compass } from 'lucide-react';
import { detectTVPlatform } from '../tvDetection';

export type TVStationId = 'home' | 'discover' | 'locker' | 'dj' | 'settings';

/** Open nav rail on D-pad Left only from the left edge of a row or control strip. */
export function shouldOpenNavOnArrowLeft(el: HTMLElement | null): boolean {
  if (!el) return true;
  if (el.closest('#tv-drawer-panel')) return false;
  const dialog = el.closest('[role="dialog"]');
  if (dialog && !dialog.closest('#tv-drawer-panel')) return false;

  const card = el.closest<HTMLElement>('[data-tv-card]');
  if (card) {
    const cards = card.parentElement?.querySelectorAll('[data-tv-card]');
    if (cards && cards.length > 0 && cards[0] !== card) return false;
    return true;
  }

  const controls = el.closest('.tv-playback-controls');
  if (controls) {
    const focusables = controls.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input[type="range"]',
    );
    return focusables.length > 0 && focusables[0] === el;
  }

  return true;
}

interface TVNavigationProps {
  activeStation: TVStationId;
  isOpen: boolean;
  onSelectStation: (station: TVStationId) => void;
  onToggleOpen: (open: boolean) => void;
  discoverEnabled?: boolean;
}

const ALL_STATIONS = [
  { id: 'home' as const, label: 'Home', icon: Home },
  { id: 'discover' as const, label: 'Discover', subtitle: 'Feed · Explore · Playlists', icon: Compass },
  { id: 'locker' as const, label: 'Local Library', subtitle: 'Phone layout on TV', icon: HardDrive },
  { id: 'dj' as const, label: 'DJ Console', icon: Sliders },
  { id: 'settings' as const, label: 'Settings', icon: Settings },
];

export function useIsTVMode(): boolean {
  const [isTV, setIsTV] = React.useState(false);
  useEffect(() => {
    setIsTV(detectTVPlatform());
  }, []);
  return isTV;
}

export default function TVNavigation({
  activeStation,
  isOpen,
  onSelectStation,
  onToggleOpen,
  discoverEnabled = true,
}: TVNavigationProps) {
  const stations = discoverEnabled
    ? ALL_STATIONS
    : ALL_STATIONS.filter((s) => s.id !== 'discover');
  const currentStationIndex = stations.findIndex((s) => s.id === activeStation);
  const isAndroidTV = detectTVPlatform();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const activeBtn =
      panelRef.current?.querySelector<HTMLButtonElement>(
        `button[data-tv-station="${activeStation}"]`,
      ) ?? panelRef.current?.querySelector<HTMLButtonElement>('nav button');
    activeBtn?.focus();
  }, [isOpen, activeStation]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;
      const code = e.keyCode;
      const active = document.activeElement as HTMLElement | null;

      if (key === 'ArrowLeft' || code === 37) {
        if (!isOpen && shouldOpenNavOnArrowLeft(active)) {
          e.preventDefault();
          onToggleOpen(true);
        }
      } else if (key === 'ArrowRight' || code === 39) {
        if (isOpen) {
          e.preventDefault();
          onToggleOpen(false);
        }
      } else if ((key === 'ArrowUp' || code === 38) && isOpen) {
        e.preventDefault();
        const nextIndex = (currentStationIndex - 1 + stations.length) % stations.length;
        onSelectStation(stations[nextIndex].id);
      } else if ((key === 'ArrowDown' || code === 40) && isOpen) {
        e.preventDefault();
        const nextIndex = (currentStationIndex + 1) % stations.length;
        onSelectStation(stations[nextIndex].id);
      } else if ((key === 'Enter' || code === 13) && isOpen) {
        e.preventDefault();
        onToggleOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentStationIndex, onSelectStation, onToggleOpen]);

  const drawerTransformClass = isOpen
    ? 'translate-x-0'
    : isAndroidTV
      ? '-translate-x-full opacity-0 pointer-events-none'
      : '-translate-x-full';

  return (
    <>
      <div
        id="tv-drawer-panel"
        ref={panelRef}
        className={`fixed top-0 left-0 bottom-0 w-80 bg-[#02050B] z-50 transform transition-all duration-300 flex flex-col justify-between p-8 border-r border-[#C2410C]/10 ${drawerTransformClass} text-text-primary shadow-2xl`}
      >
        <div className="flex flex-col gap-8 mt-12">
          <div>
            <h2 className="font-display font-black text-2xl uppercase tracking-wider text-text-heading">
              Sandbox
            </h2>
            <p className="text-[10px] text-gray-500 font-mono tracking-widest mt-1">
              {isAndroidTV ? '• TV ENGINE' : '• REMOTE NAV'}
            </p>
          </div>

          <nav className="flex flex-col gap-3">
            {stations.map((s) => {
              const Icon = s.icon;
              const isActive = s.id === activeStation;
              return (
                <button
                  key={s.id}
                  type="button"
                  data-tv-station={s.id}
                  tabIndex={isOpen ? 0 : -1}
                  onClick={() => {
                    onSelectStation(s.id);
                    onToggleOpen(false);
                  }}
                  className={`flex items-center gap-4 py-3 px-4 rounded-xl text-left cursor-pointer transition-all duration-200 outline-none border focus:border-[#C2410C] focus:ring-2 focus:ring-[#C2410C]/35 ${
                    isActive
                      ? 'bg-orange-950/25 border-[#C2410C] text-text-heading font-bold shadow-[0_0_15px_rgba(194,65,12,0.2)]'
                      : 'bg-transparent border-transparent text-gray-400 hover:text-text-primary hover:bg-white/5 hover:border-[#C2410C]/40'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 ${isActive ? 'text-[#C2410C]' : 'text-gray-400'}`}
                  />
                  <span className="min-w-0">
                    <span className="text-sm font-medium tracking-wide block">{s.label}</span>
                    {'subtitle' in s && s.subtitle ? (
                      <span className="text-[9px] text-gray-500 font-mono uppercase tracking-wide block mt-0.5">
                        {s.subtitle}
                      </span>
                    ) : null}
                  </span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {isOpen ? (
        <div
          id="tv-drawer-overlay-void"
          onClick={() => onToggleOpen(false)}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-20 cursor-pointer"
          title="Close drawer"
        />
      ) : null}
    </>
  );
}
