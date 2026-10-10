import Anthropic from '@anthropic-ai/sdk'
import { readFile } from 'node:fs/promises'
import { ScriptRuntime } from '~/utils/script-runtime'

/**
 * La légende, le texte alternatif et les hashtags, écrits par Claude.
 *
 * Claude VOIT l'image (le 4:5 s'il existe, sinon la source) : une légende
 * écrite d'après le seul sujet décrirait ce qu'on a demandé, pas ce qui a été
 * peint. Les légendes déjà écrites l'accompagnent, pour qu'il ne se répète pas.
 */
interface Reply { caption: string; hashtags: string[]; alt: string }

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')!
  const body = await readBody<{ direction?: string }>(event)

  const posts = await loadPosts()
  const post = posts.find(p => p.id === id)
  if (!post) throw createError({ statusCode: 404, statusMessage: `Post inconnu : ${id}` })

  const content: Anthropic.ContentBlockParam[] = []
  const imagePath = post.renders['4x5'] ?? post.source
  if (imagePath) {
    const mime = mimeOf(imagePath)
    if (mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp') {
      const data = (await readFile(communicationPath(imagePath))).toString('base64')
      content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } })
    }
  }

  const others = posts
    .filter(p => p.id !== id && p.caption)
    .slice(0, 8)
    .map(p => `— ${p.caption.split('\n')[0]}`)
    .join('\n')

  content.push({
    type: 'text',
    text: `${IG_BRIEF}

LE POST : « ${post.title} »
${post.subject ? `Ce que montre l'image (consigne donnée au peintre, en anglais) : ${post.subject}` : ''}
${post.notes ? `Notes de l'auteur : ${post.notes}` : ''}
${body?.direction ? `Consigne pour cette légende : ${body.direction}` : ''}
${others ? `\nPremières lignes des légendes déjà écrites — ne les répète pas, varie l'accroche :\n${others}` : ''}

Écris pour Instagram, en français :
- "caption" : une légende de 3 à 6 lignes courtes. La première ligne est une accroche qui donne envie d'ouvrir (elle seule s'affiche avant « … plus »). Le ton est celui d'un film noir : sobre, évocateur, à la deuxième personne si ça sert. Termine par un appel à jouer qui renvoie au lien en bio. Deux emoji au plus, aucun hashtag dans la légende.
- "hashtags" : 10 à 15 hashtags sans le #, du plus précis au plus large, mêlant français et anglais (jeu narratif, cyberpunk, art, indé…).
- "alt" : le texte alternatif de l'image, une ou deux phrases factuelles qui décrivent ce qu'on voit, pour un lecteur d'écran.

Réponds uniquement en JSON : {"caption": "...", "hashtags": ["..."], "alt": "..."}`,
  })

  const config = useRuntimeConfig()
  const claude = new Anthropic({ apiKey: requireSecret(config.anthropicApiKey, 'ANTHROPIC_API_KEY') })
  const { script } = await ScriptRuntime.load()
  const message = await claude.messages.create({
    model: script.defaults.generation.model,
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  })
  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const reply = parseJsonReply<Reply>(text)

  return updatePost(id, (p) => {
    p.caption = String(reply.caption ?? '').trim()
    p.hashtags = (reply.hashtags ?? []).map(h => String(h).replace(/^#/, '').trim()).filter(Boolean)
    p.alt = String(reply.alt ?? '').trim()
    if (p.status === 'brouillon' && Object.keys(p.renders).length) p.status = 'pret'
  })
})
