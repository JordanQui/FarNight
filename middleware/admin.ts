import { ADMIN_LOGIN_PAGE, isProdAdminPage } from '~/utils/admin-access'

/**
 * Second verrou, côté navigation cliente.
 *
 * Le garde serveur suffit pour toute requête HTTP, mais une navigation interne
 * de Nuxt ne repasse pas par le serveur : sans ce middleware, la coquille de la
 * page s'afficherait un instant avant que l'API ne réponde 404.
 *
 * Les pages ouvertes en production (utils/admin-access.ts) demandent au
 * serveur si la session est là : le cookie n'est pas lisible d'ici.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (isLocal()) return
  const isTestTool = to.path.replace(/\/$/, '') === '/nimda/reset'
  if (isTestTool && useRuntimeConfig().public.lockOverride) return
  if (to.path.replace(/\/$/, '') === ADMIN_LOGIN_PAGE) return
  if (isProdAdminPage(to.path)) {
    // Au premier rendu, le garde serveur a déjà vérifié.
    if (import.meta.server) return
    const { ok } = await $fetch<{ ok: boolean }>('/api/nimda/session').catch(() => ({ ok: false }))
    if (ok) return
    return navigateTo({ path: ADMIN_LOGIN_PAGE, query: { next: to.path } })
  }
  throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
})
