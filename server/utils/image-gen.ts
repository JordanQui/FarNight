import { createHash } from 'node:crypto'
import OpenAI from 'openai'
import type { ArtDirection } from '~/types/script'

export interface ImageResult {
  /** Data URI prêt à poser dans un <img src>. */
  image: string
  model: string
  format: string
  bytes: number
  elapsed_ms: number
}

/**
 * Cache d'images, indexé par empreinte du prompt.
 *
 * Une image coûte ~0,07 USD, contre 0,028 pour tout le texte d'une scène :
 * c'est le poste dominant, et régénérer deux fois le même prompt est la
 * dépense la plus facile à éviter.
 *
 * Le cache vit dans la mémoire du processus. En développement il tient toute
 * la session ; sur Vercel il ne survit pas à un démarrage à froid et n'est pas
 * partagé entre lambdas — il attrape donc les répétitions rapprochées (renvoi,
 * remontage de composant, deux joueurs sur la même lambda), pas les reprises à
 * distance. Un cache durable demanderait un stockage partagé.
 */
const CACHE_MAX = 50
const imageCache = new Map<string, ImageResult>()

function cacheKey(model: string, prompt: string, size: string): string {
  return createHash('sha256').update(`${model}|${size}|${prompt}`).digest('hex')
}

function remember(key: string, result: ImageResult): void {
  // Map conserve l'ordre d'insertion : la plus ancienne entrée sort en premier.
  if (imageCache.size >= CACHE_MAX) {
    const oldest = imageCache.keys().next().value
    if (oldest) imageCache.delete(oldest)
  }
  imageCache.set(key, result)
}

/**
 * Images coupées en développement.
 *
 * Chaque rechargement régénère la scène, et l'image est le poste le plus cher :
 * une journée de mise au point en brûlait des dizaines. En dev, on rend donc un
 * aplat sombre aux bonnes proportions au lieu d'appeler OpenAI. Pour retrouver
 * les vraies images : `DEV_IMAGES=1` dans le .env.
 *
 * La production suit le même régime le temps du développement : coupée tant
 * que `PROD_IMAGES=1` n'est pas posé sur Vercel (valeur lue au build).
 */
function imagesBlocked(): boolean {
  if (import.meta.dev) return process.env.DEV_IMAGES !== '1'
  return useRuntimeConfig().imagesOff
}

function placeholder(size: string): ImageResult {
  const [w, h] = size.split('x').map(n => Number(n) || 1024)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">`
    + `<stop offset="0" stop-color="#0b0d14"/><stop offset="1" stop-color="#1a1424"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/>`
    + `<text x="50%" y="50%" fill="#3a3550" font-family="monospace" font-size="${Math.round(w / 40)}" text-anchor="middle">IMAGE COUPÉE · DÉVELOPPEMENT</text>`
    + `</svg>`
  return {
    image: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    model: 'dev-placeholder',
    format: 'svg',
    bytes: svg.length,
    elapsed_ms: 0,
  }
}

/**
 * Génère une image via la famille gpt-image-*.
 *
 * Deux différences majeures avec dall-e-3, qui n'est plus servi :
 *  - la réponse ne contient QUE du base64, jamais d'URL (donc rien n'expire) ;
 *  - le paramètre `style` n'existe plus et fait échouer la requête.
 *
 * Bascule sur le modèle de repli si le principal est indisponible.
 */
export async function generateImage(
  openai: OpenAI,
  artDirection: Pick<
    ArtDirection,
    'image_model' | 'image_fallback_model' | 'image_size' | 'image_quality' | 'image_format'
  >,
  prompt: string
): Promise<ImageResult> {
  if (imagesBlocked()) return placeholder(artDirection.image_size)

  const models = [artDirection.image_model, artDirection.image_fallback_model].filter(Boolean)
  let lastError: unknown

  for (const model of models) {
    const key = cacheKey(model, prompt, artDirection.image_size)
    const cached = imageCache.get(key)
    if (cached) return { ...cached, elapsed_ms: 0 }

    const startedAt = Date.now()
    try {
      const response = await openai.images.generate({
        model,
        prompt,
        n: 1,
        size: artDirection.image_size as '1024x1024',
        quality: artDirection.image_quality as 'low',
        output_format: artDirection.image_format as 'webp',
      })

      const b64 = response.data?.[0]?.b64_json
      if (!b64) {
        lastError = new Error(`${model} n'a renvoyé aucune image`)
        continue
      }

      const result: ImageResult = {
        image: `data:image/${artDirection.image_format};base64,${b64}`,
        model,
        format: artDirection.image_format,
        bytes: Math.round(b64.length * 0.75),
        elapsed_ms: Date.now() - startedAt,
      }
      remember(key, result)
      return result
    } catch (err) {
      lastError = err
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Génération d\'image impossible')
}
