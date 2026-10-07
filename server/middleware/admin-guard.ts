import { isLocal } from '~/utils/app-env'
/**
 * Tout ce qui vit sous /admin n'existe qu'en local.
 *
 * Le 404 est délibéré plutôt qu'un 403 : une page d'administration ne doit pas
 * signaler sa propre existence. Le garde couvre les pages comme les routes
 * d'API, et vaudra pour toute page d'admin ajoutée plus tard sans qu'on ait à
 * y penser.
 *
 * Le test est `APP_ENV`, pas NODE_ENV : ce dernier est vide dans
 * l'environnement Vercel de ce projet. Voir utils/app-env.ts.
 */
export default defineEventHandler((event) => {
  if (isLocal()) return

  const path = getRequestURL(event).pathname
  const isAdmin = path === '/admin'
    || path.startsWith('/admin/')
    || path.startsWith('/api/admin/')

  if (isAdmin) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
