/**
 * Une notification sur le téléphone, par ntfy (https://ntfy.sh) : paywall
 * ouvert, paiement accepté, carte refusée, code VIP utilisé.
 *
 * Le sujet `NTFY_TOPIC` ne vit que dans les variables de Vercel : il tient
 * lieu de mot de passe (qui le connaît lit les notifications), et son absence
 * en local évite que les essais sur ce poste sonnent.
 *
 * Une notification ne gêne jamais un paiement : sans sujet rien ne part, un
 * échec est seulement journalisé, et la promesse ne rejette jamais. Les routes
 * l'attendent en même temps que leur appel à Stripe : sur Vercel, ce qui reste
 * en vol après la réponse peut être coupé.
 */
export function notifyPhone(n: { title: string; message: string; tags: string[]; priority?: number; click?: string }): Promise<void> {
  const topic = process.env.NTFY_TOPIC?.trim()
  if (!topic) return Promise.resolve()
  return $fetch('https://ntfy.sh', { method: 'POST', body: { topic, priority: 3, ...n }, timeout: 2500 })
    .then(() => {}, (e: Error) => console.warn('[notify] ntfy injoignable :', e.message))
}

export const price = (cents: number, currency: string) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/** Le paiement dans le tableau de bord Stripe, ouvert d'une touche sur la notification. */
export const stripePaymentUrl = (id: string, livemode: boolean) =>
  `https://dashboard.stripe.com/${livemode ? '' : 'test/'}payments/${id}`
