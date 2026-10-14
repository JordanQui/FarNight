import OpenAI from 'openai'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import type { InstagramPost } from '~/types/instagram'
import { DEFAULT_FRAMING, FORMATS, formatsFor, type FormatId } from '~/utils/instagram-crop'

/**
 * L'atelier Instagram : où vivent les posts, et comment on les peint.
 *
 * Tout tient dans `communication/`, versionné avec le reste : un fichier
 * `instagram/posts.json` et les images à côté. Pas de base de données — la
 * page d'admin n'existe qu'en local (server/middleware/admin-guard.ts), et
 * c'est le disque du poste de travail qu'elle écrit.
 */

export const COMMUNICATION_DIR = resolve(process.cwd(), 'communication')
const STORE = join(COMMUNICATION_DIR, 'instagram', 'posts.json')

/** Le dossier propre à un post. Les sources et les exports y atterrissent. */
export const postDir = (id: string) => join('instagram', id)

/**
 * Le style des visuels, repris de communication/sources/prompts-generation.py
 * qui a produit les premiers posts. Il reste ici, côté serveur : la page ne
 * transmet qu'un sujet, et tous les posts sortent dans la même main.
 */
export const IG_PALETTE = { dominant: '#0b0f1c', secondary: '#46536e', accent: '#ff2e88' }

const { dominant: D, secondary: S, accent: A } = IG_PALETTE
export const IG_STYLE = `Drawn in the DARK DECO style of the 1990s Batman animated series crossed with the flat polygonal backdrops of the 1992 video game Flashback: painted as if on black paper, retro-futurist megastructure of stepped towers, bold angular geometry, strong verticals, flat cel-shaded shapes with hard edges, no gradients, no texture, heavy black shadows swallowing whole areas, powerful silhouettes, film-noir lighting from a single source.

STRICT THREE-COLOR PALETTE, nothing else: ${D} (near-black ink blue) about 70 percent, the shadow; ${S} (steel blue-grey) about 20 percent, surfaces catching indirect light; ${A} (hot neon magenta) about 10 percent, the ONLY light, painted as LARGE SOLID SHAPES: neon tubes, screens, hard-edged shafts and pools of light on wet surfaces. Everything the light touches is ${A}, everything else is shadow.

Neon rendered as abstract glowing tubes and geometric glyphs, never readable letters. No text, no lettering, no numbers, no logo, no watermark anywhere. Not photorealistic, not 3d, not anime, not medieval.`

/**
 * Une seule source pour trois formats : on peint en portrait 2:3 et on garde
 * le sujet dans la bande centrale, pour qu'il survive au carré comme au 9:16.
 */
export const IG_COMPOSITION = 'Tall portrait composition. Keep the main subject inside the central square of the frame so it survives a square crop, with extra sky or floor above and below it.'

export function buildImagePrompt(subject: string): string {
  return `${IG_COMPOSITION}\n${subject.trim()}\n\n${IG_STYLE}`
}

/**
 * Une référence de Reel n'est pas un décor : un seul sujet, entier et lisible,
 * pour que Claude puisse le décrire sans rien deviner.
 */
const REF_COMPOSITION = 'Reference image: one single subject, whole and clearly readable, centered against a plain dark background, nothing else in the frame.'

export function buildRefPrompt(subject: string): string {
  return `${REF_COMPOSITION}\n${subject.trim()}\n\n${IG_STYLE}`
}

/**
 * Peint un prompt avec gpt-image, en portrait 2:3 ; rend le PNG en base64.
 * Pas de cache, à l'inverse de server/utils/image-gen.ts : relancer le même
 * sujet, c'est justement vouloir une autre image.
 */
const IMAGE_MODELS = ['gpt-image-2', 'gpt-image-1']
export async function paintImage(prompt: string, quality: 'low' | 'medium' | 'high'): Promise<string> {
  const openai = new OpenAI({ apiKey: requireSecret(useRuntimeConfig().openaiApiKey, 'OPENAI_API_KEY') })
  let lastError: unknown
  for (const model of IMAGE_MODELS) {
    try {
      const response = await openai.images.generate({
        model, prompt, n: 1, size: '1024x1536', quality, output_format: 'png',
      })
      const b64 = response.data?.[0]?.b64_json
      if (b64) return b64
    } catch (err) {
      lastError = err
    }
  }
  throw createError({
    statusCode: 502,
    statusMessage: lastError instanceof Error ? lastError.message : 'Aucune image rendue',
  })
}

