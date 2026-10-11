/**
 * Ajoute une image au pool de références d'un Reel : peinte d'après `subject`,
 * ou importée telle quelle (`image`, en data URI). Son nom est ce qu'on tape
 * après @ dans « Ce qui bouge ».
 */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ name?: string; subject?: string; image?: string }>(event)
  const name = refName(body?.name ?? '')
  if (!name) throw createError({ statusCode: 400, statusMessage: 'Donne un nom à la référence' })

  const posts = await loadPosts()
  const post = posts.find(p => p.id === id)
  if (!post) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })
  if (post.refs.some(r => r.name === name)) {
    throw createError({ statusCode: 400, statusMessage: `@${name} existe déjà` })
  }

  const subject = (body?.subject ?? '').trim()
  let image = body?.image
  if (!image) {
    if (!subject) throw createError({ statusCode: 400, statusMessage: 'Décris ce que la référence montre' })
    image = `data:image/png;base64,${await paintImage(buildRefPrompt(subject), 'high')}`
  }

  return updatePost(id, async (p) => {
    const ext = image!.startsWith('data:image/png') ? 'png' : 'jpg'
    const path = await writeDataUri(`${postDir(id)}/ref-${name}-${Date.now()}.${ext}`, image!)
    p.refs.push({ name, path, subject: body?.image ? '' : subject })
  })
})
