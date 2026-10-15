import { VercelTimeout, vercelCli } from '~/server/utils/vercel-cli'

/**
 * Les erreurs de la prod depuis le point de départ de la page (`?since=`, ISO),
 * telles que nos fonctions les ont écrites (console.error), avec les
 * avertissements de la même requête.
 *
 * /api/scene/text répond en flux : son 200 part avant la scène, et un échec
 * n'y apparaît qu'ici, jamais dans les codes de réponse.
 *
 * Les scènes se comptent ici aussi : la route écrit `[scene/<id>]` dans ses
 * lignes, seul endroit où l'auberge se distingue des scènes d'après le
 * paywall (l'identifiant voyage dans le corps de la requête, que les
 * métriques ne voient pas).
 *
 * Quand il n'y a rien à rendre, la CLI peut chercher longtemps au lieu de
 * rendre une liste vide : passé le délai, la page le dit tel quel.
 */

const LIMIT = 40
const SCENE_LIMIT = 1000
const TIMEOUT_MS = 45_000

type Line = {
  id: string; timestamp: number; level: string; message: string
  requestMethod: string; requestPath: string; responseStatusCode: number
  logs?: { level: string; message: string }[]
}

/** Les requêtes trouvées, ou null quand la CLI n'a rien rendu à temps. */
async function read(args: string[]) {
  try {
    const out = await vercelCli(['logs', '--json', '--environment', 'production', ...args], TIMEOUT_MS)
    return out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l) as Line)
  } catch (e) {
    if (e instanceof VercelTimeout) return null
    throw createError({ statusCode: 502, statusMessage: (e as Error).message })
  }
}

/** La scène d'une requête, d'après le préfixe `[scene/<id>]` de ses lignes. */
const sceneOf = (l: Line) => [l.message, ...(l.logs ?? []).map(x => x.message)]
  .map(m => /^\[scene\/([^\]]+)\]/.exec(m ?? '')?.[1])
  .find(id => id && id !== 'text')

export default defineEventHandler(async (event) => {
  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })
  const from = since.toISOString()
  const [lines, served] = await Promise.all([
    read(['--level', 'error', '--since', from, '--limit', String(LIMIT)]),
    read(['--query', '/api/scene/text', '--since', from, '--limit', String(SCENE_LIMIT)]),
  ])
  const scenes = (served ?? []).filter(l => l.requestPath === '/api/scene/text').map(sceneOf).filter(Boolean)

  return {
    since: from,
    gaveUpAfter: lines ? null : TIMEOUT_MS / 1000,
    scenes: { auberge: scenes.filter(id => id === 'auberge').length, paid: scenes.filter(id => id !== 'auberge').length },
    lines: (lines ?? []).map(l => ({
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
