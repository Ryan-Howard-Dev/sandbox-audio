import { describe, expect, it, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { verifySubsonicAuth } from './subsonicAuth';

describe('verifySubsonicAuth', () => {
  const password = 'sandbox-test-pass';

  beforeEach(() => {
    process.env.SUBSONIC_USER = 'sandbox';
    process.env.SUBSONIC_PASSWORD = password;
  });

  it('accepts md5(password + salt) token auth', () => {
    const salt = 'randomsalt';
    const token = crypto.createHash('md5').update(password + salt).digest('hex');
    expect(
      verifySubsonicAuth({
        u: 'sandbox',
        t: token,
        s: salt,
      }),
    ).toBe(true);
  });

  it('rejects wrong token for valid salt', () => {
    expect(
      verifySubsonicAuth({
        u: 'sandbox',
        t: 'deadbeef',
        s: 'salt123',
      }),
    ).toBe(false);
  });

  it('accepts plain password when token/salt omitted', () => {
    expect(
      verifySubsonicAuth({
        username: 'sandbox',
        p: password,
      }),
    ).toBe(true);
  });

  it('rejects mismatched username', () => {
    expect(
      verifySubsonicAuth({
        u: 'other-user',
        p: password,
      }),
    ).toBe(false);
  });
});
