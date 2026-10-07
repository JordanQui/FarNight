import Stripe from 'stripe'
import { ScriptRuntime } from '~/utils/script-runtime'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { assertNotLocked } from '~/server/utils/session-quota'

/**
 * Ouvre un PaymentIntent Stripe au prix du script. Son `client_secret` laisse
 * le navigateur monter le formulaire et confirmer le paiement lui-même.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
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

  const stripe = new Stripe(requireSecret(config.stripeSecretKey, 'STRIPE_SECRET_KEY'))

  // Carte seulement (les portefeuilles sont coupés côté formulaire) : aucun
  // moyen de paiement ne renvoie hors de la page — le jeu ne sait pas y revenir.
  const intent = await stripe.paymentIntents.create({
    amount: paywall.amount_cents,
    currency: paywall.currency.toLowerCase(),
    payment_method_types: ['card'],
    description: paywall.cta,
  })

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
  }
})
