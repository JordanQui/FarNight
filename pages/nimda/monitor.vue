<script setup lang="ts">
/**
 * La prod en direct, présentée comme un tableau de cotations.
 *
 * Tout compte à partir de SINCE, l'ouverture de la séance : chaque bloc
 * transmet ce point de départ à sa route (server/api/admin/monitor/*, dont
 * meta et tiktok pour les pubs, et /api/admin/payments pour Stripe). Pour remettre le tableau à zéro, le
 * bouton en bas à droite enregistre maintenant (server/api/admin/monitor/since.ts) ;
 * la plus récente des deux, cette remise ou SINCE, ouvre la séance.
 *
 * La page relit tout toutes les deux minutes. Une tuile affiche l'écart avec
 * la cotation précédente. Rien ici n'appelle un modèle.
 */

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const SINCE = '2026-10-15T11:48:00+02:00'
const REFRESH_S = 120

const { data: reset } = await useFetch('/api/admin/monitor/since')
const saved = reset.value?.since
const since = ref(saved && Date.parse(saved) > Date.parse(SINCE) ? saved : SINCE)

// Le compte à rebours attend que tout soit rentré : une requête restée sans réponse
// (serveur de dev relancé pendant la lecture) figeait la page pour toujours. Le
// serveur abandonne de lui-même avant 45 s, le navigateur à 90 s.
// `since` est une ref : la changer relance chaque lecture.
const opts = { lazy: true, server: false, query: { since }, timeout: 90_000 } as const
/**
 * Une cotation ratée remet `data` à null (Nuxt le fait sur erreur) : les tuiles
 * retombaient en tirets jusqu'à la suivante. On garde la dernière bonne, l'erreur
 * s'affiche au-dessus des dépêches.
 */
function kept<R extends { data: Ref<unknown> }>(r: R): R {
  const last = shallowRef(r.data.value)
  watch(r.data, (v) => { if (v != null) last.value = v }, { flush: 'sync' })
  return { ...r, data: last }
}
const { data: etat, error: etatError, status: etatStatus, refresh: refreshEtat } = kept(useFetch('/api/admin/monitor/etat', opts))
const { data: trafic, error: traficError, status: traficStatus, refresh: refreshTrafic } = kept(useFetch('/api/admin/monitor/trafic', opts))
const { data: journal, error: journalError, status: journalStatus, refresh: refreshJournal } = kept(useFetch('/api/admin/monitor/journal', opts))
const { data: openai, error: openaiError, status: openaiStatus, refresh: refreshOpenai } = kept(useFetch('/api/admin/monitor/openai', opts))
const { data: stripe, error: stripeError, status: stripeStatus, refresh: refreshStripe } = kept(useFetch('/api/admin/payments', opts))
const { data: meta, error: metaError, status: metaStatus, refresh: refreshMeta } = kept(useFetch('/api/admin/monitor/meta', opts))
const { data: tiktok, error: tiktokError, status: tiktokStatus, refresh: refreshTiktok } = kept(useFetch('/api/admin/monitor/tiktok', opts))

const busy = computed(() => [etatStatus, traficStatus, journalStatus, openaiStatus, stripeStatus, metaStatus, tiktokStatus].some(s => s.value === 'pending'))
function refreshAll() {
  countdown.value = REFRESH_S
  refreshEtat(); refreshTrafic(); refreshJournal(); refreshOpenai(); refreshStripe(); refreshMeta(); refreshTiktok()
}

// L'horloge ne tourne que dans le navigateur : le serveur rend des tirets.
const now = ref<number | null>(null)
const countdown = ref(REFRESH_S)
let tick: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  now.value = Date.now()
  tick = setInterval(() => {
    now.value = Date.now()
    if (busy.value) return
    countdown.value = Math.max(0, countdown.value - 1)
    if (countdown.value === 0) refreshAll()
  }, 1000)
})
onBeforeUnmount(() => clearInterval(tick))

const opening = computed(() => new Date(since.value).getTime())
const pad = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour12: false })
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
const dayMonth = (ms: number) => new Date(ms).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' })
function chrono(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  return `${d ? `${d}.` : ''}${pad(Math.floor(s / 3600) % 24)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`
}
const int = (n: number) => new Intl.NumberFormat('fr-FR').format(n)
const usd = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(n)
const money = (cents: number, currency = 'eur') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
const reason = (e: { statusMessage?: string; message?: string } | null | undefined) => e?.statusMessage ?? e?.message ?? ''
/** Le fond d'un afficheur : tous les segments allumés, très bas. */
const ghost = (text: string) => text.replace(/\d/g, '8')

const INDICATOR: Record<string, string> = { none: 'opérationnel', minor: 'perturbé', major: 'panne partielle', critical: 'panne' }

/** Ce que fait chaque route du jeu, pour lire le tableau sans ouvrir le code. */
const ROUTES: Record<string, string> = {
  '/api/access': 'droit d’accès, à chaque chargement',
  '/api/scene/text': 'scène écrite par le modèle',
  '/api/scene/image': 'image de scène',
  '/api/image/generate': 'portrait de PNJ',
  '/api/narrative/turn': 'tour de conversation',
  '/api/scene/position': 'cookie de position',
  '/api/payment/intent': 'paywall ouvert',
  '/api/payment/confirm': 'paiement confirmé',
  '/api/payment/refused': 'carte refusée, signalée',
  '/api/payment/invite': 'code d’invitation',
  '/api/paywall': 'paywall sans scène',
  '/api/lockout': 'ville fermée',
  '/api/keepsake': 'PDF de la nuit',
  '/api/dev/forget': 'mémoire vide (test)',
}

/** ENDED est à nous : Meta laisse une campagne finie en ACTIVE. */
const CAMPAIGN_STATUS: Record<string, string> = {
  ACTIVE: 'en cours',
  ENDED: 'terminée',
  PAUSED: 'en pause',
  ARCHIVED: 'archivée',
  DELETED: 'supprimée',
  IN_PROCESS: 'en traitement',
  WITH_ISSUES: 'en erreur',
}

const STRIPE_STATUS: Record<string, string> = {
  requires_payment_method: 'formulaire ouvert',
  requires_confirmation: 'à confirmer',
  requires_action: '3-D Secure',
  processing: 'en cours',
  succeeded: 'payé',
  canceled: 'annulé',
}

const route = (path: string) => trafic.value?.api.find(r => r.path === path)
const outboundCount = (host: string, test: (status: number) => boolean) =>
  (trafic.value?.outbound ?? []).filter(r => r.host === host && test(r.status)).reduce((s, r) => s + r.count, 0)
const buckets = computed(() => trafic.value?.buckets ?? [])
const bucketLabel = (at: string) => trafic.value?.granularity === '1h' ? `${hhmm(Date.parse(at))}` : dayMonth(Date.parse(at))

