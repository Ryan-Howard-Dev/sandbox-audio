/**
 * Minimal in-memory IndexedDB for Node vitest — enough for play-events store tests.
 */

import { vi } from 'vitest';

type IdType = IDBValidKey;

type StoreSchema = {
  keyPath: string;
  records: Map<string, Record<string, unknown>>;
  indexes: Map<string, { keyPath: string; unique: boolean }>;
};

type DbSchema = {
  name: string;
  version: number;
  stores: Map<string, StoreSchema>;
};

const databases = new Map<string, DbSchema>();

function primaryKeyOf(store: StoreSchema, value: Record<string, unknown>): string {
  return String(value[store.keyPath]);
}

function indexKeyOf(value: Record<string, unknown>, keyPath: string): IdType {
  return value[keyPath] as IdType;
}

class FakeIDBKeyRange {
  readonly lower: IdType | undefined;
  readonly upper: IdType | undefined;
  readonly lowerOpen: boolean;
  readonly upperOpen: boolean;

  constructor(
    lower: IdType | undefined,
    upper: IdType | undefined,
    lowerOpen: boolean,
    upperOpen: boolean,
  ) {
    this.lower = lower;
    this.upper = upper;
    this.lowerOpen = lowerOpen;
    this.upperOpen = upperOpen;
  }

  static only(value: IdType): FakeIDBKeyRange {
    return new FakeIDBKeyRange(value, value, false, false);
  }

  static lowerBound(lower: IdType, open = false): FakeIDBKeyRange {
    return new FakeIDBKeyRange(lower, undefined, open, false);
  }

  static upperBound(upper: IdType, open = false): FakeIDBKeyRange {
    return new FakeIDBKeyRange(undefined, upper, false, open);
  }

  static bound(
    lower: IdType,
    upper: IdType,
    lowerOpen = false,
    upperOpen = false,
  ): FakeIDBKeyRange {
    return new FakeIDBKeyRange(lower, upper, lowerOpen, upperOpen);
  }

  includes(key: IdType): boolean {
    const cmp = (a: IdType, b: IdType) => (a === b ? 0 : a < b ? -1 : 1);
    if (this.lower !== undefined) {
      const c = cmp(key, this.lower);
      if (c < 0 || (c === 0 && this.lowerOpen)) return false;
    }
    if (this.upper !== undefined) {
      const c = cmp(key, this.upper);
      if (c > 0 || (c === 0 && this.upperOpen)) return false;
    }
    return true;
  }
}

function schedule(fn: () => void): void {
  queueMicrotask(fn);
}

type FakeIDBCursorWithValue = {
  value: Record<string, unknown>;
  key: IdType;
  primaryKey: IdType;
  continue: () => void;
};

class FakeIDBRequest<T = unknown> {
  result: T | undefined;
  error: DOMException | null = null;
  onsuccess: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(private readonly tx?: FakeIDBTransaction) {}

  _succeed(result: T): void {
    this.result = result;
    schedule(() => {
      this.onsuccess?.(new Event('success'));
      this.tx?._requestSettled();
    });
  }

  _failConstraint(): void {
    this.error = new DOMException('ConstraintError', 'ConstraintError');
    schedule(() => {
      const ev = new Event('error', { cancelable: true });
      this.onerror?.(ev);
      if (ev.defaultPrevented) {
        this.tx?._requestSettled();
      } else {
        this.tx?._abort(this.error!);
      }
    });
  }

  _fail(error: DOMException): void {
    this.error = error;
    schedule(() => {
      this.onerror?.(new Event('error', { cancelable: true }));
      this.tx?._abort(error);
    });
  }
}

class FakeIDBIndex {
  constructor(
    private readonly store: FakeIDBObjectStore,
    private readonly name: string,
  ) {}

