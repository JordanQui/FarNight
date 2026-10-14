import Anthropic from '@anthropic-ai/sdk'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { promisify } from 'node:util'

/**
 * Anime l'image du post avec Veo : un Reel de 8 secondes, en 9:16, muet sauf
 * si la case « son » est cochée. Veo 3.1 rend toujours une piste son : sans la
 * case, ffmpeg la retire au rapatriement.
 *
 * Veo part de l'image choisie dans la section Reel de l'atelier. « Ce qui
 * bouge » s'écrit en français : Claude, qui voit l'image, en fait le prompt
 * anglais de Veo. Il peut citer les images du pool de références par @nom.
 * Comme pour les images, chaque appel ajoute une variante.
 *
 * Une correction part d'une vidéo déjà tournée : Claude en regarde quelques
 * images, relit la consigne qu'avait reçue Veo et la remarque de l'auteur, et
 * réécrit la consigne. Veo ne retouche pas une vidéo : il retourne la prise
 * depuis la même image, c'est une génération entière.
 *
 * Pas de SDK : l'API Gemini se parle en trois requêtes — lancer, attendre
 * l'opération, télécharger. La vidéo n'y reste que deux jours, on la rapatrie
 * aussitôt dans communication/.
 */
const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const MODELS = { fast: 'veo-3.1-fast-generate-preview', standard: 'veo-3.1-generate-preview' } as const
const POLL_MS = 10_000
const MAX_WAIT_MS = 9 * 60_000
/** Les secondes où Claude regarde la vidéo à corriger. */
const FRAMES_AT = [1, 3, 5, 7]

type Picture = { data: string; mimeType: string }
type Ref = Picture & { name: string }

function imageBlock({ data, mimeType }: Picture): Anthropic.ContentBlockParam[] {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp'
    ? [{ type: 'image', source: { type: 'base64', media_type: mimeType, data } }]
    : []
}

/**
 * L'image de départ, puis les références citées par @nom, montrées à Claude
 * sous leur nom : Veo ne les verra jamais, c'est la description de Claude qui
 * les fait entrer.
 */
function pictures(start: Picture, refs: Ref[]): Anthropic.ContentBlockParam[] {
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text: 'Première image de la vidéo :' }, ...imageBlock(start)]
  for (const ref of refs) content.push({ type: 'text', text: `Référence @${ref.name} :` }, ...imageBlock(ref))
  return content
}

const DESCRIBE_REFS = `Veo ne voit pas les références : remplace chaque @nom par une description visuelle précise de l'image du même nom — forme, silhouette, matières, détails qui la distinguent — pour qu'il la reproduise sans l'avoir vue. Aucun @ ne doit rester.`

async function ask(content: Anthropic.ContentBlockParam[]): Promise<string> {
  const claude = new Anthropic({ apiKey: requireSecret(useRuntimeConfig().anthropicApiKey, 'ANTHROPIC_API_KEY') })
  const message = await claude.messages.create({
    model: IG_TEXT_MODEL,
    max_tokens: 400,
    messages: [{ role: 'user', content }],
  })
  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('').trim()
  if (!text) throw createError({ statusCode: 502, statusMessage: 'Claude n’a pas écrit la consigne de Veo' })
  return text
}

/** La prose française de l'auteur, devenue consigne de mouvement en anglais. */
function motionForVeo(motion: string, start: Picture, refs: Ref[]): Promise<string> {
  return ask([...pictures(start, refs), {
    type: 'text',
    text: `La première image ci-dessus ouvre une vidéo de 8 secondes que Veo va animer. L'auteur décrit en français ce qui doit bouger :

« ${motion} »

Réécris-le en anglais comme une consigne de mouvement pour Veo : ce qui bouge dans l'image, comment, et ce que fait la caméra (fixe, travelling, zoom lent…), en phrases simples et concrètes, en t'appuyant sur ce qu'on voit dans l'image. Garde l'intention de l'auteur, n'ajoute ni action ni personnage qu'il n'a pas demandé. Ne décris ni le style ni les couleurs, ils sont ajoutés ailleurs. ${refs.length ? `${DESCRIBE_REFS} Six phrases au plus.` : 'Trois phrases au plus.'}

Réponds uniquement par la consigne, sans guillemets ni commentaire.`,
  }])
}

/**
 * Ce que Veo a tourné, à quelques secondes d'intervalle. ffmpeg ne rend rien
 * au-delà de la fin : une vidéo plus courte donne moins d'images.
 */
async function framesOf(video: string): Promise<(Picture & { at: number })[]> {
  const file = communicationPath(video)
  if (!existsSync(file)) throw createError({ statusCode: 404, statusMessage: 'La vidéo à corriger n’est plus sur le disque' })
  try {
    const frames = await Promise.all(FRAMES_AT.map(async (at) => {
      const { stdout } = await promisify(execFile)('ffmpeg', [
        '-loglevel', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=-2:768', '-f', 'image2pipe', '-c:v', 'png', 'pipe:1',
      ], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 })
      return { at, mimeType: 'image/png', data: stdout.toString('base64') }
    }))
    return frames.filter(f => f.data)
  } catch (err: any) {
    throw createError({ statusCode: 500, statusMessage: `ffmpeg n’a pas lu la vidéo : ${err?.stderr || err?.message}` })
  }
}

