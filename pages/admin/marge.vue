<script setup lang="ts">
/**
 * Tableau de bord économique.
 *
 * Trois natures de chiffres, que la page ne mélange jamais :
 *  - MESURÉ : la taille d'entrée de chaque prompt, rendue depuis le script à
 *    chaque chargement (server/api/admin/economics.get.ts) ;
 *  - FACTURE et TARIF PUBLIC : les prix unitaires OpenAI, Stripe, Vercel ;
 *  - HYPOTHÈSE : les sorties, les volumes, la conversion (`economics`).
 */

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const { data, error } = await useFetch('/api/admin/economics')

// Curseurs. Initialisés depuis le script, ajustables à la main.
const visits = ref(10_000)
const conversionPct = ref(3)
const turnsPerScene = ref(6)
watch(data, (d) => {
  if (!d) return
  conversionPct.value = d.economics.conversion_rate_pct
  turnsPerScene.value = d.economics.play.turns_per_scene
}, { immediate: true })

const eur = (usd: number) => usd / (data.value?.economics.eur_usd ?? 1.08)
const fmt = (n: number, d = 2) =>
  new Intl.NumberFormat('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(n)
const money = (n: number) => `${fmt(n)} €`
const cents = (n: number, d = 2) => `${fmt(n * 100, d)} c`
const int = (n: number) => new Intl.NumberFormat('fr-FR').format(Math.round(n))

const TAG = {
  mesure: 'text-neon-300 border-neon-600/50',
  facture: 'text-ink-200 border-ink-300/40',
  tarif: 'text-ink-200 border-ink-300/40',
  hypothese: 'text-steel-400 border-steel-600/60',
} as const
const TAG_LABEL = { mesure: 'mesuré', facture: 'facture', tarif: 'tarif public', hypothese: 'hypothèse' } as const

/** Un appel texte, en euros. */
function call(input: number, output: number): number {
  const p = data.value?.pricing
  if (!p) return 0
  return eur(input / 1e6 * p.input_per_1m_usd + output / 1e6 * p.output_per_1m_usd)
}

const imageCost = computed(() => eur(data.value?.pricing.image_per_call_usd ?? 0))

/** Un tour : prompt mesuré, plus le fil du personnage qu'on lui renvoie. */
const turnCost = computed(() => {
  const d = data.value
  if (!d) return 0
  const t = d.economics.tokens
  return call(d.turn.input_tokens + t.turn_history_input, t.turn_output)
})

/** La nuit, scène par scène. */
const rows = computed(() => {
  const d = data.value
  if (!d) return []
  const t = d.economics.tokens
  const repair = d.economics.play.repair_rate_pct / 100

  return d.scenes.map((s) => {
    const output = s.role === 'opening' ? t.opening_output : s.role === 'ending' ? t.ending_output : t.scene_output
    // Une reprise renvoie le prompt, la réponse refusée et le motif : son entrée
    // vaut entrée + sortie. L'épilogue n'est jamais repris.
    const retry = s.role === 'ending' ? 0 : repair * call(s.input_tokens + output, output)
    const text = call(s.input_tokens, output) + retry
    const image = s.image ? imageCost.value : 0
    // L'épilogue se lit, il ne se joue pas.
    const turns = s.role === 'ending' ? 0 : turnsPerScene.value
    const turnsCost = turns * turnCost.value
    return { ...s, output, text, image, turns, turnsCost, total: text + image + turnsCost }
  })
})
type Row = (typeof rows.value)[number]
const sum = (xs: Row[], pick: (r: Row) => number) => xs.reduce((a, r) => a + pick(r), 0)

/** Ce que coûte la nuit d'un acheteur, de l'auberge à l'épilogue. */
const night = computed(() => {
  const r = rows.value
  const free = r.filter(x => x.free)
  const paid = r.filter(x => !x.free)
  return {
    total: sum(r, x => x.total),
    free: sum(free, x => x.total),
    paid: sum(paid, x => x.total),
    text: sum(r, x => x.text),
    images: sum(r, x => x.image),
    turns: sum(r, x => x.turnsCost),
    imageCount: r.filter(x => x.image).length,
    turnCount: sum(r, x => x.turns),
    inputTokens: sum(r, x => x.input_tokens),
  }
})

/** Qui s'arrête au sas : les scènes offertes, aux tours qu'il y joue. */
const visitorCost = computed(() => {
  const turns = data.value?.economics.play.free_visitor_turns ?? 0
  return sum(rows.value.filter(x => x.free), x => x.text + x.image + turns * turnCost.value)
})

const price = computed(() => data.value?.price.amount ?? 0)
const vatPerSale = computed(() => {
  const pct = data.value?.economics.vat.pct ?? 0
  return price.value * pct / (100 + pct)
})
const feePerSale = computed(() => {
  const p = data.value?.economics.payment
  return p ? price.value * p.fee_pct / 100 + p.fee_fixed_eur : 0
})
const netPerSale = computed(() => price.value - vatPerSale.value - feePerSale.value - night.value.total)

/** Le pire cas autorisé par les quotas, si quelqu'un les épuise. */
const ceilings = computed(() => {
  const l = data.value?.limits
  const r = rows.value
  if (!l || !r.length) return { free: 0, paid: 0 }
  const freeText = sum(r.filter(x => x.free), x => x.text) / Math.max(1, r.filter(x => x.free).length)
  const paidText = sum(r.filter(x => !x.free), x => x.text) / Math.max(1, r.filter(x => !x.free).length)
  return {
    free: l.scenes_per_session * freeText + l.turns_per_session * turnCost.value + l.images_per_session * imageCost.value,
    paid: l.paid.scenes_per_window * paidText + l.paid.turns_per_window * turnCost.value
      + l.paid.images_per_window * imageCost.value,
  }
})

/** Le plafond fixé pour l'IA d'une vente. */
const budget = computed(() => data.value?.economics.ai_budget_per_sale_eur ?? 3)

/**
 * La nuit jouée jusqu'au verrou dans chaque scène : le plus qu'un acheteur
 * puisse coûter sans recharger. Les rechargements, eux, sont gratuits depuis
 * que la scène et son image sont gardées par le navigateur.
 */
const maxNight = computed(() => {
  const lockTurns = data.value?.limits.lock.turns_per_scene ?? 0
  const playable = rows.value.filter(x => x.role !== 'ending').length
  return night.value.total + Math.max(0, lockTurns - turnsPerScene.value) * playable * turnCost.value
})

/** Vercel sur un mois : le forfait, et l'Analytics au-delà du crédit inclus. */
function hosting(v: number) {
  const h = data.value?.economics.hosting
  if (!h) return { analyticsUsd: 0, total: 0 }
  const analyticsUsd = v * h.events_per_visit / 1000 * h.analytics_per_1k_events_usd
  return { analyticsUsd, total: eur(h.plan_monthly_usd + Math.max(0, analyticsUsd - h.usage_credit_usd)) }
}

function project(v: number) {
  const buyers = v * conversionPct.value / 100
  const revenue = buyers * price.value
  const vat = buyers * vatPerSale.value
  const fees = buyers * feePerSale.value
  const aiVisitors = (v - buyers) * visitorCost.value
  const aiBuyers = buyers * night.value.total
  const host = hosting(v).total
  const net = revenue - vat - fees - aiVisitors - aiBuyers - host
  const netRevenue = revenue - vat
  return { buyers, revenue, vat, fees, aiVisitors, aiBuyers, host, net, margin: netRevenue ? net / netRevenue * 100 : 0 }
}

const current = computed(() => project(visits.value))
const scenarios = computed(() => [1_000, 10_000, 100_000, 1_000_000].map(v => ({ visits: v, ...project(v) })))

/**
 * Visites mensuelles à partir desquelles le forfait est couvert.
 *
 * Calculé sur le seul forfait : l'Analytics ne dépasse le crédit qu'autour de
 * 440 000 visites, bien après le seuil quand il existe.
 */
const breakEven = computed(() => {
  const h = data.value?.economics.hosting
  if (!h) return Infinity
  const rate = conversionPct.value / 100
  const perVisit = rate * netPerSale.value - (1 - rate) * visitorCost.value
  return perVisit > 0 ? eur(h.plan_monthly_usd) / perVisit : Infinity
})

/** Ce que la page sait être faux ou fragile dans ses propres entrées. */
const warnings = computed(() => {
  const d = data.value
  if (!d) return []
  const w: string[] = []
  if (!d.limits.enabled) {
    w.push('Quotas désactivés (limits.enabled à false) : les plafonds de dépense ci-dessous ne bornent rien aujourd’hui. '
      + `Le verrou (${d.limits.lock.turns_per_scene} tours par scène) et le cache du navigateur tiennent le joueur ordinaire ; `
      + 'celui qui vide les données du site régénère sans limite.')
  }
  if (ceilings.value.paid > budget.value) {
    w.push(`Le quota payant autorise ${money(ceilings.value.paid)} d’IA par vente, au-dessus du budget de ${money(budget.value)}. `
      + 'Baisser limits.paid.*_per_window.')
  }
  if (d.pricing.image_size_billed && d.pricing.image_size_billed !== d.models.image_size) {
    w.push(`Le prix image a été relevé sur facture en ${d.pricing.image_size_billed} ; les images sortent maintenant en `
      + `${d.models.image_size}. Le coût image est probablement surestimé — à recaler sur la prochaine facture.`)
  }
  const t = d.economics.tokens
  for (const s of d.scenes) {
    const output = s.role === 'opening' ? t.opening_output : s.role === 'ending' ? t.ending_output : t.scene_output
    if (output > s.max_tokens) w.push(`${s.id} : sortie supposée (${int(output)}) au-dessus de son plafond max_tokens (${int(s.max_tokens)}).`)
  }
  if (turnsPerScene.value > d.limits.lock.turns_per_scene) {
    w.push(`Plus de tours par scène que le verrou n’en autorise (${d.limits.lock.turns_per_scene}).`)
  }
  return w
})
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-5xl space-y-10">

      <div v-if="error" class="border border-neon-600/40 p-6 space-y-2">
        <p class="font-display uppercase tracking-[0.2em] text-neon-400 text-xs">Données indisponibles</p>
        <p class="text-ink-200/80 text-sm">
          Impossible de rendre les prompts de <code class="text-neon-300">game/script.json</code> :
          {{ error.statusMessage ?? error.message }}
        </p>
      </div>

      <template v-else-if="data">
        <header class="space-y-4">
          <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Économie du jeu</p>
          <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Coûts &amp; marges</h1>
          <div class="neon-rule w-32" />
          <p class="text-steel-400 text-[11px] leading-relaxed">
            {{ data.models.text }} pour le texte, {{ data.models.image }} en {{ data.models.image_size }} pour les images,
            Stripe pour l'encaissement, Vercel pour l'hébergement et l'Analytics.
          </p>
        </header>

        <!-- Ce que la page sait être fragile -->
        <section v-if="warnings.length" class="border border-red-400/40 p-5 space-y-2">
          <p class="font-display text-[10px] uppercase tracking-[0.28em] text-red-400">À savoir avant de lire</p>
          <ul class="text-red-300/90 text-xs leading-relaxed space-y-1.5 list-disc pl-4">
            <li v-for="w in warnings" :key="w">{{ w }}</li>
          </ul>
        </section>

        <!-- Le chiffre qui compte -->
        <section class="border border-neon-600/40 p-6 space-y-5">
          <p class="font-display text-[10px] uppercase tracking-[0.28em] text-neon-400/80">
            Une nuit complète — {{ rows.length }} scènes, {{ turnsPerScene }} tours chacune
          </p>
          <p class="neon-text font-display text-4xl">{{ money(night.total) }}</p>
          <p class="text-ink-200/80 text-sm leading-relaxed">
            Coût IA d'un acheteur, de l'auberge à l'épilogue. Dont {{ money(night.free) }} avant le sas
            — ce que vous offrez à chaque visiteur — et {{ money(night.paid) }} après.
          </p>
          <div class="grid gap-3 sm:grid-cols-3 pt-1">
            <div v-for="c in [
              { label: 'Images', value: night.images, detail: `${night.imageCount} générées` },
              { label: 'Générations de scène', value: night.text, detail: `${int(night.inputTokens)} jetons d'entrée, reprises comprises` },
              { label: 'Tours de jeu', value: night.turns, detail: `${int(night.turnCount)} au total` },
            ]" :key="c.label" class="space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display">{{ c.label }}</p>
              <p class="text-ink-100 font-display text-lg">{{ money(c.value) }}</p>
              <p class="text-ink-300 text-[11px]">
                {{ c.detail }} — {{ fmt(night.total ? c.value / night.total * 100 : 0, 0) }} % du total
              </p>
            </div>
          </div>
        </section>

        <!-- Scène par scène -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Scène par scène <span class="text-steel-400">— entrée mesurée, sortie supposée</span>
          </h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="text-steel-400 font-display text-[10px] uppercase tracking-[0.16em]">
                  <th class="text-left py-2 pr-4 font-normal">Scène</th>
                  <th class="text-right py-2 px-3 font-normal"><span class="text-neon-300">Entrée</span></th>
                  <th class="text-right py-2 px-3 font-normal">Sortie</th>
                  <th class="text-right py-2 px-3 font-normal">Texte</th>
                  <th class="text-right py-2 px-3 font-normal">Image</th>
                  <th class="text-right py-2 px-3 font-normal">Tours</th>
                  <th class="text-right py-2 pl-3 font-normal">Total</th>
                </tr>
              </thead>
              <tbody class="text-ink-200/85">
                <tr v-for="r in rows" :key="r.id" class="border-t border-steel-700/60">
                  <td class="py-2.5 pr-4">
                    <span class="font-display text-neon-300/90">{{ r.id }}</span>
                    <span class="text-steel-400 text-xs"> {{ r.title }}</span>
                    <span v-if="r.free" class="ml-2 border border-neon-600/50 px-1.5 text-[9px] uppercase tracking-[0.14em] text-neon-300">offerte</span>
                  </td>
                  <td class="py-2.5 px-3 text-right tabular-nums text-neon-300/90">{{ int(r.input_tokens) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums text-steel-400">{{ int(r.output) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ cents(r.text) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ r.image ? cents(r.image) : 'figée' }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ r.turns ? `${r.turns} × ${cents(turnCost)}` : '—' }}</td>
                  <td class="py-2.5 pl-3 text-right tabular-nums text-ink-100">{{ cents(r.total, 1) }}</td>
                </tr>
                <tr class="border-t border-neon-600/40 font-display">
                  <td class="py-2.5 pr-4 text-ink-100">Nuit</td>
                  <td class="py-2.5 px-3 text-right tabular-nums text-neon-300/90">{{ int(night.inputTokens) }}</td>
                  <td class="py-2.5 px-3" />
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ money(night.text) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ money(night.images) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ money(night.turns) }}</td>
                  <td class="py-2.5 pl-3 text-right tabular-nums text-neon-300">{{ money(night.total) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p class="text-ink-300 text-xs leading-relaxed">
            L'entrée est rendue depuis le script avec le dossier de démonstration, à raison de 4 caractères
            par jeton : c'est elle qui a changé de nature depuis la facture de référence — une génération de
            scène n'envoie plus 3 500 jetons mais plus de dix mille. Le texte inclut
            {{ data.economics.play.repair_rate_pct }} % de reprises après refus de validation, l'épilogue excepté.
          </p>
        </section>

        <!-- Prix unitaires -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">Prix unitaires</h2>
          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="c in [
              { label: `${data.models.text} — entrée`, value: `${fmt(data.pricing.input_per_1m_usd)} $ / 1M`, detail: `${cents(call(1000, 0), 3)} les 1 000 jetons`, tag: 'tarif' as const },
              { label: `${data.models.text} — sortie`, value: `${fmt(data.pricing.output_per_1m_usd)} $ / 1M`, detail: `${cents(call(0, 1000), 3)} les 1 000 jetons — 4 × l'entrée`, tag: 'tarif' as const },
              { label: `Une image`, value: cents(imageCost), detail: `relevée en ${data.pricing.image_size_billed ?? '?'}, qualité low`, tag: 'facture' as const },
              { label: 'Un tour de jeu', value: cents(turnCost), detail: `~${int(data.turn.input_tokens)} + ${int(data.economics.tokens.turn_history_input)} d'historique, ${int(data.economics.tokens.turn_output)} en sortie`, tag: 'mesure' as const },
              { label: 'Commission Stripe', value: money(feePerSale), detail: `${fmt(data.economics.payment.fee_pct)} % + ${money(data.economics.payment.fee_fixed_eur)} par vente`, tag: 'hypothese' as const },
              { label: 'Vercel', value: `${fmt(data.economics.hosting.plan_monthly_usd, 0)} $ / mois`, detail: `Pro, crédit de ${fmt(data.economics.hosting.usage_credit_usd, 0)} $ ; Analytics à ${fmt(data.economics.hosting.analytics_per_1k_events_usd)} $ les 1 000 événements`, tag: 'tarif' as const },
            ]" :key="c.label" class="border border-steel-600/60 p-4 space-y-1">
              <div class="flex items-start justify-between gap-2">
                <p class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display">{{ c.label }}</p>
                <span class="border px-1.5 text-[9px] uppercase tracking-[0.12em] whitespace-nowrap" :class="TAG[c.tag]">{{ TAG_LABEL[c.tag] }}</span>
              </div>
              <p class="text-neon-300 font-display text-xl">{{ c.value }}</p>
              <p class="text-ink-300 text-[11px]">{{ c.detail }}</p>
            </div>
          </div>
        </section>

        <!-- Par visiteur -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Par visiteur <span class="text-steel-400">— volumes estimés</span>
          </h2>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="border border-steel-600/60 p-5 space-y-3">
              <p class="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">Visiteur qui s'arrête au sas</p>
              <p class="text-ink-100 font-display text-2xl">{{ cents(visitorCost, 1) }}</p>
              <p class="text-ink-300 text-xs leading-relaxed">
                La génération de l'auberge — la plus lourde de la nuit, puisqu'elle écrit aussi le plan —
                et {{ data.economics.play.free_visitor_turns }} tours. Aucune image : l'auberge a son
                illustration figée.
              </p>
              <p class="text-steel-400 text-[11px]">
                Plafond si le quota est épuisé : {{ cents(ceilings.free, 1) }}
              </p>
            </div>
            <div class="border border-neon-600/40 p-5 space-y-3">
              <p class="font-display text-[10px] uppercase tracking-[0.2em] text-neon-400/80">Acheteur</p>
              <p class="font-display text-2xl" :class="netPerSale < 0 ? 'text-red-400' : 'text-neon-300'">{{ money(netPerSale) }} net</p>
              <ul class="text-ink-300 text-xs space-y-1">
                <li>Prix de vente : {{ money(price) }} TTC</li>
                <li>— TVA à {{ fmt(data.economics.vat.pct, 0) }} % : {{ money(vatPerSale) }}</li>
                <li>— commission Stripe : {{ money(feePerSale) }}</li>
                <li>— IA de sa nuit entière : {{ money(night.total) }}</li>
              </ul>
              <p class="text-neon-400/70 text-[11px]">
                Vous conservez {{ fmt(price ? netPerSale / price * 100 : 0, 0) }} % du prix.
              </p>
              <ul class="text-[11px] space-y-1 border-t border-steel-700/60 pt-2">
                <li class="text-steel-400">Budget IA par vente : {{ money(budget) }}</li>
                <li :class="maxNight > budget ? 'text-red-400' : 'text-ink-300'">
                  Nuit jouée jusqu'au verrou ({{ data.limits.lock.turns_per_scene }} tours partout) : {{ money(maxNight) }}
                </li>
                <li :class="ceilings.paid > budget ? 'text-red-400' : 'text-ink-300'">
                  Plafond si le quota de {{ data.limits.paid.window_days }} jours est épuisé : {{ money(ceilings.paid) }}
                  <span v-if="!data.limits.enabled" class="text-red-400">— quota éteint, rien ne le tient</span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <!-- Simulateur -->
        <section class="space-y-5 border-y border-neon-600/25 py-8">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">Simulateur <span class="text-steel-400">— sur un mois</span></h2>

          <div class="grid gap-6 sm:grid-cols-3">
            <label class="space-y-2 block">
              <span class="flex justify-between font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
                <span>Visites / mois</span><span class="text-neon-300">{{ int(visits) }}</span>
              </span>
              <input v-model.number="visits" type="range" min="100" max="1000000" step="100" class="w-full accent-neon-500">
            </label>
            <label class="space-y-2 block">
              <span class="flex justify-between font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
                <span>Conversion</span><span class="text-neon-300">{{ fmt(conversionPct, 1) }} %</span>
              </span>
              <input v-model.number="conversionPct" type="range" min="0.1" max="15" step="0.1" class="w-full accent-neon-500">
            </label>
            <label class="space-y-2 block">
              <span class="flex justify-between font-display text-[10px] uppercase tracking-[0.18em] text-steel-400">
                <span>Tours par scène</span><span class="text-neon-300">{{ turnsPerScene }}</span>
              </span>
              <input v-model.number="turnsPerScene" type="range" min="1" :max="data.limits.lock.turns_per_scene" step="1" class="w-full accent-neon-500">
            </label>
          </div>

          <div class="grid gap-3 sm:grid-cols-4">
            <div v-for="c in [
              { label: 'Acheteurs', value: int(current.buyers), bad: false },
              { label: 'Chiffre d\'affaires TTC', value: money(current.revenue), bad: false },
              { label: 'Coûts totaux', value: money(current.vat + current.fees + current.aiVisitors + current.aiBuyers + current.host), bad: false },
              { label: 'Résultat net', value: money(current.net), bad: current.net < 0 },
            ]" :key="c.label" class="border border-steel-600/60 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display">{{ c.label }}</p>
              <p class="font-display text-lg" :class="c.bad ? 'text-red-400' : 'text-ink-100'">{{ c.value }}</p>
            </div>
          </div>

          <ul class="text-ink-300 text-xs leading-relaxed grid gap-1 sm:grid-cols-2">
            <li>IA des {{ int(visits - current.buyers) }} visiteurs qui ne paient pas : {{ money(current.aiVisitors) }}</li>
            <li>IA des acheteurs : {{ money(current.aiBuyers) }}</li>
            <li>TVA et Stripe : {{ money(current.vat + current.fees) }}</li>
            <li>
              Vercel : {{ money(current.host) }}
              <span class="text-steel-400">— Analytics {{ fmt(hosting(visits).analyticsUsd) }} $, dans le crédit jusqu'à
                {{ int(data.economics.hosting.usage_credit_usd / data.economics.hosting.analytics_per_1k_events_usd * 1000 / data.economics.hosting.events_per_visit) }} visites</span>
            </li>
          </ul>
        </section>

        <!-- Scénarios -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Si ça prend <span class="text-steel-400">— à {{ fmt(conversionPct, 1) }} % de conversion, {{ turnsPerScene }} tours par scène</span>
          </h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="text-steel-400 font-display text-[10px] uppercase tracking-[0.16em]">
                  <th class="text-left py-2 pr-4 font-normal">Visites / mois</th>
                  <th class="text-right py-2 px-3 font-normal">Acheteurs</th>
                  <th class="text-right py-2 px-3 font-normal">CA TTC</th>
                  <th class="text-right py-2 px-3 font-normal">IA gratuits</th>
                  <th class="text-right py-2 px-3 font-normal">IA acheteurs</th>
                  <th class="text-right py-2 px-3 font-normal">Vercel</th>
                  <th class="text-right py-2 px-3 font-normal">Net</th>
                  <th class="text-right py-2 pl-3 font-normal">Marge</th>
                </tr>
              </thead>
              <tbody class="text-ink-200/85">
                <tr v-for="s in scenarios" :key="s.visits" class="border-t border-steel-700/60">
                  <td class="py-2.5 pr-4 font-display text-neon-300/90">{{ int(s.visits) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ int(s.buyers) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums">{{ money(s.revenue) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums text-steel-400">{{ money(s.aiVisitors) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums text-steel-400">{{ money(s.aiBuyers) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums text-steel-400">{{ money(s.host) }}</td>
                  <td class="py-2.5 px-3 text-right tabular-nums" :class="s.net < 0 ? 'text-red-400' : 'text-ink-100'">
                    {{ money(s.net) }}
                  </td>
                  <td class="py-2.5 pl-3 text-right tabular-nums">{{ fmt(s.margin, 0) }} %</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="breakEven === Infinity" class="text-red-400/90 text-xs leading-relaxed">
            À ce taux de conversion, chaque visite coûte plus qu'elle ne rapporte : le résultat devient
            d'autant plus négatif que le trafic augmente. Un buzz serait une mauvaise nouvelle.
          </p>
          <p v-else class="text-ink-300 text-xs leading-relaxed">
            À ce taux, chaque visite est rentable en moyenne : le forfait Vercel est couvert à partir de
            <strong class="text-ink-100">{{ int(Math.ceil(breakEven)) }} visites par mois</strong>, et le résultat
            croît avec le trafic au-delà.
          </p>
        </section>

        <p class="text-steel-400 text-[11px] leading-relaxed border-t border-steel-700/60 pt-5">
          Mesuré : l'entrée des prompts, rendue à chaque chargement depuis
          <code class="text-neon-300/80">game/script.json</code>. Facture : le prix image. Tarifs publics :
          OpenAI et Vercel, relevés le 13/09/2026. <strong class="text-ink-200">Hypothèses</strong> : les sorties,
          les reprises, les tours joués, la conversion, la TVA et la commission Stripe, déclarées sous
          <code class="text-neon-300/80">economics</code>. À réviser dès qu'il existe une facture sur la nuit à
          {{ rows.length }} scènes et du trafic réel.
        </p>
      </template>
    </div>
  </div>
</template>
