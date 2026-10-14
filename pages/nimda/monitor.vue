<script setup lang="ts">
/**
 * La prod en direct : Vercel, OpenAI et Stripe sur une page.
 *
 * Chaque bloc se charge seul (server/api/admin/monitor/*) : les métriques et
 * les journaux de Vercel prennent une quinzaine de secondes, le reste
 * s'affiche avant. Les paiements viennent de /api/admin/payments, la même
 * source que /nimda/monitorpaiement. Rien ici n'appelle un modèle.
 */

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const lazy = { lazy: true, server: false } as const
const { data: etat, error: etatError, status: etatStatus, refresh: refreshEtat } = useFetch('/api/admin/monitor/etat', lazy)
const { data: trafic, error: traficError, status: traficStatus, refresh: refreshTrafic } = useFetch('/api/admin/monitor/trafic', lazy)
const { data: journal, error: journalError, status: journalStatus, refresh: refreshJournal } = useFetch('/api/admin/monitor/journal', lazy)
const { data: openai, error: openaiError, status: openaiStatus, refresh: refreshOpenai } = useFetch('/api/admin/monitor/openai', lazy)
const { data: stripe, error: stripeError, status: stripeStatus, refresh: refreshStripe } = useFetch('/api/admin/payments', lazy)

const busy = computed(() => [etatStatus, traficStatus, journalStatus, openaiStatus, stripeStatus].some(s => s.value === 'pending'))
function refreshAll() {
  refreshEtat(); refreshTrafic(); refreshJournal(); refreshOpenai(); refreshStripe()
}

const int = (n: number) => new Intl.NumberFormat('fr-FR').format(n)
const usd = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD' }).format(n)
const money = (cents: number, currency = 'eur') =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
const date = (ms: number) => new Date(ms).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`
const seconds = (ms: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(ms / 1000)} s`
const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' })
function ago(ms: number) {
  const min = Math.round((ms - Date.now()) / 60_000)
  if (Math.abs(min) < 60) return rtf.format(min, 'minute')
  if (Math.abs(min) < 48 * 60) return rtf.format(Math.round(min / 60), 'hour')
  return rtf.format(Math.round(min / 1440), 'day')
}
const reason = (e: { statusMessage?: string; message?: string } | null | undefined) => e?.statusMessage ?? e?.message ?? ''

/** Le palier des pages de statut, en clair. */
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
  '/api/payment/invite': 'code d’invitation',
  '/api/paywall': 'paywall sans scène',
  '/api/lockout': 'ville fermée',
  '/api/keepsake': 'PDF de la nuit',
  '/api/dev/forget': 'mémoire vide (test)',
}

const STRIPE_STATUS: Record<string, string> = {
  requires_payment_method: 'formulaire ouvert',
  requires_confirmation: 'à confirmer',
  requires_action: '3-D Secure',
  processing: 'en cours',
  succeeded: 'payé',
  canceled: 'annulé',
}

/** Les appels sortants, un hôte par ligne : ce qui est passé, et les refus code par code. */
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

const trafficMax = computed(() => Math.max(1, ...(trafic.value?.daily ?? []).map(d => d.ok + d.refused + d.failed)))
const failedDays = computed(() => (trafic.value?.daily ?? []).filter(d => d.failed > 0))
const costMax = computed(() => Math.max(0.01, ...(openai.value?.configured ? openai.value.daily.map(d => d.usd) : [])))

