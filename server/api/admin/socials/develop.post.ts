import Anthropic from '@anthropic-ai/sdk'
import { network } from '../../../socials'
import { bad, failure } from '../../../socials/common'
import { developPrompt } from '../../../socials/develop'

/**
 * « Développer » : le texte du champ devient un post fini pour le réseau et
 * le format choisis (le prompt est dans server/socials/develop.ts). Claude
 * voit jusqu'à quatre images du brouillon, réduites par la page en JPEG
 * (une vidéo par sa première image). Le modèle est celui de l'atelier
 * Instagram, IG_TEXT_MODEL. Rien n'est enregistré : la page remplace le champ
 * et garde l'ancien texte pour « Annuler ». Avec `fix`, c'est « Corriger » :
 * le texte est déjà un post, `fix` la consigne (vide = relecture).
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ network?: string; format?: string; text?: string; title?: string; media?: unknown[]; images?: unknown[]; fix?: unknown }>(event)
  const n = network(body?.network)
  const format = n.formats.find(f => f.id === body?.format)
  if (!format?.text) throw bad(`${n.label} : ce format n’a pas de texte à développer`)
  const text = String(body?.text ?? '').trim()
  if (!text) throw bad('Écrire d’abord quelques mots : ils servent de consigne')
  const title = String(body?.title ?? '').trim()
  const media = (body?.media ?? []).filter((m): m is string => m === 'image' || m === 'video')
  const images = (body?.images ?? []).filter((i): i is string => typeof i === 'string' && i.length < 3_000_000).slice(0, 4)
  const fix = typeof body?.fix === 'string' ? body.fix.trim() : undefined

  const content: Anthropic.ContentBlockParam[] = images.map(data => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }))
  content.push({ type: 'text', text: developPrompt({ networkId: n.id, network: n.label, format, text, title, media, images: images.length, fix }) })

  const claude = new Anthropic({ apiKey: requireSecret(useRuntimeConfig().anthropicApiKey, 'ANTHROPIC_API_KEY') })
  let reply: { text?: string; title?: string }
  try {
    const message = await claude.messages.create({ model: IG_TEXT_MODEL, max_tokens: 4000, messages: [{ role: 'user', content }] })
    reply = parseJsonReply(message.content.map(b => (b.type === 'text' ? b.text : '')).join(''))
  } catch (e) {
    throw createError({ statusCode: 502, statusMessage: `Claude : ${failure(e)}` })
  }
  const developed = String(reply.text ?? '').trim()
  if (!developed) throw createError({ statusCode: 502, statusMessage: 'Claude : réponse vide' })
  return {
    text: developed,
    title: format.title && !title ? String(reply.title ?? '').trim().slice(0, format.title.max) || null : null,
  }
})
