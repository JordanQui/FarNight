/**
 * Peint une nouvelle source pour le post.
 *
 * Chaque appel ajoute une variante sans effacer les précédentes : on compare,
 * on choisit.
 *
 * Portrait 2:3 : la seule taille d'où sortent les trois formats sans perte.
 */
const QUALITIES = ['low', 'medium', 'high'] as const

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ subject?: string; quality?: string }>(event)
  const quality = QUALITIES.find(q => q === body?.quality) ?? 'high'

  const posts = await loadPosts()
  const post = posts.find(p => p.id === id)
  if (!post) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })
  const subject = (body?.subject ?? post.subject).trim()
  if (!subject) throw createError({ statusCode: 400, statusMessage: 'Sujet de l’image manquant' })

  const b64 = await paintImage(buildImagePrompt(subject), quality)

  return updatePost(id, async (p) => {
    p.subject = subject
    const rel = await writeDataUri(`${postDir(id)}/source-${Date.now()}.png`, `data:image/png;base64,${b64}`)
    p.sources.push(rel)
    p.source = rel
    if (p.status === 'idee') p.status = 'brouillon'
  })
})
