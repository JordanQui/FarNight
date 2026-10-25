import { VercelTimeout, vercelCli, vercelJson, vercelProject } from '~/server/utils/vercel-cli'

/**
 * Vercel pour la page de suivi, en local comme en prod.
 *
 * En local, la CLI connectée du poste fait tout (server/utils/vercel-cli.ts).
 * En prod, ni la CLI ni .vercel/project.json n'existent : on appelle les
 * mêmes routes qu'elle, directement, avec un jeton (`VERCEL_TOKEN`) et les
 * identifiants que `vercel link` écrit dans .vercel/project.json
 * (`VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`). Le jeton suffit à basculer : posé en
 * local, il y sert aussi.
 *
 * Chaque fonction rend la forme de la sortie `--json` de la commande qu'elle
 * remplace (CLI 63 à 65), pour que les routes n'aient pas à savoir laquelle a
 * répondu.
 */

const API = 'https://api.vercel.com'
const TIMEOUT_MS = 25_000

const token = () => process.env.VERCEL_TOKEN?.trim() || null

/** Le projet et l'équipe : les variables d'abord, sinon le fichier de `vercel link`. */
export async function project(): Promise<{ projectId: string; orgId: string }> {
  const projectId = process.env.VERCEL_PROJECT_ID?.trim()
  const orgId = (process.env.VERCEL_ORG_ID || process.env.VERCEL_TEAM_ID)?.trim()
  if (projectId && orgId) return { projectId, orgId }
  try {
    return await vercelProject()
  } catch {
    throw new Error('VERCEL_PROJECT_ID et VERCEL_ORG_ID absents de l\'environnement')
  }
}

function requireToken(): string {
  const t = token()
  if (!t) throw new Error('VERCEL_TOKEN absent de l\'environnement')
  return t
}

/** Un appel à l'API, rattaché à l'équipe comme la CLI le fait. */
async function call<T>(path: string, init: { method?: string; body?: unknown; base?: string; timeoutMs?: number } = {}): Promise<T> {
  const { orgId } = await project()
  const url = new URL(path, init.base ?? API)
  if (orgId.startsWith('team_')) url.searchParams.set('teamId', orgId)
  try {
    return await $fetch(url.toString(), {
      method: (init.method ?? 'GET') as 'GET',
      body: init.body as Record<string, unknown> | undefined,
      headers: { authorization: `Bearer ${requireToken()}` },
      signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    }) as T
  } catch (e) {
    const err = e as { name?: string; data?: { error?: { message?: string; code?: string } }; statusCode?: number; message: string }
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new VercelTimeout(`${url.pathname} : pas de réponse en ${(init.timeoutMs ?? TIMEOUT_MS) / 1000} s`)
    throw new Error(`${url.pathname} : ${err.data?.error?.message ?? err.data?.error?.code ?? err.statusCode ?? err.message}`)
  }
}

/** Une route de l'API REST, telle quelle (`vercel api <path> --raw`). */
export async function api<T>(path: string): Promise<T> {
  if (!token()) {
    const { orgId } = await project()
    return vercelJson<T>(['api', `${path}?teamId=${orgId}`, '--raw'])
  }
  return call<T>(path)
}

// ── Déploiements, variables, alertes ─────────────────────────────────────────

export type Deployment = {
  url: string; state: string; target: string | null; createdAt: number; buildingAt?: number; ready?: number
  creator?: { username?: string }; meta?: Record<string, string>
}

/** `vercel ls --json --limit n` : `contextName` est le slug de l'équipe. */
export async function deployments(limit: number): Promise<{ contextName: string; deployments: Deployment[] }> {
  if (!token()) return vercelJson(['ls', '--json', '--limit', String(limit)])
  const { projectId, orgId } = await project()
  const [list, team] = await Promise.all([
    call<{ deployments: (Deployment & { readyState?: string; created?: number })[] }>(`/v6/deployments?projectId=${projectId}&limit=${limit}`),
    orgId.startsWith('team_') ? call<{ slug: string }>(`/v2/teams/${orgId}`) : call<{ user: { username: string } }>('/v2/user').then(r => ({ slug: r.user.username })),
  ])
  return {
    contextName: team.slug,
    deployments: list.deployments.map(d => ({ ...d, state: d.state ?? d.readyState ?? '', createdAt: d.createdAt ?? d.created ?? 0 })),
  }
}

/** `vercel env ls --json`. */
export async function envs(): Promise<{ envs: { key: string; target?: string[]; type: string; updatedAt: number }[] }> {
  if (!token()) return vercelJson(['env', 'ls', '--json'])
  const { projectId } = await project()
  return call(`/v10/projects/${projectId}/env`)
}

