import { vercelJson } from '~/server/utils/vercel-cli'

/**
 * Les sept derniers jours de prod, lus dans les métriques de Vercel.
 *
 * Deux sources qui ne comptent pas la même chose : Web Analytics ne voit que
 * les navigateurs qui ont exécuté son script (des visiteurs), les invocations
 * voient tout ce qui a touché une fonction, robots compris. Les appels sortants
 * sont ceux de nos fonctions vers OpenAI, Stripe… avec la réponse reçue.
 */

type Row = Record<string, string | number | null>
type Result = { summary: Row[]; data: Row[] }

const DAYS = 7

/** Jours en UTC : l'API de métriques refuse encore --bucket-timezone. */
const day = (iso: unknown) => String(iso).slice(0, 10)
const metric = (id: string, ...args: string[]) =>
  vercelJson<Result>(['metrics', id, '--since', `${DAYS}d`, '--prod', '--json', ...args])
/** La valeur d'une ligne : la seule colonne que Vercel nomme d'après la métrique. */
const value = (row?: Row) => Number(Object.entries(row ?? {}).find(([k]) => k.startsWith('vercel_'))?.[1] ?? 0)

export default defineEventHandler(async () => {
  const errors: Record<string, string> = {}
  const soft = <T>(name: string, p: Promise<T>) => p.catch((e: Error) => { errors[name] = e.message; return null })

  const [visitors, views, countries, referrers, paths, statuses, outbound, openaiMs] = await Promise.all([
    soft('visiteurs', metric('vercel.analytics.page_view.count', '-a', 'unique/visitorId', '-g', '1d')),
    soft('pages vues', metric('vercel.analytics.page_view.count', '-g', '1d')),
    soft('pays', metric('vercel.analytics.page_view.count', '-a', 'unique/visitorId', '--group-by', 'country', '-l', '8')),
    soft('provenance', metric('vercel.analytics.page_view.count', '--group-by', 'referrerHostname', '-l', '8')),
    soft('routes', metric('vercel.function_invocation.count', '--group-by', 'requestPath', '--group-by', 'httpStatus', '-l', '60')),
    soft('statuts', metric('vercel.function_invocation.count', '--group-by', 'httpStatus', '-g', '1d')),
    soft('appels sortants', metric('vercel.external_api_request.count', '--group-by', 'requestHostname', '--group-by', 'httpStatus', '-l', '30')),
    soft('durées OpenAI', metric('vercel.external_api_request.request_duration_ms', '-f', 'requestHostname:api.openai.com', '--group-by', 'requestPath')),
  ])

  const daily = new Map<string, { day: string; visitors: number; views: number; ok: number; refused: number; failed: number }>()
  const on = (iso: unknown) => {
    const d = day(iso)
    if (!daily.has(d)) daily.set(d, { day: d, visitors: 0, views: 0, ok: 0, refused: 0, failed: 0 })
    return daily.get(d)!
  }
  for (const r of visitors?.data ?? []) on(r.timestamp).visitors = value(r)
  for (const r of views?.data ?? []) on(r.timestamp).views = value(r)
  for (const r of statuses?.data ?? []) {
    const code = Number(r.httpStatus)
    on(r.timestamp)[code >= 500 ? 'failed' : code >= 400 ? 'refused' : 'ok'] += value(r)
  }

  // Les routes du jeu : la fonction unique de Nitro s'appelle /__fallback,
  // seul le chemin demandé les distingue.
  const api = new Map<string, { path: string; total: number; refused: number; failed: number }>()
  for (const r of paths?.summary ?? []) {
    const path = String(r.requestPath ?? '')
    if (!path.startsWith('/api/')) continue
    if (!api.has(path)) api.set(path, { path, total: 0, refused: 0, failed: 0 })
    const row = api.get(path)!
    const code = Number(r.httpStatus)
    row.total += value(r)
    if (code >= 500) row.failed += value(r)
    else if (code >= 400) row.refused += value(r)
  }

  return {
    errors,
    days: DAYS,
    visitors: visitors ? value(visitors.summary[0]) : null,
    views: views ? value(views.summary[0]) : null,
    daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    countries: countries?.summary.map(r => ({ country: String(r.country || '?'), visitors: value(r) })) ?? null,
    referrers: referrers?.summary.map(r => ({ host: String(r.referrerHostname || ''), views: value(r) })) ?? null,
    statuses: statuses?.summary.map(r => ({ status: Number(r.httpStatus), count: value(r) })).sort((a, b) => a.status - b.status) ?? null,
    api: [...api.values()].sort((a, b) => b.total - a.total),
    outbound: outbound?.summary.map(r => ({ host: String(r.requestHostname), status: Number(r.httpStatus), count: value(r) })) ?? null,
    openaiMs: openaiMs?.summary.map(r => ({ path: String(r.requestPath), avg: Math.round(value(r)) })) ?? null,
  }
})
