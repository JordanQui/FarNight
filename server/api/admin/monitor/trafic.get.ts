import { type MetricQuery, metrics } from '~/server/utils/vercel-api'

/**
 * La prod depuis le point de départ de la page (`?since=`, ISO), lue dans les
 * métriques de Vercel, en UTC : l'API de métriques refuse encore --bucket-timezone.
 * Vercel fait partir chaque compte du début de la tranche où tombe `since` : on
 * demande 5 min et il grossit seul (1 h sur deux jours, 4 h sur une semaine).
 * Des tranches d'un jour comptaient depuis minuit UTC.
 *
 * Jamais de robots ici. Les métriques de Web Analytics n'en sont pas à l'abri :
 * les vérificateurs de pubs de Meta exécutent son script. On compte donc ses
 * balises de page vue dans les requêtes, qui disent d'où elles viennent, et on
 * y garde les visiteurs comme les fonctions sous le filtre HUMANS. Les appels
 * sortants sont ceux de nos fonctions vers OpenAI, Stripe… avec la réponse reçue.
 */

type Row = Record<string, string | number | null>

/** La valeur d'une ligne : la seule colonne que Vercel nomme d'après la métrique. */
const value = (row?: Row) => Number(Object.entries(row ?? {}).find(([k]) => k.startsWith('vercel_'))?.[1] ?? 0)

/**
 * Un joueur sort d'un opérateur ou du relais privé d'iCloud (Cloudflare, Akamai,
 * Fastly : à garder), jamais d'un datacentre. Vercel écarte déjà les robots qui
 * se déclarent ; restent ceux qui se font passer pour un navigateur, repérés à
 * leur réseau. Le 17/10 à 17 h, 18 balises de page vue sur 21 venaient de Meta.
 */
const MACHINES = ['Facebook, Inc.', 'Amazon.com, Inc.', 'Google LLC', 'Microsoft Corporation', 'Hetzner Online GmbH', 'OVH SAS', 'DigitalOcean, LLC', 'HostRoyale Technologies Pvt Ltd', 'Tencent Building, Kejizhongyi Avenue']
const HUMANS = ['NOT botVerified:pass', `NOT asnName:(${MACHINES.map(n => `"${n}"`).join(' OR ')})`]
/** La balise du script, une par page vue ; un robot déclaré reçoit 202 et n'est pas compté. */
const PAGE_VIEW = ['requestPath:*/view', 'httpStatus:200']
const FUNCTIONS = ['pathType:(func OR streaming_func)']

export default defineEventHandler(async (event) => {
  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })
  const granularity = '5m'
  const metric = (q: MetricQuery) => metrics(since, q)

  const errors: Record<string, string> = {}
  const soft = <T>(name: string, p: Promise<T>) => p.catch((e: Error) => { errors[name] = e.message; return null })

  const [visitors, views, countries, referrers, paths, statuses, outbound, openaiMs] = await Promise.all([
    // Une IP par visiteur : l'identifiant de Web Analytics n'existe que dans ses métriques.
    soft('visiteurs', metric({ metric: 'vercel.request.count', filters: [...PAGE_VIEW, ...HUMANS], aggregation: 'unique/clientIp', granularity })),
    soft('pages vues', metric({ metric: 'vercel.request.count', filters: [...PAGE_VIEW, ...HUMANS], granularity })),
    soft('pays', metric({ metric: 'vercel.analytics.page_view.count', aggregation: 'unique/visitorId', groupBy: ['country'], limit: 8 })),
    soft('provenance', metric({ metric: 'vercel.analytics.page_view.count', groupBy: ['referrerHostname'], limit: 8 })),
    soft('routes', metric({ metric: 'vercel.request.count', filters: [...FUNCTIONS, ...HUMANS], groupBy: ['requestPath', 'httpStatus'], limit: 60 })),
    soft('statuts', metric({ metric: 'vercel.request.count', filters: [...FUNCTIONS, ...HUMANS], groupBy: ['httpStatus'], granularity })),
    soft('appels sortants', metric({ metric: 'vercel.external_api_request.count', groupBy: ['requestHostname', 'httpStatus'], limit: 30 })),
    soft('durées OpenAI', metric({ metric: 'vercel.external_api_request.request_duration_ms', filters: ['requestHostname:api.openai.com'], groupBy: ['requestPath'] })),
  ])

  const buckets = new Map<string, { at: string; visitors: number; views: number; ok: number; refused: number; failed: number }>()
  const on = (iso: unknown) => {
    const at = String(iso)
    if (!buckets.has(at)) buckets.set(at, { at, visitors: 0, views: 0, ok: 0, refused: 0, failed: 0 })
    return buckets.get(at)!
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
    since: since.toISOString(),
    // La tranche que Vercel a retenue, en « 5m », « 1h », « 4h »…
    granularity: Object.entries((visitors ?? statuses)?.query.granularity ?? {}).map(([unit, n]) => `${n}${unit[0]}`)[0] ?? null,
    visitors: visitors ? value(visitors.summary[0]) : null,
    views: views ? value(views.summary[0]) : null,
    buckets: [...buckets.values()].sort((a, b) => a.at.localeCompare(b.at)),
    countries: countries?.summary.map(r => ({ country: String(r.country || '?'), visitors: value(r) })) ?? null,
    referrers: referrers?.summary.map(r => ({ host: String(r.referrerHostname || ''), views: value(r) })) ?? null,
    statuses: statuses?.summary.map(r => ({ status: Number(r.httpStatus), count: value(r) })).sort((a, b) => a.status - b.status) ?? null,
    api: [...api.values()].sort((a, b) => b.total - a.total),
    outbound: outbound?.summary.map(r => ({ host: String(r.requestHostname), status: Number(r.httpStatus), count: value(r) })) ?? null,
    openaiMs: openaiMs?.summary.map(r => ({ path: String(r.requestPath), avg: Math.round(value(r)) })) ?? null,
  }
})
