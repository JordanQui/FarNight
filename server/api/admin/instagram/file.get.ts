import { createReadStream, existsSync } from 'node:fs'

/** Sert une image de communication/ — aperçus, et source des recadrages. */
export default defineEventHandler((event) => {
  const rel = String(getQuery(event).path ?? '')
  const abs = communicationPath(rel)
  if (!existsSync(abs)) throw createError({ statusCode: 404, statusMessage: 'Fichier introuvable' })
  setHeader(event, 'content-type', mimeOf(abs))
  // Un fichier réécrit garde son nom : la page ajoute un `v=` à l'URL.
  setHeader(event, 'cache-control', 'no-cache')
  return sendStream(event, createReadStream(abs))
})
