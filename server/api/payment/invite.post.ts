import { ScriptRuntime } from '~/utils/script-runtime'
import { grantAccess, assertNotLocked } from '~/server/utils/session-quota'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { inviteCode, inviteMatches } from '~/server/utils/invite-code'
import { notifyPhone } from '~/server/utils/notify'

/**
 * Passe le paywall avec un code d'invitation au lieu d'un paiement.
 *
 * Même droit d'accès que /api/payment/confirm, même durée. Le paiement y est
 * remplacé par le code, gardé dans le cookie pour savoir qui a ouvert la nuit —
 * l'adresse, elle, n'y entre pas.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ email?: string; code?: string }>(event)
  const email = body?.email ?? ''
  const code = body?.code ?? ''

  if (!email.includes('@') || !code) {
    throw createError({ statusCode: 400, statusMessage: 'E-mail ou code manquant' })
  }

  // La ville fermée ne s'ouvre pas plus avec un code qu'avec une carte.
  assertNotLocked(event)

  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  if (!inviteMatches(email, code, secret)) {
    throw createError({ statusCode: 403, statusMessage: 'Code invalide' })
  }

  const runtime = await ScriptRuntime.load()
  const pass = grantAccess(event, `invite:${inviteCode(email, secret)}`, runtime.script.limits.paid.window_days)

  await notifyPhone({
    title: 'Nuit offerte',
    message: `${email} — accès ouvert par code VIP`,
    tags: ['star'],
    priority: 4,
  })

  return { success: true, expiresAt: pass.expires_at }
})
