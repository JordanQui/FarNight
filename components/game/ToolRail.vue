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
 * LE TROISIÈME BOUTON N'EST PAS UN OUTIL : il ouvre ce que le joueur porte.
 * Sa place est ici quand même — c'est la rangée qu'on regarde pour savoir ce
 * qu'on peut faire —, mais il est mis à part : l'oeil et la loupe changent la
 * lecture de la scène, l'inventaire la recouvre. Il n'apparaît que quand il y
 * a quelque chose dedans : une grille vide n'apprend rien.
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
      v-if="!gameStore.eyeHidden"
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

    <!--
      Ce que le joueur porte. Séparé des outils par un filet : ce bouton
      n'arme rien, il ouvre une fenêtre.
    -->
    <button
      v-if="gameStore.inventory.length"
      class="p-1.5 -my-0.5 ml-1 pl-2.5 border-l border-steel-600/40 text-steel-400
             hover:text-neon-400 transition-colors"
      :aria-label="t('game.inventory_all')"
      :title="t('game.inventory_all')"
      @click="emit('inventory')"
    >
      <svg viewBox="0 0 20 20" class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.4">
        <rect x="2.5" y="2.5" width="6" height="6" />
        <rect x="11.5" y="2.5" width="6" height="6" />
        <rect x="2.5" y="11.5" width="6" height="6" />
        <rect x="11.5" y="11.5" width="6" height="6" />
      </svg>
    </button>
  </div>
</template>