const paid = computed(() => stripe.value?.statuses.succeeded ?? 0)
const conversion = computed(() => {
  const opened = stripe.value?.server.creates ?? 0
  return opened ? Math.round((paid.value / opened) * 100) : null
})
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-5xl space-y-12">

      <header class="space-y-4">
        <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Admin — en direct</p>
        <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">La prod</h1>
        <div class="neon-rule w-32" />
        <p class="text-ink-200/85 text-sm leading-relaxed">
          Vercel, OpenAI et Stripe, lus à l’instant depuis ce poste. Chaque bloc se charge seul : les métriques et
          les journaux de Vercel prennent une quinzaine de secondes. Aucune lecture ne consomme de jetons.
        </p>
        <!-- Les lectures ne partent que du navigateur : le serveur ne sait pas qu'elles sont en cours. -->
        <ClientOnly>
          <button
            type="button" :disabled="busy"
            class="border border-steel-600/60 hover:border-neon-600/60 px-3 py-1.5 text-xs text-ink-200 disabled:opacity-50"
            @click="refreshAll()"
          >
            {{ busy ? 'lecture…' : 'Tout relire' }}
          </button>
        </ClientOnly>
      </header>

      <!-- En ce moment -->
      <section class="space-y-4">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">En ce moment</h2>
        <p v-if="etatError" class="text-red-300/90 text-sm">{{ reason(etatError) }}</p>
        <p v-else-if="!etat" class="text-steel-400 text-xs">lecture de Vercel…</p>
        <template v-else>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div class="border p-4 space-y-1" :class="etat.ping && etat.ping.status < 400 ? 'border-neon-600/40' : 'border-red-400/40'">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Site</p>
              <p class="text-ink-100 text-sm break-words">{{ etat.host ?? 'domaine inconnu' }}</p>
              <p v-if="etat.ping" class="font-display text-lg" :class="etat.ping.status < 400 ? 'text-neon-300' : 'text-red-300'">
                {{ etat.ping.status }} <span class="text-ink-300 text-xs">en {{ int(etat.ping.ms) }} ms</span>
              </p>
              <p v-else class="text-red-300/90 text-xs">{{ etat.errors.site ?? 'pas de réponse' }}</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">En ligne</p>
              <template v-if="etat.prod">
                <p class="text-ink-100 text-sm">{{ etat.prod.message ?? etat.prod.url }}</p>
                <p class="text-ink-300 text-xs"><code class="text-steel-400">{{ etat.prod.sha }}</code> · {{ ago(etat.prod.createdAt) }}</p>
                <p v-if="etat.ahead === 0" class="text-neon-300/90 text-xs">main local = prod</p>
                <p v-else-if="etat.ahead" class="text-ink-200 text-xs">{{ etat.ahead }} commit{{ etat.ahead > 1 ? 's' : '' }} local{{ etat.ahead > 1 ? 'aux' : '' }} pas encore en ligne</p>
              </template>
            </div>
            <a
              v-for="s in etat.status" :key="s.name" :href="s.url" target="_blank" rel="noopener"
              class="border p-4 space-y-1 hover:border-neon-600/60" :class="s.indicator === 'none' ? 'border-steel-600/60' : 'border-red-400/40'"
            >
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Statut {{ s.name }}</p>
              <p class="font-display text-lg" :class="s.indicator === 'none' ? 'text-neon-300' : 'text-red-300'">{{ INDICATOR[s.indicator] ?? s.indicator }}</p>
              <p class="text-ink-300 text-xs">{{ s.description }}</p>
            </a>
          </div>
          <p v-if="etat.alerts?.length" class="text-red-300/90 text-sm">
            Alertes Vercel : {{ etat.alerts.join(' · ') }}
          </p>
          <p v-for="(msg, name) in etat.errors" :key="name" class="text-red-300/90 text-xs">{{ name }} — {{ msg }}</p>
        </template>
      </section>

      <!-- Erreurs -->
      <section class="space-y-4">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
          Erreurs des fonctions <span class="text-steel-400">— {{ journal?.hours ?? 24 }} dernières heures</span>
        </h2>
        <p v-if="journalError" class="text-red-300/90 text-sm">{{ reason(journalError) }}</p>
        <p v-else-if="!journal" class="text-steel-400 text-xs">lecture des journaux…</p>
        <p v-else-if="journal.gaveUpAfter" class="text-ink-300 text-sm">
          Aucune erreur remontée : la recherche s’est arrêtée au bout de {{ journal.gaveUpAfter }} s.
        </p>
        <p v-else-if="!journal.lines.length" class="text-neon-300/90 text-sm">Aucune erreur.</p>
        <ul v-else class="space-y-2">
          <li v-for="l in journal.lines" :key="l.id" class="border-t border-steel-700/60 pt-2">
            <details>
              <summary class="cursor-pointer text-sm text-ink-200/90 leading-snug">
                <span class="text-steel-400 text-xs whitespace-nowrap">{{ date(l.at) }}</span> <code class="text-neon-300/90 text-xs">{{ l.method }} {{ l.path }} → {{ l.status }}</code> <span class="text-red-300/90">{{ l.message }}</span>
              </summary>
              <ul class="mt-2 pl-4 space-y-1">
                <li v-for="(t, i) in l.trail" :key="i" class="text-xs leading-snug" :class="t.level === 'error' ? 'text-red-300/90' : 'text-ink-300'">
                  <span class="text-steel-400 uppercase text-[10px]">{{ t.level }}</span> {{ t.message }}
                </li>
              </ul>
            </details>
          </li>
        </ul>
      </section>

      <!-- Joueurs -->
      <section class="space-y-5">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
          Fréquentation <span class="text-steel-400">— {{ trafic?.days ?? 7 }} derniers jours, prod</span>
        </h2>
        <p v-if="traficError" class="text-red-300/90 text-sm">{{ reason(traficError) }}</p>
        <p v-else-if="!trafic" class="text-steel-400 text-xs">lecture des métriques…</p>
        <template v-else>
          <div class="grid gap-3 sm:grid-cols-3">
            <div class="border border-neon-600/40 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Visiteurs uniques</p>
              <p class="neon-text font-display text-3xl">{{ trafic.visitors == null ? '—' : int(trafic.visitors) }}</p>
              <p class="text-ink-300 text-[11px]">Web Analytics, navigateurs qui ont exécuté le script</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Pages vues</p>
              <p class="text-ink-100 font-display text-3xl">{{ trafic.views == null ? '—' : int(trafic.views) }}</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-2">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">D’où</p>
              <p class="flex flex-wrap gap-x-3 text-ink-200 text-xs leading-relaxed">
                <span v-for="c in trafic.countries ?? []" :key="c.country"><span class="text-ink-100 tabular-nums">{{ int(c.visitors) }}</span> {{ c.country }}</span>
              </p>
              <p class="flex flex-wrap gap-x-3 text-ink-200 text-xs leading-relaxed">
                <span v-for="r in trafic.referrers ?? []" :key="r.host"><span class="text-ink-100 tabular-nums">{{ int(r.views) }}</span> {{ r.host || 'accès direct' }}</span>
              </p>
            </div>
          </div>

          <div class="space-y-2">
            <p class="text-ink-200/85 text-sm">Requêtes reçues par les fonctions, jour par jour (UTC), robots compris</p>
            <div class="flex items-end gap-1 h-28 border-b border-steel-600/60">
              <div
                v-for="d in trafic.daily" :key="d.day" class="flex-1 h-full flex items-end"
                :title="`${shortDay(d.day)} — ${int(d.ok + d.refused + d.failed)} requêtes : ${int(d.ok)} servies, ${int(d.refused)} refusées (4xx), ${int(d.failed)} en échec (5xx)`"
              >
                <div class="w-full bg-neon-500/70" :style="{ height: `${(d.ok + d.refused + d.failed) / trafficMax * 100}%`, borderRadius: '4px 4px 0 0' }" />
              </div>
            </div>
            <div v-if="trafic.daily.length" class="flex justify-between text-[10px] text-steel-400">
              <span>{{ shortDay(trafic.daily[0].day) }}</span><span>{{ shortDay(trafic.daily[trafic.daily.length - 1].day) }}</span>
            </div>
            <p v-if="failedDays.length" class="flex flex-wrap gap-x-3 text-red-300/90 text-xs">
              <span>Échecs serveur (5xx) :</span><span v-for="d in failedDays" :key="d.day">{{ shortDay(d.day) }} × {{ d.failed }}</span>
            </p>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="text-steel-400 font-display text-[10px] uppercase tracking-[0.16em]">
                  <th class="text-left py-2 pr-4 font-normal">Route du jeu</th>
                  <th class="text-right py-2 px-3 font-normal">Appels</th>
                  <th class="text-right py-2 px-3 font-normal">Refusés (4xx)</th>
                  <th class="text-right py-2 pl-3 font-normal">En échec (5xx)</th>
                </tr>
              </thead>
              <tbody class="text-ink-200/85">
                <tr v-for="r in trafic.api" :key="r.path" class="border-t border-steel-700/60">
                  <td class="py-2 pr-4">
                    <code class="text-neon-300/90 text-xs">{{ r.path }}</code>
                    <span v-if="ROUTES[r.path]" class="text-ink-300 text-xs"> — {{ ROUTES[r.path] }}</span>
                  </td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ int(r.total) }}</td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ r.refused ? int(r.refused) : '' }}</td>
                  <td class="py-2 pl-3 text-right tabular-nums" :class="r.failed ? 'text-red-300/90' : ''">{{ r.failed ? int(r.failed) : '' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-for="(msg, name) in trafic.errors" :key="name" class="text-red-300/90 text-xs">{{ name }} — {{ msg }}</p>
        </template>
      </section>

      <!-- Stripe -->
      <section class="space-y-5">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
          Paiements Stripe <span class="text-steel-400">— {{ stripe?.days ?? 30 }} derniers jours<template v-if="stripe">, {{ stripe.livemode === false ? 'mode test' : stripe.livemode ? 'mode live' : 'mode inconnu' }}</template></span>
        </h2>
        <p v-if="stripeError" class="text-red-300/90 text-sm">{{ reason(stripeError) }}</p>
        <p v-else-if="!stripe" class="text-steel-400 text-xs">lecture de Stripe…</p>
        <template v-else>
          <div class="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <div class="border border-neon-600/40 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Encaissé</p>
              <p class="neon-text font-display text-3xl">{{ money(stripe.revenue, stripe.recent[0]?.currency) }}</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Nuits payées</p>
              <p class="text-ink-100 font-display text-3xl">{{ int(paid) }}</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Paywalls ouverts</p>
              <p class="text-ink-100 font-display text-3xl">{{ int(stripe.server.creates) }}</p>
              <p v-if="conversion != null" class="text-ink-300 text-[11px]">{{ conversion }} % payés</p>
            </div>
            <div class="border p-4 space-y-1" :class="stripe.charges.failed ? 'border-red-400/40' : 'border-steel-600/60'">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">Cartes refusées</p>
              <p class="font-display text-3xl" :class="stripe.charges.failed ? 'text-red-300' : 'text-ink-100'">{{ int(stripe.charges.failed) }}</p>
              <p v-if="stripe.refusals[0]" class="text-ink-300 text-[11px]">surtout {{ stripe.refusals[0].reason }}</p>
            </div>
          </div>
          <ul class="text-sm space-y-1">
            <li v-for="p in stripe.recent.slice(0, 6)" :key="p.id" class="flex flex-wrap gap-x-3 border-t border-steel-700/60 pt-1">
              <span class="text-steel-400 text-xs">{{ date(p.created * 1000) }}</span>
              <span class="text-ink-100 tabular-nums text-xs">{{ money(p.amount, p.currency) }}</span>
              <span class="text-xs" :class="p.status === 'succeeded' ? 'text-neon-300/90' : 'text-ink-300'">{{ STRIPE_STATUS[p.status] ?? p.status }}</span>
              <span v-if="p.error" class="text-red-300/90 text-xs">{{ p.error }}</span>
            </li>
          </ul>
          <NuxtLink to="/nimda/monitorpaiement" class="inline-block text-xs text-neon-300 hover:underline underline-offset-4">Le détail des requêtes Stripe →</NuxtLink>
        </template>
      </section>

      <!-- OpenAI -->
      <section class="space-y-5">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">OpenAI</h2>
        <p v-if="openaiError" class="text-red-300/90 text-sm">{{ reason(openaiError) }}</p>
        <p v-else-if="!openai" class="text-steel-400 text-xs">lecture d’OpenAI…</p>
        <div v-else-if="!openai.configured" class="border border-steel-600/60 p-5 space-y-2 text-sm text-ink-200/85 leading-relaxed">
          <p>
            Les dépenses se lisent avec une <span class="text-ink-100">clé d’administration</span> : la clé du jeu n’y a pas accès.
            Un Owner la crée dans
            <a href="https://platform.openai.com/settings/organization/admin-keys" target="_blank" rel="noopener" class="text-neon-300 hover:underline underline-offset-4">Settings → Admin keys</a>,
            puis on l’ajoute au <code class="text-neon-300">.env</code> local seulement :
          </p>
          <pre class="text-xs text-neon-300/90">OPENAI_ADMIN_KEY=sk-admin-…</pre>
          <p class="text-ink-300 text-xs">Relancer le serveur de dev ensuite. En attendant, les appels vus depuis Vercel sont juste en dessous.</p>
        </div>
        <template v-else>
          <div class="grid gap-3 grid-cols-3">
            <div v-for="t in [
              { label: 'Aujourd’hui (UTC)', value: openai.today },
              { label: '7 jours', value: openai.week },
              { label: `${openai.days} jours`, value: openai.month },
            ]" :key="t.label" class="border border-steel-600/60 p-4 space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">{{ t.label }}</p>
              <p class="text-ink-100 font-display text-2xl">{{ usd(t.value) }}</p>
            </div>
          </div>
          <div class="space-y-2">
            <p class="text-ink-200/85 text-sm">Dépense jour par jour, en dollars — OpenAI la met à jour avec quelques heures de retard</p>
            <div class="flex items-end gap-1 h-28 border-b border-steel-600/60">
              <div v-for="d in openai.daily" :key="d.day" class="flex-1 h-full flex items-end" :title="`${shortDay(d.day)} — ${usd(d.usd)}`">
                <div class="w-full bg-neon-500/70" :style="{ height: `${d.usd / costMax * 100}%`, borderRadius: '4px 4px 0 0' }" />
              </div>
            </div>
            <div v-if="openai.daily.length" class="flex justify-between text-[10px] text-steel-400">
              <span>{{ shortDay(openai.daily[0].day) }}</span><span>{{ shortDay(openai.daily[openai.daily.length - 1].day) }}</span>
            </div>
          </div>
          <div class="grid gap-8 sm:grid-cols-2">
            <div class="space-y-2">
              <p class="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">Par poste, {{ openai.days }} jours</p>
              <ul class="text-sm space-y-1">
                <li v-for="i in openai.items" :key="i.name" class="flex justify-between gap-4 border-t border-steel-700/60 pt-1">
                  <span class="text-ink-200/85 text-xs">{{ i.name }}</span><span class="text-ink-100 tabular-nums text-xs">{{ usd(i.usd) }}</span>
                </li>
              </ul>
            </div>
            <div class="space-y-2 overflow-x-auto">
              <p class="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">Texte, {{ openai.days }} jours</p>
              <table class="w-full text-xs border-collapse">
                <thead>
                  <tr class="text-steel-400 text-[10px]">
                    <th class="text-left py-1 pr-3 font-normal">modèle</th>
                    <th class="text-right py-1 px-2 font-normal">requêtes</th>
                    <th class="text-right py-1 px-2 font-normal">entrée</th>
                    <th class="text-right py-1 px-2 font-normal">dont cache</th>
                    <th class="text-right py-1 pl-3 font-normal">sortie</th>
                  </tr>
                </thead>
                <tbody class="text-ink-200/85">
                  <tr v-for="m in openai.models" :key="m.model" class="border-t border-steel-700/60">
                    <td class="py-1 pr-3">{{ m.model }}</td>
                    <td class="py-1 px-2 text-right tabular-nums">{{ int(m.requests) }}</td>
                    <td class="py-1 px-2 text-right tabular-nums">{{ int(m.input) }}</td>
                    <td class="py-1 px-2 text-right tabular-nums">{{ int(m.cached) }}</td>
                    <td class="py-1 pl-3 text-right tabular-nums">{{ int(m.output) }}</td>
                  </tr>
                </tbody>
              </table>
              <p v-for="m in openai.images" :key="m.model" class="text-ink-200/85 text-xs">
                Images {{ m.model }} : <span class="text-ink-100 tabular-nums">{{ int(m.images) }}</span> en {{ int(m.requests) }} requêtes
              </p>
            </div>
          </div>
        </template>

        <div v-if="trafic" class="space-y-2">
          <p class="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">Appels sortants vus par Vercel, {{ trafic.days }} jours</p>
          <ul class="text-sm space-y-1">
            <li v-for="h in outbound" :key="h.host" class="flex flex-wrap gap-x-3 border-t border-steel-700/60 pt-1 text-xs">
              <code class="text-neon-300/90">{{ h.host }}</code>
              <span class="text-ink-200"><span class="text-ink-100 tabular-nums">{{ int(h.ok) }}</span> réussis</span>
              <span v-for="f in h.failures" :key="f.status" class="text-red-300/90">{{ int(f.count) }} × {{ f.status }}</span>
            </li>
          </ul>
          <p v-if="outbound.some(h => h.failures.some(f => f.status === 429))" class="text-ink-300 text-xs leading-relaxed">
            Un 429 d’OpenAI est un refus : limite de débit atteinte, ou crédit épuisé. Rien n’est facturé, mais le joueur n’a pas eu sa scène.
          </p>
          <p v-for="d in trafic.openaiMs ?? []" :key="d.path" class="text-ink-300 text-xs">
            <code class="text-steel-400">{{ d.path }}</code> répond en {{ seconds(d.avg) }} en moyenne
          </p>
        </div>
      </section>

      <!-- Vercel -->
      <section v-if="etat" class="space-y-5">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
          Vercel
          <span v-if="etat.project" class="text-steel-400">— {{ etat.project.name }}, {{ etat.project.framework }}, Node {{ etat.project.node }}, {{ etat.project.region }}</span>
        </h2>

        <div class="overflow-x-auto">
          <table class="w-full text-sm border-collapse">
            <tbody class="text-ink-200/85">
              <tr v-for="d in etat.deployments ?? []" :key="d.url" class="border-t border-steel-700/60">
                <td class="py-2 pr-3 text-xs whitespace-nowrap" :class="d.state === 'READY' ? 'text-ink-300' : d.state === 'ERROR' ? 'text-red-300/90' : 'text-ink-100'">
                  {{ d.state }}<span v-if="d.live" class="text-neon-300"> · en ligne</span>
                </td>
                <td class="py-2 px-3 text-xs text-steel-400 whitespace-nowrap">{{ d.target }}</td>
                <td class="py-2 px-3 text-xs">{{ d.message ?? d.url }} <code v-if="d.sha" class="text-steel-400">{{ d.sha }}</code></td>
                <td class="py-2 px-3 text-xs text-steel-400 whitespace-nowrap">{{ ago(d.createdAt) }}</td>
                <td class="py-2 pl-3 text-xs text-right tabular-nums whitespace-nowrap">{{ d.buildMs ? seconds(d.buildMs) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="grid gap-8 sm:grid-cols-2">
          <div class="space-y-2">
            <p class="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">Variables de prod</p>
            <ul class="text-xs space-y-1">
              <li v-for="e in etat.env ?? []" :key="e.key" class="flex flex-wrap justify-between gap-x-4 border-t border-steel-700/60 pt-1">
                <code class="text-ink-100">{{ e.key }}</code>
                <span :class="e.stale ? 'text-red-300/90' : 'text-steel-400'">
                  {{ e.stale ? `changée ${ago(e.updatedAt)}, après le déploiement en ligne : redéployer` : `posée ${ago(e.updatedAt)}` }}
                </span>
              </li>
            </ul>
          </div>
          <div v-if="etat.usage" class="space-y-2">
            <p class="font-display text-[10px] uppercase tracking-[0.2em] text-steel-400">
              Facture du {{ new Date(etat.usage.from).toLocaleDateString('fr-FR') }} au {{ new Date(etat.usage.to).toLocaleDateString('fr-FR') }}
            </p>
            <p class="text-ink-100 font-display text-2xl">{{ usd(etat.usage.total) }}</p>
            <p v-if="etat.usage.credit" class="text-ink-300 text-xs">
              Crédit inclus : {{ usd(etat.usage.credit.used) }} consommés sur {{ usd(etat.usage.credit.allocated) }}
            </p>
            <ul class="text-xs space-y-1">
              <li v-for="s in etat.usage.services" :key="s.name" class="flex justify-between gap-4 border-t border-steel-700/60 pt-1">
                <span class="text-ink-200/85">{{ s.name }} <span class="text-steel-400">— {{ int(Math.round(s.quantity * 100) / 100) }} {{ s.unit }}</span></span>
                <span class="text-ink-100 tabular-nums">{{ usd(s.cost) }}</span>
              </li>
            </ul>
          </div>
        </div>
        <a v-if="etat.dashboard" :href="etat.dashboard" target="_blank" rel="noopener" class="inline-block text-xs text-neon-300 hover:underline underline-offset-4">Ouvrir le projet sur Vercel →</a>
      </section>

      <nav class="flex flex-wrap gap-4 text-xs">
        <NuxtLink to="/" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Retour au jeu</NuxtLink>
        <NuxtLink to="/nimda/marge" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Coûts &amp; marges</NuxtLink>
        <NuxtLink to="/nimda/monitorpaiement" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Requêtes Stripe</NuxtLink>
      </nav>
    </div>
  </div>
</template>
