import { beforeEach, describe, expect, it } from 'vitest';
import { prefsRemoveItem } from './prefsStorage';
import {
  loadTauriCastGuidanceDismissed,
  loadTauriCastGuidanceRequested,
  requestTauriCastGuidance,
  saveTauriCastGuidanceDismissed,
  shouldShowTauriCastGuidancePanel,
} from './sandboxSettings';

const DISMISSED_KEY = 'sandbox_tauri_cast_guidance_dismissed';
const REQUESTED_KEY = 'sandbox_tauri_cast_guidance_requested';

function clearCastGuidancePrefs(): void {
  prefsRemoveItem(DISMISSED_KEY);
  prefsRemoveItem(REQUESTED_KEY);
}

describe('tauri cast guidance prefs', () => {
  beforeEach(() => {
    clearCastGuidancePrefs();
  });

  it('shows guidance panel by default on fresh install', () => {
    expect(loadTauriCastGuidanceDismissed()).toBe(false);
    expect(shouldShowTauriCastGuidancePanel()).toBe(true);
  });

  it('persists dismiss so guidance does not reappear', () => {
    saveTauriCastGuidanceDismissed(true);
    expect(loadTauriCastGuidanceDismissed()).toBe(true);
    expect(shouldShowTauriCastGuidancePanel()).toBe(false);
  });

  it('records cast intent once when user opens Cast', () => {
    expect(loadTauriCastGuidanceRequested()).toBe(false);
    requestTauriCastGuidance();
    expect(loadTauriCastGuidanceRequested()).toBe(true);
    requestTauriCastGuidance();
    expect(loadTauriCastGuidanceRequested()).toBe(true);
  });
});
