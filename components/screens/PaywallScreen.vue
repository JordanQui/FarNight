<script setup lang="ts">
const { t } = useLang()

import { usePaywall } from '~/composables/usePaywall'
import { usePaymentStore } from '~/stores/payment'
import { usePlayerStore } from '~/stores/player'
import type { ScenePaywall } from '~/types/scene'

const { initPayments, fetchPaymentIntent, submitPayment, submitInvite } = usePaywall()
const paymentStore = usePaymentStore()
const playerStore = usePlayerStore()

const isInitializing = ref(true)

// Nuit offerte : l'e-mail et le code qu'on en a tiré, à la place de la carte.
const invite = reactive({ open: false, email: '', code: '' })

/**
 * Textes de repli, quand aucune scène n'est chargée — cas du visiteur qui a
 * épuisé son quota gratuit sans partie en cours. Ils viennent du script, servis
 * par une route qui ne génère rien.
 */
const fallback = ref<ScenePaywall | null>(null)

// Tout le texte du paywall vient du script, interpolé avec la quête du joueur.
const paywall = computed(() => playerStore.scene?.paywall ?? fallback.value)
const price = computed(() => {
  const p = paywall.value
  if (!p) return ''
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: p.currency })
    .format(p.amount_cents / 100)
})

onMounted(async () => {
  if (!playerStore.scene) {
    try {
      fallback.value = await $fetch<ScenePaywall>('/api/paywall')
    } catch { /* le prix et le bouton resteront vides, sans casser l'écran */ }
  }

  try {
    const intent = await fetchPaymentIntent()
    await nextTick()
    await initPayments('#card-container', intent)
  } catch (err) {
    paymentStore.setError(err instanceof Error ? err.message : 'Paiement indisponible')
  } finally {
    isInitializing.value = false
  }
})
</script>

