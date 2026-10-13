import { requireSecret } from '~/server/utils/runtime-secrets'
import { inviteCode, normalizeEmail } from '~/server/utils/invite-code'

/**
 * Le code d'invitation d'un influenceur, pour la page /admin/encrypt.
 *
 * Calculé avec le NUXT_SECRET de la machine : il n'ouvre la production que si
 * c'est le même que celui de Vercel. L'accès est fermé par
 * server/middleware/admin-guard.ts.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string }>(event)
  const email = normalizeEmail(body?.email ?? '')
  if (!email.includes('@')) {
    throw createError({ statusCode: 400, statusMessage: 'Adresse e-mail invalide' })
  }

  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  return { email, code: inviteCode(email, secret) }
})
