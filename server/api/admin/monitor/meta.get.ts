/**
 * Ce que coûtent les pubs Meta (les boosts Instagram), lu dans l'API
 * Marketing depuis le point de départ de la page (`?since=`, ISO).
 *
 * Le jeton `META_ADS_TOKEN` est celui de l'utilisateur système « monitor » du
 * portfolio FarNight : `ads_read` seul, sans expiration, dans le .env local
 * seulement. Le compte publicitaire se retrouve par le jeton. Ce sont des
 * lectures : rien ici ne peut toucher aux campagnes.
 *
 * Meta compte à l'heure du compte (Europe/Paris). Dépense, impressions et
 * clics partent de l'heure du point de départ ; la couverture, des personnes
 * uniques qui ne s'additionnent pas d'une heure à l'autre, part de minuit le
 * même jour, et la page le dit. Après une remise à zéro, la première lecture
 * note la couverture du jour et les suivantes la retranchent : restent les
 * personnes touchées depuis. Les fonds prépayés restent hors de portée de
 * `ads_read`.
 */

const GRAPH = 'https://graph.facebook.com/v26.0'
const HOUR = 'hourly_stats_aggregated_by_advertiser_time_zone'
/** La couverture relevée à la remise à zéro ; `monitor:since` est celle de since.ts. */
const REACH_KEY = 'monitor:meta-reach'

type Page<T> = { data: T[]; paging?: { next?: string } }
type Action = { action_type: string; value: string }
type Account = { id: string; name: string; currency: string; timezone_name: string }
type Hourly = {
  campaign_id: string; date_start: string; [HOUR]: string
  spend: string; impressions: string; inline_link_clicks?: string; actions?: Action[]
}
type Campaign = {
  id: string; name: string; effective_status: string; start_time: string; stop_time?: string
  lifetime_budget?: string; daily_budget?: string; insights?: { data: { spend: string }[] }
  ads?: { data: { creative?: { call_to_action?: { value?: { link?: string } } } }[] }
}

const num = (v?: string) => Number(v ?? 0) || 0
/** Le `?c=` du lien de la pub, que le jeu range sur le paiement : null sans lui. */
function tag(c: Campaign) {
  const link = c.ads?.data.map(a => a.creative?.call_to_action?.value?.link).find(Boolean)
  try {
    return link ? new URL(link).searchParams.get('c') : null
  } catch {
    return null
  }
}
/** Les clics suivis du chargement de la page : ce que Meta appelle landing_page_view. */
const visits = (r: Hourly) => num(r.actions?.find(a => a.action_type === 'landing_page_view')?.value)

