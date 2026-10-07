import { forgetEverything } from '~/server/utils/session-quota'
import { isLocal } from '~/utils/app-env'

/**
 * Vide la mémoire cookie du jeu. Les cookies sont `httpOnly` : le navigateur
 * ne peut pas les effacer lui-même, il faut passer par ici.
 *
 * Même garde que la levée du verrou : local, ou production tant que
 * `lockOverride` est ouvert (phases de test). Aucune génération, aucun coût.
 */
export default defineEventHandler((event) => {
  if (!isLocal() && !useRuntimeConfig().public.lockOverride) {
    throw createError({ statusCode: 403, statusMessage: 'Indisponible' })
  }
  forgetEverything(event)
  return { ok: true as const }
})
