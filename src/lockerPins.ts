import { prefsGetItem, prefsSetItem } from './prefsStorage';

export const LOCKER_PIN_SLOTS = 3;

export type LockerPin = {
  key: string;
  title: string;
  artist: string;
  kind: 'album';
  pinnedAt: number;
};

const KEY = 'sandbox_locker_pins_v1';

export function loadLockerPins(): LockerPin[] {
  try {
    const raw = prefsGetItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LockerPin[];
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, LOCKER_PIN_SLOTS);
  } catch {
    return [];
  }
}

export function saveLockerPins(pins: LockerPin[]): LockerPin[] {
  const next = pins.slice(0, LOCKER_PIN_SLOTS);
  prefsSetItem(KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent('sandbox-locker-pins-change'));
  return next;
}

export function isLockerPinned(key: string): boolean {
  return loadLockerPins().some((p) => p.key === key);
}

export function pinLockerAlbum(pin: Omit<LockerPin, 'pinnedAt'>): boolean {
  const pins = loadLockerPins();
  if (pins.some((p) => p.key === pin.key)) return true;
  if (pins.length >= LOCKER_PIN_SLOTS) return false;
  saveLockerPins([...pins, { ...pin, pinnedAt: Date.now() }]);
  return true;
}

export function unpinLockerAlbum(key: string): void {
  saveLockerPins(loadLockerPins().filter((p) => p.key !== key));
}

export function toggleLockerPin(pin: Omit<LockerPin, 'pinnedAt'>): boolean {
  if (isLockerPinned(pin.key)) {
    unpinLockerAlbum(pin.key);
    return true;
  }
  return pinLockerAlbum(pin);
}