/** `vercel alerts --json` : les groupes d'alertes des dernières 24 h. */
export async function alerts(): Promise<{ groups: Record<string, unknown>[] }> {
  if (!token()) return vercelJson(['alerts', '--json'])
  const { projectId } = await project()
  const to = new Date()
  const from = new Date(to.getTime() - 86_400_000)
  const groups = await call<Record<string, unknown>[]>(`/alerts/v3/groups?projectId=${projectId}&from=${from.toISOString()}&to=${to.toISOString()}`)
  return { groups }
}

// ── Facture ──────────────────────────────────────────────────────────────────

export type Usage = {
  period: { from: string; to: string }
  costUnit: string
  creditBalance?: { allocated: number; used: number; remaining: number }
  services: { name: string; quantity: number; unit?: string; cost: number; category: string }[]
}

/** Minuit à Los Angeles, le jour `day` (AAAA-MM-JJ) plus `plus` jours, en UTC. */
function laMidnight(day: string, plus = 0): Date {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number)
  const wall = Date.UTC(y, m - 1, d + plus)
  const offset = (t: number) => {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Los_Angeles', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(t))
    const n = (type: string) => Number(p.find(x => x.type === type)?.value)
    return Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second')) - t
  }
  // Deux passes : la première estimation peut tomber de l'autre côté d'un changement d'heure.
  const first = wall - offset(wall)
  return new Date(wall - offset(first))
}

type CostsResponse = {
  metrics: { slug: string; unit?: { singular?: string; plural?: string; name?: string } }[]
  results: {
    dimensionsMeta: { product?: { values: Record<string, { title?: string; category?: string }> } }
    views: Record<string, { results: { dimensionValues: { product?: string }; metrics: string[]; totalValue: number[]; values: number[][]; flatRate?: boolean }[] }>
  }
}

/** `vercel usage --json --from <jour> --to <jour>`, jours entiers à l'heure de Los Angeles. */
export async function usage(fromDay: string, toDay: string): Promise<Usage> {
  if (!token()) return vercelJson(['usage', '--json', '--from', fromDay, '--to', toDay])
  const from = laMidnight(fromDay).toISOString()
  const to = laMidnight(toDay, 1).toISOString()
  const r = await call<CostsResponse>('/v2/billing/costs', {
    method: 'POST',
    body: { from, to, metrics: ['gross_cost', 'quantity'], format: 'timeseries', views: { byProduct: { groupBy: ['product'] } }, userAgent: 'vercel-cli.usage' },
  })
  const unit = r.metrics.find(m => m.slug === 'gross_cost')?.unit
  const products = r.results.dimensionsMeta.product?.values ?? {}
  const services = new Map<string, Usage['services'][number]>()
  for (const row of r.results.views.byProduct?.results ?? []) {
    const product = row.dimensionValues.product
    if (!product) continue
    const subscription = products[product]?.category === 'Subscription Licenses'
    const costAt = row.metrics.indexOf('gross_cost')
    const qtyAt = row.metrics.findIndex(m => m !== 'gross_cost')
    const cost = costAt === -1 ? 0 : row.totalValue[costAt] ?? 0
    // Une licence se compte au plus haut de la période, pas en somme.
    const quantity = qtyAt === -1 ? 0
      : subscription ? row.values.reduce((max, v) => Math.max(max, v[qtyAt] ?? 0), 0)
        : row.totalValue[qtyAt] ?? 0
    const key = JSON.stringify([product, row.flatRate === true])
    const seen = services.get(key)
    if (seen) {
      seen.quantity = subscription ? Math.max(seen.quantity, quantity) : seen.quantity + quantity
      seen.cost += cost
    } else {
      services.set(key, { name: products[product]?.title ?? product, quantity, cost, category: subscription ? 'subscription' : 'usage' })
    }
  }
  return {
    period: { from, to },
    costUnit: unit?.singular === 'MIU' || unit?.plural === 'MIUs' ? 'managed_infrastructure_units' : 'USD',
    services: [...services.values()],
  }
}

// ── Métriques ────────────────────────────────────────────────────────────────

export type MetricQuery = {
  metric: string
  /** `count`, `sum`, `avg`, `unique/<dimension>`… Absent : celui que le catalogue donne. */
  aggregation?: string
  groupBy?: string[]
  /** KQL, combinés en ET. */
  filters?: string[]
  limit?: number
  /** `5m`, `1h`… relevé au minimum que Vercel accepte pour la durée demandée. */
  granularity?: string
}

