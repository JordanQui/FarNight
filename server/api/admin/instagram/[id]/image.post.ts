import OpenAI from 'openai'

/**
 * Peint une nouvelle source pour le post.
 *
 * Chaque appel ajoute une variante sans effacer les précédentes : on compare,
 * on choisit. Pas de cache ici, à l'inverse de server/utils/image-gen.ts —
 * relancer le même sujet, c'est justement vouloir une autre image.
 *
 * Portrait 2:3 : la seule taille d'où sortent les trois formats sans perte.
 */
const MODELS = ['gpt-image-2', 'gpt-image-1']
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

  const config = useRuntimeConfig()
  const openai = new OpenAI({ apiKey: requireSecret(config.openaiApiKey, 'OPENAI_API_KEY') })
  const prompt = buildImagePrompt(subject)

  let b64: string | undefined
  let lastError: unknown
  for (const model of MODELS) {
    try {
      const response = await openai.images.generate({
        model, prompt, n: 1, size: '1024x1536', quality, output_format: 'png',
      })
      b64 = response.data?.[0]?.b64_json
      if (b64) break
    } catch (err) {
      lastError = err
    }
  }
  if (!b64) {
    throw createError({
      statusCode: 502,
      statusMessage: lastError instanceof Error ? lastError.message : 'Aucune image rendue',
    })
  }

  return updatePost(id, async (p) => {
    p.subject = subject
    const rel = await writeDataUri(`${postDir(id)}/source-${Date.now()}.png`, `data:image/png;base64,${b64}`)
    p.sources.push(rel)
    p.source = rel
    if (p.status === 'idee') p.status = 'brouillon'
  })
})