/** Les pubs. Meta compte à l'heure du compte : « 2026-10-14 18 » devient « 14/10 18h ». */
const ads = computed(() => meta.value?.configured ? meta.value : null)
const metaAt = (at: string) => `${at.slice(8, 10)}/${at.slice(5, 7)}${at.length > 10 ? ` ${at.slice(11)}h` : ''}`
const adsAt = computed(() => ads.value?.buckets.map(b => metaAt(b.at)))
/** TikTok répond dans la même forme que Meta, à l'heure de son compte. */
const tt = computed(() => tiktok.value?.configured ? tiktok.value : null)
const ttAt = computed(() => tt.value?.buckets.map(b => metaAt(b.at)))
/** Toute la dépense pub, Meta et TikTok, dès que l'une des deux est lue. */
const adSpend = computed(() => ads.value || tt.value ? (ads.value?.spend ?? 0) + (tt.value?.spend ?? 0) : null)
/** La dépense pub rapportée à un compte du jeu, tant qu'il y a de quoi diviser. */
const perAd = (n: number | null | undefined) => adSpend.value != null && n ? adSpend.value / n : null
/** Ce que les campagnes en cours peuvent encore dépenser sur leur budget total. */
const budgetLeft = (campaigns: { status: string; budget: number | null; daily: boolean; lifetime: number }[]) => campaigns
  .filter(c => c.status === 'ACTIVE' && c.budget != null && !c.daily)
  .reduce((s, c) => s + Math.max(0, c.budget! - c.lifetime), 0)

/**
 * La viabilité, pub par pub : une pub est rentable si elle amène au moins
 * dépense ÷ marge ventes. Les pubs se distinguent par le `?c=` de leur lien,
 * que le jeu range sur le paiement ; sans lui, tout tombe dans « sans étiquette ».
 * Marge : 12 € − frais Stripe (~0,43 €) − IA d'une nuit (~1,31 €, /nimda/marge le 07/10).
 */
const MARGIN_EUR = 10
/** Sous ce risque, voir aussi peu de ventes au seuil n'est plus de la malchance. */
const RISK = 0.05
const VERDICT: Record<string, string> = { good: 'rentable à ce jour', warn: 'pas encore tranché', bad: 'sous le seuil', muted: 'aucune dépense' }

/** P(X ≤ k) pour X de Poisson de moyenne λ : les ventes attendues au seuil. */
function poissonAtMost(k: number, lambda: number) {
  let term = Math.exp(-lambda)
  let sum = term
  for (let i = 1; i <= k; i++) { term *= lambda / i; sum += term }
  return sum
}

const studies = computed(() => {
  if (!stripe.value || (!ads.value && !tt.value)) return null
  const rows = new Map<string | null, { tag: string | null; spend: number; clicks: number; paywalls: number; sales: number }>()
  const row = (tag: string | null) => {
    if (!rows.has(tag)) rows.set(tag, { tag, spend: 0, clicks: 0, paywalls: 0, sales: 0 })
    return rows.get(tag)!
  }
  for (const c of [...ads.value?.campaigns ?? [], ...tt.value?.campaigns ?? []]) { row(c.tag).spend += c.spend; row(c.tag).clicks += c.clicks }
  for (const c of stripe.value.campaigns) { row(c.tag).paywalls += c.paywalls; row(c.tag).sales += c.sales }
  return [...rows.values()].map((r) => {
    const need = r.spend / MARGIN_EUR
    const chance = poissonAtMost(r.sales, need)
    return { ...r, need, chance, verdict: !need ? 'muted' : r.sales >= need ? 'good' : chance < RISK ? 'bad' : 'warn' }
  }).sort((a, b) => b.spend - a.spend)
})

/** Les échecs de scène ne se voient que dans les journaux : la route répond 200 avant d'échouer. */
const sceneFailures = computed(() => journal.value?.lines.filter(l => l.path === '/api/scene/text').length ?? null)
/** Les scènes que le journal ne sait pas attribuer : servies sans ligne `[scene/<id>]`, ou sorties de sa rétention. */
const scenesUnread = computed(() => trafic.value && journal.value
  ? Math.max(0, (route('/api/scene/text')?.total ?? 0) - journal.value.scenes.auberge - journal.value.scenes.paid)
  : 0)

type Tile = {
  code: string; label: string; value: number | null
  unit?: string; decimals?: number; bad?: boolean; alert?: boolean; note?: string; spark?: number[]
  /** Les tranches du spark, quand ce ne sont pas celles du trafic. */
  sparkAt?: string[]
}

/** Le crédit OpenAI : le solde saisi, moins ce que les coûts ont avancé depuis. */
const credit = computed(() => openai.value?.configured ? openai.value.credit : null)
const CREDIT_LOW_EUR = 5

