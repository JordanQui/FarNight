/**
 * Les promotions X des posts, pour /nimda/socials : les derniers posts du
 * compte, chacun avec ses promotions, et « Promouvoir » qui en crée une.
 *
 * L'Ads API est une API à part. L'app doit être acceptée par X (formulaire
 * « Ads API Access », niveau Standard), le compte pub d'ads.x.com avoir une
 * carte, et elle ne parle qu'OAuth 1.0a : X_API_KEY / X_API_SECRET de l'app,
 * X_ACCESS_TOKEN / X_ACCESS_SECRET du compte, générés dans console.x.com
 * APRÈS l'accord (ceux d'avant n'ont pas l'accès). Le jeton OAuth 2.0 de x.ts
 * n'y sert pas. X_ADS_ACCOUNT choisit le compte pub s'il y en a plusieurs.
 *
 * Une promotion = une campagne, un groupe d'annonces (objectif clics vers le
 * site, payé au clic), son ciblage et le post promu. Le post garde son propre
 * lien : le `?c=` n'y est que s'il a été publié avec. Tout naît en pause ;
 * « Lancer » allume la campagne et, la première fois, le groupe d'annonces,
 * dont la fin recule alors pour garder toute la durée.
 *
 * Écrit d'après la doc de la version 12 (17/10/2026), jamais appelé en vrai.
 */
import { createHmac, randomBytes } from 'node:crypto'
import { bad, http } from './common'

const ADS = 'https://ads-api.x.com/12'
const POSTS = 12

/** Les tranches d'âge de X : une seule par groupe d'annonces. La doc actuelle ne les liste plus, valeurs de l'ancienne. */
export const AGES = [
  'AGE_18_TO_24', 'AGE_18_TO_34', 'AGE_18_TO_49', 'AGE_18_TO_54', 'AGE_OVER_18',
  'AGE_21_TO_34', 'AGE_21_TO_49', 'AGE_21_TO_54', 'AGE_OVER_21',
  'AGE_25_TO_49', 'AGE_25_TO_54', 'AGE_OVER_25',
  'AGE_35_TO_49', 'AGE_35_TO_54', 'AGE_OVER_35', 'AGE_OVER_50',
]

const ENV = ['X_API_KEY', 'X_API_SECRET', 'X_ACCESS_TOKEN', 'X_ACCESS_SECRET']
const env = (k: string) => process.env[k]?.trim() ?? ''

/* OAuth 1.0a, signé à la main : chaque paramètre voyage dans l'adresse, le corps reste vide */

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)

function sign(method: string, base: string, params: [string, string][]) {
  const oauth: Record<string, string> = {
    oauth_consumer_key: env('X_API_KEY'),
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: env('X_ACCESS_TOKEN'),
    oauth_version: '1.0',
  }
  // Rangés par clé puis par valeur, une fois encodés (RFC 5849).
  const all = [...params, ...Object.entries(oauth)].map(([k, v]) => [enc(k), enc(v)]).sort(([a, x], [b, y]) => a === b ? (x! < y! ? -1 : 1) : a! < b! ? -1 : 1)
  const text = [method, enc(base), enc(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&')
  oauth.oauth_signature = createHmac('sha1', `${enc(env('X_API_SECRET'))}&${enc(env('X_ACCESS_SECRET'))}`).update(text).digest('base64')
  return `OAuth ${Object.entries(oauth).map(([k, v]) => `${enc(k)}="${enc(v)}"`).join(', ')}`
}

function call<T>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, query: Record<string, string | number | undefined> = {}) {
  const params = Object.entries(query).filter(([, v]) => v !== undefined && v !== '').map(([k, v]): [string, string] => [k, String(v)])
  const base = `${ADS}/${path}`
  const url = params.length ? `${base}?${params.map(([k, v]) => `${enc(k)}=${enc(v)}`).join('&')}` : base
  return http<T>('X Ads', url, { method, headers: { Authorization: sign(method, base, params) } })
}

/** « Not authorized » seul ne dit pas où X bloque : chaque étape signe son erreur. */
function step<T>(name: string, p: Promise<T>) {
  return p.catch((e: { statusMessage?: string }) => {
    throw createError({ statusCode: 502, statusMessage: `${e.statusMessage ?? 'X Ads : échec'} (${name})` })
  })
}

type Paged<T> = { data: T[]; next_cursor?: string | null }
type Account = { id: string; name: string; deleted?: boolean }
type Funding = {
  id: string
  type: string
  description?: string
  currency: string
  able_to_fund?: boolean
  reasons_not_able_to_fund?: string[]
  deleted?: boolean
  cancelled?: boolean
}
type Campaign = { id: string; name: string; entity_status: string; deleted?: boolean }
type Line = {
  id: string
  campaign_id: string
  entity_status: string
  start_time: string
  end_time?: string | null
  total_budget_amount_local_micro?: number | null
  daily_budget_amount_local_micro?: number | null
  deleted?: boolean
}
type Promoted = { id: string; line_item_id: string; tweet_id: string; approval_status?: string; deleted?: boolean }
type Tweet = {
  id_str: string
  created_at: string
  full_text?: string
  text?: string
  entities?: { urls?: { expanded_url?: string }[] }
  extended_entities?: { media?: { media_url_https?: string }[] }
}
type Stats = { data: { id: string; id_data: { metrics: { billed_charge_local_micro?: number[] | null; url_clicks?: number[] | null } }[] }[] }

const micro = (v?: number | null) => (v ?? 0) / 1e6
/** X veut l'ISO 8601 sans millisecondes ; ses statistiques, des heures pleines. */
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z')
const hour = (ms: number) => Math.floor(ms / 3600_000) * 3600_000
const excerptOf = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)

