/**
 * Subsonic-compatible token auth — md5(password + salt) = token.
 */

import crypto from 'node:crypto';

export type SubsonicCredentials = {
  username: string;
  password: string;
};

export function loadSubsonicCredentials(): SubsonicCredentials {
  return {
    username: (process.env.SUBSONIC_USER ?? 'sandbox').trim() || 'sandbox',
    password: (process.env.SUBSONIC_PASSWORD ?? 'sandbox').trim() || 'sandbox',
  };
}

export function isSubsonicEnabled(): boolean {
  return process.env.SUBSONIC_API_ENABLED !== 'false';
}

export function verifySubsonicAuth(query: Record<string, unknown>): boolean {
  const { username, password } = loadSubsonicCredentials();
  const u = String(query.u ?? query.username ?? '').trim();
  if (!u || u.toLowerCase() !== username.toLowerCase()) return false;

  const token = String(query.t ?? '').trim();
  const salt = String(query.s ?? '').trim();
  if (token && salt) {
    const expected = crypto.createHash('md5').update(password + salt).digest('hex');
    return token.toLowerCase() === expected.toLowerCase();
  }

  const plain = String(query.p ?? query.password ?? '').trim();
  if (plain) {
    return plain === password;
  }

  return false;
}
