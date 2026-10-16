/**
 * L'album de la nuit : l'image de chaque lieu traversé, pour le PDF de l'aube.
 *
 * `scene-image-memory` ne garde que la scène en cours, et la suivante l'écrase.
 * Ici chaque lieu garde la sienne, rangée sous le titre de sa scène — la clé
 * que le journal tient déjà pour unique. Une miniature JPEG et non l'original :
 * douze originaux en base64 dépasseraient ce que Vercel accepte en entrée.
 *
 * Base à part de `tg_memory` : y ajouter un magasin demanderait d'en monter la
 * version, et de migrer l'image en cours. Tout échec vaut « pas d'image » : le
 * PDF tient sans elle.
 */

const DB_NAME = 'tg_album'
const STORE = 'places'

/** Assez pour une demi-page A4, assez léger pour douze lieux dans une requête. */
const THUMB_WIDTH = 900
const THUMB_QUALITY = 0.72

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

/**
 * L'image réduite en JPEG. Elle peut être une data URL ou un chemin du site
 * (l'illustration figée de l'auberge) : même origine, le canevas reste lisible.
 */
export async function thumbnail(src: string, width = THUMB_WIDTH, quality = THUMB_QUALITY): Promise<string | undefined> {
  try {
    const img = new Image()
    img.src = src
    await img.decode()
    const scale = Math.min(1, width / img.naturalWidth)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return undefined
  }
}

/** Range l'image d'un lieu. Une seconde image du même lieu remplace la première. */
export async function keepPlaceImage(sceneTitle: string, image: string): Promise<void> {
  if (!sceneTitle || image.startsWith('data:image/svg')) return
  const thumb = await thumbnail(image)
  if (thumb) await run('readwrite', s => s.put(thumb, sceneTitle))
}

export async function readPlaceImage(sceneTitle: string): Promise<string | undefined> {
  return (await run<string>('readonly', s => s.get(sceneTitle))) ?? undefined
}

/** Une nouvelle partie repart d'un album vide. */
export async function forgetAlbum(): Promise<void> {
  await run('readwrite', s => s.clear())
}
