import { stripeClient } from '~/server/utils/stripe'

/**
 * Les données de la page de suivi des paiements.
 *
 * Stripe n'expose pas ses journaux de requêtes par l'API : le compte exact,
 * lectures de Stripe.js comprises, ne se lit que dans Workbench → Logs. Ce qui
 * suit est RECONSTITUÉ depuis les objets que nos requêtes laissent derrière
 * elles, sur les 30 jours où Stripe garde ses événements :
 *  - chaque PaymentIntent est le POST de /api/payment/intent ;
 *  - chaque accès ouvert (`metadata.granted_at`) est le GET puis le POST de
 *    /api/payment/confirm, que le navigateur n'appelle qu'après un paiement
 *    accepté ;
 *  - chaque requête du navigateur qui a changé un paiement laisse son
 *    identifiant sur les événements qu'elle a produits.
 *
 * L'accès est fermé par server/middleware/admin-guard.ts. Chaque chargement
 * fait lui-même trois lectures par centaine d'objets.
 */
const DAYS = 30
const CAP = 5000

const day = (unix: number) => new Date(unix * 1000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' })

export default defineEventHandler(async (event) => {
  const stripe = stripeClient()
  // La page de suivi impose son point de départ (`?since=`, ISO).
  const since = getQuery(event).since
  const created = { gte: since ? Math.floor(new Date(String(since)).getTime() / 1000) : Math.floor(Date.now() / 1000) - DAYS * 86400 }

  const [intents, events, charges] = await Promise.all([
    stripe.paymentIntents.list({ created, limit: 100 }).autoPagingToArray({ limit: CAP }),
    stripe.events.list({ created, type: 'payment_intent.*', limit: 100 }).autoPagingToArray({ limit: CAP }),
    stripe.charges.list({ created, limit: 100 }).autoPagingToArray({ limit: CAP }),
  ])

  // Une requête du navigateur se reconnaît à son identifiant : ni celui qui a
  // créé l'intent (notre serveur), ni aucun (Stripe agissant seul).
  const creations = new Set(events.filter(e => e.type === 'payment_intent.created').map(e => e.request?.id))
  const browser = new Set(events.map(e => e.request?.id).filter(id => id && !creations.has(id)))

  const daily = new Map<string, { day: string; intents: number; granted: number; succeeded: number; failed: number }>()
  const on = (unix: number) => {
    const d = day(unix)
    if (!daily.has(d)) daily.set(d, { day: d, intents: 0, granted: 0, succeeded: 0, failed: 0 })
    return daily.get(d)!
  }

  const statuses: Record<string, number> = {}
  for (const pi of intents) {
    statuses[pi.status] = (statuses[pi.status] ?? 0) + 1
    on(pi.created).intents++
    if (pi.metadata.granted_at) on(pi.created).granted++
  }

  const refusals: Record<string, number> = {}
  for (const ch of charges) {
    if (ch.status === 'succeeded') on(ch.created).succeeded++
    if (ch.status !== 'failed') continue
    on(ch.created).failed++
    const reason = [ch.outcome?.type, ch.outcome?.reason ?? ch.failure_code].filter(Boolean).join(' · ') || 'inconnu'
    refusals[reason] = (refusals[reason] ?? 0) + 1
  }

  const granted = intents.filter(pi => pi.metadata.granted_at).length

  return {
    days: DAYS,
    livemode: intents[0]?.livemode ?? events[0]?.livemode ?? null,
    truncated: [intents, events, charges].some(list => list.length >= CAP),
    server: { creates: intents.length, retrieves: granted, updates: granted },
    /** Encaissé sur la période, remboursements non déduits. */
    revenue: intents.filter(pi => pi.status === 'succeeded').reduce((sum, pi) => sum + pi.amount_received, 0),
    browser: browser.size,
    statuses,
    charges: {
      total: charges.length,
      succeeded: charges.filter(ch => ch.status === 'succeeded').length,
      failed: charges.filter(ch => ch.status === 'failed').length,
    },
    refusals: Object.entries(refusals).map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    daily: [...daily.values()].sort((a, b) => b.day.localeCompare(a.day)),
    recent: intents.slice(0, 25).map(pi => ({
      id: pi.id,
      created: pi.created,
      status: pi.status,
      amount: pi.amount,
      currency: pi.currency,
      granted: Boolean(pi.metadata.granted_at),
      error: pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? null,
    })),
  }
})
