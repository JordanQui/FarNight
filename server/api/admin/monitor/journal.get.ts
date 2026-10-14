import { VercelTimeout, vercelCli } from '~/server/utils/vercel-cli'

/**
 * Les erreurs de la prod depuis le point de départ de la page (`?since=`, ISO),
 * telles que nos fonctions les ont écrites (console.error), avec les
 * avertissements de la même requête.
 *
 * /api/scene/text répond en flux : son 200 part avant la scène, et un échec
 * n'y apparaît qu'ici, jamais dans les codes de réponse.
 *
 * Quand il n'y a rien à rendre, la CLI peut chercher longtemps au lieu de
 * rendre une liste vide : passé le délai, la page le dit tel quel.
 */

const LIMIT = 40
const TIMEOUT_MS = 45_000

type Line = {
  id: string; timestamp: number; level: string; message: string
  requestMethod: string; requestPath: string; responseStatusCode: number
  logs?: { level: string; message: string }[]
}

export default defineEventHandler(async (event) => {
  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })
  let out: string
  try {
    out = await vercelCli([
      'logs', '--json', '--environment', 'production', '--level', 'error',
      '--since', since.toISOString(), '--limit', String(LIMIT),
    ], TIMEOUT_MS)
  } catch (e) {
    if (e instanceof VercelTimeout) return { since: since.toISOString(), lines: [], gaveUpAfter: TIMEOUT_MS / 1000 }
    throw createError({ statusCode: 502, statusMessage: (e as Error).message })
  }

  const lines = out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l) as Line)
  return {
    since: since.toISOString(),
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
