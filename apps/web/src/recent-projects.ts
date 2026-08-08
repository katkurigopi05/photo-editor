/**
 * Recently opened projects.
 *
 * A `FileSystemFileHandle` is structured-cloneable, so IndexedDB can keep the
 * handle itself rather than a path the browser would never give us. Reopening
 * then costs one permission prompt instead of a trip through the file picker.
 *
 * Permission is not persistent: the browser drops write access between visits,
 * so every use of a stored handle asks again. That is the browser's decision,
 * not something to work around.
 */

const DB_NAME = "director.recents";
const STORE = "projects";
const KEY = "list";

export interface RecentProject {
  name: string;
  handle: FileSystemFileHandle;
  openedAt: string;
}

/** How many to keep. Long enough to cover a week of work, short enough that the
 * list stays a list rather than a history. */
export const RECENT_LIMIT = 8;

/**
 * Put `entry` at the front, drop any earlier entry for the same file, and cap
 * the list.
 *
 * Pure, and separate from storage, because this is the part with rules worth
 * testing: reopening a project should move it up rather than appear twice.
 */
export function mergeRecent(
  existing: readonly RecentProject[],
  entry: RecentProject,
  limit: number = RECENT_LIMIT,
): RecentProject[] {
  const rest = existing.filter((candidate) => candidate.name !== entry.name);
  return [entry, ...rest].slice(0, limit);
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
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

export async function listRecent(): Promise<RecentProject[]> {
  try {
    const value = await withStore<RecentProject[] | undefined>(
      "readonly",
      (store) => store.get(KEY),
    );
    return value ?? [];
  } catch {
    // A blocked or corrupt store is not a reason to break opening files.
    return [];
  }
}

export async function rememberProject(
  handle: FileSystemFileHandle,
): Promise<void> {
  try {
    const merged = mergeRecent(await listRecent(), {
      name: handle.name,
      handle,
      openedAt: new Date().toISOString(),
    });
    await withStore("readwrite", (store) => store.put(merged, KEY));
  } catch {
    // Remembering is a convenience; failing to remember must not fail the save.
  }
}

export async function forgetProject(name: string): Promise<void> {
  try {
    const remaining = (await listRecent()).filter(
      (entry) => entry.name !== name,
    );
    await withStore("readwrite", (store) => store.put(remaining, KEY));
  } catch {
    // As above.
  }
}

/** Handles carrying permission methods; typed here because the DOM lib in this
 * TypeScript version does not declare them. */
interface PermissionedHandle {
  queryPermission?: (options: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
  requestPermission?: (options: {
    mode: "read" | "readwrite";
  }) => Promise<PermissionState>;
}

/**
 * Make sure a stored handle may still be used, asking if it must.
 *
 * Returns false when the user declines or the file is gone, so the caller falls
 * back to the picker rather than failing at the write.
 */
export async function ensurePermission(
  handle: FileSystemFileHandle,
  mode: "read" | "readwrite",
): Promise<boolean> {
  const permissioned = handle as unknown as PermissionedHandle;
  // Handles from the origin-private file system carry no permission methods at
  // all: nothing was granted, so nothing can lapse.
  if (!permissioned.queryPermission && !permissioned.requestPermission) {
    return true;
  }
  try {
    if ((await permissioned.queryPermission?.({ mode })) === "granted") {
      return true;
    }
    return (await permissioned.requestPermission?.({ mode })) === "granted";
  } catch {
    return false;
  }
}
