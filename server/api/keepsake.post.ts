import { clampKeepsake } from '~/utils/keepsake'
import { renderKeepsakePdf } from '~/server/utils/keepsake-pdf'
import { readLock } from '~/server/utils/session-quota'

/**
 * Le PDF de la nuit, offert à la fin.
 *
 * Seule une nuit finie l'obtient : le verrou `completed`, posé avec
 * l'épilogue, dure autant que l'offre. Sans lui, n'importe qui ferait tourner
 * Chrome à volonté sur nos fonctions.
 */
export default defineEventHandler(async (event) => {
  if (readLock(event)?.reason !== 'completed') {
    throw createError({ statusCode: 403, statusMessage: 'Nuit non terminée' })
  }
  const body = await readBody<{ keepsake?: unknown }>(event)
  const keepsake = clampKeepsake(body?.keepsake)
  if (!keepsake) throw createError({ statusCode: 400, statusMessage: 'Nuit manquante' })

  const pdf = await renderKeepsakePdf(keepsake)
  setHeader(event, 'content-type', 'application/pdf')
  setHeader(event, 'cache-control', 'no-store')
  return pdf
})
