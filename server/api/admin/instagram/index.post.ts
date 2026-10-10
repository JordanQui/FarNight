import type { InstagramPost } from '~/types/instagram'

/** Un nouveau post — une idée, au départ : un titre, un sujet. */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ title?: string; subject?: string; notes?: string }>(event)
  const title = body?.title?.trim()
  if (!title) throw createError({ statusCode: 400, statusMessage: 'Titre manquant' })

  const posts = await loadPosts()
  const post: InstagramPost = newPost({
    id: slugFor(title, posts.map(p => p.id)),
    title,
    subject: body.subject?.trim() ?? '',
    notes: body.notes?.trim() ?? '',
  })
  posts.unshift(post)
  await savePosts(posts)
  return post
})
