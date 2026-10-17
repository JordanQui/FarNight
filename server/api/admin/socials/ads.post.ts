/**
 * Les pubs des posts depuis /nimda/socials (voir server/socials/ads.ts).
 * `{ action: 'promote', network, post, excerpt, budget, days, audience,
 * placements, link }` crée une promotion en pause (`audience` : une audience
 * enregistrée ou un groupe) ;
 * `{ action: 'status', campaign, status }` la lance (ACTIVE) ou la met en
 * pause (PAUSED) ;
 * `{ action: 'group', name, id?, …ciblage }` range un groupe de cibles
 * (avec `id`, le modifie),
 * `{ action: 'ungroup', id }` le retire, `{ action: 'estimate', …ciblage }`
 * demande à Meta combien de personnes il touche ;
 * `{ action: 'cap', amount }` fixe le plafond du compte (null le retire).
 * On vérifie tout ici avant d'écrire chez Meta.
 */
import type { Aim, Place, Placement } from '../../../socials/ads'
import { GEO, dropGroup, estimate, promote, saveGroup, setCap, setStatus } from '../../../socials/ads'
import { bad } from '../../../socials/common'

const PLACEMENTS: Placement[] = ['instagram', 'facebook', 'both']

/** Un lieu du formulaire : un type que la page sait écrire, et un rayon dans les bornes de Meta (sous elles, il compte 0 personne). */
function place(raw: unknown): Place {
  const p = (raw ?? {}) as Record<string, unknown>
  const type = String(p.type ?? '')
  const name = String(p.name ?? '').slice(0, 160)
  if (!GEO[type]) throw bad(`lieu d’un type inconnu : ${type || '?'}`)
  const radius = p.radius === undefined || p.radius === null || p.radius === '' ? undefined : Number(p.radius)
  if (type === 'pin') {
    const lat = Number(p.lat)
    const lng = Number(p.lng)
    if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) throw bad(`point illisible : ${name}`)
    if (!(radius! >= 1 && radius! <= 80)) throw bad(`rayon autour de « ${name} » : de 1 à 80 km`)
    return { type, key: `${lat},${lng}`, name, lat, lng, radius }
  }
  const key = String(p.key ?? '')
  if (!/^[\w:.-]{1,60}$/.test(key)) throw bad(`lieu illisible : ${name}`)
  if (radius !== undefined && (type !== 'city' || !(radius >= 17 && radius <= 80))) throw bad(`rayon autour de « ${name} » : de 17 à 80 km, et seulement autour d’une ville`)
  const country = /^[A-Z]{2}$/.test(String(p.country)) ? String(p.country) : undefined
  const region = /^\d+$/.test(String(p.region)) ? String(p.region) : undefined
  return { type, key, name, country, region, radius }
}

/** Le ciblage du formulaire : lieux visés et exclus, âge, sexe, intérêts. */
function aim(b: Record<string, unknown>): Aim {
  const ageMin = Number(b.ageMin)
  const ageMax = Number(b.ageMax)
  const places = Array.isArray(b.places) ? b.places.map(place) : []
  const excluded = Array.isArray(b.excluded) ? b.excluded.map(place) : []
  const genders = Array.isArray(b.genders) ? b.genders.map(Number) : []
  const interests = Array.isArray(b.interests)
    ? b.interests.map(i => ({ id: String((i as { id?: unknown }).id ?? ''), name: String((i as { name?: unknown }).name ?? '').slice(0, 120) }))
    : []
  if (!Number.isInteger(ageMin) || !Number.isInteger(ageMax) || ageMin < 18 || ageMax > 65 || ageMin > ageMax) throw bad('âge : de 18 à 65')
  if (!places.length) throw bad('lieux : au moins un')
  if (places.length + excluded.length > 200) throw bad('lieux : 200 au plus')
  if (genders.length > 1 || genders.some(g => g !== 1 && g !== 2)) throw bad('sexe inconnu')
  if (interests.length > 25 || interests.some(i => !/^\d+$/.test(i.id))) throw bad('intérêts illisibles, 25 au plus')
  return { places, excluded, ageMin, ageMax, genders, interests }
}

export default defineEventHandler(async (event) => {
  const b = await readBody<Record<string, unknown>>(event).catch(() => null)

  if (b?.action === 'status') {
    const campaign = String(b.campaign ?? '')
    if (!/^\d+$/.test(campaign)) throw bad('campagne illisible')
    if (b.status !== 'ACTIVE' && b.status !== 'PAUSED') throw bad('état inconnu')
    await setStatus(campaign, b.status)
    return { ok: true }
  }
  if (b?.action === 'group') {
    const name = String(b.name ?? '').trim()
    if (!name || name.length > 60) throw bad('nom du groupe : de 1 à 60 signes')
    const id = b.id ? String(b.id) : undefined
    if (id && !/^g\d+$/.test(id)) throw bad('groupe illisible')
    return saveGroup(name, aim(b), id)
  }
  if (b?.action === 'ungroup') {
    const id = String(b.id ?? '')
    if (!/^g\d+$/.test(id)) throw bad('groupe illisible')
    await dropGroup(id)
    return { ok: true }
  }
  if (b?.action === 'estimate') return estimate(aim(b))
  if (b?.action === 'cap') {
    const amount = b.amount == null ? null : Number(b.amount)
    // Comme le budget d'une pub : le plafond attrape une faute de frappe.
    if (amount !== null && !(amount >= 1 && amount <= 5000)) throw bad('plafond : de 1 à 5 000')
    await setCap(amount)
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
  // Le plafond attrape une faute de frappe ; le compte a de toute façon son spend_cap.
  if (!(budget >= 1 && budget <= 500)) throw bad('budget : de 1 à 500')
  if (!Number.isInteger(days) || days < 1 || days > 30) throw bad('durée : de 1 à 30 jours')
  // Le ciblage se compose dans les groupes de cibles : la pub n'en reçoit que le nom.
  const audience = String(b.audience ?? '')
  if (!/^g?\d+$/.test(audience)) throw bad('audience : choisir un groupe ou une audience')
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

  return promote({ network, post: postId, excerpt: String(b.excerpt ?? '').slice(0, 90), budget, days, audience, placements, link: link.href })
})
