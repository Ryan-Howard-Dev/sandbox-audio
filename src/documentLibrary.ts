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

/** Documents and books share a store; the shelves that show them are separate. */
export type LibraryItemKind = 'document' | 'book';

export interface SavedBookChapter {
  title: string;
  text: string;
}

/**
 * Where the listener stopped in one imported item.
 *
 * Kept on the item rather than in `audiobookProgress`, which looks like the obvious home and is
 * not: its keys are `audiobook:`/`audiobook-catalog:` ids, and everything in it feeds the
 * continue-listening shelf, which resumes a book by re-fetching chapters from a stored catalog
 * locator. An imported EPUB has no locator, so it would appear on that shelf as an entry whose only
 * possible response to a tap is "could not reopen that book".
 *
 * `chunkIndex` is the narration chunk within the chapter, not a second count: the reader's position
 * is a chunk, and text-to-speech has no timeline to seek on.
 */
export interface ReadingPosition {
  chapterIndex: number;
  chunkIndex: number;
  updatedAt: number;
}

export interface SavedDocument {
  /** Absent on entries written before books existed — those are all documents. */
  kind?: LibraryItemKind;
  /** Calibre's row id, when the book came from a Calibre folder — this is what spots a re-import. */
  calibreId?: number;
  /** Last place read aloud. Absent until something has actually been listened to. */
  position?: ReadingPosition;
  /** Real chapters from an EPUB spine. Documents have none; their sections come from headings. */
  chapters?: SavedBookChapter[];
  author?: string;
  /** Cover extracted from the EPUB itself — a data URL, so it works offline. */
  coverUrl?: string;
  description?: string;
  language?: string;
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
export type DocumentSummary = Omit<SavedDocument, 'text' | 'chapters'> & { chapterTitles?: string[] };

export function documentSummary(doc: SavedDocument): DocumentSummary {
  const { text: _text, chapters, ...rest } = doc;
  // Chapter *titles* are cheap and a shelf wants them; chapter bodies are the whole book.
  return chapters ? { ...rest, chapterTitles: chapters.map((c) => c.title) } : rest;
}

/** Documents and books are one store and two shelves — filter rather than duplicate the IO. */
export function itemKind(doc: Pick<SavedDocument, 'kind'>): LibraryItemKind {
  return doc.kind ?? 'document';
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

/**
 * Whether a position is worth a write.
 *
 * Narration reports a new chunk every sentence or two, and each write here is a read of the whole
 * record — text included — followed by a put of it. Doing that per chunk means rewriting a
 * book-sized record hundreds of times per chapter. A chapter change always writes, because that is
 * the jump a listener would notice losing.
 */
export function shouldPersistReadingPosition(
  previous: ReadingPosition | null | undefined,
  next: ReadingPosition,
  options?: { minIntervalMs?: number; minChunkDelta?: number },
): boolean {
  if (next.chunkIndex < 0 || next.chapterIndex < 0) return false;
  if (!previous) return true;
  if (previous.chapterIndex !== next.chapterIndex) return true;
  const minIntervalMs = options?.minIntervalMs ?? 20_000;
  const minChunkDelta = options?.minChunkDelta ?? 10;
  if (next.updatedAt - previous.updatedAt >= minIntervalMs) return true;
  return Math.abs(next.chunkIndex - previous.chunkIndex) >= minChunkDelta;
}

/**
 * Store a reading position without touching the rest of the record.
 *
 * Read-modify-write rather than a partial put: IndexedDB's `put` replaces the whole object, so
 * writing a position as a bare record would delete the book's text and leave a shelf entry that
 * opens to nothing. A missing item is not an error — it was deleted while being read.
 */
export async function saveReadingPosition(
  id: string,
  position: ReadingPosition,
): Promise<void> {
  try {
    const existing = await getDocument(id);
    if (!existing) return;
    await saveDocument({ ...existing, position });
  } catch {
    /* losing a position must never interrupt narration */
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
