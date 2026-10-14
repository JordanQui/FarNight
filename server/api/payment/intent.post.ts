import { ScriptRuntime } from '~/utils/script-runtime'
import { assertNotLocked } from '~/server/utils/session-quota'
import { stripeClient, stripePublishableKey } from '~/server/utils/stripe'

/**
 * Ouvre un PaymentIntent Stripe au prix du script. Son `client_secret` laisse
 * le navigateur monter le formulaire et confirmer le paiement lui-même.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ product?: string }>(event).catch(() => null)
  // Le PDF de la nuit, vendu sur l'écran de fin : il n'ouvre aucun accès.
  const keepsake = body?.product === 'keepsake'

  /**
   * On ne vend pas une porte fermée.
   *
   * La fenêtre payante court à partir du paiement, pas de la première scène :
   * payer pendant les 24 h de fermeture reviendrait à acheter huit jours dont
   * le premier est déjà perdu. Et après l'épilogue, ce serait payer pour une
   * histoire qui ne se rejoue pas. Le PDF, lui, se vend justement là.
   */
  if (!keepsake) assertNotLocked(event)

  const runtime = await ScriptRuntime.load()
  const paywall = runtime.paywall

  // Rien qui renvoie hors de la page : le jeu ne saurait pas y revenir.
  const intent = await stripeClient().paymentIntents.create({
    amount: keepsake ? paywall.keepsake_cents : paywall.amount_cents,
    currency: paywall.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    // 3-D Secure toujours : sans lui, Radar jugeait seules les cartes de débit
    // (CIC, néobanques…) et les bloquait « highest risk » avant même la banque.
    // Authentifiées, elles passent, et la responsabilité d'une fraude bascule.
    payment_method_options: { card: { request_three_d_secure: 'any' } },
    description: keepsake ? 'PDF de la nuit' : paywall.cta,
    ...(keepsake ? { metadata: { product: 'keepsake' } } : {}),
  })

  return {
    publishableKey: stripePublishableKey(),
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
  }
})
