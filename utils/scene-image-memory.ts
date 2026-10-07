/**
 * L'illustration de la scène en cours, gardée par le navigateur.
 *
 * Le texte revenait de `localStorage` au rechargement, l'image non : elle
 * n'existait que dans le store, et chaque rechargement la redemandait — ~7
 * centimes, une image du quota payant, et un décor DIFFÉRENT de celui que le
 * joueur venait de voir. Le cache du serveur ne la rattrapait pas : sur Vercel
 * il ne survit pas à un démarrage à froid.
 *
 * IndexedDB et non `localStorage` : une image en base64 pèse un à trois
 * mégaoctets, et `localStorage` plafonne autour de cinq pour tout le site.
 *
 * Un seul emplacement : seule la scène en cours a besoin de son image, celles
 * d'avant ne se revoient pas. Tout échec vaut « pas d'image gardée » — on
 * régénérera, c'est tout.
 */

const DB_NAME = 'tg_memory'
const STORE = 'scene_image'
const SLOT = 'current'

interface KeptImage {
  /** L'empreinte de la scène illustrée. Une autre scène ne la reprend pas. */
  stamp: string
  image: string
  saved_at: number
}

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

/** L'image gardée pour cette scène, ou null si c'en est une autre ou si elle a expiré. */
export async function readSceneImage(stamp: string, maxAgeMs: number): Promise<string | null> {
  const kept = await run<KeptImage>('readonly', s => s.get(SLOT))
  if (!kept || kept.stamp !== stamp || !kept.image) return null
  if (Date.now() - kept.saved_at > maxAgeMs) {
    void forgetSceneImage()
    return null
  }
  return kept.image
}

export async function storeSceneImage(stamp: string, image: string): Promise<void> {
  const kept: KeptImage = { stamp, image, saved_at: Date.now() }
  await run('readwrite', s => s.put(kept, SLOT))
}

export async function forgetSceneImage(): Promise<void> {
  await run('readwrite', s => s.delete(SLOT))
}