function tagOf(link?: string) {
  try {
    return link ? new URL(link).searchParams.get('c') : null
  } catch {
    return null
  }
}

/** Le compte pub nommé par X_ADS_ACCOUNT, sinon le premier qui vit. */
async function account() {
  const { data } = await step('comptes pub', call<Paged<Account>>('GET', 'accounts'))
  const wanted = env('X_ADS_ACCOUNT')
  const acc = data.find(a => a.id === wanted) ?? data.find(a => !a.deleted)
  if (!acc) throw createError({ statusCode: 502, statusMessage: 'X Ads : aucun compte pub pour ce jeton (en ouvrir un sur ads.x.com)' })
  return acc
}

/** La carte du compte : X n'a pas d'API pour en ajouter, elle s'enregistre sur ads.x.com. */
async function funding(accountId: string) {
  const { data } = await step('moyens de paiement', call<Paged<Funding>>('GET', `accounts/${accountId}/funding_instruments`))
  const live = data.filter(f => !f.deleted && !f.cancelled)
  return live.find(f => f.able_to_fund) ?? live[0] ?? null
}

/** Dépense et clics des 7 derniers jours : la seule fenêtre que la lecture immédiate de X ouvre. */
async function lastWeek(accountId: string, lines: string[]) {
  const out = new Map<string, { spend: number; clicks: number }>()
  const end = hour(Date.now())
  for (let i = 0; i < lines.length; i += 20) {
    const { data } = await call<Stats>('GET', `stats/accounts/${accountId}`, {
      entity: 'LINE_ITEM',
      entity_ids: lines.slice(i, i + 20).join(','),
      start_time: iso(end - 7 * 86400_000),
      end_time: iso(end),
      granularity: 'TOTAL',
      metric_groups: 'BILLING,ENGAGEMENT',
      placement: 'ALL_ON_TWITTER',
    })
    for (const d of data) {
      const m = d.id_data[0]?.metrics
      out.set(d.id, { spend: micro(m?.billed_charge_local_micro?.[0]), clicks: m?.url_clicks?.[0] ?? 0 })
    }
  }
  return out
}

/** Ce qui manque au .env pour parler à l'Ads API ; vide = tout y est. */
export const xAdsMissing = () => ENV.filter(k => !env(k))

