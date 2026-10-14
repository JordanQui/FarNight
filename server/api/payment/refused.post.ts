import { stripeClient } from '~/server/utils/stripe'
import { notifyPhone, price, stripePaymentUrl } from '~/server/utils/notify'

/**
 * Une carte refusée, signalée par le navigateur.
 *
 * Stripe.js confirme le paiement sans passer par nous : un refus s'arrête dans
 * le navigateur, et sans ce signal personne ne le saurait avant d'ouvrir
 * Stripe. On ne croit pas le navigateur sur parole : on relit le paiement, et
 * seul un refus que Stripe a enregistré fait sonner le téléphone.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ paymentIntentId?: string }>(event).catch(() => null)
  if (!body?.paymentIntentId) {
    throw createError({ statusCode: 400, statusMessage: 'paymentIntentId manquant' })
  }

  const intent = await stripeClient().paymentIntents.retrieve(body.paymentIntentId)
  const error = intent.last_payment_error
  if (!error) return { notified: false }

  await notifyPhone({
    title: 'Carte refusée',
    message: `${price(intent.amount, intent.currency)} — ${error.decline_code ?? error.code ?? error.type}`,
    tags: ['x'],
    click: stripePaymentUrl(intent.id, intent.livemode),
  })
  return { notified: true }
})
