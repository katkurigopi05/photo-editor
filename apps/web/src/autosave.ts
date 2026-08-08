/**
 * Crash recovery.
 *
 * A periodic snapshot of the project file in IndexedDB, so closing the tab —
 * or a crash, or a reload — costs at most the last interval rather than the
 * whole session. `localStorage` would be the shorter code and the wrong choice:
 * it is synchronous, blocks the main thread, and caps at a few megabytes, which
 * an operation log passes on a busy afternoon.
 *
 * This is a recovery snapshot, not a save. It is written without asking, so it
 * must never be mistaken for the user's own file: opening a project or saving
 * one clears it.
 */

const DB_NAME = "director.autosave";
const STORE = "snapshots";
const KEY = "current";

export interface Snapshot {
  savedAt: string;
  contents: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexedDB"));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("indexedDB"));
    });
  } finally {
    db.close();
  }
}

export async function writeSnapshot(contents: string): Promise<void> {
  const snapshot: Snapshot = { savedAt: new Date().toISOString(), contents };
  await withStore("readwrite", (store) => store.put(snapshot, KEY));
}

export async function readSnapshot(): Promise<Snapshot | null> {
  const value = await withStore<Snapshot | undefined>("readonly", (store) =>
    store.get(KEY),
  );
  return value ?? null;
}

export async function clearSnapshot(): Promise<void> {
  await withStore("readwrite", (store) => store.delete(KEY));
}