/** Le nom d'une référence tel qu'on le tape après @ : sans accent, en minuscules. */
export const refName = (raw: string) => raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30)

/**
 * Veo part de l'image déjà peinte : le style est dans l'image, le prompt ne
 * dit que ce qui bouge, et rappelle de ne rien inventer d'autre.
 */
export function buildVideoPrompt(motion: string, sound: boolean): string {
  return `${motion.trim()}

Keep the exact look of the starting image: flat cel-shaded shapes, hard edges, no gradients, the same three colors (${D} shadow, ${S} surfaces, ${A} neon light). Slow, deliberate, film-noir movement. No text, no lettering, no logo appears at any time.${sound ? `
Sound: rain, the low hum of neon and a distant city. No dialogue, no music.` : ''}`
}

/** Ce que Claude doit savoir du jeu pour en parler. */
export const IG_BRIEF = `LE JEU : « La Nuit du Bout du Monde », jeu de rôle textuel conçu par Jordan Quiqueret, qui se joue dans le navigateur.
Une nuit dans une mégapole cyberpunk battue par la pluie, écrite pour un seul joueur. On remplit un formulaire d'admission au bureau des admissions ; la ville, ses habitants et sa quête naissent de ces réponses, illustrés scène après scène. On joue en tapant ce qu'on veut faire, comme dans les jeux d'aventure textuels des années 80.
Direction artistique : Dark Deco (Batman, la série animée des années 90) croisé avec Flashback (1992) — tours à gradins, néon rose magenta, ombres noires, pluie. Ton : film noir, mélancolique, intrigant, jamais criard.
Le lien vers le jeu est dans la bio du compte.`

/**
 * Le modèle qui écrit et regarde pour l'atelier. Il ne suit pas celui du jeu :
 * le jeu est revenu à gpt-4o, l'atelier parle à Claude.
 */
export const IG_TEXT_MODEL = 'claude-sonnet-5-5'

/** Toujours en tête : on n'ajoute plus que ceux du texte. */
export const IG_DEFAULT_HASHTAGS = ['textgame', 'divination', 'ecodata']

const now = () => new Date().toISOString()

function blankFraming() {
  return Object.fromEntries(FORMATS.map(f => [f.id, { ...DEFAULT_FRAMING }])) as InstagramPost['framing']
}

export function newPost(fields: Partial<InstagramPost> & Pick<InstagramPost, 'id' | 'title'>): InstagramPost {
  const at = now()
  return {
    kind: 'publication',
    format: '4x5',
    subject: '',
    notes: '',
    status: 'idee',
    scheduled_for: null,
    published_at: null,
    caption: '',
    hashtags: [...IG_DEFAULT_HASHTAGS],
    overlay: { hook: '', cta: '', position: 'bottom' },
    sources: [],
    source: null,
    framing: blankFraming(),
    renders: {},
    motion: '',
    videos: [],
    video: null,
    takes: {},
    refs: [],
    created_at: at,
    updated_at: at,
    ...fields,
  }
}

/** Un format qui ne va pas avec le type du post est remplacé par celui par défaut. */
export function settleFormat(post: InstagramPost): void {
  const allowed = formatsFor(post.kind)
  if (!allowed.includes(post.format)) post.format = allowed[0]!
}

/**
 * Les quatre premiers posts, faits à la main avant l'atelier, chacun en
 * publication (instagram/images/posts/) et en story (instagram/images/stories/).
 * Les autres images de ces dossiers n'entrent pas. Les fichiers restent où ils
 * sont, et le fichier exporté sert aussi de source au recadrage.
 */
const SEED_DIR = 'instagram/images'

