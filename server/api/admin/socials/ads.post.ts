/**
 * Les pubs des posts depuis /nimda/socials (voir server/socials/ads.ts).
 * `{ action: 'promote', network, post, excerpt, budget, days, audience,
 * countries, ageMin, ageMax, placements, link }` crée une promotion en pause
 * (`audience` : une audience enregistrée, sinon les pays et l'âge) ;
 * `{ action: 'status', campaign, status }` la lance (ACTIVE) ou la met en
 * pause (PAUSED). On vérifie tout ici avant d'écrire chez Meta.
 */
import type { Placement } from '../../../socials/ads'
import { promote, setStatus } from '../../../socials/ads'
import { bad } from '../../../socials/common'

const PLACEMENTS: Placement[] = ['instagram', 'facebook', 'both']

export default defineEventHandler(async (event) => {
  const b = await readBody<Record<string, unknown>>(event).catch(() => null)

  if (b?.action === 'status') {
    const campaign = String(b.campaign ?? '')
    if (!/^\d+$/.test(campaign)) throw bad('campagne illisible')
    if (b.status !== 'ACTIVE' && b.status !== 'PAUSED') throw bad('état inconnu')
    await setStatus(campaign, b.status)
    return { ok: true }
  }
  if (b?.action !== 'promote') throw bad('action inconnue')

  const network = b.network
  if (network !== 'instagram' && network !== 'facebook') throw bad('pubs Meta : Instagram ou Facebook seulement')
  const postId = String(b.post ?? '')
  // Un média Instagram est un nombre ; un post Facebook, « page_post ».
  if (!(network === 'instagram' ? /^\d+$/ : /^\d+_\d+$/).test(postId)) throw bad('post illisible')
  const budget = Number(b.budget)
  const days = Number(b.days)
  const ageMin = Number(b.ageMin)
  const ageMax = Number(b.ageMax)
  // Le plafond attrape une faute de frappe ; le compte a de toute façon son spend_cap.
  if (!(budget >= 1 && budget <= 500)) throw bad('budget : de 1 à 500')
  if (!Number.isInteger(days) || days < 1 || days > 30) throw bad('durée : de 1 à 30 jours')
  const audience = b.audience ? String(b.audience) : null
  const countries = Array.isArray(b.countries) ? b.countries.map(c => String(c).trim().toUpperCase()).filter(Boolean) : []
  // Une audience enregistrée apporte ses lieux et ses âges ; sinon il faut ceux du formulaire.
  if (audience) {
    if (!/^\d+$/.test(audience)) throw bad('audience illisible')
  } else {
    if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) throw bad('âge : de 18 à 65')
    if (!countries.length || countries.length > 25 || countries.some(c => !/^[A-Z]{2}$/.test(c))) throw bad('pays : codes à deux lettres (FR, BE…), 25 au plus')
  }
  const placements = b.placements as Placement
  if (!PLACEMENTS.includes(placements)) throw bad('emplacements inconnus')
  // « farnight.online » tout court suffit : on complète l'adresse. Le `?c=` reste facultatif.
  let link: URL
  try {
    const raw = String(b.link ?? '').trim()
    link = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw bad('lien illisible')
  }
  if (link.hostname.replace(/^www\./, '') !== 'farnight.online') throw bad('le lien doit mener à farnight.online')
  link.protocol = 'https:'
  const tag = link.searchParams.get('c')
  if (tag !== null && !/^[a-z0-9-]{1,16}$/i.test(tag)) throw bad('étiquette ?c= : lettres, chiffres et tirets, 16 au plus')

  return promote({ network, post: postId, excerpt: String(b.excerpt ?? '').slice(0, 90), budget, days, audience, countries, ageMin, ageMax, placements, link: link.href })
})