  openCursor(
    range?: FakeIDBKeyRange | IDBValidKey | null,
    direction: IDBCursorDirection = 'next',
  ): FakeIDBRequest<FakeIDBCursorWithValue | null> {
    const req = new FakeIDBRequest<FakeIDBCursorWithValue | null>(this.store.tx);
    this.store.tx._requestStarted();
    const keyRange =
      range == null
        ? null
        : range instanceof FakeIDBKeyRange
          ? range
          : FakeIDBKeyRange.only(range as IdType);

    schedule(() => {
      const meta = this.store.schema.indexes.get(this.name);
      if (!meta) {
        req._fail(new DOMException('Index not found', 'NotFoundError'));
        return;
      }
      const rows: Array<{ pk: string; value: Record<string, unknown>; ik: IdType }> = [];
      for (const [pk, value] of this.store.schema.records) {
        const ik = indexKeyOf(value, meta.keyPath);
        if (keyRange && !keyRange.includes(ik)) continue;
        rows.push({ pk, value, ik });
      }
      rows.sort((a, b) => {
        if (a.ik === b.ik) return a.pk < b.pk ? -1 : 1;
        return a.ik < b.ik ? -1 : 1;
      });
      if (direction === 'prev' || direction === 'prevunique') rows.reverse();

      let i = 0;
      const advance = () => {
        if (i >= rows.length) {
          req._succeed(null);
          return;
        }
        const row = rows[i++]!;
        const cursor: FakeIDBCursorWithValue = {
          value: row.value,
          key: row.ik,
          primaryKey: row.pk,
          continue: () => {
            this.store.tx._requestStarted();
            schedule(advance);
          },
        };
        req._succeed(cursor);
      };
      advance();
    });
    return req;
  }
}

class FakeIDBObjectStore {
  constructor(
    readonly schema: StoreSchema,
    readonly tx: FakeIDBTransaction,
  ) {}

  createIndex(name: string, keyPath: string, options?: { unique?: boolean }): FakeIDBIndex {
    this.schema.indexes.set(name, {
      keyPath,
      unique: Boolean(options?.unique),
    });
    return new FakeIDBIndex(this, name);
  }

  index(name: string): FakeIDBIndex {
    if (!this.schema.indexes.has(name)) {
      throw new DOMException(`Index ${name} not found`, 'NotFoundError');
    }
    return new FakeIDBIndex(this, name);
  }

  add(value: Record<string, unknown>): FakeIDBRequest<IdType> {
    const req = new FakeIDBRequest<IdType>(this.tx);
    this.tx._requestStarted();
    schedule(() => {
      if (this.tx.aborted) {
        req._fail(new DOMException('Transaction aborted', 'AbortError'));
        return;
      }
      const pk = primaryKeyOf(this.schema, value);
      if (this.schema.records.has(pk)) {
        req._failConstraint();
        return;
      }
      for (const [, idx] of this.schema.indexes) {
        if (!idx.unique) continue;
        const ik = indexKeyOf(value, idx.keyPath);
        for (const existing of this.schema.records.values()) {
          if (indexKeyOf(existing, idx.keyPath) === ik) {
            req._failConstraint();
            return;
          }
        }
      }
      this.schema.records.set(pk, { ...value });
      req._succeed(pk);
    });
    return req;
  }

  count(): FakeIDBRequest<number> {
    const req = new FakeIDBRequest<number>(this.tx);
    this.tx._requestStarted();
    schedule(() => req._succeed(this.schema.records.size));
    return req;
  }

  clear(): FakeIDBRequest<undefined> {
    const req = new FakeIDBRequest<undefined>(this.tx);
    this.tx._requestStarted();
    schedule(() => {
      this.schema.records.clear();
      req._succeed(undefined);
    });
    return req;
  }
}

class FakeIDBTransaction {
  oncomplete: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onabort: ((ev: Event) => void) | null = null;
  error: DOMException | null = null;
  aborted = false;
  private pending = 0;
  private started = false;
  private completed = false;

  constructor(
    private readonly db: FakeIDBDatabase,
    private readonly storeNames: string[],
  ) {
    // Defer completion until at least one request or empty txn settles.
    schedule(() => {
      this.started = true;
      this._maybeComplete();
    });
  }

