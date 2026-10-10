import { ScriptRuntime } from '~/utils/script-runtime'
import { rememberPosition } from '~/server/utils/session-quota'
import { requestLang } from '~/server/utils/lang'

/**
 * Pose le cookie de position d'une scène que /api/scene/text vient de rendre.
 *
 * Cette route-là répond en flux : ses en-têtes partent avant la scène, donc
 * avant de savoir quoi retenir. Elle remet au client la position scellée, et
 * c'est ici qu'elle devient un cookie. Le ticket est signé : le navigateur le
 * transporte, il ne peut pas l'écrire.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ ticket?: string }>(event) ?? {}
  const runtime = await ScriptRuntime.load(requestLang(event))
  if (!body.ticket || !rememberPosition(event, body.ticket, runtime.limits.paid.window_days)) {
    throw createError({ statusCode: 400, statusMessage: 'Position illisible' })
  }
  return { ok: true }
})
