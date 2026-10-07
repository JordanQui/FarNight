import { SquareError } from 'square'
import { ScriptRuntime } from '~/utils/script-runtime'
import { squareClient, squareLocationId } from '~/server/utils/square'
import { grantAccess, assertNotLocked } from '~/server/utils/session-quota'

export default defineEventHandler(async (event) => {
  const body = await readBody<{ sourceId: string }>(event)

  if (!body?.sourceId) {
    throw createError({ statusCode: 400, statusMessage: 'sourceId manquant' })
  }

  // Avant de débiter quoi que ce soit : la ville fermée ne se vend pas. Voir
  // /api/payment/intent — ici c'est la dernière barrière, et la seule qui
  // compte, puisque c'est elle qui précède le débit.
  assertNotLocked(event)

  const runtime = await ScriptRuntime.load()
  const paywall = runtime.paywall

  // Un refus de Square (carte déclinée…) lève une SquareError : on renvoie son
  // code, sinon le joueur ne lit qu'une erreur 500. Pas de verificationToken :
  // le paiement part sans 3-D Secure, comme dans ronde_v2.
  const response = await squareClient().payments.create({
    sourceId: body.sourceId,
    idempotencyKey: crypto.randomUUID(),
    amountMoney: {
      amount: BigInt(paywall.amount_cents),
      currency: paywall.currency as 'EUR' | 'USD',
    },
    locationId: await squareLocationId(),
  }).catch((err) => {
    if (!(err instanceof SquareError)) throw err
    const code = err.errors[0]?.code ?? 'UNKNOWN'
    console.error('[payment] refus Square', err.statusCode, code, err.errors)
    throw createError({ statusCode: 402, statusMessage: `Paiement refusé : ${code}` })
  })

  if (response.payment?.status !== 'COMPLETED') {
    throw createError({
      statusCode: 402,
      statusMessage: `Paiement non abouti : ${response.payment?.status}`,
    })
  }

  // Le paiement ouvre l'accès à la suite, pour la durée prévue au script.
  // Cookie SIGNÉ : le précédent portait une valeur fixe en clair, que
  // n'importe qui pouvait renvoyer pour débloquer la suite sans payer.
  const pass = grantAccess(event, response.payment?.id ?? 'inconnu', runtime.script.limits.paid.window_days)

  return { success: true, paymentId: response.payment?.id, expiresAt: pass.expires_at }
})
