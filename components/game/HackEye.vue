<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useGyroEye } from '~/composables/useGyroEye'

/**
 * Le bouton de l'oeil, et au tactile son réticule.
 *
 * Le bouton et sa fenêtre sont les mêmes partout : tant qu'on ne l'a pas
 * ouvert, l'oeil ne lit rien, à la souris comme au doigt. Une fois ouvert, le
 * réticule n'existe qu'au tactile — sur desktop, c'est le curseur qui prend la
 * forme de l'oeil, et un second oeil à l'écran serait un doublon.
 */
const gameStore = useGameStore()
const playerStore = usePlayerStore()
const { usesTouch, enabled, denied, unavailable, enable } = useGyroEye()

/**
 * On dit d'abord ce que le bouton allume, on l'ouvre ensuite.
 *
 * Le bouton de la fenêtre est lui-même un geste utilisateur : iOS accepte donc
 * `requestPermission()` depuis là, ce qui n'aurait pas marché depuis un
 * `onMounted` ou une frame plus tard.
 */
const showPrimer = ref(false)

/** La fenêtre ne se lit qu'une fois par partie : ensuite le bouton ouvre l'oeil. */
function onButton() {
  if (gameStore.eyePrimerSeen) void enable()
  else showPrimer.value = true
}

async function confirmPrimer() {
  showPrimer.value = false
  gameStore.eyePrimerSeen = true
  await enable()
}

/**
 * Le bouton n'existe qu'à l'auberge, première scène : c'est là qu'on apprend ce
 * qu'est l'oeil. Ensuite il est ouvert d'office à l'arrivée sur la page —
 * changement de scène comme rechargement.
 */
const firstSceneId = (useRuntimeConfig().public.sceneIndex as Array<{ id: string }>)?.[0]?.id
const isFirstScene = computed(() => !playerStore.scene || playerStore.scene.scene_id === firstSceneId)

// Le bouton est tu pendant l'ouverture, sinon il clignote le temps de la
// permission. S'il revient hors de l'auberge, c'est que l'ouverture sans geste
// a échoué (iOS après un rechargement) : il reste alors le seul moyen d'ouvrir.
const reopening = ref(!isFirstScene.value || gameStore.eyeWasOpen)
async function autoOpen() {
  reopening.value = true
  if (!enabled.value) await enable({ auto: true })
  reopening.value = false
}
onMounted(() => {
  if (reopening.value) void autoOpen()
})
watch(isFirstScene, (first) => {
  if (!first) void autoOpen()
})

const style = computed(() => ({
  left: `${gameStore.eyePos.x * 100}%`,
  top: `${gameStore.eyePos.y * 100}%`,
}))
</script>

<template>
  <div>
    <EyePrimer
      v-if="showPrimer"
      @confirm="confirmPrimer"
      @close="showPrimer = false"
    />

    <!-- Avant activation : le bouton, partout. Au tactile, c'est aussi le geste
         que la permission d'iOS exige. La flèche le désigne tant que l'oeil
         reste fermé, et part avec lui. -->
    <div
      v-if="!enabled && !reopening && !gameStore.eyeHidden"
      class="fixed top-3 left-3 z-40 flex items-center gap-2"
    >
      <button
        class="flex items-center gap-2 px-3 py-2
               font-display text-[10px] uppercase tracking-[0.18em]
               text-neon-300 bg-ink-900/90 border border-neon-600/50"
        @click="onButton"
      >
        <svg viewBox="0 0 24 16" class="w-5 h-3.5" fill="none" stroke="currentColor" stroke-width="1.4">
          <path d="M1 8s4-6.5 11-6.5S23 8 23 8s-4 6.5-11 6.5S1 8 1 8Z" />
          <circle cx="12" cy="8" r="3.4" />
        </svg>
        {{ denied ? t('game.eye_denied') : unavailable ? t('game.eye_unavailable') : playerStore.scene?.eye_primer?.cta ?? t('game.eye_open') }}
      </button>
      <svg
        viewBox="0 0 24 12" class="eye-arrow w-6 h-3 pointer-events-none" fill="none"
        stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M23 6H2M7 1L2 6l5 5" />
      </svg>
    </div>

    <!-- Actif, au tactile : l'oeil suit l'inclinaison de l'appareil. -->
    <div
      v-else-if="enabled && usesTouch && (gameStore.activeTool === 'lens' || !gameStore.eyeHidden)"
      class="eye pointer-events-none fixed z-40"
      :class="gameStore.revealing && 'is-locked-on'"
      :style="style"
      aria-hidden="true"
    >
      <!-- La loupe en main : le réticule change de forme, comme le curseur. -->
      <svg
        v-if="gameStore.activeTool === 'lens'"
        viewBox="0 0 20 20" class="w-9 h-9" fill="none" stroke="currentColor" stroke-width="1.3"
      >
        <circle cx="8.5" cy="8.5" r="6" />
        <path d="M13 13l5 5" stroke-linecap="round" />
        <path v-if="!gameStore.revealing" d="M8.5 5.2v6.6M5.2 8.5h6.6" stroke-width="0.8" opacity="0.6" />
      </svg>

      <svg v-else viewBox="0 0 24 16" class="w-10 h-7" fill="none" stroke="currentColor" stroke-width="1.2">
        <path d="M1 8s4-6.5 11-6.5S23 8 23 8s-4 6.5-11 6.5S1 8 1 8Z" />
        <!-- Pupille retirée dès qu'un nom est verrouillé : elle se poserait
             pile sur les lettres qu'on essaie de lire. -->
        <circle
          v-if="!gameStore.revealing"
          cx="12" cy="8" r="3.4"
          fill="currentColor" fill-opacity="0.35"
        />
        <path d="M12 0v3M12 13v3M0 8h3M21 8h3" stroke-width="0.8" opacity="0.7" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
.eye {
  transform: translate(-50%, -50%);
  color: rgb(var(--neon-400));
  filter: drop-shadow(0 0 6px rgb(var(--neon-500) / 0.6));
  transition: color 0.12s ease, filter 0.12s ease;
}

/* La flèche pointe le bouton et bat vers lui : on ne la rate pas. */
.eye-arrow {
  color: rgb(var(--neon-400));
  filter: drop-shadow(0 0 4px rgb(var(--neon-500) / 0.7));
  animation: eye-arrow-nudge 1.1s ease-in-out infinite;
}
@keyframes eye-arrow-nudge {
  0%, 100% { transform: translateX(0); opacity: 1; }
  50% { transform: translateX(6px); opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  .eye-arrow { animation: none; }
}

/* Verrouillé sur un nom : l'oeil le dit avant même qu'on lise. */
.is-locked-on {
  color: rgb(var(--neon-200));
  filter: drop-shadow(0 0 12px rgb(var(--neon-500) / 0.95));
}
</style>