const tiles = computed<Tile[]>(() => [
  {
    code: 'CRD', label: 'Crédit OpenAI restant', value: credit.value?.remaining ?? null, unit: '€', decimals: 2,
    alert: credit.value != null && credit.value.remaining < CREDIT_LOW_EUR,
    note: !openai.value ? undefined : !openai.value.configured ? 'clé admin absente' : credit.value
      ? `estimé, solde saisi le ${dayMonth(Date.parse(credit.value.at))} à ${hhmm(Date.parse(credit.value.at))}`
      : 'solde à saisir dans le panneau OpenAI',
  },
  { code: 'VIS', label: 'Visiteurs uniques', value: trafic.value?.visitors ?? null, spark: buckets.value.map(b => b.visitors), note: 'Web Analytics' },
  { code: 'PGV', label: 'Pages vues', value: trafic.value?.views ?? null, spark: buckets.value.map(b => b.views) },
  { code: 'REQ', label: 'Requêtes serveur', value: trafic.value ? buckets.value.reduce((s, b) => s + b.ok + b.refused + b.failed, 0) : null, spark: buckets.value.map(b => b.ok + b.refused + b.failed), note: 'robots compris' },
  { code: 'AUB', label: 'Scènes auberge', value: journal.value?.scenes.auberge ?? null, note: 'gratuites, lues au journal' },
  {
    code: 'PAY', label: 'Scènes après paywall', value: journal.value?.scenes.paid ?? null,
    note: scenesUnread.value ? `${scenesUnread.value} autre(s) demandée(s), scène inconnue` : 'personnalisées, épilogue compris',
  },
  { code: 'KO', label: 'Scènes ratées', value: sceneFailures.value, bad: true, note: journal.value?.gaveUpAfter ? 'journal muet' : 'lues au journal' },
  { code: 'TRN', label: 'Tours de conversation', value: trafic.value ? route('/api/narrative/turn')?.total ?? 0 : null },
  { code: 'IMG', label: 'Images de scène', value: trafic.value ? route('/api/scene/image')?.total ?? 0 : null },
  { code: 'PWL', label: 'Paywalls ouverts', value: stripe.value?.server.creates ?? null },
  { code: 'CNF', label: 'Confirmations Stripe', value: stripe.value?.browser ?? null, note: 'POST /confirm du navigateur, reconstitué' },
  { code: 'VTE', label: 'Nuits vendues', value: stripe.value?.statuses.succeeded ?? (stripe.value ? 0 : null) },
  { code: 'CA', label: 'Encaissé', value: stripe.value ? stripe.value.revenue / 100 : null, unit: '€', decimals: 2 },
  {
    code: 'PUB', label: 'Dépense pub Meta', value: ads.value?.spend ?? null, unit: '€', decimals: 2, bad: true, alert: false,
    spark: ads.value?.buckets.map(b => b.spend), sparkAt: adsAt.value,
    note: !meta.value ? undefined : ads.value ? `boosts Instagram, depuis ${metaAt(ads.value.from)}` : 'jeton Meta absent',
  },
  { code: 'IMP', label: 'Impressions pub', value: ads.value?.impressions ?? null, spark: ads.value?.buckets.map(b => b.impressions), sparkAt: adsAt.value },
  { code: 'CVT', label: 'Personnes touchées', value: ads.value?.reach ?? null, note: !ads.value ? undefined : ads.value.reachSinceReset ? `nouvelles depuis ${hhmm(opening.value)}` : `depuis minuit le ${metaAt(ads.value.from.slice(0, 10))}` },
  {
    code: 'CLK', label: 'Clics sur la pub', value: ads.value?.clicks ?? null, spark: ads.value?.buckets.map(b => b.clicks), sparkAt: adsAt.value,
    note: ads.value ? `${int(ads.value.visits)} pages chargées derrière` : undefined,
  },
  { code: 'CPC', label: 'Coût par clic Meta', value: ads.value?.clicks ? ads.value.spend / ads.value.clicks : null, unit: '€', decimals: 2, bad: true, alert: false },
  {
    code: 'TTK', label: 'Dépense pub TikTok', value: tt.value?.spend ?? null, unit: '€', decimals: 2, bad: true, alert: false,
    spark: tt.value?.buckets.map(b => b.spend), sparkAt: ttAt.value,
    note: !tiktok.value ? undefined : tt.value ? `depuis ${metaAt(tt.value.from)}` : 'compte TikTok à brancher',
  },
  {
    code: 'TIM', label: 'Impressions TikTok', value: tt.value?.impressions ?? null, spark: tt.value?.buckets.map(b => b.impressions), sparkAt: ttAt.value,
    note: tt.value ? `${int(tt.value.reach)} personnes depuis minuit le ${metaAt(tt.value.from.slice(0, 10))}` : undefined,
  },
  {
    code: 'TCL', label: 'Clics TikTok', value: tt.value?.clicks ?? null, spark: tt.value?.buckets.map(b => b.clicks), sparkAt: ttAt.value,
    note: tt.value?.clicks ? `${money((tt.value.spend / tt.value.clicks) * 100, tt.value.account.currency)} le clic` : undefined,
  },
  { code: 'CPP', label: 'Pub par paywall ouvert', value: perAd(stripe.value?.server.creates), unit: '€', decimals: 2, bad: true, alert: false, note: 'Meta + TikTok, paywalls de toute provenance' },
  {
    code: 'CPA', label: 'Pub par nuit vendue', value: perAd(stripe.value?.statuses.succeeded), unit: '€', decimals: 2, bad: true, alert: false,
    note: stripe.value && !stripe.value.statuses.succeeded ? 'aucune vente encore' : 'Meta + TikTok, ventes de toute provenance',
  },
  { code: 'OAI', label: 'Appels OpenAI réussis', value: trafic.value ? outboundCount('api.openai.com', s => s < 400) : null },
  { code: '429', label: 'Refus OpenAI', value: trafic.value ? outboundCount('api.openai.com', s => s === 429) : null, bad: true },
  { code: '$AI', label: 'Dépense OpenAI', value: openai.value?.configured ? openai.value.total : null, unit: '$', decimals: 2, bad: true, note: !openai.value ? undefined : openai.value.configured ? `jour UTC entier, depuis ${dayMonth(Date.parse(openai.value.costsFrom))} ${hhmm(Date.parse(openai.value.costsFrom))}` : 'clé admin absente' },
  { code: '5XX', label: 'Échecs serveur', value: trafic.value ? buckets.value.reduce((s, b) => s + b.failed, 0) : null, bad: true, spark: buckets.value.map(b => b.failed) },
  { code: 'LAT', label: 'Réponse du site', value: etat.value?.ping?.ms ?? null, unit: 'ms', bad: true },
  { code: 'VRC', label: 'Vercel consommé', value: etat.value?.usage?.consumption ?? null, unit: '$', decimals: 2, bad: true, note: 'jour entier, heure de Los Angeles' },
])

const led = (t: Tile) => t.value == null ? '--' : t.value.toFixed(t.decimals ?? 0)

// L'écart avec la cotation précédente : pris quand toutes les lectures sont rentrées.
const previous = ref<Record<string, number>>({})
const deltas = ref<Record<string, number>>({})
const quotedAt = ref<number | null>(null)
watch(busy, (isBusy, wasBusy) => {
  if (isBusy || !wasBusy) return
  const next: Record<string, number> = {}
  const moved: Record<string, number> = {}
  for (const t of tiles.value) {
    if (t.value == null) continue
    next[t.code] = t.value
    if (t.code in previous.value) moved[t.code] = t.value - previous.value[t.code]
  }
  previous.value = next
  deltas.value = moved
  quotedAt.value = Date.now()
})

function move(t: Tile) {
  const d = deltas.value[t.code]
  if (d == null) return null
  if (Math.abs(d) < 1e-9) return { arrow: '=', text: '', tone: 'flat' }
  const up = d > 0
  return {
    arrow: up ? '▲' : '▼',
    text: `${up ? '+' : '−'}${Math.abs(d).toFixed(t.decimals ?? 0)}`,
    tone: up === !t.bad ? 'good' : 'bad',
  }
}
const sparkMax = (values: number[]) => Math.max(1, ...values)

const healthy = computed(() => {
  const e = etat.value
  if (!e) return null
  return !!e.ping && e.ping.status < 400 && e.status.every(s => s.indicator === 'none')
})

/** Le bandeau : chaque cotation, puis l'état des services. */
const ticker = computed(() => {
  const items = tiles.value.map((t) => {
    const m = move(t)
    return { key: t.code, code: t.code, value: t.value == null ? '—' : `${t.unit === '$' ? usd(t.value) : t.unit === '€' ? money(t.value * 100) : int(t.value)}${t.unit === 'ms' ? ' ms' : ''}`, move: m }
  })
  for (const s of etat.value?.status ?? []) {
    items.push({ key: s.name, code: s.name.toUpperCase(), value: INDICATOR[s.indicator] ?? s.indicator, move: { arrow: '●', text: '', tone: s.indicator === 'none' ? 'good' : 'bad' } })
  }
  return items
})

