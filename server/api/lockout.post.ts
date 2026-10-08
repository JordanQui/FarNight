import { ScriptRuntime } from '~/utils/script-runtime'
import { requestLang } from '~/server/utils/lang'
import { closeForStalling, clearLock, giveSolution } from '~/server/utils/session-quota'
import { isLocal } from '~/utils/app-env'

/**
 * Referme la scène : le game over.
 *
 * Appelé par le client au moment où la nuit se referme, pour que l'écran et le
 * cookie basculent ensemble. Ce n'est PAS la seule barrière : `consumeQuota`
 * compte les tours de chaque scène côté serveur et ferme de lui-même au
 * dépassement. Un client qui n'appellerait pas cette route se ferait fermer au
 * tour suivant — celui-ci ne partirait simplement jamais.
 *
 * Renvoie le texte rangé dans le cookie — celui de la scène refermée — plutôt
 * que de laisser le client fournir le sien : c'est le même texte qui reviendra
 * après un rechargement, et il ne doit pas changer entre les deux.
 *
 * Aucune génération, donc aucun coût.
 *
 * En local, et en production tant que `lockOverride` est ouvert
 * (phases de test), `{ open: true }` lève le verrou : sans quoi une seule
 * séance de test condamnerait la journée.
 *
 * `{ solution: true }` la lève pour tous, une fois par scène, et renvoie la
 * scène où reprendre : le client y retourne et joue `#solution`.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ open?: boolean; solution?: boolean }>(event).catch(() => null)
  const runtime = await ScriptRuntime.load(requestLang(event))

  if (body?.solution) {
    const position = giveSolution(event, runtime.limits)
    if (!position) throw createError({ statusCode: 403, statusMessage: 'Indisponible' })
    return { resume: { sceneId: position.scene_id, index: position.index } }
  }

  if (body?.open) {
    if (!isLocal() && !useRuntimeConfig().public.lockOverride) {
      throw createError({ statusCode: 403, statusMessage: 'Indisponible' })
    }
    clearLock(event, runtime.limits)
    return { open: true as const }
  }

  return closeForStalling(event, runtime.limits)
})
