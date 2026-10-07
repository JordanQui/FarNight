<script setup lang="ts">
const { t } = useLang()

import { usePaywall } from '~/composables/usePaywall'
import { usePaymentStore } from '~/stores/payment'
import { usePlayerStore } from '~/stores/player'
import type { ScenePaywall } from '~/types/scene'

const { initPayments, fetchPaymentIntent, submitPayment } = usePaywall()
const paymentStore = usePaymentStore()
const playerStore = usePlayerStore()

const isInitializing = ref(true)

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
    const { clientSecret } = await fetchPaymentIntent()
    await nextTick()
    await initPayments('#card-container', clientSecret)
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

        <p v-if="paymentStore.errorMessage" class="text-red-400/80 text-xs text-center">
          {{ paymentStore.errorMessage }}
        </p>
      </div>

      <div class="text-center">
        <GlowButton
          :loading="paymentStore.status === 'processing'"
          :disabled="isInitializing"
          class="w-full"
          @click="submitPayment()"
        >
          {{ paywall?.cta ?? t('common.continue') }}
        </GlowButton>
      </div>

      <p v-if="playerStore.place" class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display text-center">
        {{ playerStore.playerName }} — {{ playerStore.place.name }}
      </p>
    </div>

    <div class="crt-scanlines absolute inset-0 z-20 pointer-events-none opacity-40" />
  </div>
</template>