type Row = Record<string, string | number | null>
export type MetricResult = { query: { granularity: Record<string, number> }; summary: Row[]; data: Row[] }

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
/** Durée maximale, tranche par défaut, tranche minimale : la table de la CLI. */
const GRANULARITIES: [number, string, string][] = [[HOUR, '1m', '1m'], [2 * HOUR, '5m', '5m'], [12 * HOUR, '15m', '5m'], [3 * DAY, '1h', '1h'], [30 * DAY, '4h', '4h']]
const toMs = (g: string) => Number(g.slice(0, -1)) * (({ m: MINUTE, h: HOUR, d: DAY } as Record<string, number>)[g.slice(-1)] ?? MINUTE)
const toDuration = (ms: number): Record<string, number> => ms >= DAY ? { days: ms / DAY } : ms >= HOUR ? { hours: ms / HOUR } : { minutes: ms / MINUTE }

function granularityFor(rangeMs: number, explicit?: string): number {
  const row = GRANULARITIES.find(([max]) => rangeMs <= max)
  const [auto, min] = row ? [row[1], row[2]] : ['1d', '1d']
  if (!explicit) return toMs(auto)
  return Math.max(toMs(explicit), toMs(min))
}

const catalog = new Map<string, Promise<{ id: string; unit: string; aggregations: string[] } | undefined>>()

/** Ce que le catalogue dit d'une métrique : son unité et ses agrégations. */
function catalogEntry(metric: string, activeSince: string) {
  if (!catalog.has(metric)) {
    const p = call<{ metrics: { id: string; unit: string; aggregations: string[] }[] }>(
      `/metrics/v1?limit=250&kind=system&search=${encodeURIComponent(metric)}&activeSince=${activeSince}`,
    ).then(r => r.metrics.find(m => m.id === metric))
    p.catch(() => catalog.delete(metric))
    catalog.set(metric, p)
  }
  return catalog.get(metric)!
}

/** Les flags de `vercel metrics` pour la même requête. */
function cliArgs(q: MetricQuery): string[] {
  return [
    ...(q.filters ?? []).flatMap(f => ['--filter', f]),
    ...(q.aggregation ? ['--aggregation', q.aggregation] : []),
    ...(q.groupBy ?? []).flatMap(g => ['--group-by', g]),
    ...(q.limit ? ['--limit', String(q.limit)] : []),
    ...(q.granularity ? ['--granularity', q.granularity] : []),
  ]
}

/** `vercel metrics <id> --since <since> --prod --json …`. */
export async function metrics(since: Date, q: MetricQuery): Promise<MetricResult> {
  if (!token()) return vercelJson(['metrics', q.metric, '--since', since.toISOString(), '--prod', '--json', ...cliArgs(q)])

  const { projectId, orgId } = await project()
  const end = new Date()
  const bucket = granularityFor(end.getTime() - since.getTime(), q.granularity)
  const start = new Date(Math.floor(since.getTime() / bucket) * bucket)
  const stop = new Date(Math.ceil(end.getTime() / bucket) * bucket)
  const groupBy = q.groupBy ?? []

  const entry = await catalogEntry(q.metric, since.toISOString())
  const supported = entry?.aggregations
  const aggregation = q.aggregation ?? (() => {
    if (!entry) return q.metric.endsWith('.count') ? 'count' : 'sum'
    const preferred = ['bytes', 'count', 'usd', 'units'].includes(entry.unit) ? 'sum' : 'avg'
    if (entry.aggregations.includes(preferred)) return preferred
    if (preferred === 'sum' && entry.aggregations.includes('count')) return 'count'
    return entry.aggregations.includes('sum') ? 'sum' : entry.aggregations[0] ?? 'sum'
  })()
  const [name, ...dimension] = aggregation.split('/')
  const selection = name === 'unique' && dimension.length
    ? { metric: q.metric, aggregation: 'unique', dimensions: [dimension.join('/')] }
    : { metric: q.metric, aggregation }

  // Les groupes se classent au nombre d'évènements quand la métrique le permet.
  const byCount = selection.aggregation === 'count' || !supported || supported.includes('count')
  const rankByCount = groupBy.length > 0 && byCount && selection.aggregation !== 'count'
  const filters = [...(q.filters ?? []).filter(Boolean), 'environment:production']
  const filter = filters.length === 1 ? filters[0] : filters.map(f => `(${f})`).join(' AND ')

  const r = await call<{
    series?: { timestamp: string; dimensions: Row; values: Record<string, number | null> }[]
    summary: { dimensions: Row; values: Record<string, number | null> }[]
  }>('/metrics/v1', {
    method: 'POST',
    body: {
      scope: { ownerId: orgId, projectIds: [projectId] },
      timeRange: { start: start.toISOString(), end: stop.toISOString() },
      bucketSeconds: bucket / 1000,
      ...(groupBy.length ? { groupBy } : {}),
      filter,
      metrics: { value: selection, ...(rankByCount ? { __seriesCount: { metric: q.metric, aggregation: 'count' } } : {}) },
      outputs: ['value'],
      ...(groupBy.length ? { seriesSelection: { limit: q.limit ?? 10, mode: 'exact', rankBy: [{ metric: rankByCount ? '__seriesCount' : 'value', direction: 'desc' }] } } : {}),
    },
  })

  const column = `${q.metric}_${aggregation}`.replace(/[./]/g, '_')
  const toRow = (p: { dimensions: Row; values: Record<string, number | null> }) => ({ ...p.dimensions, [column]: p.values.value ?? null })
  return {
    query: { granularity: toDuration(bucket) },
    summary: r.summary.map(toRow),
    data: (r.series ?? []).map(p => ({ timestamp: p.timestamp, ...toRow(p) })),
  }
}

