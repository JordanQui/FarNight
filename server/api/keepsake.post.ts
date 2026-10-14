import { createHash } from 'node:crypto'
import { ScriptRuntime } from '~/utils/script-runtime'
import { stripeClient } from '~/server/utils/stripe'
import { clampKeepsake } from '~/utils/keepsake'
import { renderKeepsakePdf } from '~/server/utils/keepsake-pdf'
import { notifyPhone, price, stripePaymentUrl } from '~/server/utils/notify'

/**
 * Le PDF de la nuit, contre le paiement passé sur l'écran de fin.
 *
 * Le paiement est relu chez Stripe à chaque demande : il suffit pour
 * retélécharger, et la ville fermée n'y change rien — c'est elle qu'il vient
 * clore. Mais il ne vaut que pour la nuit qui l'a payé : sans l'empreinte, un
 * identifiant partagé imprimerait la nuit de n'importe qui.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ paymentIntentId?: string; keepsake?: unknown }>(event)
  const keepsake = clampKeepsake(body?.keepsake)
  if (!body?.paymentIntentId || !keepsake) {
    throw createError({ statusCode: 400, statusMessage: 'Paiement ou nuit manquant' })
  }

  const paywall = (await ScriptRuntime.load()).paywall
  const stripe = stripeClient()
  const intent = await stripe.paymentIntents.retrieve(body.paymentIntentId)

  if (intent.status !== 'succeeded') {
    throw createError({ statusCode: 402, statusMessage: `Paiement non abouti : ${intent.status}` })
  }
  if (intent.metadata.product !== 'keepsake'
    || intent.amount !== paywall.keepsake_cents
    || intent.currency !== paywall.currency.toLowerCase()) {
    throw createError({ statusCode: 402, statusMessage: 'Paiement inattendu' })
  }

  // Le texte de fin est écrit pour un seul joueur : c'est lui qui signe la nuit.
  const night = createHash('sha256').update(keepsake.ending_html).digest('hex').slice(0, 16)
  if (intent.metadata.night && intent.metadata.night !== night) {
    throw createError({ statusCode: 409, statusMessage: 'Paiement déjà utilisé pour une autre nuit' })
  }
  if (!intent.metadata.night) {
    await Promise.all([
      stripe.paymentIntents.update(intent.id, { metadata: { night } }),
      notifyPhone({
        title: 'PDF de la nuit vendu',
        message: price(intent.amount, intent.currency),
        tags: ['moneybag'],
        priority: 4,
        click: stripePaymentUrl(intent.id, intent.livemode),
      }),
    ])
  }

  const pdf = await renderKeepsakePdf(keepsake)
  setHeader(event, 'content-type', 'application/pdf')
  setHeader(event, 'cache-control', 'no-store')
  return pdf
})
