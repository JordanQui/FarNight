/**
 * Ce qu'OpenAI facture, lu chez OpenAI, sur 30 jours.
 *
 * Les coûts et l'usage de l'organisation exigent une clé d'administration
 * (`OPENAI_ADMIN_KEY`, sk-admin-…, créée par un Owner) : la clé du jeu n'y a
 * pas accès. Elle ne vit que dans le .env local, jamais sur Vercel. Ce sont des
 * lectures : aucune ne consomme de jetons.
 *
 * OpenAI met ces chiffres à jour avec quelques heures de retard, et les donne
 * en dollars, jour par jour en UTC.
 */

const DAYS = 30

type Page<T> = { data: { start_time: number; results: T[] }[] }
type Cost = { amount: { value: number | string }; line_item: string | null }
type Completions = { model: string | null; num_model_requests: number; input_tokens: number; input_cached_tokens: number; output_tokens: number }
type Images = { model: string | null; num_model_requests: number; images: number }

const day = (unix: number) => new Date(unix * 1000).toISOString().slice(0, 10)

export default defineEventHandler(async () => {
  const key = process.env.OPENAI_ADMIN_KEY?.trim()
  if (!key) return { configured: false as const }

  const today = new Date()
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (DAYS - 1)) / 1000
  const get = <T>(path: string, groupBy: string) => $fetch<Page<T>>(`https://api.openai.com/v1/organization/${path}`, {
    headers: { Authorization: `Bearer ${key}` },
    query: { start_time: start, bucket_width: '1d', limit: DAYS + 1, group_by: groupBy },
  })

  let costs: Page<Cost>, completions: Page<Completions>, images: Page<Images>
  try {
    [costs, completions, images] = await Promise.all([
      get<Cost>('costs', 'line_item'),
      get<Completions>('usage/completions', 'model'),
      get<Images>('usage/images', 'model'),
    ])
  } catch (e) {
    const err = e as { data?: { error?: { message?: string } }; message: string }
    throw createError({ statusCode: 502, statusMessage: `OpenAI : ${err.data?.error?.message ?? err.message}` })
  }

  const usd = (c: Cost) => Number(c.amount.value) || 0
  const daily = costs.data.map(b => ({ day: day(b.start_time), usd: b.results.reduce((s, c) => s + usd(c), 0) }))
  const sumLast = (n: number) => daily.slice(-n).reduce((s, d) => s + d.usd, 0)

  const items = new Map<string, number>()
  for (const b of costs.data) for (const c of b.results) {
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
    days: DAYS,
    today: sumLast(1),
    week: sumLast(7),
    month: sumLast(DAYS),
    daily,
    items: [...items].map(([name, usd]) => ({ name, usd })).filter(i => i.usd >= 0.005).sort((a, b) => b.usd - a.usd),
    models: [...models.values()].sort((a, b) => b.requests - a.requests),
    images: [...pictures.values()].sort((a, b) => b.images - a.images),
  }
})