const balanceInput = ref('')
const savingBalance = ref(false)
async function saveBalance() {
  const value = Number(balanceInput.value.replace(',', '.'))
  if (!Number.isFinite(value) || value < 0) return
  savingBalance.value = true
  try {
    await $fetch('/api/admin/monitor/openai', { method: 'POST', body: { eur: value } })
    balanceInput.value = ''
    await refreshOpenai()
  } finally {
    savingBalance.value = false
  }
}

/** Remise à zéro : la séance s'ouvre maintenant, les écarts repartent de rien. */
const resetting = ref(false)
async function resetSession() {
  if (!confirm('Remettre le tableau à zéro ? Tout comptera à partir de maintenant.')) return
  resetting.value = true
  try {
    since.value = (await $fetch('/api/admin/monitor/since', { method: 'POST' })).since!
    previous.value = {}
    deltas.value = {}
    countdown.value = REFRESH_S
  } finally {
    resetting.value = false
  }
}

/**
 * Brancher le compte TikTok : son autorisation revient ici avec un `auth_code`
 * valable une heure, échangé aussitôt contre le jeton puis retiré de l'adresse.
 * Le formulaire du panneau fait pareil avec une adresse de retour collée.
 */
const redirect = `${useRequestURL().origin}/nimda/monitor`
const authorize = computed(() => tiktok.value && !tiktok.value.configured && tiktok.value.appId
  ? `https://business-api.tiktok.com/portal/auth?app_id=${tiktok.value.appId}&state=monitor&redirect_uri=${encodeURIComponent(redirect)}`
  : null)
const authInput = ref('')
const connecting = ref(false)
const connectError = ref('')
async function connectTiktok(code: string) {
  connecting.value = true
  connectError.value = ''
  try {
    await $fetch('/api/admin/monitor/tiktok', { method: 'POST', body: { code } })
    authInput.value = ''
    await refreshTiktok()
  } catch (e) {
    connectError.value = reason(e as { statusMessage?: string; message?: string })
  } finally {
    connecting.value = false
  }
}
const returned = useRoute().query.auth_code
const router = useRouter()
onMounted(() => {
  if (typeof returned !== 'string') return
  router.replace({ query: {} })
  connectTiktok(returned)
})

const outbound = computed(() => {
  const hosts = new Map<string, { host: string; ok: number; failures: { status: number; count: number }[] }>()
  for (const r of trafic.value?.outbound ?? []) {
    if (!hosts.has(r.host)) hosts.set(r.host, { host: r.host, ok: 0, failures: [] })
    const h = hosts.get(r.host)!
    if (r.status < 400) h.ok += r.count
    else h.failures.push({ status: r.status, count: r.count })
  }
  return [...hosts.values()].sort((a, b) => b.ok - a.ok)
})
</script>

