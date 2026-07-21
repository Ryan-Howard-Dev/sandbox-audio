import { describe, expect, it } from 'vitest';
import { t } from './index';

describe('i18n plural', () => {
  it('formats artist hub play count', () => {
    expect(t('locker.artistHubPlayCount', 'en', { count: 1 })).toBe('1 play');
    expect(t('locker.artistHubPlayCount', 'en', { count: 4 })).toBe('4 plays');
  });
});