/**
 * La remarque de l'auteur sur une prise ratée, devenue nouvelle consigne.
 * Claude voit ce que Veo a vraiment tourné ; Veo ne verra que l'image de départ
 * et la consigne réécrite. Une prise d'avant la correction n'a pas gardé sa
 * consigne : Claude repart alors de l'intention en français.
 */
function fixForVeo(note: string, previous: string, intent: string, start: Picture, frames: (Picture & { at: number })[], refs: Ref[]): Promise<string> {
  const content = pictures(start, refs)
  for (const frame of frames) content.push({ type: 'text', text: `La vidéo tournée, à ${frame.at} s :` }, ...imageBlock(frame))
  content.push({
    type: 'text',
    text: `Veo a animé la première image ci-dessus en une vidéo de 8 secondes, ${previous
      ? `avec cette consigne :\n\n${previous}`
      : `d'après cette intention de l'auteur : « ${intent} »`}

Les images « vidéo tournée » montrent ce qu'il en a fait. L'auteur dit en français ce qui ne va pas :

« ${note} »

Réécris en anglais la consigne de mouvement de Veo pour corriger cela. Regarde les images de la vidéo pour comprendre ce qui s'est passé, garde ce qui marchait, ne change que ce que l'auteur vise. Veo ne verra ni la vidéo ni cette remarque : décris ce qui doit se passer, en phrases simples et concrètes, pas ce qui s'est mal passé. N'ajoute ni action ni personnage qu'il n'a pas demandé. Ne décris ni le style ni les couleurs, ils sont ajoutés ailleurs. ${refs.length ? DESCRIBE_REFS : ''} Six phrases au plus.

Réponds uniquement par la consigne, sans guillemets ni commentaire.`,
  })
  return ask(content)
}

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ motion?: string; model?: string; sound?: boolean; fix?: { video?: string; note?: string } }>(event)
  const sound = body?.sound === true
  const model = MODELS[body?.model === 'standard' ? 'standard' : 'fast']

  const posts = await loadPosts()
  const post = posts.find(p => p.id === id)
  if (!post) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })
  const motion = (body?.motion ?? post.motion).trim()
  // Une correction repart de la prise visée : son image et sa consigne.
  const fix = body?.fix
  const note = fix?.note?.trim() ?? ''
  if (fix) {
    if (!fix.video || !post.videos.includes(fix.video)) throw createError({ statusCode: 404, statusMessage: 'Vidéo à corriger inconnue' })
    if (!note) throw createError({ statusCode: 400, statusMessage: 'Dis d’abord ce qui ne va pas' })
  } else if (!motion) throw createError({ statusCode: 400, statusMessage: 'Décris d’abord ce qui bouge' })
  const take = fix?.video ? post.takes[fix.video] : undefined
  const start = take && existsSync(communicationPath(take.source)) ? take.source : post.source
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

  // Seules les références citées partent chez Claude. Une consigne déjà tournée les a décrites.
  const citing = fix ? `${take ? '' : motion} ${note}` : motion
  const cited = [...new Set([...citing.matchAll(/@([\p{L}\p{N}-]+)/gu)].map(m => refName(m[1]!)))]
  const refs = await Promise.all(cited.map(async (name) => {
    const ref = post.refs.find(r => r.name === name)
    if (!ref) throw createError({ statusCode: 400, statusMessage: `Référence inconnue : @${name}` })
    return { name, mimeType: mimeOf(ref.path), data: (await readFile(communicationPath(ref.path))).toString('base64') }
  }))

  const data = (await readFile(communicationPath(start))).toString('base64')
  const motionEn = fix?.video
    ? await fixForVeo(note, take?.motion ?? '', motion, { data, mimeType }, await framesOf(fix.video), refs)
    : await motionForVeo(motion, { data, mimeType }, refs)
  let op = await (await call(`${BASE}/models/${model}:predictLongRunning`, {
    method: 'POST',
    body: JSON.stringify({
      instances: [{ prompt: buildVideoPrompt(motionEn, sound), image: { bytesBase64Encoded: data, mimeType } }],
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
    if (sound) await writeFile(abs, video)
    else {
      const raw = `${abs}.son.mp4`
      await writeFile(raw, video)
      try {
        await promisify(execFile)('ffmpeg', ['-y', '-loglevel', 'error', '-i', raw, '-c', 'copy', '-an', abs])
      } catch (err: any) {
        throw createError({ statusCode: 500, statusMessage: `ffmpeg n’a pas retiré le son : ${err?.stderr || err?.message}` })
      } finally {
        await unlink(raw).catch(() => {})
      }
    }
    p.videos.push(rel)
    p.video = rel
    p.takes[rel] = { source: start, motion: motionEn }
  })
})