<template>
  <div class="bourse">
    <!-- Bandeau du haut : la séance -->
    <header class="top">
      <div class="brand">
        <p class="eyebrow">Admin — séance en direct</p>
        <p class="name">FAR NIGHT <span class="sym">FNGT</span></p>
        <p class="session" :class="healthy === false ? 'bad' : 'good'">
          <span class="dot" />{{ healthy === false ? 'Séance perturbée' : 'Séance ouverte' }}
        </p>
      </div>

      <div class="clock" aria-label="Heure de Paris">
        <span class="led-ghost">88:88:88</span>
        <span class="led-on">{{ now ? clock(now) : '--:--:--' }}</span>
        <span class="clock-tz">Paris</span>
      </div>

      <div class="meta">
        <p><span class="k">Ouverture</span> {{ dayMonth(opening) }} {{ clock(opening) }}</p>
        <p><span class="k">Écoulé</span> <span class="led-small">{{ now ? chrono(now - opening) : '--:--:--' }}</span></p>
        <p>
          <span class="k">Prochaine cotation</span>
          <span class="led-small">{{ !now || busy ? '--:--' : `${pad(Math.floor(countdown / 60))}:${pad(countdown % 60)}` }}</span>
        </p>
        <p v-if="quotedAt"><span class="k">Dernière</span> {{ clock(quotedAt) }}</p>
        <ClientOnly>
          <button type="button" class="btn" :disabled="busy" @click="refreshAll()">{{ busy ? 'cotation…' : 'Coter maintenant' }}</button>
        </ClientOnly>
      </div>
    </header>

    <!-- Le bandeau défilant -->
    <div class="tape" aria-hidden="true">
      <div class="tape-track">
        <template v-for="copy in 2" :key="copy">
          <span v-for="i in ticker" :key="`${copy}-${i.key}`" class="tape-item">
            <span class="tape-code">{{ i.code }}</span>
            <span class="tape-value">{{ i.value }}</span>
            <span v-if="i.move" :class="['tape-move', i.move.tone]">{{ i.move.arrow }} {{ i.move.text }}</span>
          </span>
        </template>
      </div>
    </div>

    <main class="wrap">
      <!-- Le tableau des cotes -->
      <section class="board" aria-label="Cotations">
        <article v-for="t in tiles" :key="t.code" class="tile" :class="{ alert: t.alert ?? (t.bad && (t.value ?? 0) > 0 && t.unit !== 'ms' && t.unit !== '$') }">
          <header class="tile-head">
            <span class="tile-code">{{ t.code }}</span>
            <span v-if="move(t)" :class="['tile-move', move(t)!.tone]">{{ move(t)!.arrow }} {{ move(t)!.text }}</span>
          </header>
          <p class="tile-value">
            <span class="led-ghost">{{ ghost(led(t)) }}</span>
            <span class="led-on">{{ led(t) }}</span>
            <span v-if="t.unit" class="tile-unit">{{ t.unit }}</span>
          </p>
          <p class="tile-label">{{ t.label }}</p>
          <div v-if="t.spark?.length" class="spark">
            <span
              v-for="(v, i) in t.spark" :key="i" class="spark-bar"
              :style="{ height: `${(v / sparkMax(t.spark)) * 100}%` }"
              :title="`${t.sparkAt?.[i] ?? bucketLabel(buckets[i]?.at ?? '')} — ${int(v)}`"
            />
          </div>
          <p v-if="t.note" class="tile-note">{{ t.note }}</p>
        </article>
      </section>

      <!-- Viabilité : chaque pub jugée sur ses ventes -->
      <section class="panel">
        <h2>Viabilité <span>par pub · marge {{ money(MARGIN_EUR * 100) }} par vente · ventes nécessaires = dépense ÷ marge</span></h2>
        <p v-if="!studies" class="muted">lecture des pubs et de Stripe…</p>
        <template v-else>
          <table class="tbl">
            <thead><tr><th>Pub</th><th class="num">Dépense</th><th class="num">Clics</th><th class="num">Paywalls</th><th class="num">Ventes</th><th class="num">Nécessaires</th><th>Verdict</th></tr></thead>
            <tr v-for="s in studies" :key="s.tag ?? ''">
              <td><code v-if="s.tag">?c={{ s.tag }}</code><span v-else class="muted">sans étiquette</span></td>
              <td class="num">{{ money(s.spend * 100) }}</td>
              <td class="num">{{ int(s.clicks) }}</td>
              <td class="num">{{ int(s.paywalls) }}</td>
              <td class="num">{{ int(s.sales) }}</td>
              <td class="num">{{ s.need.toFixed(1) }}</td>
              <td :class="s.verdict">
                <span class="pill" />{{ VERDICT[s.verdict] }}{{ s.verdict === 'bad' ? ` — ${Math.round(s.chance * 100)} % de chances au seuil` : '' }}
              </td>
            </tr>
          </table>
          <p class="muted small">
            Toutes pubs confondues : {{ int(ads?.visits ?? 0) }} pages chargées derrière les clics Meta{{ tt ? `, ${int(tt.clicks)} clics TikTok` : '' }} → {{ int(route('/api/scene/text')?.total ?? 0) }} scènes écrites
            → {{ int(studies.reduce((n, s) => n + s.paywalls, 0)) }} paywalls → {{ int(studies.reduce((n, s) => n + s.sales, 0)) }} ventes. Seules les deux dernières étapes se lisent par pub.
          </p>
          <p class="muted small">
            Rouge quand, au seuil, voir aussi peu de ventes arriverait moins d’une fois sur 20. Une pub s’étiquette par son lien, <code>farnight.online/?c=e2</code> ;
            « sans étiquette » réunit les liens sans <code>?c=</code> (les boosts du 14/10) et tout ce qui vient d’ailleurs.
          </p>
        </template>
      </section>

      <p v-for="e in [etatError, traficError, journalError, openaiError, stripeError, metaError, tiktokError].filter(Boolean)" :key="reason(e)" class="err">{{ reason(e) }}</p>
      <p v-for="(msg, name) in { ...(etat?.errors ?? {}), ...(trafic?.errors ?? {}) }" :key="name" class="err">{{ name }} — {{ msg }}</p>

      <div class="cols">
        <!-- Dépêches : les erreurs du journal -->
        <section class="panel">
          <h2>Dépêches <span>erreurs des fonctions depuis l’ouverture</span></h2>
          <p v-if="!journal" class="muted">lecture des journaux…</p>
          <p v-else-if="journal.gaveUpAfter" class="muted">Aucune erreur remontée : le journal n’a rien rendu en {{ journal.gaveUpAfter }} s.</p>
          <p v-else-if="!journal.lines.length" class="good">Aucune erreur.</p>
          <ul v-else class="wire">
            <li v-for="l in journal.lines" :key="l.id">
              <details>
                <summary>
                  <span class="t">{{ clock(l.at) }}</span>
                  <span v-if="l.path === '/api/scene/text'" class="tag bad">scène ratée</span>
                  <code>{{ l.method }} {{ l.path }} → {{ l.status }}</code>
                  <span class="bad">{{ l.message }}</span>
                </summary>
                <ul class="trail">
                  <li v-for="(t, i) in l.trail" :key="i" :class="t.level === 'error' ? 'bad' : 'muted'"><b>{{ t.level }}</b> {{ t.message }}</li>
                </ul>
              </details>
            </li>
          </ul>
        </section>

        <!-- Transactions : Stripe -->
        <section class="panel">
          <h2>Transactions <span>Stripe, {{ stripe ? (stripe.livemode === false ? 'mode test' : 'mode live') : '…' }}</span></h2>
          <p v-if="!stripe" class="muted">lecture de Stripe…</p>
          <template v-else>
            <p v-if="!stripe.recent.length" class="muted">Aucun paywall ouvert depuis l’ouverture.</p>
            <table v-else class="tbl">
              <tr v-for="p in stripe.recent" :key="p.id">
                <td class="t">{{ clock(p.created * 1000) }}</td>
                <td class="num">{{ money(p.amount, p.currency) }}</td>
                <td :class="p.status === 'succeeded' ? 'good' : 'muted'">{{ STRIPE_STATUS[p.status] ?? p.status }}</td>
                <td class="bad">{{ p.error ?? '' }}</td>
              </tr>
            </table>
            <p v-if="stripe.charges.failed" class="bad small">{{ stripe.charges.failed }} carte(s) refusée(s){{ stripe.refusals[0] ? ` — ${stripe.refusals[0].reason}` : '' }}</p>
            <p class="muted small">Les paywalls ouverts depuis ce poste comptent aussi : la clé Stripe du .env local est la clé live.</p>
            <NuxtLink to="/nimda/monitorpaiement" class="link">Le détail des requêtes Stripe →</NuxtLink>
          </template>
        </section>
      </div>

      <!-- Cotes détaillées : les routes du jeu -->
      <section class="panel">
        <h2>Cotes détaillées <span>routes du jeu depuis l’ouverture</span></h2>
        <p v-if="!trafic" class="muted">lecture des métriques…</p>
        <p v-else-if="!trafic.api.length" class="muted">Aucun appel depuis l’ouverture.</p>
        <table v-else class="tbl">
          <thead><tr><th>Route</th><th class="num">Appels</th><th class="num">4xx</th><th class="num">5xx</th></tr></thead>
          <tr v-for="r in trafic.api" :key="r.path">
            <td><code>{{ r.path }}</code> <span class="muted">{{ ROUTES[r.path] ?? '' }}</span></td>
            <td class="num">{{ int(r.total) }}</td>
            <td class="num">{{ r.refused ? int(r.refused) : '' }}</td>
            <td class="num" :class="r.failed ? 'bad' : ''">{{ r.failed ? int(r.failed) : '' }}</td>
          </tr>
        </table>
        <p class="muted small">/api/scene/text répond en flux : son 200 part avant la scène. Ses échecs se lisent dans les dépêches, pas dans la colonne 5xx.</p>
      </section>

      <div class="cols">
        <!-- Flux sortants -->
        <section class="panel">
          <h2>Flux sortants <span>appels de nos fonctions</span></h2>
          <p v-if="!trafic" class="muted">lecture des métriques…</p>
          <template v-else>
            <p v-if="!outbound.length" class="muted">Aucun appel sortant depuis l’ouverture.</p>
            <table v-else class="tbl">
              <tr v-for="h in outbound" :key="h.host">
                <td><code>{{ h.host }}</code></td>
                <td class="num">{{ int(h.ok) }} ok</td>
                <td class="bad">{{ h.failures.map(f => `${int(f.count)} × ${f.status}`).join(' · ') }}</td>
              </tr>
            </table>
            <p v-for="d in trafic.openaiMs ?? []" :key="d.path" class="muted small">
              <code>{{ d.path }}</code> répond en {{ (d.avg / 1000).toFixed(1) }} s en moyenne
            </p>
            <p v-if="outbound.some(h => h.failures.some(f => f.status === 429))" class="muted small">
              Un 429 d’OpenAI est un refus : limite de débit (30 000 jetons par minute au palier 1) ou crédit épuisé.
            </p>
          </template>
        </section>

        <!-- OpenAI -->
        <section class="panel">
          <h2>OpenAI <span>facturé chez OpenAI{{ openai?.configured ? ` · coûts depuis ${dayMonth(Date.parse(openai.costsFrom))} ${hhmm(Date.parse(openai.costsFrom))}, usage depuis l’ouverture` : '' }}</span></h2>
          <p v-if="openaiError" class="bad">{{ reason(openaiError) }}</p>
          <p v-else-if="!openai" class="muted">lecture d’OpenAI…</p>
          <div v-else-if="!openai.configured" class="muted small">
            <p>
              Les dépenses ne se lisent qu’avec une clé d’administration, créée par un Owner dans
              <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noopener" class="link">Settings → Admin keys</a>,
              puis ajoutée au <code>.env</code> local seulement : <code>OPENAI_ADMIN_KEY=sk-admin-…</code>. Relancer le dev ensuite.
            </p>
          </div>
          <template v-else>
            <form class="balance" @submit.prevent="saveBalance">
              <label for="balance">
                Solde lu sur
                <a href="https://platform.openai.com/settings/organization/billing/overview" target="_blank" rel="noopener" class="link">Billing</a>
              </label>
              <input id="balance" v-model="balanceInput" inputmode="decimal" placeholder="en euros" autocomplete="off">
              <button type="submit" class="btn" :disabled="savingBalance || !balanceInput">{{ savingBalance ? '…' : 'Enregistrer' }}</button>
            </form>
            <p v-if="openai.credit" class="muted small">
              {{ money(openai.credit.eur * 100) }} le {{ dayMonth(Date.parse(openai.credit.at)) }} à {{ hhmm(Date.parse(openai.credit.at)) }},
              {{ money((openai.credit.eur - openai.credit.remaining) * 100) }} dépensés depuis : reste {{ money(openai.credit.remaining * 100) }}.
              Dépenses facturées en dollars, converties à {{ openai.credit.usdToEur.toFixed(4) }} € le dollar.
              Aucune API ne donne ce solde, il se recale à chaque saisie.
            </p>
            <table class="tbl">
              <tr v-for="i in openai.items" :key="i.name"><td>{{ i.name }}</td><td class="num">{{ usd(i.usd) }}</td></tr>
            </table>
            <table class="tbl">
              <thead><tr><th>Modèle</th><th class="num">Requêtes</th><th class="num">Entrée</th><th class="num">Sortie</th></tr></thead>
              <tr v-for="m in openai.models" :key="m.model">
                <td>{{ m.model }}</td><td class="num">{{ int(m.requests) }}</td><td class="num">{{ int(m.input) }}</td><td class="num">{{ int(m.output) }}</td>
              </tr>
            </table>
            <p v-for="m in openai.images" :key="m.model" class="muted small">Images {{ m.model }} : {{ int(m.images) }}</p>
            <p class="muted small">OpenAI met ces chiffres à jour avec quelques heures de retard.</p>
          </template>
        </section>
      </div>

      <!-- Publicité : Meta -->
      <section class="panel">
        <h2>Publicité <span>Meta{{ ads ? ` · compte ${ads.account.name} · depuis ${metaAt(ads.from)}` : '' }}</span></h2>
        <p v-if="metaError" class="bad">{{ reason(metaError) }}</p>
        <p v-else-if="!meta" class="muted">lecture de Meta…</p>
        <p v-else-if="!ads" class="muted small">
          Les pubs se lisent avec le jeton de l’utilisateur système « monitor » du portfolio FarNight, <code>ads_read</code> seul,
          dans le <code>.env</code> local : <code>META_ADS_TOKEN=EAA…</code>. Relancer le dev ensuite.
        </p>
        <template v-else>
          <p v-if="!ads.campaigns.length" class="muted">Aucune campagne en cours.</p>
          <table v-else class="tbl">
            <thead><tr><th>Campagne</th><th class="num">Budget</th><th class="num">Dépensé</th><th class="num">Depuis l’ouverture</th></tr></thead>
            <tr v-for="c in ads.campaigns" :key="c.id">
              <td>
                {{ c.title }}
                <span class="t">{{ dayMonth(Date.parse(c.start)) }} {{ hhmm(Date.parse(c.start)) }}{{ c.stop ? ` → ${dayMonth(Date.parse(c.stop))}` : '' }}</span>
                <span v-if="c.status !== 'ACTIVE'" class="tag muted">{{ CAMPAIGN_STATUS[c.status] ?? c.status }}</span>
              </td>
              <td class="num">{{ c.budget == null ? '' : `${money(c.budget * 100, ads.account.currency)}${c.daily ? ' / jour' : ''}` }}</td>
              <td class="num">{{ money(c.lifetime * 100, ads.account.currency) }}</td>
              <td class="num">{{ money(c.spend * 100, ads.account.currency) }}</td>
            </tr>
          </table>
          <p v-if="budgetLeft(ads.campaigns)" class="muted small">
            Les campagnes en cours peuvent encore dépenser {{ money(budgetLeft(ads.campaigns) * 100, ads.account.currency) }}, dans la limite des fonds prépayés.
            Ces fonds ne se lisent pas avec <code>ads_read</code> : Instagram → Paiements publicitaires.
          </p>
          <p class="muted small">Meta met ces chiffres à jour avec un peu de retard et les corrige parfois après coup.</p>
        </template>
      </section>

      <!-- Publicité : TikTok -->
      <section class="panel">
        <h2>Publicité <span>TikTok{{ tt ? ` · compte ${tt.account.name} · depuis ${metaAt(tt.from)}` : '' }}</span></h2>
        <p v-if="tiktokError" class="bad">{{ reason(tiktokError) }}</p>
        <p v-else-if="!tiktok" class="muted">lecture de TikTok…</p>
        <div v-else-if="!tt" class="muted small">
          <p v-if="!authorize">
            Les pubs TikTok se lisent par une app développeur, créée une fois sur
            <a href="https://business-api.tiktok.com/portal" target="_blank" rel="noopener" class="link">TikTok API for Business</a>
            (Become a Developer, puis My Apps → Create an app) : permissions « Ad Account Management », « Ads Management » et « Reporting »,
            adresse de retour (Advertiser redirect URL) <code>{{ redirect }}</code>. TikTok valide l’app en deux ou trois jours ouvrés.
            Son App ID et son Secret vont dans le <code>.env</code> local seulement : <code>TIKTOK_APP_ID=…</code> et <code>TIKTOK_APP_SECRET=…</code>. Relancer le dev ensuite.
          </p>
          <template v-else>
            <p>
              L’app est prête, reste à lui ouvrir le compte publicitaire :
              <a :href="authorize" class="link">autoriser sur TikTok →</a>
              TikTok revient ici et le compte se branche seul. S’il revient ailleurs, coller l’adresse où il a atterri :
            </p>
            <form class="balance" @submit.prevent="connectTiktok(authInput)">
              <input v-model="authInput" class="wide" placeholder="adresse de retour ou auth_code" autocomplete="off">
              <button type="submit" class="btn" :disabled="connecting || !authInput">{{ connecting ? '…' : 'Brancher' }}</button>
            </form>
          </template>
          <p v-if="connectError" class="bad">{{ connectError }}</p>
        </div>
        <template v-else>
          <p v-if="!tt.campaigns.length" class="muted">Aucune campagne en cours.</p>
          <table v-else class="tbl">
            <thead><tr><th>Campagne</th><th class="num">Budget</th><th class="num">Dépensé</th><th class="num">Depuis l’ouverture</th></tr></thead>
            <tr v-for="c in tt.campaigns" :key="c.id">
              <td>
                {{ c.title }}
                <span class="t">{{ dayMonth(Date.parse(c.start)) }} {{ hhmm(Date.parse(c.start)) }}{{ c.stop ? ` → ${dayMonth(Date.parse(c.stop))}` : '' }}</span>
                <span v-if="c.status !== 'ACTIVE'" class="tag muted">{{ CAMPAIGN_STATUS[c.status] ?? c.status }}</span>
              </td>
              <td class="num">{{ c.budget == null ? '' : `${money(c.budget * 100, tt.account.currency)}${c.daily ? ' / jour' : ''}` }}</td>
              <td class="num">{{ money(c.lifetime * 100, tt.account.currency) }}</td>
              <td class="num">{{ money(c.spend * 100, tt.account.currency) }}</td>
            </tr>
          </table>
          <p v-if="budgetLeft(tt.campaigns)" class="muted small">
            Les campagnes en cours peuvent encore dépenser {{ money(budgetLeft(tt.campaigns) * 100, tt.account.currency) }}, dans la limite du solde du compte.
          </p>
          <p class="muted small">
            Seules les campagnes du Gestionnaire de publicités TikTok se lisent ici, Spark Ads compris ; « Promouvoir », dans l’appli, n’y passe pas.
            Une pub s’étiquette par son lien de destination, <code>farnight.online/?c=t1</code>.
          </p>
        </template>
      </section>

      <!-- Infrastructure -->
      <section v-if="etat" class="panel">
        <h2>
          Infrastructure
          <span v-if="etat.project">{{ etat.project.name }} · {{ etat.project.framework }} · Node {{ etat.project.node }} · {{ etat.project.region }}</span>
        </h2>
        <div class="infra">
          <div>
            <p class="k">Site</p>
            <p :class="etat.ping && etat.ping.status < 400 ? 'good' : 'bad'">
              {{ etat.host ?? '—' }} · {{ etat.ping ? `${etat.ping.status} en ${etat.ping.ms} ms` : etat.errors.site ?? 'pas de réponse' }}
            </p>
            <p class="k">En ligne</p>
            <p v-if="etat.prod">{{ etat.prod.message }} <code>{{ etat.prod.sha }}</code></p>
            <p v-if="etat.ahead === 0" class="good small">main local = prod</p>
            <p v-else-if="etat.ahead" class="small">{{ etat.ahead }} commit(s) local(aux) pas encore en ligne</p>
            <p class="k">Services</p>
            <p v-for="s in etat.status" :key="s.name" :class="s.indicator === 'none' ? 'good' : 'bad'">● {{ s.name }} {{ INDICATOR[s.indicator] ?? s.indicator }}</p>
            <p v-if="etat.alerts?.length" class="bad">Alertes : {{ etat.alerts.join(' · ') }}</p>
          </div>
          <div>
            <p class="k">Derniers déploiements</p>
            <table class="tbl">
              <tr v-for="d in (etat.deployments ?? []).slice(0, 6)" :key="d.url">
                <td :class="d.state === 'READY' ? (d.live ? 'good' : 'muted') : 'bad'">{{ d.live ? 'EN LIGNE' : d.state }}</td>
                <td>{{ d.message ?? d.url }}</td>
                <td class="t">{{ dayMonth(d.createdAt) }} {{ hhmm(d.createdAt) }}</td>
              </tr>
            </table>
            <p class="k">Variables de prod</p>
            <p v-for="e in etat.env ?? []" :key="e.key" class="small" :class="e.stale ? 'bad' : 'muted'">
              <code>{{ e.key }}</code>{{ e.stale ? ' — changée après le déploiement en ligne : redéployer' : '' }}
            </p>
          </div>
          <div v-if="etat.usage">
            <p class="k">Vercel, du {{ new Date(etat.usage.from).toLocaleDateString('fr-FR') }} au {{ new Date(etat.usage.to).toLocaleDateString('fr-FR') }}</p>
            <table class="tbl">
              <tr v-for="s in etat.usage.services" :key="s.name"><td>{{ s.name }}</td><td class="num">{{ usd(s.cost) }}</td></tr>
            </table>
            <a v-if="etat.dashboard" :href="etat.dashboard" target="_blank" rel="noopener" class="link">Ouvrir le projet sur Vercel →</a>
          </div>
        </div>
      </section>

      <nav class="foot">
        <NuxtLink to="/" class="link">Retour au jeu</NuxtLink>
        <NuxtLink to="/nimda/marge" class="link">Coûts &amp; marges</NuxtLink>
        <NuxtLink to="/nimda/monitorpaiement" class="link">Requêtes Stripe</NuxtLink>
      </nav>
    </main>

    <ClientOnly>
      <button type="button" class="btn reset" :disabled="resetting" @click="resetSession()">{{ resetting ? 'remise à zéro…' : 'Remise à zéro' }}</button>
    </ClientOnly>
  </div>
