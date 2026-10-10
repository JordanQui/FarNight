import Anthropic from '@anthropic-ai/sdk'
import type { PostIdea } from '~/types/instagram'
import { ScriptRuntime } from '~/utils/script-runtime'

/**
 * Des idées de posts, à partir du jeu et de ce qui est déjà publié.
 *
 * Les titres des actes et des scènes servent de matière, jamais les secrets
 * d'une partie : il s'agit de donner envie d'entrer, pas de raconter la nuit.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ direction?: string; count?: number }>(event)
  const count = Math.min(Math.max(Number(body?.count) || 6, 1), 12)

  const posts = await loadPosts()
  const { script } = await ScriptRuntime.load()
  const places = script.acts.map(a => a.title).join(', ')
  const done = posts.map(p => `— ${p.title}${p.subject ? ` : ${p.subject.slice(0, 140)}…` : ''}`).join('\n')

  const prompt = `${IG_BRIEF}

Les actes de la nuit : ${places}.

POSTS DÉJÀ FAITS OU PRÉVUS — ne les refais pas, cherche d'autres angles :
${done || '(aucun)'}
${body?.direction ? `\nCONSIGNE DE L'AUTEUR : ${body.direction}` : ''}

Propose ${count} idées de posts Instagram pour faire connaître le jeu. Chaque post est UNE image illustrée dans le style du jeu, sans aucun texte dans l'image. Varie : lieux de la mégapole, personnages anonymes, objets, moments, ambiances, ce que vit le joueur. Rien qui dévoile une solution ou une fin.

Pour chacune :
- "title" : un titre court en français (1 à 3 mots), qui sert aussi de nom de fichier ;
- "subject" : la consigne pour le peintre, EN ANGLAIS, 2 à 4 phrases concrètes — décor, cadrage, une figure ou un objet focal, où tombe la lumière néon. Ne parle ni de style ni de couleurs : ils sont ajoutés à part ;
- "angle" : en français, une phrase sur ce que le post raconte du jeu et pourquoi il accroche.

Réponds uniquement en JSON : {"ideas": [{"title": "...", "subject": "...", "angle": "..."}]}`

  const config = useRuntimeConfig()
  const claude = new Anthropic({ apiKey: requireSecret(config.anthropicApiKey, 'ANTHROPIC_API_KEY') })
  const message = await claude.messages.create({
    model: script.defaults.generation.model,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }],
  })
  const text = message.content.map(b => (b.type === 'text' ? b.text : '')).join('')
  const { ideas } = parseJsonReply<{ ideas: PostIdea[] }>(text)
  return { ideas: (ideas ?? []).filter(i => i?.title && i?.subject) }
})
