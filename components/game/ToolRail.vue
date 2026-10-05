<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'

/**
 * Les outils de lecture.
 *
 * Chacun modifie ce que le texte laisse voir, et le curseur prend sa forme :
 * l'oeil déchiffre les identités, la loupe — l'augmentation — analyse les
 * objets scellés. La loupe n'apparaît qu'une fois l'augmentation obtenue :
 * avant, le joueur ne doit pas soupçonner qu'un second mode existe.
 *
 * LA POIGNÉE DE DROITE N'EST PAS UN OUTIL : elle montre ce que le joueur porte
 * et ouvre la grille. Sa place est ici quand même — c'est la rangée qu'on
 * regarde pour savoir ce qu'on peut faire —, juste après la loupe, encadrée :
 * l'oeil et la loupe changent la lecture de la scène, l'inventaire la recouvre.
 * Elle est là même vide : un bouton qui n'apparaît qu'au premier objet ne
 * se cherche pas, et le joueur croyait l'inventaire disparu. Vide, elle
 * l'ouvre sur « Tu ne portes rien. », ce qui est déjà une réponse.
 */
const gameStore = useGameStore()
const playerStore = usePlayerStore()

const emit = defineEmits<{ inventory: [] }>()


// Le nom de L'AUGMENTATION, pas celui de l'objet-clé de la scène en cours :
// dès la scène 2, la loupe prenait le nom d'une carte d'accès.
const lensLabel = computed(() => gameStore.augmentation?.name
  ?? (playerStore.scene?.grants_augmentation ? playerStore.scene.key_item?.name : null)
  ?? 'Analyse')
</script>

<template>
  <div class="shrink-0 flex items-center gap-1.5 px-4 py-1.5">
    <button
      class="p-1.5 -my-0.5 transition-colors"
      :class="gameStore.activeTool === 'eye' ? 'text-neon-400' : 'text-steel-400 hover:text-neon-600'"
      :aria-pressed="gameStore.activeTool === 'eye'"
      :aria-label="t('game.eye_tooltip')"
      :title="t('game.eye_label')"
      @click="gameStore.setTool('eye')"
    >
      <svg viewBox="0 0 24 16" class="w-6 h-4" fill="none" stroke="currentColor" stroke-width="1.4">
        <path d="M1 8s4-6.5 11-6.5S23 8 23 8s-4 6.5-11 6.5S1 8 1 8Z" />
        <circle cx="12" cy="8" r="3.4" :fill="gameStore.activeTool === 'eye' ? 'currentColor' : 'none'" />
      </svg>
    </button>

    <button
      v-if="gameStore.hasAugmentation"
      class="p-1.5 -my-0.5 transition-colors"
      :class="gameStore.activeTool === 'lens' ? 'text-neon-400' : 'text-steel-400 hover:text-neon-600'"
      :aria-pressed="gameStore.activeTool === 'lens'"
      :aria-label="t('game.lens_aria', { label: lensLabel })"
      :title="t('game.lens_title', { label: lensLabel })"
      @click="gameStore.setTool('lens')"
    >
      <svg viewBox="0 0 20 20" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="8.5" cy="8.5" r="6" />
        <path d="M13 13l5 5" stroke-linecap="round" />
        <path
          v-if="gameStore.activeTool === 'lens'"
          d="M8.5 5.2v6.6M5.2 8.5h6.6" stroke-width="0.9" opacity="0.6"
        />
      </svg>
    </button>

    <!-- Un seul bouton : il ouvre la grille où les objets portés sont listés. -->
    <button
      class="ml-1 px-2 py-1 -my-0.5 border border-neon-700/40 text-[10px] uppercase tracking-[0.2em]
             font-display text-neon-400/80 hover:text-neon-300 hover:border-neon-500/60 transition-colors"
      :aria-label="t('game.inventory_all')"
      :title="t('game.inventory_all')"
      @click="emit('inventory')"
    >
      {{ t('game.inventory') }}
    </button>
  </div>
</template>