</template>

<style>
/* Afficheur à 7 segments, licence SIL OFL : https://github.com/keshikan/DSEG */
@font-face {
  font-family: 'DSEG7';
  src: url('https://cdn.jsdelivr.net/npm/dseg@0.46.0/fonts/DSEG7-Classic/DSEG7Classic-Bold.woff2') format('woff2');
  font-display: swap;
}
</style>

<style scoped>
.bourse {
  --up: #3ddc84;
  --down: #ff5c5c;
  --warn: #ffb547;
  --led: rgb(var(--neon-300));
  --panel: rgba(255, 255, 255, 0.025);
  --line: rgba(255, 255, 255, 0.09);
  --muted: rgb(var(--ink-300));
  min-height: 100dvh;
  background: #05070a;
  color: rgb(var(--ink-100));
  font-size: 13px;
}

/* La séance */
.top {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  gap: 16px;
  padding: 18px 24px;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(#0a0d12, #05070a);
}
.eyebrow, .k, .tile-code, .tile-label, .panel h2, .session, .clock-tz {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.18em;
}
.eyebrow { font-size: 10px; color: rgb(var(--neon-400) / 0.8); letter-spacing: 0.4em; }
.name { font-size: 20px; letter-spacing: 0.12em; margin-top: 4px; }
.sym { font-size: 11px; color: var(--muted); border: 1px solid var(--line); padding: 1px 6px; margin-left: 6px; vertical-align: middle; }
.session { font-size: 10px; margin-top: 8px; display: flex; align-items: center; gap: 8px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; animation: pulse 1.6s ease-in-out infinite; }

.clock { position: relative; display: grid; justify-items: center; }
.clock .led-ghost, .clock .led-on { grid-area: 1 / 1; font-size: clamp(34px, 7vw, 64px); }
.clock-tz { font-size: 9px; color: var(--muted); margin-top: 6px; }

.led-ghost, .led-on, .led-small { font-family: 'DSEG7', 'Courier New', monospace; font-style: normal; }
.led-ghost { color: var(--led); opacity: 0.07; }
.led-on { color: var(--led); text-shadow: 0 0 6px rgb(var(--neon-400) / 0.65), 0 0 18px rgb(var(--neon-500) / 0.35); }
.led-small { color: var(--led); font-size: 12px; text-shadow: 0 0 6px rgb(var(--neon-400) / 0.5); }

.meta { justify-self: end; text-align: right; display: grid; gap: 4px; font-size: 12px; }
.meta .k { font-size: 9px; color: var(--muted); margin-right: 6px; }
.btn { justify-self: end; margin-top: 4px; border: 1px solid var(--line); padding: 4px 10px; font-size: 11px; color: rgb(var(--ink-200)); }
.btn:hover:not(:disabled) { border-color: rgb(var(--neon-500) / 0.6); }
.btn:disabled { opacity: 0.5; }

/* Le bandeau défilant */
.tape { overflow: hidden; border-bottom: 1px solid var(--line); background: #080b0f; white-space: nowrap; }
.tape-track { display: inline-flex; animation: tape 70s linear infinite; }
.tape:hover .tape-track { animation-play-state: paused; }
.tape-item { display: inline-flex; gap: 8px; align-items: baseline; padding: 8px 22px; border-right: 1px solid var(--line); font-variant-numeric: tabular-nums; }
.tape-code { color: var(--muted); font-size: 11px; letter-spacing: 0.1em; }
.tape-value { color: rgb(var(--ink-100)); }
.tape-move { font-size: 11px; }

.good { color: var(--up); }
.bad { color: var(--down); }
.flat, .muted { color: var(--muted); }
.warn { color: var(--warn); }
.pill { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: currentColor; box-shadow: 0 0 8px currentColor; margin-right: 8px; }

.wrap { padding: 20px 24px 40px; display: grid; gap: 20px; }

/* Le tableau des cotes */
.board { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 8px; }
.tile { background: var(--panel); border: 1px solid var(--line); padding: 10px 12px 12px; display: grid; gap: 6px; align-content: start; }
.tile.alert { border-color: rgb(255 92 92 / 0.45); }
.tile-head { display: flex; justify-content: space-between; align-items: baseline; }
.tile-code { font-size: 11px; color: rgb(var(--neon-400) / 0.85); }
.tile-move { font-size: 11px; font-variant-numeric: tabular-nums; }
.tile-value { position: relative; display: grid; justify-content: start; align-items: baseline; grid-template-columns: auto auto; column-gap: 6px; }
.tile-value .led-ghost, .tile-value .led-on { grid-area: 1 / 1; font-size: 30px; line-height: 1.1; }
.tile-unit { grid-area: 1 / 2; font-size: 12px; color: var(--muted); }
.tile-label { font-size: 9px; color: rgb(var(--ink-200)); letter-spacing: 0.14em; }
.tile-note { font-size: 10px; color: var(--muted); }
.spark { display: flex; align-items: flex-end; gap: 2px; height: 26px; border-bottom: 1px solid var(--line); }
.spark-bar { flex: 1; min-width: 2px; background: rgb(var(--neon-500) / 0.7); border-radius: 2px 2px 0 0; }

.err { color: var(--down); font-size: 12px; }

/* Panneaux */
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 460px), 1fr)); gap: 20px; }
.panel { background: var(--panel); border: 1px solid var(--line); padding: 14px 16px; display: grid; gap: 10px; align-content: start; min-width: 0; }
.panel h2 { font-size: 11px; color: rgb(var(--ink-100)); display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; }
.panel h2 span { font-size: 9px; color: var(--muted); letter-spacing: 0.14em; }
.small { font-size: 11px; }
code { font-family: 'Courier New', monospace; color: rgb(var(--neon-300) / 0.9); font-size: 12px; }
.link { color: rgb(var(--neon-300)); font-size: 12px; }
.link:hover { text-decoration: underline; text-underline-offset: 4px; }

