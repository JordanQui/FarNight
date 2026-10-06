/**
 * Tout ce qui vit sous /admin n'existe qu'en développement.
 *
 * Le 404 est délibéré plutôt qu'un 403 : une page d'administration ne doit pas
 * signaler sa propre existence. Le garde couvre les pages comme les routes
 * d'API, et vaudra pour toute page d'admin ajoutée plus tard sans qu'on ait à
 * y penser.
 *
 * `import.meta.dev` est figé à la compilation par Nuxt : il ne dépend pas de
 * NODE_ENV, qui est vide dans l'environnement Vercel de ce projet et ne peut
 * donc pas servir de test fiable.
 */
export default defineEventHandler((event) => {
  if (import.meta.dev) return

  const path = getRequestURL(event).pathname
  const isAdmin = path === '/admin'
    || path.startsWith('/admin/')
    || path.startsWith('/api/admin/')

  // Le plan des scènes suit les autres outils de test : ouvert tant que
  // `lockOverride` l'est. Il ne fait rien de plus que la commande `#scene<n>`.
  const isRoute = path.replace(/\/$/, '') === '/admin/route'
  if (isRoute && useRuntimeConfig().public.lockOverride) return

  if (isAdmin) {
    throw createError({ statusCode: 404, statusMessage: 'Not Found' })
  }
})
