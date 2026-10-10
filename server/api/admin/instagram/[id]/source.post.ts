/** Une image source déposée à la main, plutôt que générée. */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const { image } = await readBody<{ image: string }>(event)

  return updatePost(id, async (post) => {
    const ext = image?.startsWith('data:image/png') ? 'png' : 'jpg'
    const rel = await writeDataUri(`${postDir(id)}/source-${Date.now()}.${ext}`, image)
    post.sources.push(rel)
    post.source = rel
  })
})
