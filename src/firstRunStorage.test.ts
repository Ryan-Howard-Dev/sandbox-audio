import { beforeEach, describe, expect, it } from 'vitest';
import { firstRunGetItem, firstRunSetItem } from './firstRunStorage';

describe('firstRunStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('persists in localStorage regardless of session storage', () => {
    firstRunSetItem('sandbox_onboarding_complete', 'true');
    expect(localStorage.getItem('sandbox_onboarding_complete')).toBe('true');
    expect(sessionStorage.getItem('sandbox_onboarding_complete')).toBeNull();
    expect(firstRunGetItem('sandbox_onboarding_complete')).toBe('true');
  });

  it('migrates legacy session-only values to localStorage', () => {
    sessionStorage.setItem('sandbox_onboarding_complete', 'true');
    expect(firstRunGetItem('sandbox_onboarding_complete')).toBe('true');
    expect(localStorage.getItem('sandbox_onboarding_complete')).toBe('true');
    expect(sessionStorage.getItem('sandbox_onboarding_complete')).toBeNull();
  });
});