// ── Journal ──────────────────────────────────────────────────────────────────

export type LogLine = {
  id: string; timestamp: number; level: string; message: string
  requestMethod: string; requestPath: string; responseStatusCode: number
  logs?: { level: string; message: string }[]
}

type LogRow = {
  requestId?: string; timestamp?: string; requestMethod?: string; requestPath?: string; statusCode?: number
  logs?: { level?: string; message?: string }[]
}

const SEVERITY: Record<string, number> = { info: 0, warning: 1, error: 2, fatal: 3 }

/**
 * `vercel logs --json --environment production` : les requêtes depuis `since`,
 * les plus récentes d'abord, jusqu'à `limit`. Null si rien n'est venu à temps.
 */
export async function requestLogs(opts: { since: Date; limit: number; level?: string; search?: string; timeoutMs: number }): Promise<LogLine[] | null> {
  if (!token()) {
    const args = [
      ...(opts.level ? ['--level', opts.level] : []),
      ...(opts.search ? ['--query', opts.search] : []),
      '--since', opts.since.toISOString(), '--limit', String(opts.limit),
    ]
    try {
      const out = await vercelCli(['logs', '--json', '--environment', 'production', ...args], opts.timeoutMs)
      return out.split('\n').filter(l => l.startsWith('{')).map(l => JSON.parse(l) as LogLine)
    } catch (e) {
      if (e instanceof VercelTimeout) return null
      throw e
    }
  }

  const { projectId, orgId } = await project()
  const deadline = Date.now() + opts.timeoutMs
  const since = opts.since.getTime()
  let until = Date.now()
  const seen = new Set<string>()
  const lines: LogLine[] = []
  try {
    // Page après page en remontant le temps, comme la CLI.
    while (lines.length < opts.limit) {
      const query = new URLSearchParams({ projectId, ownerId: orgId, startDate: String(since), endDate: String(until), environment: 'production' })
      if (opts.level) query.set('level', opts.level)
      if (opts.search) query.set('search', opts.search)
      const page = await call<{ rows?: LogRow[]; hasMoreRows?: boolean }>(`/api/logs/request-logs?${query}`, {
        base: 'https://vercel.com',
        timeoutMs: Math.max(1000, deadline - Date.now()),
      })
      const rows = page.rows ?? []
      let fresh = 0
      for (const row of rows) {
        const id = row.requestId ?? ''
        if (id && seen.has(id)) continue
        if (id) seen.add(id)
        fresh++
        const logs = (row.logs ?? []).map(l => ({ level: l.level || 'info', message: l.message || '' }))
        const wanted = opts.level ? logs.filter(l => l.level === opts.level) : logs
        const shown = (wanted.length ? wanted : logs).reduce<typeof logs[number] | undefined>(
          (top, l) => !top || (SEVERITY[l.level] ?? -1) > (SEVERITY[top.level] ?? -1) ? l : top, undefined)
        lines.push({
          id,
          timestamp: row.timestamp ? Date.parse(row.timestamp) : Date.now(),
          level: shown?.level ?? 'info',
          message: shown?.message ?? '',
          requestMethod: row.requestMethod ?? '',
          requestPath: row.requestPath ?? '',
          responseStatusCode: row.statusCode ?? 0,
          logs,
        })
        if (lines.length >= opts.limit) break
      }
      if (!fresh || !page.hasMoreRows) break
      const stamps = rows.map(r => Date.parse(r.timestamp ?? ''))
      const oldest = Math.min(...stamps)
      const next = oldest === Math.max(...stamps) ? oldest - 1 : oldest
      if (!Number.isFinite(next) || next >= until || next < since) break
      until = next
    }
  } catch (e) {
    if (e instanceof VercelTimeout) return lines.length ? lines : null
    throw e
  }
  return lines
}
