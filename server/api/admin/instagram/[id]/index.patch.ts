import type { InstagramPost } from '~/types/instagram'

/** Les champs que la page a le droit de changer à la main. */
const EDITABLE = [
  'title', 'subject', 'notes', 'status', 'scheduled_for', 'published_at',
  'caption', 'hashtags', 'alt', 'overlay', 'source', 'framing', 'motion', 'video', 'kind', 'format',
] as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<Partial<InstagramPost>>(event)

  return updatePost(id, (post) => {
    for (const key of EDITABLE) {
      if (body[key] !== undefined) (post as any)[key] = body[key]
    }
    if (body.source !== undefined && body.source !== null && !post.sources.includes(body.source)) {
      throw createError({ statusCode: 400, statusMessage: 'Source inconnue pour ce post' })
    }
    if (body.video !== undefined && body.video !== null && !post.videos.includes(body.video)) {
      throw createError({ statusCode: 400, statusMessage: 'Vidéo inconnue pour ce post' })
    }
    settleFormat(post)
    // Passer en « publié » date la mise en ligne, si personne ne l'a fait.
    if (post.status === 'publie' && !post.published_at) post.published_at = new Date().toISOString().slice(0, 10)
  })
})
