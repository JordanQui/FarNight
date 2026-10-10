import { rm } from 'node:fs/promises'

/**
 * Retire un post. Seul son dossier `instagram/<id>/` part avec lui : les
 * fichiers d'avant l'atelier (sources/, posts-carres/…) ne sont jamais touchés.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const posts = await loadPosts()
  const index = posts.findIndex(p => p.id === id)
  if (index < 0) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })

  posts.splice(index, 1)
  await savePosts(posts)
  await rm(communicationPath(postDir(id)), { recursive: true, force: true })
  return { ok: true }
})