  objectStore(name: string): FakeIDBObjectStore {
    const schema = this.db.schema.stores.get(name);
    if (!schema) throw new DOMException(`Store ${name} not found`, 'NotFoundError');
    return new FakeIDBObjectStore(schema, this);
  }

  _requestStarted(): void {
    this.pending += 1;
  }

  _requestSettled(): void {
    this.pending -= 1;
    this._maybeComplete();
  }

  _abort(err: DOMException): void {
    if (this.aborted) return;
    this.aborted = true;
    this.error = err;
    this.pending = 0;
    schedule(() => {
      this.onerror?.(new Event('error'));
      this.onabort?.(new Event('abort'));
    });
  }

  private _maybeComplete(): void {
    if (this.completed || this.aborted) return;
    if (!this.started || this.pending > 0) return;
    this.completed = true;
    schedule(() => this.oncomplete?.(new Event('complete')));
  }
}

class FakeIDBDatabase {
  objectStoreNames: { contains: (n: string) => boolean };

  constructor(readonly schema: DbSchema) {
    this.objectStoreNames = {
      contains: (n: string) => this.schema.stores.has(n),
    };
  }

  createObjectStore(name: string, options?: { keyPath?: string }): FakeIDBObjectStore {
    const store: StoreSchema = {
      keyPath: options?.keyPath ?? 'id',
      records: new Map(),
      indexes: new Map(),
    };
    this.schema.stores.set(name, store);
    const tx = new FakeIDBTransaction(this, [name]);
    return new FakeIDBObjectStore(store, tx);
  }

  transaction(storeNames: string | string[]): FakeIDBTransaction {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    return new FakeIDBTransaction(this, names);
  }

  close(): void {
    /* no-op */
  }
}

class FakeIDBOpenDBRequest {
  result: FakeIDBDatabase | undefined;
  error: DOMException | null = null;
  onsuccess: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null = null;
  onblocked: ((ev: Event) => void) | null = null;
}

export function installFakeIndexedDB(): void {
  databases.clear();
  const fake = {
    open(name: string, version?: number): FakeIDBOpenDBRequest {
      const req = new FakeIDBOpenDBRequest();
      schedule(() => {
        let schema = databases.get(name);
        const requested = version ?? schema?.version ?? 1;
        if (!schema) {
          schema = { name, version: requested, stores: new Map() };
          databases.set(name, schema);
          const db = new FakeIDBDatabase(schema);
          req.result = db;
          req.onupgradeneeded?.({
            oldVersion: 0,
            newVersion: requested,
            target: req,
          } as unknown as IDBVersionChangeEvent);
          // Attach result for handlers that read request.result
          Object.defineProperty(req, 'result', { value: db, writable: true });
          req.onsuccess?.(new Event('success'));
          return;
        }
        if (requested < schema.version) {
          req.error = new DOMException('VersionError', 'VersionError');
          req.onerror?.(new Event('error'));
          return;
        }
        if (requested > schema.version) {
          const oldVersion = schema.version;
          schema.version = requested;
          const db = new FakeIDBDatabase(schema);
          req.result = db;
          req.onupgradeneeded?.({
            oldVersion,
            newVersion: requested,
            target: req,
          } as unknown as IDBVersionChangeEvent);
          req.onsuccess?.(new Event('success'));
          return;
        }
        req.result = new FakeIDBDatabase(schema);
        req.onsuccess?.(new Event('success'));
      });
      return req;
    },
    deleteDatabase(name: string): FakeIDBOpenDBRequest {
      const req = new FakeIDBOpenDBRequest();
      schedule(() => {
        databases.delete(name);
        req.onsuccess?.(new Event('success'));
      });
      return req;
    },
  };
  vi.stubGlobal('indexedDB', fake);
  vi.stubGlobal('IDBKeyRange', FakeIDBKeyRange);
  if (typeof globalThis.DOMException === 'undefined') {
    vi.stubGlobal(
      'DOMException',
      class DOMException extends Error {
        constructor(message?: string, name?: string) {
          super(message);
          this.name = name ?? 'Error';
        }
      },
    );
  }
}

export function resetFakeIndexedDB(): void {
  databases.clear();
}
