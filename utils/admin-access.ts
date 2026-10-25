/**
 * Les pages d'admin ouvertes en production, derrière le mot de passe.
 *
 * Le suivi de la prod et la communication sur les réseaux : ce qu'on veut
 * consulter depuis n'importe où. Le reste de /nimda reste local, en 404.
 * Chaque page vient avec les routes d'API qu'elle appelle.
 */
export const PROD_ADMIN_PAGES = [
  '/nimda/monitor',
  '/nimda/monitorpaiement',
  '/nimda/socials',
  '/nimda/instagram',
]

const PROD_ADMIN_API_PREFIXES = [
  '/api/admin/monitor',
  '/api/admin/payments',
  '/api/admin/socials',
  '/api/admin/instagram',
]

/** La page qui demande le mot de passe. Elle seule s'affiche sans session. */
export const ADMIN_LOGIN_PAGE = '/nimda/login'

const trim = (path: string) => path.replace(/\/+$/, '') || '/'

export function isProdAdminPage(path: string): boolean {
  return PROD_ADMIN_PAGES.includes(trim(path))
}

export function isProdAdminApi(path: string): boolean {
  const p = trim(path)
  return PROD_ADMIN_API_PREFIXES.some(prefix => p === prefix || p.startsWith(`${prefix}/`))
}

/** Le retour après connexion : une page ouverte, jamais une adresse extérieure. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && isProdAdminPage(next) ? next : PROD_ADMIN_PAGES[0]
}
