import OpenAI from 'openai'
import type { UserAgreement } from '~/types/user'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { pack, resolveLang } from '~/utils/languages'
import { needsLatinName } from '~/utils/numerology'

/**
 * Un avatar : une identité inventée, pour jouer sans rien donner de soi.
 *
 * La date et l'heure sont tirées ici : un modèle à qui l'on demande « une date
 * au hasard » rend toujours les mêmes. Il n'écrit que ce qu'un tirage ne sait
 * pas faire — un nom et une ville qui vont ensemble, dans la langue de la nuit,
 * accordés comme le joueur l'a choisi. Il en propose six et on en garde une :
 * seul, il rendrait le même prénom à tout le monde.
 *
 * Rien du joueur ne part : la langue et l'accord sont des réglages.
 */
const MODEL = 'gpt-4o-mini'

const PERSON: Record<UserAgreement, string> = {
  masculin: 'un homme',
  feminin: 'une femme',
  neutre: 'une personne au prénom épicène',
}

interface Identity {
  first_name?: unknown
  last_name?: unknown
  first_name_latin?: unknown
  last_name_latin?: unknown
  city?: unknown
}

const pick = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1))
const pad = (n: number) => String(n).padStart(2, '0')
const text = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : '')

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<{ lang?: string; agreement?: UserAgreement }>(event)
  const lang = resolveLang(body?.lang)
  const agreement: UserAgreement = body?.agreement && body.agreement in PERSON ? body.agreement : 'masculin'
  const language = pack(lang).generation.name_fr

  // Entre 19 et 60 ans, n'importe quel jour : Date se charge des fins de mois.
  const year = new Date().getUTCFullYear() - pick(19, 60)
  const birthday = new Date(Date.UTC(year, 0, pick(1, 365))).toISOString().slice(0, 10)
  const birthTime = `${pad(pick(0, 23))}:${pad(pick(0, 59))}`

  const prompt = `Invente six identités fictives pour ${PERSON[agreement]} né en ${year}, `
    + `chacune dans une ville différente d'un pays où l'on parle ${language}. `
    + 'Varie les régions, les milieux et les sonorités ; aucun des prénoms les plus donnés cette année-là.\n'
    + `Pour chacune : prénom et nom tels qu'on les écrit en ${language}, leur forme en lettres latines, `
    + `et une vraie ville de naissance, écrite en ${language}.\n`
    + 'Réponds en JSON : {"identities":[{"first_name":"","last_name":"","first_name_latin":"","last_name_latin":"","city":""}]}'

  const openai = new OpenAI({ apiKey: requireSecret(config.openaiApiKey, 'OPENAI_API_KEY') })
  let identities: Identity[] = []
  try {
    const res = await openai.chat.completions.create({
      model: MODEL,
      temperature: 1,
      max_tokens: 500,
      seed: pick(0, 2 ** 31),
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    })
    const parsed = JSON.parse(res.choices[0]?.message?.content || '{}')
    if (Array.isArray(parsed?.identities)) identities = parsed.identities
  } catch (err) {
    const status = err instanceof OpenAI.APIError ? err.status : undefined
    console.error(`[user/avatar] ${MODEL} a refusé l'avatar (${status ?? '?'}) :`,
      err instanceof Error ? err.message : err)
  }

  const usable = identities.filter(i => text(i?.first_name) && text(i?.city))
  const chosen = usable[pick(0, usable.length - 1)]
  if (!chosen) throw createError({ statusCode: 503, statusMessage: 'Aucun avatar disponible' })

  const firstName = text(chosen.first_name)
  const lastName = text(chosen.last_name)
  return {
    firstName,
    lastName,
    // La forme latine ne sert que si l'écriture du nom ne se pèse pas.
    firstNameLatin: needsLatinName(firstName) ? text(chosen.first_name_latin) : '',
    lastNameLatin: needsLatinName(lastName) ? text(chosen.last_name_latin) : '',
    birthday,
    birthTime,
    hometown: text(chosen.city),
  }
})
