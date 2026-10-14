/**
 * Remet un fichier au joueur : l'aube, le PDF de la nuit.
 *
 * Sur mobile, la feuille de partage permet de l'enregistrer dans la photothèque
 * ou dans Fichiers, ce qu'un téléchargement n'offre pas sur iOS. Refusée — le
 * geste du joueur est trop loin, après une longue attente —, on télécharge.
 */
export async function saveFile(blob: Blob, filename: string): Promise<void> {
  const name = filename.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ')
  const file = new File([blob], name, { type: blob.type })

  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      // Feuille fermée par le joueur : il n'a rien demandé d'autre.
      if ((err as Error).name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
