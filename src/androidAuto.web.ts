import { WebPlugin } from '@capacitor/core';
import type { AndroidAutoPlugin } from './androidAuto';

export class AndroidAutoWeb extends WebPlugin implements AndroidAutoPlugin {
  async setBrowseQueue(): Promise<void> {
    /* web — no-op */
  }

  async setBrowseLibrary(): Promise<void> {
    /* web — no-op */
  }

  async setBrowseSearchResults(): Promise<void> {
    /* web — no-op */
  }
}
