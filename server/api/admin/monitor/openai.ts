/**
 * Ce qu'OpenAI facture, lu chez OpenAI, depuis le point de départ de la page
 * (`?since=`, ISO). L'usage (requêtes, jetons) part de cette heure-là ; les
 * coûts, qu'OpenAI ne découpe qu'en jours UTC entiers, partent de minuit UTC
 * le même jour, et la page le dit.
 *
 * Les coûts et l'usage de l'organisation exigent une clé d'administration
 * (`OPENAI_ADMIN_KEY`, sk-admin-…, créée par un Owner) : la clé du jeu n'y a
 * pas accès. Elle ne vit que dans le .env local, jamais sur Vercel. Ce sont des
 * lectures : aucune ne consomme de jetons.
 *
 * Le crédit restant n'existe dans aucune API : OpenAI ne le montre qu'au
 * tableau de bord, dans le navigateur. On le reconstitue. POST enregistre le
 * solde lu là-bas, en euros comme le compte l'affiche, avec ce que la journée
 * UTC avait déjà coûté à cet instant et le taux dollar → euro du jour (BCE,
 * via Frankfurter) ; GET en retire ce que les coûts, facturés en dollars, ont
 * avancé depuis. C'est une estimation : les coûts arrivent avec quelques
 * heures de retard.
 *
 * Une page de réponse couvre 31 jours au plus : au-delà, il faudrait suivre la
 * pagination.
 */

const MAX_BUCKETS = 31
const CREDIT_KEY = 'monitor:openai-credit'

type Page<T> = { data: { start_time: number; results: T[] }[] }
type Cost = { amount: { value: number | string }; line_item: string | null }
type Completions = { model: string | null; num_model_requests: number; input_tokens: number; input_cached_tokens: number; output_tokens: number }
type Images = { model: string | null; num_model_requests: number; images: number }
type Credit = { eur: number; at: string; spentThatDay: number; usdToEur: number }

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10)
const dayStart = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
const usd = (c: Cost) => Number(c.amount.value) || 0
const spent = (page: Page<Cost>, from = 0) =>
  page.data.filter(b => b.start_time >= from).reduce((s, b) => s + b.results.reduce((t, c) => t + usd(c), 0), 0)

export default defineEventHandler(async (event) => {
  const key = process.env.OPENAI_ADMIN_KEY?.trim()
  if (!key) return { configured: false as const }

  const get = async <T>(path: string, from: number, groupBy: string) => {
    const limit = Math.min(MAX_BUCKETS, Math.ceil((Date.now() / 1000 - from) / 86_400))
    try {
      return await $fetch<Page<T>>(`https://api.openai.com/v1/organization/${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        query: { start_time: Math.floor(from), bucket_width: '1d', limit, group_by: groupBy },
      })
    } catch (e) {
      const err = e as { data?: { error?: { message?: string } }; message: string }
      throw createError({ statusCode: 502, statusMessage: `OpenAI : ${err.data?.error?.message ?? err.message}` })
    }
  }

  if (event.method === 'POST') {
    const body = await readBody<{ eur?: unknown }>(event).catch(() => null)
    const balance = Number(body?.eur)
    if (!Number.isFinite(balance) || balance < 0) throw createError({ statusCode: 400, statusMessage: 'solde illisible' })
    const now = new Date()
    const [today, rate] = await Promise.all([
      get<Cost>('costs', dayStart(now), 'line_item'),
      $fetch<{ rates: { EUR: number } }>('https://api.frankfurter.dev/v1/latest', { query: { base: 'USD', symbols: 'EUR' }, timeout: 8000 })
        .catch(() => { throw createError({ statusCode: 502, statusMessage: 'taux dollar → euro injoignable' }) }),
    ])
    const credit: Credit = { eur: balance, at: now.toISOString(), spentThatDay: spent(today), usdToEur: rate.rates.EUR }
    await useStorage('data').setItem(CREDIT_KEY, credit)
    return credit
  }

  const since = new Date(String(getQuery(event).since))
  if (Number.isNaN(since.getTime())) throw createError({ statusCode: 400, statusMessage: 'since manquant ou illisible' })

  const saved = await useStorage('data').getItem<Credit>(CREDIT_KEY)
  const start = Math.floor(since.getTime() / 1000)
  const costsStart = dayStart(since)
  const creditStart = saved ? dayStart(new Date(saved.at)) : costsStart

  const [costs, completions, images] = await Promise.all([
    get<Cost>('costs', Math.min(costsStart, creditStart), 'line_item'),
    get<Completions>('usage/completions', start, 'model'),
    get<Images>('usage/images', start, 'model'),
  ])

  const shown = costs.data.filter(b => b.start_time >= costsStart)
  const daily = shown.map(b => ({ day: day(b.start_time), usd: b.results.reduce((s, c) => s + usd(c), 0) }))

  const items = new Map<string, number>()
  for (const b of shown) for (const c of b.results) {
    const name = c.line_item ?? 'autre'
    items.set(name, (items.get(name) ?? 0) + usd(c))
  }

  const models = new Map<string, { model: string; requests: number; input: number; cached: number; output: number }>()
  for (const b of completions.data) for (const r of b.results) {
    const name = r.model ?? '?'
    if (!models.has(name)) models.set(name, { model: name, requests: 0, input: 0, cached: 0, output: 0 })
    const m = models.get(name)!
    m.requests += r.num_model_requests
    m.input += r.input_tokens
    m.cached += r.input_cached_tokens
    m.output += r.output_tokens
  }

  const pictures = new Map<string, { model: string; requests: number; images: number }>()
  for (const b of images.data) for (const r of b.results) {
    const name = r.model ?? '?'
    if (!pictures.has(name)) pictures.set(name, { model: name, requests: 0, images: 0 })
    pictures.get(name)!.requests += r.num_model_requests
    pictures.get(name)!.images += r.images
  }

  return {
    configured: true as const,
    since: since.toISOString(),
    costsFrom: new Date(costsStart * 1000).toISOString(),
    total: daily.reduce((s, d) => s + d.usd, 0),
    daily,
    credit: saved && {
      eur: saved.eur,
      at: saved.at,
      usdToEur: saved.usdToEur,
      remaining: saved.eur - (spent(costs, creditStart) - saved.spentThatDay) * saved.usdToEur,
    },
    items: [...items].map(([name, usd]) => ({ name, usd })).filter(i => i.usd >= 0.005).sort((a, b) => b.usd - a.usd),
    models: [...models.values()].sort((a, b) => b.requests - a.requests),
    images: [...pictures.values()].sort((a, b) => b.images - a.images),
  }
})
