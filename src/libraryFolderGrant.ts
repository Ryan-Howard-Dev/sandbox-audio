/**
 * The folder the user grants once, and the five directories inside it.
 *
 * Wraps the LibraryFolder plugin so the rest of the app never touches a Capacitor call directly and
 * every path degrades on web and desktop, where there is no Storage Access Framework and no grant
 * to ask for.
 */
import { LIBRARY_FOLDERS, FOLDER_DIR_NAME, type LibraryFolder } from './libraryFolders';

export interface LibraryFolderStatus {
  granted: boolean;
  /** Name the user will recognise — what they picked in the system chooser. */
  displayName?: string | null;
  treeUri?: string | null;
}

export interface EnsureFoldersResult {
  rootUri: string;
  created: string[];
  existing: string[];
}

export interface FolderContents {
  present: boolean;
  count: number;
  uri: string | null;
}

interface LibraryFolderPlugin {
  getStatus(): Promise<LibraryFolderStatus>;
  requestFolder(): Promise<LibraryFolderStatus & { cancelled?: boolean }>;
  ensureFolders(): Promise<EnsureFoldersResult>;
  listFolders(): Promise<{ folders: Record<string, FolderContents> }>;
  releaseFolder(): Promise<{ granted: false }>;
}

/*
 * registerPlugin, not Capacitor.Plugins.
 *
 * Plugins is the legacy accessor and is not reliably populated on the imported module in Capacitor
 * 8 -- isPluginAvailable can report true from window.Capacitor while the imported module exposes
 * nothing, which presents as this feature silently not existing. registerPlugin is the documented
 * path and returns a proxy bound to the native plugin by name.
 */
let cached: LibraryFolderPlugin | null | undefined;

async function plugin(): Promise<LibraryFolderPlugin | null> {
  if (cached !== undefined) return cached;
  try {
    const { Capacitor, registerPlugin } = await import('@capacitor/core');
    if (!Capacitor?.isNativePlatform?.()) {
      cached = null;
      return cached;
    }
    cached = registerPlugin<LibraryFolderPlugin>('LibraryFolder');
    return cached;
  } catch {
    cached = null;
    return cached;
  }
}

/** True where a folder can be granted at all — Android only. */
export async function isLibraryFolderSupported(): Promise<boolean> {
  return (await plugin()) !== null;
}

export async function getLibraryFolderStatus(): Promise<LibraryFolderStatus> {
  const p = await plugin();
  if (!p) return { granted: false };
  try {
    return await p.getStatus();
  } catch {
    return { granted: false };
  }
}

/**
 * Ask for a folder, then create the five directories inside it.
 *
 * One call because they are one user intention. Asking for a folder and then leaving it empty until
 * some later trigger is how a feature ends up looking broken.
 */
export async function requestLibraryFolder(): Promise<{
  granted: boolean;
  cancelled: boolean;
  created: string[];
}> {
  const p = await plugin();
  if (!p) return { granted: false, cancelled: false, created: [] };
  const res = await p.requestFolder();
  if (!res.granted) return { granted: false, cancelled: Boolean(res.cancelled), created: [] };
  try {
    const made = await p.ensureFolders();
    return { granted: true, cancelled: false, created: made.created };
  } catch {
    // The grant held but the directories did not. Reporting granted is still correct — the next
    // ensureFolders() will retry, and claiming otherwise would prompt the user again for nothing.
    return { granted: true, cancelled: false, created: [] };
  }
}

/** Idempotent — safe on every launch. */
export async function ensureLibraryFolders(): Promise<EnsureFoldersResult | null> {
  const p = await plugin();
  if (!p) return null;
  try {
    return await p.ensureFolders();
  } catch {
    return null;
  }
}

/** What each shelf currently holds, keyed by our folder id rather than the directory name. */
export async function readLibraryFolderCounts(): Promise<Record<LibraryFolder, number>> {
  const empty = Object.fromEntries(LIBRARY_FOLDERS.map((f) => [f, 0])) as Record<
    LibraryFolder,
    number
  >;
  const p = await plugin();
  if (!p) return empty;
  try {
    const { folders } = await p.listFolders();
    const out = { ...empty };
    for (const id of LIBRARY_FOLDERS) {
      out[id] = folders[FOLDER_DIR_NAME[id]]?.count ?? 0;
    }
    return out;
  } catch {
    return empty;
  }
}

export async function releaseLibraryFolder(): Promise<void> {
  const p = await plugin();
  if (!p) return;
  try {
    await p.releaseFolder();
  } catch {
    // Nothing to undo — the grant is either already gone or was never held.
  }
}
