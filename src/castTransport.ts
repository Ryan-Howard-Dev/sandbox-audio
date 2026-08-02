/**
 * Which casting the running build actually has.
 *
 * There are two, and they are not alternatives so much as consequences of how the app was built.
 * The Play build carries Google's Cast SDK and casts from the phone. The F-Droid build cannot,
 * because that SDK is proprietary, so it asks Sandbox Server to cast on its behalf.
 *
 * Deciding this in one place keeps the choice out of the UI. Nothing above here should be asking
 * which flavour it is running in; it should ask whether casting is available and get an answer.
 */

import { isNativeCastPlatform, isNativeCastSupported } from './nativeCast';
import { isServerCastConfigured } from './serverCast';

export type CastTransport = 'native' | 'server' | 'none';

/**
 * Native first, and not merely by preference.
 *
 * Casting from the phone works with the server switched off, on any network, with no second device
 * involved. Where the SDK is present it is straightforwardly better, so the server route exists to
 * restore a feature that would otherwise be missing rather than to replace a working one.
 */
export function resolveCastTransport(): CastTransport {
  if (isNativeCastPlatform() && isNativeCastSupported()) return 'native';
  if (isServerCastConfigured()) return 'server';
  return 'none';
}

export function isCastingAvailable(): boolean {
  return resolveCastTransport() !== 'none';
}

/**
 * Why casting is unavailable, in words worth showing someone.
 *
 * Returns null when it is available. The distinction that matters is between a build that has no
 * casting at all and one whose server simply is not running, because only the second is something
 * the person holding the phone can do anything about.
 */
export function castUnavailableReason(): string | null {
  if (isCastingAvailable()) return null;
  if (isNativeCastPlatform()) {
    return 'Casting needs Sandbox Server running on your network. Start it, then try again.';
  }
  return 'Casting is not available in this app.';
}
