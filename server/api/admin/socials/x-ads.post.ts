/**
 * Les promotions X des posts depuis /nimda/socials (voir server/socials/x-ads.ts).
 * `{ action: 'promote', post, excerpt, budget, days, places, age, gender }`
 * crée une promotion en pause ;
 * `{ action: 'status', campaign, status }` la lance (ACTIVE) ou la met en
 * pause (PAUSED).
 * On vérifie tout ici avant d'écrire chez X.
 */
import { bad } from '../../../socials/common'
import { AGES, xPromote, xSetStatus } from '../../../socials/x-ads'

export default defineEventHandler(async (event) => {
  const b = await readBody<Record<string, unknown>>(event).catch(() => null)

  if (b?.action === 'status') {
    const campaign = String(b.campaign ?? '')
    // Les identifiants de l'Ads API sont des mots courts en base 36.
    if (!/^[a-z0-9]{1,20}$/.test(campaign)) throw bad('campagne illisible')
    if (b.status !== 'ACTIVE' && b.status !== 'PAUSED') throw bad('état inconnu')
    await xSetStatus(campaign, b.status)
    return { ok: true }
  }
  if (b?.action !== 'promote') throw bad('action inconnue')

  const post = String(b.post ?? '')
  if (!/^\d{1,25}$/.test(post)) throw bad('post illisible')
  const budget = Number(b.budget)
  const days = Number(b.days)
  // Le plafond attrape une faute de frappe, comme chez Meta.
  if (!(budget >= 1 && budget <= 500)) throw bad('budget : de 1 à 500')
  if (!Number.isInteger(days) || days < 1 || days > 30) throw bad('durée : de 1 à 30 jours')
  const places = Array.isArray(b.places) ? b.places.map(String) : []
  // Sans lieu, X vise le monde entier : on en exige un.
  if (!places.length) throw bad('lieux : au moins un')
  if (places.length > 100 || places.some(p => !/^[\w-]{1,40}$/.test(p))) throw bad('lieux illisibles, 100 au plus')
  const age = String(b.age ?? '')
  if (age && !AGES.includes(age)) throw bad('tranche d’âge inconnue')
  const gender = String(b.gender ?? '')
  if (gender && gender !== '1' && gender !== '2') throw bad('sexe inconnu')

  return xPromote({ post, excerpt: String(b.excerpt ?? '').slice(0, 90), budget, days, places, age, gender })
})
