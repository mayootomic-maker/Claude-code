/**
 * A minimal IndexedDB key/value store.
 *
 * Hand-rolled rather than pulling in idb: we need four operations and the
 * dependency would cost more than the code. IndexedDB (not localStorage)
 * because the ticket vault stores binary blobs in Phase 2, and localStorage
 * would force base64 and a 5 MB ceiling.
 */

const DB_NAME = 'pendlo'
const STORE = 'kv'
const VERSION = 1

let handle: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (handle !== null) return handle

  handle = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    // Fires when another tab holds an old version open.
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'))
  })

  // A failed open must not be cached forever — a private-mode browser or a
  // transient error would then permanently disable persistence.
  handle.catch(() => {
    handle = null
  })

  return handle
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode)
        const request = work(tx.objectStore(STORE))
        request.onsuccess = () => resolve(request.result as T)
        request.onerror = () => reject(request.error)
        tx.onabort = () => reject(tx.error)
      }),
  )
}

export function dbGet<T>(key: string): Promise<T | undefined> {
  return run<T | undefined>('readonly', (store) => store.get(key))
}

export function dbSet(key: string, value: unknown): Promise<void> {
  return run<void>('readwrite', (store) => store.put(value, key))
}

export function dbDelete(key: string): Promise<void> {
  return run<void>('readwrite', (store) => store.delete(key))
}

/**
 * Ask the browser to exempt our data from eviction.
 *
 * iOS clears PWA storage after roughly seven days of inactivity. This is the
 * documented defence, but it is a request the browser may decline, and Apple's
 * behaviour here has changed before — which is why export/import exists rather
 * than relying on this alone. Safe to call on every launch.
 */
export async function requestPersistence(): Promise<boolean> {
  if (navigator.storage?.persist === undefined) return false
  try {
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}
