import { rm } from 'node:fs/promises'

/**
 * Retire une variante du pool d'un post : une image source, une vidéo ou une
 * référence de Reel. Si
 * c'était celle choisie, la précédente prend sa place. Le fichier n'est
 * effacé que s'il est dans le dossier `instagram/<id>/` du post : les images
 * faites à la main avant l'atelier quittent le pool mais restent sur le disque.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { path } = await readBody<{ path?: string }>(event)
  if (!path) throw createError({ statusCode: 400, statusMessage: 'Quelle variante ?' })

  return updatePost(id, async (p) => {
    if (p.sources.includes(path)) {
      p.sources = p.sources.filter(s => s !== path)
      if (p.source === path) p.source = p.sources.at(-1) ?? null
    } else if (p.videos.includes(path)) {
      p.videos = p.videos.filter(v => v !== path)
      if (p.video === path) p.video = p.videos.at(-1) ?? null
    } else if (p.refs.some(r => r.path === path)) {
      p.refs = p.refs.filter(r => r.path !== path)
    } else {
      throw createError({ statusCode: 404, statusMessage: 'Variante inconnue' })
    }
    if (path.startsWith(`${postDir(id)}/`)) await rm(communicationPath(path), { force: true })
  })
})