export default defineEventHandler(async (event) => {
  const token = process.env.META_ADS_TOKEN?.trim()
  if (!token) return { configured: false as const }

  const raw = String(getQuery(event).since)
  const since = new Date(raw)
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })

  const get = async <T>(path: string, query: Record<string, string | number> = {}) => {
    try {
      return await $fetch<Page<T>>(path.startsWith('https://') ? path : `${GRAPH}/${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        query,
      })
    } catch (e) {
      const err = e as { data?: { error?: { message?: string } }; message: string }
      throw createError({ statusCode: 502, statusMessage: `Meta : ${err.data?.error?.message ?? err.message}` })
    }
  }
  const all = async <T>(path: string, query: Record<string, string | number>) => {
    let page = await get<T>(path, query)
    const rows = [...page.data]
    while (page.paging?.next) {
      page = await get<T>(page.paging.next)
      rows.push(...page.data)
    }
    return rows
  }

  const [account] = (await get<Account>('me/adaccounts', { fields: 'name,currency,timezone_name' })).data
  if (!account) throw createError({ statusCode: 502, statusMessage: 'Meta : aucun compte publicitaire pour ce jeton' })

  // « 2026-10-14 18 » : le jour et l'heure à l'heure du compte, comparables en texte.
  const local = (d: Date) => d.toLocaleString('sv-SE', { timeZone: account.timezone_name }).slice(0, 13)
  const from = local(since)
  const range = JSON.stringify({ since: from.slice(0, 10), until: local(new Date()).slice(0, 10) })

  const [hourly, [whole], campaigns] = await Promise.all([
    // Sans time_increment, Meta additionnerait la même heure de tous les jours.
    all<Hourly>(`${account.id}/insights`, {
      level: 'campaign', time_range: range, time_increment: 1, breakdowns: HOUR, limit: 500,
      fields: 'campaign_id,spend,impressions,inline_link_clicks,actions',
    }),
    get<{ reach: string }>(`${account.id}/insights`, { time_range: range, fields: 'reach' }).then(p => p.data),
    all<Campaign>(`${account.id}/campaigns`, {
      limit: 100,
      fields: 'name,effective_status,start_time,stop_time,lifetime_budget,daily_budget,insights.date_preset(maximum){spend},ads.limit(5){creative{call_to_action}}',
    }),
  ])

  // Relevé pris à la première lecture qui suit la remise à zéro, jamais pour une remise ancienne.
  const storage = useStorage('data')
  let base = await storage.getItem<{ since: string; reach: number }>(REACH_KEY)
  if (base?.since !== raw && raw === await storage.getItem<string>('monitor:since') && Date.now() - since.getTime() < 10 * 60_000) {
    base = { since: raw, reach: num(whole?.reach) }
    await storage.setItem(REACH_KEY, base)
  }
  const reachBase = base?.since === raw ? base.reach : null

  // Tranches d'une heure sur les deux premiers jours, d'un jour ensuite, comme le trafic.
  const byDay = Date.now() - since.getTime() > 48 * 3600_000
  const buckets = new Map<string, { at: string; spend: number; impressions: number; clicks: number }>()
  const spent = new Map<string, { spend: number; clicks: number }>()
  const total = { spend: 0, impressions: 0, clicks: 0, visits: 0 }
  for (const r of hourly) {
    const hour = `${r.date_start} ${r[HOUR].slice(0, 2)}`
    if (hour < from) continue
    const at = byDay ? hour.slice(0, 10) : hour
    if (!buckets.has(at)) buckets.set(at, { at, spend: 0, impressions: 0, clicks: 0 })
    if (!spent.has(r.campaign_id)) spent.set(r.campaign_id, { spend: 0, clicks: 0 })
    const b = buckets.get(at)!
    const c = spent.get(r.campaign_id)!
    b.spend += num(r.spend)
    b.impressions += num(r.impressions)
    b.clicks += num(r.inline_link_clicks)
    c.spend += num(r.spend)
    c.clicks += num(r.inline_link_clicks)
    total.spend += num(r.spend)
    total.impressions += num(r.impressions)
    total.clicks += num(r.inline_link_clicks)
    total.visits += visits(r)
  }

  return {
    configured: true as const,
    account: { id: account.id.replace(/^act_/, ''), name: account.name, currency: account.currency },
    /** Heure locale du compte, « 2026-10-14 18 ». */
    from,
    ...total,
    reach: Math.max(0, num(whole?.reach) - (reachBase ?? 0)),
    /** Couverture comptée depuis la remise à zéro ; sinon depuis minuit le jour du départ. */
    reachSinceReset: reachBase !== null,
    buckets: [...buckets.values()].sort((a, b) => a.at.localeCompare(b.at)),
    // Une campagne reste ACTIVE chez Meta après sa date de fin : c'est stop_time qui dit qu'elle est finie.
    campaigns: campaigns
      .map(c => ({
        id: c.id,
        title: c.name.replace(/^Instagram post:\s*/, '').split('\n')[0],
        tag: tag(c),
        start: c.start_time,
        stop: c.stop_time ?? null,
        status: c.stop_time && Date.parse(c.stop_time) < Date.now() ? 'ENDED' : c.effective_status,
        /** Montants Meta en centimes de la devise du compte. */
        budget: c.lifetime_budget ? num(c.lifetime_budget) / 100 : c.daily_budget ? num(c.daily_budget) / 100 : null,
        daily: !c.lifetime_budget && !!c.daily_budget,
        lifetime: num(c.insights?.data[0]?.spend),
        spend: spent.get(c.id)?.spend ?? 0,
        clicks: spent.get(c.id)?.clicks ?? 0,
      }))
      .filter(c => c.status === 'ACTIVE' || c.spend > 0)
      .sort((a, b) => b.start.localeCompare(a.start)),
  }
})
