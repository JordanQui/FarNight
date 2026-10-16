/**
 * Ce que coûtent les pubs TikTok, lu dans l'API Marketing (TikTok API for
 * Business) depuis le point de départ de la page (`?since=`, ISO). La réponse
 * a la forme de meta.get.ts : la page lit les deux de la même façon.
 *
 * L'accès passe par une app développeur TikTok (business-api.tiktok.com,
 * My Apps) : `TIKTOK_APP_ID` et `TIKTOK_APP_SECRET`, dans le .env local
 * seulement. Le compte publicitaire l'autorise une fois : TikTok renvoie vers
 * /nimda/monitor avec un `auth_code` valable une heure, que POST échange
 * contre un jeton longue durée, gardé dans le stockage local comme le solde
 * OpenAI. TikTok n'a pas de permission en lecture seule, mais tout ici est
 * lecture : rien ne peut toucher aux campagnes.
 *
 * Seules les campagnes du Gestionnaire de publicités (ads.tiktok.com) passent
 * par l'API, Spark Ads compris ; « Promouvoir », dans l'appli, n'y passe pas.
 *
 * TikTok compte à l'heure du compte, et ne découpe en heures qu'un jour par
 * requête : une requête par jour depuis le point de départ. Les horaires des
 * campagnes, eux, sont en UTC.
 */

const API = 'https://business-api.tiktok.com/open_api/v1.3'
const TOKEN_KEY = 'monitor:tiktok'

type Reply<T> = { code: number; message: string; data: T }
type List<T> = { list: T[]; page_info?: { page: number; total_page: number } }
type Row = { dimensions: { campaign_id: string; stat_time_hour: string }; metrics: Record<string, string> }
type Saved = { token: string; advertiserIds: string[]; at: string }
type Advertiser = { advertiser_id: string; name: string; currency: string; timezone?: string; display_timezone?: string }
type Campaign = {
  campaign_id: string; campaign_name: string; budget?: number; budget_mode?: string
  secondary_status?: string; operation_status?: string; create_time?: string
}
type AdGroup = {
  campaign_id: string; budget?: number; budget_mode?: string
  schedule_type?: string; schedule_start_time?: string; schedule_end_time?: string
}
type Ad = { campaign_id: string; landing_page_url?: string | null }

/** Les statuts TikTok dans les mots de Meta, que la page traduit déjà. Un inconnu passe tel quel. */
const STATUS: Record<string, string> = {
  CAMPAIGN_STATUS_ENABLE: 'ACTIVE',
  CAMPAIGN_STATUS_DISABLE: 'PAUSED',
  CAMPAIGN_STATUS_DELETE: 'DELETED',
  CAMPAIGN_STATUS_BUDGET_EXCEED: 'ENDED',
  CAMPAIGN_STATUS_ADVERTISER_AUDIT: 'IN_PROCESS',
  CAMPAIGN_STATUS_ADVERTISER_AUDIT_DENY: 'WITH_ISSUES',
}

const num = (v?: string | number | null) => Number(v ?? 0) || 0
/** « 2026-10-15 18:00:00 » en UTC, comme TikTok écrit les horaires de campagne. */
const utc = (s?: string) => s ? new Date(`${s.replace(' ', 'T')}Z`).toISOString() : null
/** Le `?c=` du lien de la pub, que le jeu range sur le paiement : null sans lui. */
function tag(ads: Ad[]) {
  const link = ads.map(a => a.landing_page_url).find(Boolean)
  try {
    return link ? new URL(link).searchParams.get('c') : null
  } catch {
    return null
  }
}
/** Le fuseau du compte, s'il est lisible ici ; Paris sinon. */
function zone(tz?: string) {
  try {
    new Intl.DateTimeFormat('fr-FR', { timeZone: tz })
    return tz ?? 'Europe/Paris'
  } catch {
    return 'Europe/Paris'
  }
}

