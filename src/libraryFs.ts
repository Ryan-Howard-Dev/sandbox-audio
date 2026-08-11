/**
 * Typed access to the desktop's filesystem layer.
 *
 * Desktop only, and deliberately so: the phone reaches its files through the Storage Access
 * Framework, which grants a folder rather than a path and has its own plugin. Every function here
 * returns a null-ish answer off the desktop instead of throwing, so a caller can ask without
 * knowing which platform it is on.
 *
 * The shape of the API is plan, then apply. Nothing renames or deletes anything until a plan has
 * been produced and its id handed back, which means a screen cannot skip the preview even by
 * accident — there is no call that takes operations and performs them.
 */

export type RootKind = 'music' | 'podcast' | 'audiobook' | 'document';

export interface LibraryRoot {
  id: string;
  path: string;
  kind: RootKind;
  addedAt: number;
}

export interface FileEntry {
  path: string;
  name: string;
  isDir: boolean;
  size: number;
  /** Epoch milliseconds, 0 where the platform will not say. */
  modified: number;
  extension?: string | null;
}

export interface ScanResult {
  entries: FileEntry[];
  /** The cap was hit, so this is a sample and not the library. */
  truncated: boolean;
  scanned: number;
}

export type LibraryOperation =
  | { kind: 'rename'; path: string; toName: string }
  | { kind: 'move'; path: string; toDir: string }
  | { kind: 'delete'; path: string }
  | { kind: 'createDir'; path: string };

/**
 * Why a change can or cannot go ahead.
 *
 * `ok` and `noChange` proceed; everything else is reported and skipped. Blocked changes are still
 * listed, because a preview that hides what it refused is not a preview.
 */
export type PlanOutcome =
  | 'ok'
  | 'collision'
  | 'sourceMissing'
  | 'outsideRoots'
  | 'noRoots'
  | 'noChange'
  | 'invalidName';

export interface PlannedChange {
  operation: LibraryOperation;
  from: string;
  to?: string | null;
  outcome: PlanOutcome;
  note?: string | null;
}

export interface LibraryPlan {
  id: string;
  changes: PlannedChange[];
  blocked: number;
  createdAt: number;
}

export interface AppliedChange {
  from: string;
  to?: string | null;
  ok: boolean;
  error?: string | null;
  skipped: boolean;
}

export interface ApplyResult {
  planId: string;
  applied: number;
  failed: number;
  skipped: number;
  changes: AppliedChange[];
}

/** Outcomes that stop a change from running. Mirrors Outcome::blocks on the Rust side. */
export function outcomeBlocks(outcome: PlanOutcome): boolean {
  return outcome !== 'ok' && outcome !== 'noChange';
}

/** A one-line summary for a plan, so the confirm step can say what is about to happen. */
export function describePlan(plan: LibraryPlan): string {
  const willRun = plan.changes.filter((c) => c.outcome === 'ok').length;
  const unchanged = plan.changes.filter((c) => c.outcome === 'noChange').length;
  const parts: string[] = [];
  parts.push(willRun === 1 ? '1 change' : `${willRun} changes`);
  if (plan.blocked > 0) parts.push(`${plan.blocked} blocked`);
  if (unchanged > 0) parts.push(`${unchanged} already correct`);
  return parts.join(', ');
}

export function isLibraryFsAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

async function invokeFs<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(command, args);
}

export async function listLibraryRoots(): Promise<LibraryRoot[]> {
  if (!isLibraryFsAvailable()) return [];
  try {
    return await invokeFs<LibraryRoot[]>('library_roots_list');
  } catch {
    return [];
  }
}

/**
 * Register a folder the manager may act inside.
 *
 * Rejects a folder that overlaps one already registered: nested roots make every path ambiguous
 * about which root confines it and which station owns it, and make a scan return everything twice.
 */
export async function addLibraryRoot(path: string, kind: RootKind): Promise<LibraryRoot> {
  return invokeFs<LibraryRoot>('library_root_add', { path, kind });
}

/** Forget a folder. Never touches what is inside it. */
export async function removeLibraryRoot(id: string): Promise<void> {
  await invokeFs<void>('library_root_remove', { id });
}

export async function scanLibrary(
  options: { rootId?: string; limit?: number } = {},
): Promise<ScanResult> {
  return invokeFs<ScanResult>('library_scan', {
    rootId: options.rootId ?? null,
    limit: options.limit ?? null,
  });
}

export async function statLibraryPath(path: string): Promise<FileEntry> {
  return invokeFs<FileEntry>('library_stat', { path });
}

/** Describe what these operations would do. Writes nothing. */
export async function planLibraryOperations(
  operations: LibraryOperation[],
): Promise<LibraryPlan> {
  return invokeFs<LibraryPlan>('library_plan', { operations });
}

/** Carry out a plan produced by planLibraryOperations. */
export async function applyLibraryPlan(planId: string): Promise<ApplyResult> {
  return invokeFs<ApplyResult>('library_apply', { planId });
}

/** Reverse the most recent applied run, where the files are still where it left them. */
export async function undoLastLibraryRun(): Promise<ApplyResult> {
  return invokeFs<ApplyResult>('library_undo_last');
}

/**
 * A url an audio element can actually play this file from.
 *
 * A WebView will not load a file:// path, and granting it the asset protocol would grant it the
 * whole disk. Rust serves the bytes over loopback instead, with byte ranges so seeking works, and
 * only ever opens paths already confined to a library root.
 *
 * Returns null off the desktop rather than throwing: Android reaches its files through the Storage
 * Access Framework and needs none of this, so a caller can ask without knowing the platform.
 */
export async function libraryMediaUrl(path: string): Promise<string | null> {
  if (!isLibraryFsAvailable()) return null;
  try {
    return await invokeFs<string>('library_media_url', { path });
  } catch {
    return null;
  }
}
