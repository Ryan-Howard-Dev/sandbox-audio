/**
 * Sanitize server filesystem paths before showing in user-facing UI.
 * Full paths remain in tier34 logs and .env on the host; clients must not see usernames.
 */

const WINDOWS_USER_PREFIX = /^[A-Za-z]:[\\/]Users[\\/][^\\/]+/i;
const UNIX_USER_PREFIX = /^\/(?:Users|home)\/[^/]+/i;
const PATH_ANCHORS = ['tier34-server', 'storage/blobs', 'storage'] as const;

function normalizeSeparators(path: string): string {
  return path.replace(/\\/g, '/');
}

function collapseFromAnchor(path: string): string | null {
  const norm = normalizeSeparators(path);
  const lower = norm.toLowerCase();
  for (const anchor of PATH_ANCHORS) {
    const idx = lower.indexOf(anchor.toLowerCase());
    if (idx >= 0) {
      return `…/${norm.slice(idx)}`;
    }
  }
  return null;
}

function redactUserHome(path: string): string {
  if (WINDOWS_USER_PREFIX.test(path)) {
    const drive = path.charAt(0);
    const tail = normalizeSeparators(path).replace(/^[^:]+:[\\/]Users[\\/][^\\/]+[\\/]?/i, '');
    return tail ? `${drive}:\\Users\\***\\…\\${tail.replace(/\//g, '\\')}` : `${drive}:\\Users\\***`;
  }
  const norm = normalizeSeparators(path);
  if (UNIX_USER_PREFIX.test(norm)) {
    const tail = norm.replace(/^\/(?:Users|home)\/[^/]+\/?/i, '');
    return tail ? `/Users/***/…/${tail}` : '/Users/***';
  }
  return path;
}

/** True when the tier34 backend URL points at this machine (operator context). */
export function isLocalTier34Backend(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl.trim()).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  } catch {
    return false;
  }
}

/**
 * Redact usernames and collapse absolute paths to project-relative tails.
 * Example: C:\Users\RH\Downloads\sovereign-music-console\tier34-server\storage\blobs
 *       -> …/tier34-server/storage/blobs
 */
export function sanitizePathForDisplay(path: string | null | undefined): string {
  if (!path?.trim()) return '—';

  const trimmed = path.trim();
  const collapsed = collapseFromAnchor(trimmed);
  if (collapsed) return collapsed;

  const redacted = redactUserHome(trimmed);
  if (redacted !== trimmed) {
    const collapsedRedacted = collapseFromAnchor(redacted);
    if (collapsedRedacted) return collapsedRedacted;
    return redacted;
  }

  if (/^[A-Za-z]:[\\/]/.test(trimmed) || trimmed.startsWith('/')) {
    const parts = normalizeSeparators(trimmed).split('/').filter(Boolean);
    if (parts.length >= 2) {
      return `…/${parts.slice(-3).join('/')}`;
    }
    return 'On-server path (hidden)';
  }

  return trimmed;
}

/** Vault / settings label for tier34 blob storage — never exposes host usernames. */
export function displayTier34StoragePath(blobsDir: string | null | undefined): string {
  if (!blobsDir?.trim()) return '—';
  const sanitized = sanitizePathForDisplay(blobsDir);
  if (sanitized === '—') return sanitized;
  if (sanitized.startsWith('…/')) return sanitized;
  if (/^storage(\/|$)/i.test(sanitized)) return sanitized;
  return 'Sandbox Server blob store (on server)';
}
