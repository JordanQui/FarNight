import { openAdminSession, passwordMatches } from '~/server/utils/admin-session'

/**
 * Ouvre la session d'admin. Hors de /api/admin : il faut pouvoir l'appeler
 * avant d'avoir la session.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ password?: string }>(event).catch(() => null)
  if (!passwordMatches(body?.password)) {
    // Un essai par seconde au plus, pour un mot de passe court.
    await new Promise(r => setTimeout(r, 1000))
    throw createError({ statusCode: 401, statusMessage: 'Mot de passe incorrect' })
  }
  openAdminSession(event)
  return { ok: true }
})
