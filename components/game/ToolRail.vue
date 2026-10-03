<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useInventory } from '~/composables/useInventory'

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
 * regarde pour savoir ce qu'on peut faire —, mais elle est poussée à droite :
 * l'oeil et la loupe changent la lecture de la scène, l'inventaire la recouvre.
 * Elle n'apparaît que quand il y a quelque chose dedans : une grille vide
 * n'apprend rien.
 */
const gameStore = useGameStore()
const playerStore = usePlayerStore()

const emit = defineEmits<{ inventory: [] }>()

const { items } = useInventory()
/** La rangée tient sur une ligne : au-delà, le compte dit le reste. */
const shown = computed(() => items.value.slice(-5))

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
      Ce que le joueur porte, À VUE. Un pictogramme muet en bout de rangée ne
      se remarquait pas : on ramassait une carte en scène 2 sans trouver où
      elle était passée. Les objets eux-mêmes s'alignent donc ici — leur
      symbole, et pour une carte sa pastille de couleur —, et toute la poignée
      ouvre la grille où les noms s'écrivent en entier.
    -->
    <button
      v-if="items.length"
      class="ml-auto flex items-center gap-2 min-w-0 px-2 py-1 -my-0.5 border border-neon-700/40
             text-steel-400 hover:text-neon-300 hover:border-neon-500/60 transition-colors"
      :aria-label="t('game.inventory_all')"
      :title="t('game.inventory_all')"
      @click="emit('inventory')"
    >
      <span class="text-[10px] uppercase tracking-[0.2em] font-display text-neon-400/80 shrink-0">
        {{ t('game.inventory') }}
      </span>
      <span class="flex items-center gap-1 min-w-0 overflow-hidden">
        <span
          v-for="o in shown"
          :key="o.id"
          class="relative shrink-0"
        >
          <ItemIcon
            :icon="o.icon"
            :kind="o.kind"
            :known="o.known"
            class="w-4 h-4"
            :class="o.known ? 'text-neon-300' : 'text-steel-500'"
          />
          <span
            v-if="o.kind === 'key'"
            class="absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 border border-ink-900"
            :style="{ background: o.hex || 'rgb(var(--neon-500))' }"
            aria-hidden="true"
          />
        </span>
      </span>
      <span class="text-[10px] font-mono tabular-nums text-steel-400 shrink-0">{{ items.length }}</span>
    </button>
  </div>
</template>
