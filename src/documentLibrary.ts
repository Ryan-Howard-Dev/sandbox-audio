/**
 * Imported documents — their own shelf, kept separate from audiobooks.
 *
 * A research paper is not an audiobook and should not be filed among them; it has no author
 * catalog, no chapters until narration derives them, and no cover. It gets its own shelf so
 * neither list has to pretend the other's metadata applies.
 *
 * Text lives in IndexedDB rather than localStorage: a book-length document is megabytes, and
 * localStorage is both small and synchronous, so a large paste would block the UI thread and then
 * fail. Nothing here touches the network — an imported document never leaves the device.
 */

const DB_NAME = 'SandboxDocumentsDB';
const DB_VERSION = 1;
const STORE = 'documents';

export interface SavedDocument {
  id: string;
  name: string;
  addedAt: number;
  /** Full extracted text, re-chunked on open so narration rules can improve without re-import. */
  text: string;
  /** Chunk count at import, for a shelf card that does not have to parse to say something. */
  chunkCount: number;
  estimatedSeconds: number;
}

/** Card-sized view of a document: everything a shelf needs, without its text. */
export type DocumentSummary = Omit<SavedDocument, 'text'>;

export function documentSummary(doc: SavedDocument): DocumentSummary {
  const { text: _text, ...summary } = doc;
  return summary;
}

/** Stable id from the name and time, so re-importing the same file makes a distinct entry. */
export function newDocumentId(name: string, now = Date.now()): string {
  const slug = name
    .replace(/\.[^.]+$/, '')
    .replace(/[^a-z0-9]+/gi, '-')
    // Trim the separators before testing for emptiness: a name of only punctuation collapses to
    // "-", which is truthy, so without this the fallback never fired and ids ended in a stray dash.
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40);
  return `doc-${now.toString(36)}-${slug || 'untitled'}`;
}

/** Display name without its extension — the extension is noise on a shelf card. */
export function documentDisplayName(name: string): string {
  return name.replace(/\.(txt|md|markdown|text)$/i, '').trim() || name;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveDocument(doc: SavedDocument): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(doc);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  try {
    const db = await openDb();
    const all = await new Promise<SavedDocument[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as SavedDocument[]) ?? []);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.map(documentSummary).sort((a, b) => b.addedAt - a.addedAt);
  } catch {
    return [];
  }
}

export async function getDocument(id: string): Promise<SavedDocument | null> {
  try {
    const db = await openDb();
    const doc = await new Promise<SavedDocument | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as SavedDocument | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return doc ?? null;
  } catch {
    return null;
  }
}

/** User-initiated only — an imported document is user data and is never removed on its behalf. */
export async function deleteDocument(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
