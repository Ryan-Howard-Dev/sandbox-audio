/**
 * The camera, used for exactly one thing.
 *
 * ML Kit decodes on the device. No frame is uploaded, no image is kept, and the only thing that
 * ever leaves as a result of a scan is the thirteen digits printed on the sleeve, sent to
 * MusicBrainz when a lookup is asked for. In an app whose pitch is that it does not watch you, that
 * distinction is the whole justification for asking for a camera at all — so the permission is
 * requested at the moment the scanner opens and never on launch.
 *
 * Android only. Everywhere else this reports unavailable and the shelf falls back to typing the
 * number, which works identically — barcodeRelease takes digits from any source.
 */

import { Capacitor } from '@capacitor/core';

/** Formats that actually appear on music packaging. Narrowed so a stray QR code is not read. */
const MUSIC_BARCODE_FORMATS = ['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E'] as const;

export type ScanOutcome =
  | { status: 'scanned'; barcode: string }
  /** The sheet was opened and closed without a read. Not a failure; say nothing. */
  | { status: 'cancelled' }
  /** Camera refused. The listener can still type the number. */
  | { status: 'denied' }
  /** No scanner on this platform at all. */
  | { status: 'unavailable' };

export function isBarcodeScanningAvailable(): boolean {
  return Capacitor.getPlatform() === 'android';
}

/**
 * Open the scanner and return the first music barcode seen.
 *
 * Imported lazily so the ML Kit module is not pulled into the initial bundle for the overwhelming
 * majority of sessions that never scan anything.
 */
export async function scanMusicBarcode(): Promise<ScanOutcome> {
  if (!isBarcodeScanningAvailable()) return { status: 'unavailable' };

  try {
    const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');

    const permission = await BarcodeScanner.requestPermissions();
    if (permission.camera !== 'granted' && permission.camera !== 'limited') {
      return { status: 'denied' };
    }

    /*
     * The scanning module is a separate download on some devices rather than part of the app. Ask
     * for it before opening a camera that would otherwise sit there reading nothing.
     */
    const available = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable().catch(() => ({
      available: true,
    }));
    if (!available.available) {
      await BarcodeScanner.installGoogleBarcodeScannerModule().catch(() => undefined);
    }

    const result = await BarcodeScanner.scan({
      formats: MUSIC_BARCODE_FORMATS as unknown as never,
    });
    const first = result.barcodes?.[0]?.rawValue?.trim();
    if (!first) return { status: 'cancelled' };
    return { status: 'scanned', barcode: first };
  } catch (err) {
    /*
     * The plugin throws on a cancelled scan as well as on a real fault, and the two are not worth
     * telling apart here: neither produced a barcode, and neither is worth an error message over a
     * camera the listener just closed.
     */
    const message = err instanceof Error ? err.message.toLowerCase() : '';
    if (message.includes('permission') || message.includes('denied')) return { status: 'denied' };
    return { status: 'cancelled' };
  }
}
