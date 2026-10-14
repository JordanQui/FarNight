import { clampKeepsake } from '~/utils/keepsake'
import { renderKeepsakePdf } from '~/server/utils/keepsake-pdf'

/**
 * Le PDF de la nuit sans paiement, pour voir à quoi il ressemble.
 *
 * Même rendu que /api/keepsake, sans Stripe. Sous /api/admin : le garde de
 * `server/middleware/admin-guard.ts` le rend introuvable hors local.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ keepsake?: unknown }>(event)
  const keepsake = clampKeepsake(body?.keepsake)
  if (!keepsake) throw createError({ statusCode: 400, statusMessage: 'Nuit manquante' })

  const pdf = await renderKeepsakePdf(keepsake)
  setHeader(event, 'content-type', 'application/pdf')
  setHeader(event, 'cache-control', 'no-store')
  return pdf
})
