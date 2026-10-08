import { ScriptRuntime } from '~/utils/script-runtime'
import { readAccess, readLock, readPosition } from '~/server/utils/session-quota'

/**
 * Le droit d'accès en cours.
 *
 * Interrogé au chargement : c'est ce qui permet à un joueur qui a déjà payé de
 * reprendre l'aventure sans repasser par le paywall, sans compte ni base de
 * données. Aucune génération, donc aucun coût.
 */
export default defineEventHandler(async (event) => {
  // La fermeture voyage avec le droit d'accès : c'est le seul appel fait au
  // chargement, et l'écran d'adieu doit revenir tel quel après un rechargement,
  // dans un autre onglet, le lendemain. Le texte vient du cookie signé — rien
  // n'est régénéré, rien n'est facturé.
  const lock = readLock(event)
  const closed = lock
    ? { until: lock.until, reason: lock.reason, text: lock.text, solution: !!lock.solution }
    : null

  const pass = readAccess(event)

  /**
   * Où le joueur en était, s'il a le droit d'y retourner.
   *
   * C'est ICI que se décide la reprise, pas côté client : la première scène est
   * gratuite, toutes les suivantes sont derrière le sas. Renvoyer une position
   * tardive à qui n'a pas payé ferait proposer un « Continuer » qui n'aurait
   * mené qu'au paywall — et la ville fermée ne se reprend pas du tout.
   */
  const position = closed ? null : readPosition(event)
  const resume = position && (position.index === 0 || pass)
    ? { sceneId: position.scene_id, index: position.index }
    : null

  if (!pass) return { active: false as const, lock: closed, resume }

  const runtime = await ScriptRuntime.load()
  return {
    active: true as const,
    expiresAt: pass.expires_at,
    windowDays: runtime.script.limits.paid.window_days,
    lock: closed,
    resume,
  }
})
