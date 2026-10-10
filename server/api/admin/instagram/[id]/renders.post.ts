import type { Framing, FormatId } from '~/utils/instagram-crop'

/**
 * Les déclinaisons, recadrées dans la page.
 *
 * Le recadrage se fait côté navigateur, sur un canvas, avec le calcul même
 * qui dessine l'aperçu (utils/instagram-crop.ts) : ce qu'on a vu est ce qui
 * est écrit. Le serveur ne fait que poser les fichiers.
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ renders: Record<string, string>; framing?: Record<FormatId, Framing> }>(event)

  return updatePost(id, async (post) => {
    for (const [format, dataUri] of Object.entries(body.renders ?? {})) {
      if (!isFormat(format)) throw createError({ statusCode: 400, statusMessage: `Format inconnu : ${format}` })
      post.renders[format] = await writeDataUri(`${postDir(id)}/${id}-${format}.jpg`, dataUri)
    }
    if (body.framing) post.framing = { ...post.framing, ...body.framing }
    if (post.status === 'idee' || post.status === 'brouillon') post.status = post.caption ? 'pret' : 'brouillon'
  })
})
