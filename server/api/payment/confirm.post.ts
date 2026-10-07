import Stripe from 'stripe'
import { ScriptRuntime } from '~/utils/script-runtime'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { grantAccess, assertNotLocked } from '~/server/utils/session-quota'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const body = await readBody<{ paymentIntentId: string }>(event)

  if (!body?.paymentIntentId) {
    throw createError({ statusCode: 400, statusMessage: 'paymentIntentId manquant' })
  }

  // La ville fermée ne se vend pas. Voir /api/payment/intent — ici c'est la
  // dernière barrière, celle qui ouvre l'accès.
  assertNotLocked(event)

  const runtime = await ScriptRuntime.load()
  const paywall = runtime.paywall

  const stripe = new Stripe(requireSecret(config.stripeSecretKey, 'STRIPE_SECRET_KEY'))

  // Le navigateur a confirmé le paiement auprès de Stripe ; on ne le croit pas
  // sur parole : on relit le PaymentIntent, son statut et son montant.
  const intent = await stripe.paymentIntents.retrieve(body.paymentIntentId)

  if (intent.status !== 'succeeded') {
    throw createError({ statusCode: 402, statusMessage: `Paiement non abouti : ${intent.status}` })
  }
  if (intent.amount !== paywall.amount_cents || intent.currency !== paywall.currency.toLowerCase()) {
    throw createError({ statusCode: 402, statusMessage: 'Montant du paiement inattendu' })
  }

  // Un paiement n'ouvre qu'un accès : sans cette marque, le même identifiant
  // renvoyé depuis un autre navigateur débloquerait la suite sans payer.
  if (intent.metadata.granted_at) {
    throw createError({ statusCode: 409, statusMessage: 'Paiement déjà utilisé' })
  }
  await stripe.paymentIntents.update(intent.id, { metadata: { granted_at: String(Date.now()) } })

  // Le paiement ouvre l'accès à la suite, pour la durée prévue au script.
  // Cookie SIGNÉ : le précédent portait une valeur fixe en clair, que
  // n'importe qui pouvait renvoyer pour débloquer la suite sans payer.
  const pass = grantAccess(event, intent.id, runtime.script.limits.paid.window_days)

  return { success: true, paymentId: intent.id, expiresAt: pass.expires_at }
})
