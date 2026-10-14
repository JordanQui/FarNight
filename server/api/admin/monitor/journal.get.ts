import { VercelTimeout, vercelCli } from '~/server/utils/vercel-cli'

/**
 * Les erreurs de la prod sur 24 h, telles que nos fonctions les ont écrites
 * (console.error), avec les avertissements de la même requête.
 *
 * Quand il n'y a rien à rendre, la CLI peut chercher longtemps au lieu de
 * rendre une liste vide : passé le délai, la page le dit tel quel.
 */

const HOURS = 24
const LIMIT = 40
const TIMEOUT_MS = 45_000

type Line = {
  id: string; timestamp: number; level: string; message: string
  requestMethod: string; requestPath: string; responseStatusCode: number
  logs?: { level: string; message: string }[]
}

export default defineEventHandler(async () => {
  let out: string
  try {
    out = await vercelCli([
      'logs', '--json', '--environment', 'production', '--level', 'error',
      '--since', `${HOURS}h`, '--limit', String(LIMIT),
    ], TIMEOUT_MS)
  } catch (e) {
    if (e instanceof VercelTimeout) return { hours: HOURS, lines: [], gaveUpAfter: TIMEOUT_MS / 1000 }
    throw createError({ statusCode: 502, statusMessage: (e as Error).message })
  }

  const lines = out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l) as Line)
  return {
    hours: HOURS,
    gaveUpAfter: null,
    lines: lines.map(l => ({
      id: l.id,
      at: l.timestamp,
      method: l.requestMethod,
      path: l.requestPath,
      status: l.responseStatusCode,
      message: l.message || l.logs?.find(x => x.level === 'error')?.message || '',
      trail: l.logs ?? [],
    })),
  }
})
