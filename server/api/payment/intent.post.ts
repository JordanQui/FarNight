import { ScriptRuntime } from '~/utils/script-runtime'
import { assertNotLocked } from '~/server/utils/session-quota'
import { squareApplicationId, squareEnvironment, squareLocationId } from '~/server/utils/square'

/**
 * La configuration du formulaire de carte, comme le /config de ronde_v2.
 *
 * Plus de lien de paiement : il n'était jamais ouvert, et chaque visite de
 * l'écran en créait un. Le débit passe par /api/payment/confirm, avec le jeton
 * de carte, authentifié en 3-D Secure au moment où il est créé.
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

  const { paywall } = await ScriptRuntime.load()

  return {
    applicationId: squareApplicationId(),
    locationId: await squareLocationId(),
    environment: squareEnvironment(),
    // La somme que /api/payment/confirm débitera, lue au même endroit : la
    // banque authentifie un montant précis, il ne doit pas venir d'ailleurs.
    amountCents: paywall.amount_cents,
    currency: paywall.currency,
  }
})
