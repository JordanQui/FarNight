<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'

/**
 * La ville fermée.
 *
 * Deux fins, un seul écran. La nuit a patiné : elle rouvre après un cycle, et
 * le compte à rebours le dit. L'histoire est allée jusqu'au bout : elle ne rouvre pas, et il n'y a rien à attendre — on
 * ne montre alors aucun décompte, ce serait promettre un retour.
 *
 * Le texte vient du modèle, écrits pour ce joueur-là à la génération de sa scène ou
 * de son épilogue. Il est déjà payé : l'afficher ne coûte aucun appel, et
 * c'est voulu — on ne fait pas patienter quelqu'un devant une porte qui se
 * ferme.
 */
const gameStore = useGameStore()

const lock = computed(() => gameStore.lock)
const definitive = computed(() => lock.value?.reason === 'completed')

/** Le temps qui reste, rafraîchi à la minute. Inutile d'être à la seconde. */
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null
onMounted(() => { ticker = setInterval(() => { now.value = Date.now() }, 30_000) })
onUnmounted(() => { if (ticker) clearInterval(ticker) })

/**
 * Rouvrir, en développement et pendant les phases de test.
 *
 * Une fois l'écran affiché, le canal `#` n'est plus accessible : `#ouvre`
 * devient injoignable, et une séance de test condamnait la journée. Le serveur
 * refuse ce geste quand `lockOverride` est fermé — le bouton n'est alors même
 * pas rendu.
 */
const canOverride = isLocal() || useRuntimeConfig().public.lockOverride

async function reopen() {
  await $fetch('/api/lockout', { method: 'POST', body: { open: true } }).catch(() => null)
  gameStore.openCity()
  gameStore.setScreen('login')
}

const remaining = computed(() => {
  const until = lock.value?.until ?? 0
  const ms = Math.max(0, until - now.value)
  const hours = Math.floor(ms / 3600_000)
  const minutes = Math.floor((ms % 3600_000) / 60_000)
  if (hours >= 1) {
    return t('locked.remaining_hours', { hours, minutes: String(minutes).padStart(2, '0') })
  }
  return t('locked.remaining_minutes', { minutes })
})
</script>

<template>
  <div class="min-h-[100dvh] flex items-center justify-center px-6 py-12 bg-ink-900">
    <div class="w-full max-w-md space-y-8 text-center">
      <p class="text-neon-400/80 font-display uppercase text-[10px] tracking-[0.32em]">
        {{ definitive ? t('locked.eyebrow_end') : t('locked.eyebrow_recalibrating') }}
      </p>

      <div class="neon-rule w-20 mx-auto" />

      <!-- Ce que le modèle a écrit pour ce joueur. Le seul texte de l'écran. -->
      <p
        v-if="lock?.text"
        class="narrative-text text-parchment/90 text-[15px] sm:text-sm leading-relaxed whitespace-pre-line text-left"
      >{{ lock.text }}</p>
      <p v-else class="text-ink-200/70 text-sm leading-relaxed">
        {{ definitive
          ? t('locked.fallback_end')
          : t('locked.fallback_reload') }}
      </p>

      <div class="neon-rule w-20 mx-auto" />

      <!--
        Un décompte seulement quand il y a quelque chose à attendre. Pour une
        histoire terminée, en afficher un laisserait croire qu'elle rouvre.
      -->
      <p
        v-if="!definitive"
        class="text-steel-400 font-display uppercase text-[11px] tracking-[0.18em]"
      >
        {{ t('locked.reopen_in', { remaining }) }}
      </p>
      <p v-else class="text-steel-400 font-display uppercase text-[11px] tracking-[0.18em]">
        {{ t('locked.the_end') }}
      </p>

      <!-- Phases de test : un lien discret, pour les testeurs -->
      <button
        v-if="canOverride"
        class="text-steel-400/40 hover:text-steel-400 underline underline-offset-4 font-display
               uppercase text-[10px] tracking-[0.18em] transition-colors"
        @click="reopen"
      >
        {{ t('locked.dev_unlock') }}
      </button>
    </div>
  </div>
</template>
