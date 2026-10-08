import { assertNotLocked } from '~/server/utils/session-quota'
import { squareApplicationId, squareEnvironment, squareLocationId } from '~/server/utils/square'

/**
 * La configuration du formulaire de carte, comme le /config de ronde_v2.
 *
 * Plus de lien de paiement : il n'était jamais ouvert, et chaque visite de
 * l'écran en créait un. Le débit passe par /api/payment/confirm, avec le jeton
 * de carte, vérifié 3-D Secure à la tokenisation.
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

  return {
    applicationId: squareApplicationId(),
    locationId: await squareLocationId(),
    environment: squareEnvironment(),
  }
})
