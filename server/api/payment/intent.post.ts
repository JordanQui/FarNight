import { ScriptRuntime } from '~/utils/script-runtime'
import { assertNotLocked } from '~/server/utils/session-quota'
import { stripeClient, stripePublishableKey } from '~/server/utils/stripe'

/**
 * Ouvre un PaymentIntent Stripe au prix du script. Son `client_secret` laisse
 * le navigateur monter le formulaire et confirmer le paiement lui-même.
 */
export default defineEventHandler(async (event) => {
  await readBody(event).catch(() => null)

  /**
   * On ne vend pas une porte fermée.
   *
   * La fenêtre payante court à partir du paiement, pas de la première scène :
   * payer pendant les 24 h de fermeture reviendrait à acheter huit jours dont
   * le premier est déjà perdu. Et après l'épilogue, ce serait payer pour une
   * histoire qui ne se rejoue pas.
   */
  assertNotLocked(event)

  const runtime = await ScriptRuntime.load()
  const paywall = runtime.paywall

  // Rien qui renvoie hors de la page : le jeu ne saurait pas y revenir.
  const intent = await stripeClient().paymentIntents.create({
    amount: paywall.amount_cents,
    currency: paywall.currency.toLowerCase(),
    automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
    description: paywall.cta,
  })

  return {
    publishableKey: stripePublishableKey(),
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
  }
})