/** Les derniers posts du compte, leurs promotions, la carte et ce qui tourne. */
export async function xBoard() {
  const missing = xAdsMissing()
  if (missing.length) return { configured: false as const, missing }
  const acc = await account()
  const [card, campaigns, lines, promoted, tweets] = await Promise.all([
    funding(acc.id),
    step('campagnes', call<Paged<Campaign>>('GET', `accounts/${acc.id}/campaigns`, { count: 1000 })),
    step('groupes d’annonces', call<Paged<Line>>('GET', `accounts/${acc.id}/line_items`, { count: 1000 })),
    step('posts promus', call<Paged<Promoted>>('GET', `accounts/${acc.id}/promoted_tweets`, { count: 1000 })),
    step('posts du compte', call<Paged<Tweet>>('GET', `accounts/${acc.id}/tweets`, { tweet_type: 'PUBLISHED', timeline_type: 'ORGANIC', count: POSTS, trim_user: 'true' })),
  ])
  const campaignOf = new Map(campaigns.data.filter(c => !c.deleted).map(c => [c.id, c]))
  const lineOf = new Map(lines.data.filter(l => !l.deleted && campaignOf.has(l.campaign_id)).map(l => [l.id, l]))
  const alive = promoted.data.filter(p => !p.deleted && lineOf.has(p.line_item_id))
  // Les statistiques sont un plus : sans elles, la page montre « ? » et le reste.
  const week = await lastWeek(acc.id, [...new Set(alive.map(p => p.line_item_id))]).catch(() => null)

  const posts = tweets.data.map((t) => {
    const urls = (t.entities?.urls ?? []).map(u => u.expanded_url ?? '').filter(Boolean)
    const link = urls.find(u => u.includes('farnight.online')) ?? urls.at(0) ?? null
    return {
      id: t.id_str,
      at: new Date(t.created_at).toISOString(),
      excerpt: excerptOf(t.full_text ?? t.text),
      thumb: t.extended_entities?.media?.[0]?.media_url_https,
      url: `https://x.com/i/web/status/${t.id_str}`,
      link,
      tag: tagOf(link ?? undefined),
      /** L'objectif clics vers le site veut un lien dans le post. */
      eligible: !!link,
    }
  })
  const tagOfPost = new Map(posts.map(p => [p.id, p.tag]))

  /** Une promotion telle que la page la montre, avec les mots d'état de Meta pour partager ses étiquettes. */
  const promo = (p: Promoted) => {
    const l = lineOf.get(p.line_item_id)!
    const c = campaignOf.get(l.campaign_id)!
    const ended = !!l.end_time && Date.parse(l.end_time) < Date.now()
    const on = c.entity_status === 'ACTIVE' && l.entity_status === 'ACTIVE'
    const w = week?.get(l.id)
    return {
      id: p.id,
      campaign: c.id,
      title: c.name.replace(/^Post X\s*:\s*/, ''),
      status: p.approval_status === 'REJECTED' ? 'DISAPPROVED' : ended ? 'ENDED' : !on ? 'PAUSED' : p.approval_status === 'UNDER_REVIEW' ? 'PENDING_REVIEW' : 'ACTIVE',
      running: on && !ended,
      tag: tagOfPost.get(p.tweet_id) ?? null,
      budget: l.total_budget_amount_local_micro ? micro(l.total_budget_amount_local_micro) : l.daily_budget_amount_local_micro ? micro(l.daily_budget_amount_local_micro) : null,
      daily: !l.total_budget_amount_local_micro && !!l.daily_budget_amount_local_micro,
      /** Sur les 7 derniers jours ; null quand X n'a pas rendu ses statistiques. */
      spend: w ? w.spend : null,
      clicks: w ? w.clicks : null,
    }
  }
  const listed = new Set(posts.map(p => p.id))
  const rows = alive.map(p => ({ post: p.tweet_id, ...promo(p) }))
  const live = rows.filter(r => r.running)
  return {
    configured: true as const,
    account: acc.name,
    currency: card?.currency ?? 'EUR',
    card: card ? { name: card.description ?? card.type, able: card.able_to_fund !== false, reasons: card.reasons_not_able_to_fund ?? [] } : null,
    running: live.length,
    spent: week ? rows.reduce((t, r) => t + (r.spend ?? 0), 0) : null,
    /** Ce que les budgets totaux en marche peuvent encore dépenser, au mieux : X ne rend la dépense que sur 7 jours. */
    engaged: live.filter(r => !r.daily).reduce((t, r) => t + Math.max(0, (r.budget ?? 0) - (r.spend ?? 0)), 0),
    perDay: live.filter(r => r.daily).reduce((t, r) => t + (r.budget ?? 0), 0),
    ages: AGES,
    posts: posts.map(p => ({ ...p, ads: rows.filter(r => r.post === p.id) })),
    /** Les promotions encore en vie d'un post plus ancien que la liste. */
    others: rows.filter(r => !listed.has(r.post) && r.status !== 'ENDED'),
  }
}

