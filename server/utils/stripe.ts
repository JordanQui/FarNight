import Stripe from 'stripe'
import { requireSecret } from '~/server/utils/runtime-secrets'

/**
 * Stripe, lu côté serveur à l'exécution — la leçon de Square : une clé bakée
 * au build finit toujours par ne plus correspondre à l'autre. La clé
 * publiable part au client par /api/payment/intent, jamais par le bundle.
 */
export function stripeClient(): Stripe {
  return new Stripe(requireSecret(useRuntimeConfig().stripeSecretKey, 'STRIPE_SECRET_KEY'))
}

export function stripePublishableKey(): string {
  return requireSecret(undefined, 'STRIPE_PUBLISHABLE_KEY')
}
