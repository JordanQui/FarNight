import { ScriptRuntime } from '~/utils/script-runtime'
import { requestLang } from '~/server/utils/lang'
import { closeForStalling, closeForSleep, clearLock } from '~/server/utils/session-quota'

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
 * `{ asleep: true }` : l'aube l'a pris avant la fin. Même cycle, mais la
 * position revient au premier lieu de la nuit.
 *
 * Aucune génération, donc aucun coût.
 *
 * En développement, et en production tant que `lockOverride` est ouvert
 * (phases de test), `{ open: true }` lève le verrou : sans quoi une seule
 * séance de test condamnerait la journée.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ open?: boolean; asleep?: boolean }>(event).catch(() => null)
  const runtime = await ScriptRuntime.load(requestLang(event))

  if (body?.open) {
    if (!import.meta.dev && !useRuntimeConfig().public.lockOverride) {
      throw createError({ statusCode: 403, statusMessage: 'Indisponible' })
    }
    clearLock(event, runtime.limits)
    return { open: true as const }
  }

  // L'aube l'a pris : il dort un cycle, et la nuit repart de son premier lieu.
  if (body?.asleep) {
    const sceneId = runtime.script.defaults.night_clock.starts_at_scene
    const index = runtime.script.progression.order.indexOf(sceneId)
    return closeForSleep(event, runtime.limits, { sceneId, index })
  }

  return closeForStalling(event, runtime.limits)
})