.tbl { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.tbl th { text-align: left; font-weight: normal; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); padding: 4px 8px 6px 0; }
.tbl td { border-top: 1px solid var(--line); padding: 5px 8px 5px 0; vertical-align: top; }
.tbl .num { text-align: right; white-space: nowrap; }
.t { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }

.wire { display: grid; gap: 6px; }
.wire > li { border-top: 1px solid var(--line); padding-top: 6px; }
.wire summary { cursor: pointer; line-height: 1.5; }
.wire summary > * { margin-right: 8px; }
.tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; border: 1px solid currentColor; padding: 0 5px; }
.trail { margin-top: 6px; padding-left: 16px; display: grid; gap: 3px; font-size: 11px; }
.trail b { font-weight: normal; text-transform: uppercase; font-size: 9px; color: var(--muted); margin-right: 6px; }

.infra { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 20px; }
.infra .k { font-size: 9px; color: var(--muted); margin-top: 8px; }
.infra .k:first-child { margin-top: 0; }

.foot { display: flex; flex-wrap: wrap; gap: 16px; }

.balance { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: 12px; }
.balance input { width: 120px; background: #05070a; border: 1px solid var(--line); padding: 4px 8px; color: rgb(var(--ink-100)); font-variant-numeric: tabular-nums; }
.balance input:focus { outline: none; border-color: rgb(var(--neon-500) / 0.6); }
.balance .btn { margin-top: 0; }
.balance input.wide { width: min(100%, 360px); }

.reset { position: fixed; right: 16px; bottom: 16px; z-index: 10; margin: 0; background: #0a0d12; }
.reset:hover:not(:disabled) { border-color: rgb(255 92 92 / 0.6); color: var(--down); }

@keyframes tape { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes pulse { 50% { opacity: 0.35; } }

@media (prefers-reduced-motion: reduce) {
  .tape-track, .dot { animation: none; }
  .tape { overflow-x: auto; }
}

@media (max-width: 760px) {
  .top { grid-template-columns: 1fr; justify-items: start; padding: 16px; }
  .clock { justify-self: center; }
  .meta { justify-self: stretch; text-align: left; }
  .btn { justify-self: start; }
  .wrap { padding: 16px; }
  .board { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .tile-value .led-ghost, .tile-value .led-on { font-size: 24px; }
}
</style>