/** Les lieux que X connaît pour un mot : pays, régions, métropoles, villes, codes postaux. */
export async function xPlaces(q: string) {
  const { data } = await call<Paged<{ name: string; country_code?: string; location_type: string; targeting_value: string }>>(
    'GET', 'targeting_criteria/locations', { q, count: 15 },
  )
  return data.map(d => ({ key: d.targeting_value, name: d.name, type: d.location_type, country: d.country_code }))
}

export type XSpec = {
  post: string
  excerpt: string
  /** Budget total, dans la devise de la carte. */
  budget: number
  days: number
  /** Les `targeting_value` des lieux ; aucun = le monde entier, la route en exige un. */
  places: string[]
  /** Une des AGES, ou vide = tous les âges. */
  age: string
  /** 1 = hommes, 2 = femmes, vide = tous. */
  gender: string
}

/** Monte la campagne, le groupe d'annonces, son ciblage et le post promu ; tout reste en pause. */
export async function xPromote(s: XSpec) {
  const acc = await account()
  const card = await funding(acc.id)
  if (!card?.able_to_fund) throw bad(`X Ads : aucune carte en état de payer${card?.reasons_not_able_to_fund?.length ? ` (${card.reasons_not_able_to_fund.join(', ')})` : ''} : l’enregistrer sur ads.x.com`)
  const name = `Post X : ${s.excerpt}`.slice(0, 255)
  const total = Math.round(s.budget * 1e6)
  // La campagne veut un budget quotidien avec une carte : la part d'un jour, arrondie au centime supérieur.
  const daily = Math.min(total, Math.ceil(total / s.days / 10_000) * 10_000)
  const { data: campaign } = await step('création de la campagne', call<{ data: { id: string } }>('POST', `accounts/${acc.id}/campaigns`, {
    funding_instrument_id: card.id, name, entity_status: 'PAUSED', total_budget_amount_local_micro: total, daily_budget_amount_local_micro: daily,
  }))
  try {
    const start = Date.now()
    const { data: line } = await step('groupe d’annonces', call<{ data: { id: string } }>('POST', `accounts/${acc.id}/line_items`, {
      campaign_id: campaign.id,
      name,
      objective: 'WEBSITE_CLICKS',
      product_type: 'PROMOTED_TWEETS',
      placements: 'ALL_ON_TWITTER',
      bid_strategy: 'AUTO',
      total_budget_amount_local_micro: total,
      start_time: iso(start),
      end_time: iso(start + s.days * 86400_000),
      entity_status: 'PAUSED',
    }))
    const aim = (targeting_type: string, targeting_value: string) => step('ciblage', call('POST', `accounts/${acc.id}/targeting_criteria`, {
      line_item_id: line.id, operator_type: 'EQ', targeting_type, targeting_value,
    }))
    for (const place of s.places) await aim('LOCATION', place)
    if (s.age) await aim('AGE', s.age)
    if (s.gender) await aim('GENDER', s.gender)
    await step('post promu', call('POST', `accounts/${acc.id}/promoted_tweets`, { line_item_id: line.id, tweet_ids: s.post }))
    return { campaign: campaign.id }
  } catch (e) {
    // Une campagne à moitié montée ne reste pas dans le compte.
    await call('DELETE', `accounts/${acc.id}/campaigns/${campaign.id}`).catch(() => {})
    throw e
  }
}

/** Lance ou met en pause la campagne ; au premier lancement, allume aussi son groupe d'annonces. */
export async function xSetStatus(campaign: string, status: 'ACTIVE' | 'PAUSED') {
  const acc = await account()
  if (status === 'ACTIVE') {
    const { data } = await step('lecture du groupe d’annonces', call<Paged<Line>>('GET', `accounts/${acc.id}/line_items`, { campaign_ids: campaign }))
    for (const l of data.filter(l => !l.deleted && l.entity_status === 'PAUSED')) {
      // Créé en pause et lancé plus tard : seule la fin bouge, pour garder toute la durée prévue.
      const span = l.end_time ? Date.parse(l.end_time) - Date.parse(l.start_time) : 0
      await step('allumage du groupe d’annonces', call('PUT', `accounts/${acc.id}/line_items/${l.id}`, {
        entity_status: 'ACTIVE', end_time: span > 0 && Date.parse(l.start_time) < Date.now() ? iso(Date.now() + span) : undefined,
      }))
    }
  }
  await step(status === 'ACTIVE' ? 'lancement de la campagne' : 'pause de la campagne', call('PUT', `accounts/${acc.id}/campaigns/${campaign}`, { entity_status: status }))
}
