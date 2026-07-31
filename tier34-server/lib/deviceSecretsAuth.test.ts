import { afterEach, describe, expect, it } from 'vitest';
import type { Request } from 'express';
import { secretsMatch, verifyDeviceSyncAuth } from './deviceSecrets.js';

const CLIENT = 'sandbox-music/1.0';

function req(headers: Record<string, string>): Request {
  return { headers } as unknown as Request;
}

afterEach(() => {
  delete process.env.TIER34_DEVICE_SYNC_SECRET;
});

describe('verifyDeviceSyncAuth', () => {
  it('rejects anything without the client header', () => {
    expect(verifyDeviceSyncAuth(req({}))).toEqual({
      ok: false,
      status: 403,
      error: 'X-Sandbox-Client required',
    });
  });

  /*
   * Deliberate: with no secret configured the endpoints stay open to LAN clients, which is the
   * self-hosted default. Tightening it would lock out every existing install on upgrade.
   */
  it('allows LAN clients when no secret is configured', () => {
    expect(verifyDeviceSyncAuth(req({ 'x-sandbox-client': CLIENT }))).toEqual({ ok: true });
  });

  /*
   * The bug this exists for. `if (sandboxToken) return ok` accepted the token header on presence
   * alone, never comparing it — and since the client only ever sends X-Sandbox-Token, that was the
   * only live path. Setting the secret protected nothing: any LAN client could write Prowlarr and
   * Real-Debrid keys with a junk token while the operator believed it was locked down.
   */
  it('rejects an arbitrary token when a secret is configured', () => {
    process.env.TIER34_DEVICE_SYNC_SECRET = 'correct-horse';
    expect(
      verifyDeviceSyncAuth(req({ 'x-sandbox-client': CLIENT, 'x-sandbox-token': 'anything' })),
    ).toEqual({ ok: false, status: 401, error: 'Invalid device sync credentials' });
  });

  it('rejects a request carrying no credential at all', () => {
    process.env.TIER34_DEVICE_SYNC_SECRET = 'correct-horse';
    expect(verifyDeviceSyncAuth(req({ 'x-sandbox-client': CLIENT }))).toMatchObject({
      ok: false,
      status: 401,
    });
  });

  it('accepts the secret in the dedicated header', () => {
    process.env.TIER34_DEVICE_SYNC_SECRET = 'correct-horse';
    expect(
      verifyDeviceSyncAuth(
        req({ 'x-sandbox-client': CLIENT, 'x-tier34-device-sync': 'correct-horse' }),
      ),
    ).toEqual({ ok: true });
  });

  /*
   * The app sends the server token as X-Sandbox-Token and has no field for the sync header, so
   * this path is what makes the fix usable without a client release: paste the secret into the
   * existing server-token field.
   */
  it('accepts the secret in the token header the app already sends', () => {
    process.env.TIER34_DEVICE_SYNC_SECRET = 'correct-horse';
    expect(
      verifyDeviceSyncAuth(req({ 'x-sandbox-client': CLIENT, 'x-sandbox-token': 'correct-horse' })),
    ).toEqual({ ok: true });
  });

  it('rejects a near-miss secret', () => {
    process.env.TIER34_DEVICE_SYNC_SECRET = 'correct-horse';
    expect(
      verifyDeviceSyncAuth(req({ 'x-sandbox-client': CLIENT, 'x-sandbox-token': 'correct-hors' })),
    ).toMatchObject({ ok: false, status: 401 });
  });
});

describe('secretsMatch', () => {
  it('matches only an exact secret', () => {
    expect(secretsMatch('abc', 'abc')).toBe(true);
    expect(secretsMatch('abc', 'abd')).toBe(false);
  });

  it('is false for unequal lengths rather than throwing', () => {
    expect(secretsMatch('short', 'much-longer-secret')).toBe(false);
  });

  it('never treats an empty value as a match', () => {
    expect(secretsMatch('', '')).toBe(false);
    expect(secretsMatch('', 'secret')).toBe(false);
    expect(secretsMatch('secret', '')).toBe(false);
  });
});