<template>
  <div class="relative min-h-[100dvh] overflow-hidden flex flex-col items-center justify-center px-5 py-10">
    <div
      class="absolute inset-x-0 bottom-0 h-[50vh] pointer-events-none"
      style="background: radial-gradient(85% 100% at 50% 100%, rgb(var(--neon-500) / 0.16) 0%, transparent 68%)"
    />

    <div class="relative z-10 w-full max-w-md space-y-9">

      <!-- Narration de la porte : la dernière ligne de fiction avant le pitch -->
      <div class="text-center space-y-4">
        <div class="neon-rule w-24 mx-auto" />
        <p class="text-ink-100 text-[15px] sm:text-sm leading-relaxed whitespace-pre-line">
          {{ paywall?.gate_text }}
        </p>
        <p v-if="paywall" class="text-neon-400/75 text-xs font-display uppercase tracking-[0.2em]">
          {{ paywall.sub_cta }}
        </p>
      </div>

      <!--
        L'inédit d'abord : ce qu'on achète n'est pas une suite écrite, c'est une
        nuit qui n'existe pas encore et qui ne sera fabriquée que pour ce joueur.
      -->
      <div v-if="paywall?.pitch?.generative" class="text-center space-y-3">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ paywall.pitch.generative.eyebrow }}
        </p>
        <h2 class="text-ink-50 font-display text-lg sm:text-xl uppercase tracking-[0.1em] leading-snug">
          {{ paywall.pitch.generative.title }}
        </h2>
        <p class="text-ink-200/80 text-[13px] leading-relaxed">
          {{ paywall.pitch.generative.text }}
        </p>
      </div>

      <!--
        Ce qui se joue pour lui : la tension, vers quoi elle tend, et par quels
        moyens la nuit la dénoue — dit en clair, sans rien laisser deviner.
      -->
      <div v-if="paywall?.pitch" class="space-y-5 border-y border-steel-600/40 py-6">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display text-center">
          {{ paywall.pitch.eyebrow }}
        </p>

        <ul class="space-y-4">
          <li v-for="point in paywall.pitch.points" :key="point.label" class="flex items-start gap-3.5">
            <svg viewBox="0 0 8 10" class="w-2 h-2.5 mt-1 shrink-0 fill-neon-500" aria-hidden="true">
              <path d="M0 0 L5 5 L0 10 L3 10 L8 5 L3 0 Z" />
            </svg>
            <div class="space-y-1">
              <p class="text-ink-100 text-xs font-display uppercase tracking-[0.14em]">{{ point.label }}</p>
              <p class="text-ink-200/75 text-[13px] leading-relaxed">{{ point.text }}</p>
            </div>
          </li>
        </ul>

        <p class="text-neon-300/80 text-[13px] leading-relaxed text-center italic">
          {{ paywall.pitch.closing }}
        </p>
      </div>

      <!-- Prix -->
      <div class="text-center">
        <p class="neon-text font-display text-3xl tracking-[0.04em]">{{ price }}</p>
      </div>

      <!-- Formulaire Stripe, sans cadre : il se fond dans l'écran -->
      <div class="space-y-3">
        <p class="text-steel-400 text-[10px] uppercase tracking-[0.28em] font-display text-center">
          {{ t('paywall.secure') }}
        </p>
        <div v-if="isInitializing" class="h-12 flex items-center justify-center">
          <p class="text-steel-400 text-xs">{{ t('paywall.loading') }}</p>
        </div>
        <div id="card-container" />

        <p v-if="paymentStore.errorMessage && !invite.open" class="text-red-400/80 text-xs text-center">
          {{ paymentStore.errorMessage }}
        </p>
      </div>

      <div class="text-center space-y-3">
        <GlowButton
          :loading="paymentStore.status === 'processing'"
          :disabled="isInitializing"
          class="w-full"
          @click="submitPayment()"
        >
          {{ paywall?.cta ?? t('common.continue') }}
        </GlowButton>
        <!-- Contenu numérique livré tout de suite : la renonciation doit précéder le paiement (L221-28 13°). -->
        <p class="text-steel-400 text-[11px] leading-relaxed">
          {{ t('paywall.withdrawal') }}
          <a href="/mentions-legales#vente" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-neon-300">{{ t('legal.link') }}</a>
        </p>
      </div>

      <!-- Nuit offerte : un code tiré de l'e-mail remplace le paiement. -->
      <div class="text-center space-y-4">
        <button
          type="button"
          class="text-steel-400 hover:text-neon-300 text-[10px] uppercase tracking-[0.28em] font-display underline underline-offset-4"
          @click="invite.open = !invite.open; paymentStore.errorMessage = null"
        >
          {{ t('puzzle.eyebrow_code') }}
        </button>

        <form v-if="invite.open" class="space-y-3" @submit.prevent="submitInvite(invite.email, invite.code)">
          <input
            v-model="invite.email"
            type="email"
            placeholder="@"
            autocomplete="email"
            required
            class="w-full bg-ink-800/50 border-0 border-b border-steel-600 focus:border-neon-400 px-3 py-2 text-ink-100 text-[13px] outline-none"
          >
          <input
            v-model="invite.code"
            type="text"
            :placeholder="t('puzzle.eyebrow_code')"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            required
            class="w-full bg-ink-800/50 border-0 border-b border-steel-600 focus:border-neon-400 px-3 py-2 text-ink-100 text-[13px] uppercase tracking-[0.2em] outline-none"
          >
          <p v-if="paymentStore.errorMessage" class="text-red-400/80 text-xs">
            {{ paymentStore.errorMessage }}
          </p>
          <GlowButton type="submit" :loading="paymentStore.status === 'processing'" class="w-full">
            {{ t('common.continue') }}
          </GlowButton>
        </form>
      </div>

      <p v-if="playerStore.place" class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display text-center">
        {{ playerStore.playerName }} — {{ playerStore.place.name }}
      </p>
    </div>

    <div class="crt-scanlines absolute inset-0 z-20 pointer-events-none opacity-40" />
  </div>
</template>

