import { describe, expect, it } from 'vitest';
import {
  buildSoulseekUrl,
  parseSoulseekStreamQuery,
  parseSoulseekUrl,
} from './soulseek.js';

describe('soulseek urls', () => {
  it('round-trips soulseek download refs', () => {
    const url = buildSoulseekUrl('peer1', '@@Music\\Artist\\track.mp3', 12345);
    const parsed = parseSoulseekUrl(url);
    expect(parsed).toEqual({
      username: 'peer1',
      filename: '@@Music\\Artist\\track.mp3',
      size: 12345,
    });
  });

  it('parses stream query params', () => {
    expect(
      parseSoulseekStreamQuery({
        username: 'peer1',
        filename: '@@Album\\01.mp3',
        size: '999',
      }),
    ).toEqual({
      username: 'peer1',
      filename: '@@Album\\01.mp3',
      size: 999,
    });
  });
});
