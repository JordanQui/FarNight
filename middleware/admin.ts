/**
 * Second verrou, côté navigation cliente.
 *
 * Le garde serveur suffit pour toute requête HTTP, mais une navigation interne
 * de Nuxt ne repasse pas par le serveur : sans ce middleware, la coquille de la
 * page s'afficherait un instant avant que l'API ne réponde 404.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (isLocal()) return
  const isTestTool = to.path.replace(/\/$/, '') === '/nimda/reset'
  if (isTestTool && useRuntimeConfig().public.lockOverride) return
  throw createError({ statusCode: 404, statusMessage: 'Not Found', fatal: true })
})
