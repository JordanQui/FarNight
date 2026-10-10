import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Anime l'image du post avec Veo : un Reel de 8 secondes, en 9:16, son compris.
 *
 * Veo part du 9:16 exporté s'il existe (le cadrage choisi à la main), sinon de
 * la source. Comme pour les images, chaque appel ajoute une variante.
 *
 * Pas de SDK : l'API Gemini se parle en trois requêtes — lancer, attendre
 * l'opération, télécharger. La vidéo n'y reste que deux jours, on la rapatrie
 * aussitôt dans communication/.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODELS = { fast: 'veo-3.1-fast-generate-preview', standard: 'veo-3.1-generate-preview' } as const
const POLL_MS = 10_000
const MAX_WAIT_MS = 9 * 60_000

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ motion?: string; model?: string }>(event)
  const model = MODELS[body?.model === 'standard' ? 'standard' : 'fast']

  const posts = await loadPosts()
  const post = posts.find(p => p.id === id)
  if (!post) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })
  const motion = (body?.motion ?? post.motion).trim()
  if (!motion) throw createError({ statusCode: 400, statusMessage: 'Décris d’abord ce qui bouge' })
  const start = post.renders['9x16'] ?? post.source
  if (!start) throw createError({ statusCode: 400, statusMessage: 'Il faut d’abord une image à animer' })
  const mimeType = mimeOf(start)
  if (!mimeType.startsWith('image/')) throw createError({ statusCode: 400, statusMessage: 'Image de départ illisible' })

  const key = requireSecret(useRuntimeConfig().geminiApiKey, 'GEMINI_API_KEY')
  const headers = { 'x-goog-api-key': key, 'content-type': 'application/json' }
  const call = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, { ...init, headers })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw createError({ statusCode: 502, statusMessage: `Veo ${res.status} : ${detail.replace(/\s+/g, ' ').slice(0, 300)}` })
    }
    return res
  }

  const data = (await readFile(communicationPath(start))).toString('base64')
  let op = await (await call(`${BASE}/models/${model}:predictLongRunning`, {
    method: 'POST',
    body: JSON.stringify({
      instances: [{ prompt: buildVideoPrompt(motion), image: { inlineData: { mimeType, data } } }],
      // Partir d'une image n'admet que `allow_adult`, seule valeur permise en Europe.
      parameters: { aspectRatio: '9:16', durationSeconds: 8, resolution: '1080p', personGeneration: 'allow_adult' },
    }),
  })).json()

  const deadline = Date.now() + MAX_WAIT_MS
  while (!op.done) {
    if (Date.now() > deadline) throw createError({ statusCode: 504, statusMessage: 'Veo n’a pas fini à temps' })
    await new Promise(r => setTimeout(r, POLL_MS))
    op = await (await call(`${BASE}/${op.name}`)).json()
  }
  if (op.error) throw createError({ statusCode: 502, statusMessage: `Veo : ${op.error.message ?? 'échec'}` })

  const result = op.response?.generateVideoResponse
  const uri: string | undefined = result?.generatedSamples?.[0]?.video?.uri
  if (!uri) {
    const why = result?.raiMediaFilteredReasons?.join(' ') || 'aucune vidéo rendue'
    throw createError({ statusCode: 502, statusMessage: `Veo : ${why}` })
  }
  const video = Buffer.from(await (await call(uri)).arrayBuffer())

  return updatePost(id, async (p) => {
    p.motion = motion
    const rel = `${postDir(id)}/video-${Date.now()}.mp4`
    const abs = communicationPath(rel)
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, video)
    p.videos.push(rel)
    p.video = rel
  })
})
