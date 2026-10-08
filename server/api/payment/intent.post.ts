import { SquareClient, SquareEnvironment } from 'square'
import { ScriptRuntime } from '~/utils/script-runtime'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { assertNotLocked } from '~/server/utils/session-quota'

/**
 * Square v44 : `SquareClient` / `SquareEnvironment`, et les ressources sont
 * imbriquées (`checkout.paymentLinks.create`). Les anciens `Client` /
 * `Environment` / `checkoutApi` de la v3x n'existent plus.
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

  const client = new SquareClient({
    token: requireSecret(config.squareAccessToken, 'SQUARE_ACCESS_TOKEN'),
    environment: config.public.squareEnvironment === 'production'
      ? SquareEnvironment.Production
      : SquareEnvironment.Sandbox,
  })

  const response = await client.checkout.paymentLinks.create({
    idempotencyKey: crypto.randomUUID(),
    order: {
      locationId: config.public.squareLocationId,
      lineItems: [
        {
          name: paywall.cta,
          quantity: '1',
          basePriceMoney: {
            amount: BigInt(paywall.amount_cents),
            currency: paywall.currency as 'EUR' | 'USD',
          },
        },
      ],
    },
    checkoutOptions: {
      allowTipping: false,
      askForShippingAddress: false,
    },
  })

  if (!response.paymentLink) {
    throw createError({ statusCode: 502, statusMessage: 'Square n\'a pas créé de lien de paiement' })
  }

  return {
    paymentLinkId: response.paymentLink.id,
    url: response.paymentLink.url,
    applicationId: config.public.squareApplicationId,
    locationId: config.public.squareLocationId,
  }
})
