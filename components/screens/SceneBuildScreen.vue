<script setup lang="ts">
const { t } = useLang()

import { usePlayerStore } from '~/stores/player'
import { useGameStore } from '~/stores/game'
import { useScene } from '~/composables/useScene'
import { isLocal } from '~/utils/app-env'

const playerStore = usePlayerStore()
const gameStore = useGameStore()
const { loadSceneText, loadSceneImage, error, quotaExhausted } = useScene()

const messages = [1, 2, 3, 4].map(n => t(`build.omen_${n}`))
const currentMessage = ref(messages[0])
let interval: ReturnType<typeof setInterval> | null = null

function startMessages() {
  let i = 0
  interval = setInterval(() => {
    i = (i + 1) % messages.length
    currentMessage.value = messages[i]
  }, 2500)
}

/**
 * Hors de l'auberge, l'oeil est déjà ouvert : le curseur le dit dès le
 * chargement, au lieu de passer par la flèche le temps que la scène arrive.
 * À l'auberge, c'est le bouton « Ouvrir l'œil » qui l'allume.
 */
const firstSceneId = (useRuntimeConfig().public.sceneIndex as Array<{ id: string }>)?.[0]?.id
const eyeCursor = !!gameStore.pendingSceneId && gameStore.pendingSceneId !== firstSceneId

// `pendingSceneId` est posé par la commande `#scene<n>` ; sinon on prend la
// scène de départ déclarée par le script. Lu UNE fois, au montage : le bouton
// « Réessayer » rappelle `build`, et relire le store à ce moment-là — déjà vidé
// par le premier essai — reconstruisait l'auberge au lieu de la scène visée.
const target = gameStore.pendingSceneId ?? undefined
// Consommé : sans ça, une scène demandée une fois resterait épinglée et toute
// construction ultérieure y reviendrait.
gameStore.pendingSceneId = null

async function build() {
  // Pas de dossier, pas de nuit : on renvoie au formulaire. En local seulement,
  // le serveur retombe sur le dossier type (commandes `#scene<n>`).
  if (!playerStore.profile && !isLocal()) {
    gameStore.setScreen('admission')
    return
  }

  startMessages()

  // Phase 1 : le texte. Bloquant, c'est lui qui rend la scène jouable.
  const scene = await loadSceneText(target, playerStore.profile ?? undefined)

  if (interval) clearInterval(interval)

  // Quota épuisé : on l'envoie vers la sortie payante, pas vers un message rouge.
  if (quotaExhausted.value) {
    gameStore.setScreen('paywall')
    return
  }

  if (!scene) return

  gameStore.setScreen('playing')

  // Phase 2 : l'image, en tâche de fond. On joue déjà.
  void loadSceneImage(scene).then(() => playerStore.markImageReady())
}

onMounted(build)

onUnmounted(() => { if (interval) clearInterval(interval) })
</script>

<template>
  <div
    class="min-h-[100dvh] flex flex-col items-center justify-center px-6 text-center relative overflow-hidden"
    :class="eyeCursor && 'cursor-eye'"
  >
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div class="deco-rays animate-deco-turn w-[120vmax] h-[120vmax] shrink-0" />
    </div>

    <div class="relative z-10 space-y-9 w-full max-w-sm">
      <!--
        Skyline Deco à gradins, en lieu et place de la bougie : la lumière du
        Dark Deco vient d'une source dure, jamais d'une flamme qui vacille.
      -->
      <div class="flex items-end justify-center gap-2 h-14" aria-hidden="true">
        <span
          v-for="(h, i) in [16, 30, 46, 56, 46, 30, 16]"
          :key="i"
          class="w-2 bg-neon-500 animate-deco-pulse"
          :style="{ height: `${h}px`, animationDelay: `${i * 0.18}s` }"
        />
      </div>

      <Transition name="fade" mode="out-in">
        <p :key="currentMessage" class="font-display text-[11px] sm:text-xs uppercase tracking-[0.3em] text-neon-400/85">
          {{ currentMessage.replace('...', '') }}
        </p>
      </Transition>

      <div class="deco-rule mx-auto max-w-[10rem]" />

      <!-- Avancement du pipeline -->
      <div class="space-y-3 text-left">
        <div
          v-for="step in [
            { done: playerStore.buildProgress.text, label: t('build.step_text') },
            { done: playerStore.buildProgress.image, label: t('build.step_image') },
          ]"
          :key="step.label"
          class="flex items-center gap-3.5"
        >
          <!-- Barre pleine quand l'étape est faite, creuse sinon -->
          <span
            class="w-6 h-[3px] shrink-0 transition-colors duration-500"
            :class="step.done ? 'bg-neon-500' : 'bg-ink-600'"
          />
          <span
            class="font-display text-[10px] uppercase tracking-[0.18em] transition-colors duration-500"
            :class="step.done ? 'text-ink-100' : 'text-ink-400'"
          >
            {{ step.label }}
          </span>
        </div>
      </div>

      <div v-if="error" class="space-y-4 pt-2 flex flex-col items-center">
        <p class="text-red-400/80 text-xs">{{ error }}</p>
        <GlowButton class="w-full" @click="build">{{ t('common.retry') }}</GlowButton>
      </div>
    </div>

    <p
      class="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-md px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[11px] leading-relaxed text-ink-200/50 text-center"
    >
      {{ t('game.loading_disclaimer') }}
    </p>
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 0.4s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