async function seed(): Promise<InstagramPost[]> {
  const first: [string, string, string][] = [
    ['1-la-ville', 'La ville', 'View down a rain-soaked canyon of colossal stepped towers at night, endless verticals vanishing upward, a narrow footbridge crossing the void in the middle ground with one lone figure in a long coat walking across it, neon tubes running down the tower edges, a flying car silhouette between buildings, rain in straight hard streaks, the street far below glowing.'],
    ['2-l-oeil', 'L’œil', 'Close-up bust portrait in profile three-quarter view of an anonymous city dweller with a hard angular jaw, collar turned up, half the face swallowed by solid black shadow, one bionic eye implant glowing as a solid neon disc with concentric geometric rings, thin cable implants at the temple suggested by flat shapes, rain streaks on the window glass behind, flat city lights behind as geometric blocks.'],
    ['3-le-sas', 'Le sas', 'A massive armored blast door at the end of a wet concrete corridor, its frame built of stepped concentric layers, closed, a single card reader beside it glowing as a solid neon slot, a gloved hand in the foreground raising a blank access card toward it, pools of neon light on the wet floor, heavy pipes and cable bundles on the walls, deep perspective.'],
    ['4-insomnie', 'Insomnie', 'Inside a tiny bare apartment at three in the morning, a figure sitting awake on the edge of a narrow bed, seen from behind as a black silhouette, facing a tall window; outside, a wall of giant lit advertising screens and neon tubes on the facing tower floods the room with hard-edged shafts of neon light that cut the floor and the walls. The city never sleeps. Melancholic, quiet, lonely.'],
  ]
  const known = new Map(first.map(([file, title, subject]) => [file, { title, subject }]))
  const titleOf = (file: string) => known.get(file)!.title
  const filesIn = async (dir: string) => existsSync(communicationPath(`${SEED_DIR}/${dir}`))
    ? (await readdir(communicationPath(`${SEED_DIR}/${dir}`)))
        .filter(f => known.has(f.replace(/\.\w+$/, '')))
        .sort((a, b) => parseInt(a) - parseInt(b))
    : []

  const posts = (await filesIn('posts')).map((name) => {
    const file = name.replace(/\.\w+$/, '')
    const path = `${SEED_DIR}/posts/${name}`
    return newPost({
      id: file, title: titleOf(file), subject: known.get(file)!.subject, status: 'pret',
      format: '1x1', sources: [path], source: path, renders: { '1x1': path },
    })
  })
  const stories = (await filesIn('stories')).map((name) => {
    const file = name.replace(/\.\w+$/, '')
    const path = `${SEED_DIR}/stories/${name}`
    return newPost({
      id: `${file}-story`, title: `${titleOf(file)} — story`, subject: known.get(file)!.subject, status: 'pret',
      kind: 'story', format: '9x16', sources: [path], source: path, renders: { '9x16': path },
    })
  })
  return [...posts, ...stories]
}

export async function loadPosts(): Promise<InstagramPost[]> {
  if (!existsSync(STORE)) return seed()
  const data = JSON.parse(await readFile(STORE, 'utf-8'))
  // Un champ ajouté plus tard prend sa valeur par défaut sur les posts anciens.
  return (data.posts as InstagramPost[]).map(p => newPost({ ...p, framing: { ...blankFraming(), ...p.framing } }))
}

export async function savePosts(posts: InstagramPost[]): Promise<void> {
  await mkdir(dirname(STORE), { recursive: true })
  await writeFile(STORE, JSON.stringify({ posts }, null, 2) + '\n', 'utf-8')
}

/** Lit, modifie un post, réécrit. Rend le post à jour. */
export async function updatePost(
  id: string, change: (post: InstagramPost) => void | Promise<void>,
): Promise<InstagramPost> {
  const posts = await loadPosts()
  const post = posts.find(p => p.id === id)
  if (!post) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })
  await change(post)
  post.updated_at = now()
  await savePosts(posts)
  return post
}

/** Identifiant lisible, unique parmi les posts. */
export function slugFor(title: string, taken: string[]): string {
  const base = title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'post'
  let id = base
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`
  return id
}

/**
 * Un chemin relatif à `communication/`, vérifié : la page ne doit pouvoir
 * lire ou écrire nulle part ailleurs.
 */
export function communicationPath(rel: string): string {
  const abs = resolve(COMMUNICATION_DIR, normalize(rel))
  if (!abs.startsWith(COMMUNICATION_DIR + sep)) {
    throw createError({ statusCode: 400, statusMessage: 'Chemin hors de communication/' })
  }
  return abs
}

const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4' }
export const mimeOf = (path: string) => MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'

/** Écrit un data URI d'image ; rend le chemin relatif. */
export async function writeDataUri(rel: string, dataUri: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUri)
  if (!match) throw createError({ statusCode: 400, statusMessage: 'Image attendue en data URI (png, jpeg ou webp)' })
  const abs = communicationPath(rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, Buffer.from(match[2]!, 'base64'))
  return rel
}

export const isFormat = (id: string): id is FormatId => FORMATS.some(f => f.id === id)

/** Le premier objet JSON d'une réponse, même entourée de texte ou de ```json. */
export function parseJsonReply<T>(text: string): T {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw createError({ statusCode: 502, statusMessage: 'Réponse de Claude illisible' })
  return JSON.parse(text.slice(start, end + 1)) as T
}
