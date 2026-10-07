import { useRuntimeConfig } from '#imports'

/**
 * L'environnement du jeu, posé par `APP_ENV` dans le .env : `local` ou
 * `production`. C'est le seul test pour les fonctionnalités de mise au point
 * (admin, inventaire de test, plafonds levés, mocks, verrou levable).
 *
 * Absent, il vaut `production` : un oubli ne doit jamais rien ouvrir.
 * `import.meta.dev` ne sert plus qu'à ce qui dépend du serveur de dev lui-même.
 */
export function isLocal(): boolean {
  return useRuntimeConfig().public.appEnv === 'local'
}