export default defineEventHandler(async (event) => {
  const appId = process.env.TIKTOK_APP_ID?.trim()
  const secret = process.env.TIKTOK_APP_SECRET?.trim()
  if (!appId || !secret) return { configured: false as const, appId: null }

  const storage = useStorage('data')
  const saved = await storage.getItem<Saved>(TOKEN_KEY)

  // TikTok répond 200 même en échec : c'est `code` qui le dit. Les listes passent en JSON dans l'adresse.
  const call = async <T>(path: string, init: { query?: Record<string, unknown>; body?: Record<string, unknown> }) => {
    let reply: Reply<T>
    try {
      reply = await $fetch<Reply<T>>(`${API}/${path}/`, {
        method: init.body ? 'POST' : 'GET',
        headers: saved?.token && !init.body ? { 'Access-Token': saved.token } : {},
        query: init.query && Object.fromEntries(Object.entries(init.query).map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : v])),
        body: init.body,
      })
    } catch (e) {
      throw createError({ statusCode: 502, statusMessage: `TikTok : ${(e as Error).message}` })
    }
    if (reply.code !== 0) throw createError({ statusCode: 502, statusMessage: `TikTok : ${reply.message} (${reply.code})` })
    return reply.data
  }

  if (event.method === 'POST') {
    // L'adresse de retour collée depuis la barre du navigateur, ou le seul code.
    const raw = String((await readBody<{ code?: unknown }>(event).catch(() => null))?.code ?? '').trim()
    let code = raw
    try {
      code = new URL(raw).searchParams.get('auth_code') ?? raw
    } catch {}
    if (!code || code.length > 512) throw createError({ statusCode: 400, statusMessage: 'auth_code manquant ou illisible' })
    const data = await call<{ access_token: string; advertiser_ids: string[] }>('oauth2/access_token', {
      body: { app_id: appId, secret, auth_code: code },
    })
    await storage.setItem(TOKEN_KEY, { token: data.access_token, advertiserIds: data.advertiser_ids, at: new Date().toISOString() })
    return { advertisers: data.advertiser_ids.length }
  }

  if (!saved?.token) return { configured: false as const, appId }

  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })

  const get = <T>(path: string, query: Record<string, unknown>) => call<T>(path, { query })
  const all = async <T>(path: string, query: Record<string, unknown>) => {
    const rows: T[] = []
    for (let page = 1; ; page++) {
      const data = await get<List<T>>(path, { ...query, page, page_size: 1000 })
      rows.push(...data.list)
      if (!data.page_info || page >= data.page_info.total_page) return rows
    }
  }

  const id = saved.advertiserIds[0]
  if (!id) throw createError({ statusCode: 502, statusMessage: 'TikTok : aucun compte publicitaire autorisé pour ce jeton' })
  const [account] = (await get<{ list: Advertiser[] }>('advertiser/info', {
    advertiser_ids: [id], fields: ['name', 'currency', 'timezone', 'display_timezone'],
  })).list
  if (!account) throw createError({ statusCode: 502, statusMessage: 'TikTok : compte publicitaire introuvable' })
  const tz = zone(account.display_timezone ?? account.timezone)

  // « 2026-10-14 18 » : le jour et l'heure à l'heure du compte, comparables en texte.
  const local = (d: Date) => d.toLocaleString('sv-SE', { timeZone: tz }).slice(0, 13)
  const from = local(since)
  const today = local(new Date()).slice(0, 10)
  const days: string[] = []
  for (const d = new Date(`${from.slice(0, 10)}T00:00:00Z`); d.toISOString().slice(0, 10) <= today; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10))
  }

  const report = (query: Record<string, unknown>) => all<Row>('report/integrated/get', { advertiser_id: id, report_type: 'BASIC', ...query })
  const [hourly, [whole], lifetime, campaigns, adgroups, ads] = await Promise.all([
    Promise.all(days.map(day => report({
      data_level: 'AUCTION_CAMPAIGN', dimensions: ['campaign_id', 'stat_time_hour'],
      metrics: ['spend', 'impressions', 'clicks'], start_date: day, end_date: day,
    }))).then(r => r.flat()),
    report({ data_level: 'AUCTION_ADVERTISER', dimensions: ['advertiser_id'], metrics: ['reach'], start_date: days[0], end_date: today }),
    report({ data_level: 'AUCTION_CAMPAIGN', dimensions: ['campaign_id'], metrics: ['spend'], query_lifetime: true }),
    all<Campaign>('campaign/get', {
      advertiser_id: id,
      fields: ['campaign_id', 'campaign_name', 'budget', 'budget_mode', 'secondary_status', 'operation_status', 'create_time'],
    }),
    all<AdGroup>('adgroup/get', {
      advertiser_id: id,
      fields: ['campaign_id', 'budget', 'budget_mode', 'schedule_type', 'schedule_start_time', 'schedule_end_time'],
    }),
    all<Ad>('ad/get', { advertiser_id: id, fields: ['campaign_id', 'landing_page_url'] }),
  ])

  // Tranches d'une heure sur les deux premiers jours, d'un jour ensuite, comme le trafic.
  const byDay = Date.now() - since.getTime() > 48 * 3600_000
  const buckets = new Map<string, { at: string; spend: number; impressions: number; clicks: number }>()
  const spent = new Map<string, { spend: number; clicks: number }>()
  const total = { spend: 0, impressions: 0, clicks: 0 }
  for (const r of hourly) {
    const hour = r.dimensions.stat_time_hour.slice(0, 13)
    if (hour < from) continue
    const at = byDay ? hour.slice(0, 10) : hour
    if (!buckets.has(at)) buckets.set(at, { at, spend: 0, impressions: 0, clicks: 0 })
    if (!spent.has(r.dimensions.campaign_id)) spent.set(r.dimensions.campaign_id, { spend: 0, clicks: 0 })
    const b = buckets.get(at)!
    const c = spent.get(r.dimensions.campaign_id)!
    b.spend += num(r.metrics.spend)
    b.impressions += num(r.metrics.impressions)
    b.clicks += num(r.metrics.clicks)
    c.spend += num(r.metrics.spend)
    c.clicks += num(r.metrics.clicks)
    total.spend += num(r.metrics.spend)
    total.impressions += num(r.metrics.impressions)
    total.clicks += num(r.metrics.clicks)
  }

  const of = <T extends { campaign_id: string }>(list: T[], campaign: string) => list.filter(x => x.campaign_id === campaign)

  return {
    configured: true as const,
    account: { id, name: account.name, currency: account.currency },
    /** Heure locale du compte, « 2026-10-14 18 ». */
    from,
    ...total,
    reach: num(whole?.metrics.reach),
    buckets: [...buckets.values()].sort((a, b) => a.at.localeCompare(b.at)),
    campaigns: campaigns
      .map((c) => {
        const groups = of(adgroups, c.campaign_id)
        // Une campagne finit quand son dernier groupe d'annonces finit ; un groupe sans fin la laisse ouverte.
        const ends = groups.map(g => g.schedule_type === 'SCHEDULE_START_END' ? utc(g.schedule_end_time) : null)
        const stop = ends.length && ends.every(Boolean) ? ends.sort().at(-1)! : null
        const start = groups.map(g => utc(g.schedule_start_time)).filter(Boolean).sort()[0] ?? utc(c.create_time) ?? ''
        // Le budget est à la campagne, ou à défaut dans ses groupes d'annonces, s'ils ont tous le même mode.
        const holders: { budget?: number; budget_mode?: string }[] = c.budget_mode && c.budget_mode !== 'BUDGET_MODE_INFINITE' ? [c] : groups
        const modes = new Set(holders.map(h => h.budget_mode))
        const mode = modes.size === 1 ? [...modes][0] : undefined
        const status = STATUS[c.secondary_status ?? ''] ?? c.secondary_status ?? c.operation_status ?? ''
        return {
          id: c.campaign_id,
          title: c.campaign_name,
          tag: tag(of(ads, c.campaign_id)),
          start,
          stop,
          status: status === 'ACTIVE' && stop && Date.parse(stop) < Date.now() ? 'ENDED' : status,
          /** Montants TikTok dans la devise du compte, pas en centimes. */
          budget: mode && mode !== 'BUDGET_MODE_INFINITE' ? holders.reduce((s, h) => s + num(h.budget), 0) : null,
          daily: !!mode && mode !== 'BUDGET_MODE_TOTAL' && mode !== 'BUDGET_MODE_INFINITE',
          lifetime: num(lifetime.find(r => r.dimensions.campaign_id === c.campaign_id)?.metrics.spend),
          spend: spent.get(c.campaign_id)?.spend ?? 0,
          clicks: spent.get(c.campaign_id)?.clicks ?? 0,
        }
      })
      .filter(c => c.status === 'ACTIVE' || c.spend > 0)
      .sort((a, b) => b.start.localeCompare(a.start)),
  }
})
