<script setup lang="ts">
/**
 * Les requêtes faites à Stripe, lues chez Stripe.
 *
 * Rien n'est compté de notre côté : tout est reconstitué depuis les objets du
 * compte (server/api/admin/payments.get.ts). Le compte exact, lectures de
 * Stripe.js comprises, reste dans Workbench → Logs.
 */

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const { data, error, status, refresh } = await useFetch('/api/admin/payments')

const int = (n: number) => new Intl.NumberFormat('fr-FR').format(n)
const date = (unix: number) => new Date(unix * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
const amount = (cents: number, currency: string) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

const STATUS: Record<string, string> = {
  requires_payment_method: 'formulaire ouvert, rien payé',
  requires_confirmation: 'à confirmer',
  requires_action: '3-D Secure en attente',
  processing: 'en cours',
  succeeded: 'payé',
  canceled: 'annulé',
}

const serverTotal = computed(() => {
  const s = data.value?.server
  return s ? s.creates + s.retrieves + s.updates : 0
})
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-4xl space-y-10">

      <div v-if="error" class="border border-neon-600/40 p-6 space-y-2">
        <p class="font-display uppercase tracking-[0.2em] text-neon-400 text-xs">Stripe injoignable</p>
        <p class="text-ink-200/80 text-sm">{{ error.statusMessage ?? error.message }}</p>
      </div>

      <template v-else-if="data">
        <header class="space-y-4">
          <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">
            Admin — paiements · {{ data.livemode === false ? 'mode test' : data.livemode ? 'mode live' : 'mode inconnu' }}
          </p>
          <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Requêtes Stripe</h1>
          <div class="neon-rule w-32" />
          <p class="text-ink-200/85 text-sm leading-relaxed">
            Les {{ data.days }} derniers jours, lus avec notre clé. Stripe ne donne pas ses journaux de requêtes par l'API :
            ces chiffres sont reconstitués depuis les paiements et leurs événements. Le compte exact, lectures de Stripe.js
            comprises, est dans
            <a href="https://dashboard.stripe.com/workbench/logs" target="_blank" rel="noopener" class="text-neon-300 hover:underline underline-offset-4">Workbench → Logs</a>.
          </p>
          <button
            type="button" :disabled="status === 'pending'"
            class="border border-steel-600/60 hover:border-neon-600/60 px-3 py-1.5 text-xs text-ink-200 disabled:opacity-50"
            @click="refresh()"
          >
            {{ status === 'pending' ? 'lecture…' : 'Relire Stripe' }}
          </button>
        </header>

        <section v-if="data.truncated" class="border border-red-400/40 p-5">
          <p class="text-red-300/90 text-xs">Plus de 5 000 objets sur la période : les chiffres sont tronqués.</p>
        </section>

        <!-- Nos appels, clé secrète -->
        <section class="border border-neon-600/40 p-6 space-y-5">
          <p class="font-display text-[10px] uppercase tracking-[0.28em] text-neon-400/80">Requêtes de notre serveur</p>
          <p class="neon-text font-display text-4xl">{{ int(serverTotal) }}</p>
          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="c in [
              { label: 'POST /payment_intents', value: data.server.creates, detail: 'un par paywall ouvert — /api/payment/intent' },
              { label: 'GET /payment_intents/:id', value: data.server.retrieves, detail: 'relecture du paiement — /api/payment/confirm' },
              { label: 'POST /payment_intents/:id', value: data.server.updates, detail: 'marque granted_at — /api/payment/confirm' },
            ]" :key="c.label" class="space-y-1">
              <p class="text-steel-400 text-[10px] uppercase tracking-[0.12em] font-display">{{ c.label }}</p>
              <p class="text-ink-100 font-display text-lg">{{ int(c.value) }}</p>
              <p class="text-ink-300 text-[11px]">{{ c.detail }}</p>
            </div>
          </div>
          <p class="text-ink-200/80 text-sm leading-relaxed">
            Et <span class="text-ink-100">{{ int(data.browser) }}</span> requêtes du navigateur (clé publiable) qui ont changé
            un paiement : confirmations, 3-D Secure. Ni les relectures refusées par /api/payment/confirm, ni les lectures
            de Stripe.js, ni celles de cette page ne laissent de trace hors des Logs.
          </p>
        </section>

        <!-- Ce que deviennent les intents -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">Paiements ouverts</h2>
          <div class="flex flex-wrap gap-2">
            <span v-for="(n, s) in data.statuses" :key="s" class="border border-steel-600/60 px-2.5 py-1 text-xs text-ink-200">
              <span class="text-ink-100 tabular-nums">{{ int(n) }}</span> {{ STATUS[s] ?? s }}
            </span>
          </div>
        </section>

        <!-- Tentatives de carte -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Tentatives de carte <span class="text-steel-400">— {{ int(data.charges.succeeded) }} acceptées, {{ int(data.charges.failed) }} refusées</span>
          </h2>
          <ul v-if="data.refusals.length" class="text-ink-200/85 text-sm space-y-1">
            <li v-for="r in data.refusals" :key="r.reason">
              <span class="tabular-nums text-ink-100">{{ int(r.count) }}</span> — <code class="text-steel-400">{{ r.reason }}</code>
            </li>
          </ul>
        </section>

        <!-- Jour par jour -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">Jour par jour</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse">
              <thead>
                <tr class="text-steel-400 font-display text-[10px] uppercase tracking-[0.16em]">
                  <th class="text-left py-2 pr-4 font-normal">Jour</th>
                  <th class="text-right py-2 px-3 font-normal">Intents</th>
                  <th class="text-right py-2 px-3 font-normal">Accès ouverts</th>
                  <th class="text-right py-2 px-3 font-normal">Cartes acceptées</th>
                  <th class="text-right py-2 px-3 font-normal">Cartes refusées</th>
                  <th class="text-right py-2 pl-3 font-normal"><span class="text-neon-300">Requêtes serveur</span></th>
                </tr>
              </thead>
              <tbody class="text-ink-200/85">
                <tr v-for="d in data.daily" :key="d.day" class="border-t border-steel-700/60">
                  <td class="py-2 pr-4 font-display text-xs">{{ d.day }}</td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ int(d.intents) }}</td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ int(d.granted) }}</td>
                  <td class="py-2 px-3 text-right tabular-nums">{{ int(d.succeeded) }}</td>
                  <td class="py-2 px-3 text-right tabular-nums" :class="d.failed ? 'text-red-300/90' : ''">{{ int(d.failed) }}</td>
                  <td class="py-2 pl-3 text-right tabular-nums text-neon-300/90">{{ int(d.intents + 2 * d.granted) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- Les derniers -->
        <section class="space-y-4">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">Derniers paiements</h2>
          <div class="overflow-x-auto">
            <table class="w-full text-sm border-collapse">
              <tbody class="text-ink-200/85">
                <tr v-for="p in data.recent" :key="p.id" class="border-t border-steel-700/60">
                  <td class="py-2 pr-4 text-xs text-steel-400 whitespace-nowrap">{{ date(p.created) }}</td>
                  <td class="py-2 px-3 text-xs">
                    <a :href="`https://dashboard.stripe.com/${data.livemode === false ? 'test/' : ''}payments/${p.id}`" target="_blank" rel="noopener" class="text-neon-300/90 hover:underline underline-offset-4">{{ p.id }}</a>
                  </td>
                  <td class="py-2 px-3 text-xs">{{ STATUS[p.status] ?? p.status }}<span v-if="p.granted" class="text-neon-300"> · accès ouvert</span></td>
                  <td class="py-2 px-3 text-xs text-red-300/90">{{ p.error ?? '' }}</td>
                  <td class="py-2 pl-3 text-right tabular-nums text-xs">{{ amount(p.amount, p.currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>

      <nav class="flex gap-4 text-xs">
        <NuxtLink to="/" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Retour au jeu</NuxtLink>
        <NuxtLink to="/admin/marge" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Coûts &amp; marges</NuxtLink>
      </nav>
    </div>
  </div>
</template>
