/** Supprime une ancienne image conservée avant la désactivation du cache. */

const DB_NAME = 'tg_memory'
const STORE = 'scene_image'
const SLOT = 'current'

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (!import.meta.client || !window.indexedDB) return resolve(null)
      const req = window.indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => req.result.createObjectStore(STORE)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function run<T>(
  mode: IDBTransactionMode,
  act: (store: IDBObjectStore) => IDBRequest,
): Promise<T | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = act(tx.objectStore(STORE))
      let result: T | null = null
      req.onsuccess = () => { result = (req.result as T) ?? null }
      tx.oncomplete = () => { db.close(); resolve(result) }
      tx.onerror = () => { db.close(); resolve(null) }
      tx.onabort = () => { db.close(); resolve(null) }
    } catch {
      db.close()
      resolve(null)
    }
  })
}

export async function forgetSceneImage(): Promise<void> {
  await run('readwrite', s => s.delete(SLOT))
}
