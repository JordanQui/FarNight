import { SquareClient, SquareEnvironment } from 'square'
import { requireSecret } from '~/server/utils/runtime-secrets'

/**
 * Square, comme dans ronde_v2 : tout se lit côté serveur, à l'exécution.
 *
 * L'identifiant d'application et l'environnement partaient au bundle client,
 * figés au build ; la location venait d'une variable à part. Qu'un seul des
 * trois ne corresponde pas au jeton, et la carte se tokenise bien mais
 * /v2/payments répond 400. Ici, la location est demandée au compte du jeton
 * lui-même, et le client reçoit le reste par /api/payment/intent.
 */
export function squareEnvironment(): 'production' | 'sandbox' {
  const raw = (process.env.SQUARE_ENVIRONMENT || useRuntimeConfig().public.squareEnvironment || 'sandbox').trim()
  return raw === 'production' ? 'production' : 'sandbox'
}

export function squareApplicationId(): string {
  return requireSecret(process.env.SQUARE_APPLICATION_ID || useRuntimeConfig().public.squareApplicationId, 'SQUARE_APPLICATION_ID')
}

export function squareClient(): SquareClient {
  return new SquareClient({
    token: requireSecret(process.env.SQUARE_ACCESS_TOKEN || useRuntimeConfig().squareAccessToken, 'SQUARE_ACCESS_TOKEN'),
    environment: squareEnvironment() === 'production' ? SquareEnvironment.Production : SquareEnvironment.Sandbox,
  })
}

let cachedLocationId: string | null = null

export async function squareLocationId(): Promise<string> {
  if (cachedLocationId) return cachedLocationId
  const response = await squareClient().locations.list()
  // La première location n'est pas forcément la bonne : une location fermée,
  // ou sans traitement carte, fait tout refuser. On prend celle qui encaisse.
  const locations = response.locations ?? []
  const id = (locations.find(l => l.status === 'ACTIVE' && l.capabilities?.includes('CREDIT_CARD_PROCESSING'))
    ?? locations.find(l => l.status === 'ACTIVE')
    ?? locations[0])?.id
  if (!id) throw createError({ statusCode: 502, statusMessage: 'Aucune location Square sur ce compte' })
  cachedLocationId = id
  return id
}
