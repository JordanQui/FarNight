<script setup lang="ts">
const { t } = useLang()

import { usePlayerStore } from '~/stores/player'
import { puzzleFor } from '~/utils/psychotest'

/**
 * L'épreuve d'analyse.
 *
 * Trois symboles, une règle à trouver, quatre propositions. Ce n'est pas une
 * énigme de culture : c'est une lecture de série — exactement ce que
 * l'augmentation fait à la place du joueur, et qu'elle lui demande de faire
 * une fois pour prouver qu'il sait voir.
 *
 * L'énigme est dérivée du profil et de l'objet : deux joueurs n'ont jamais la
 * même, et un échec ne permet pas d'en tirer une plus facile.
 */
const props = defineProps<{ objectId: string; objectName: string }>()
const emit = defineEmits<{ solved: []; close: [] }>()

const playerStore = usePlayerStore()

const seed = computed(() => {
  const id = playerStore.profile?.identity
  return `${id?.name ?? 'inconnu'}|${id?.birthday ?? ''}`
})

const puzzle = computed(() => puzzleFor(props.objectId, seed.value))

const picked = ref<number | null>(null)
const failed = ref(false)

function choose(index: number) {
  if (picked.value !== null) return
  picked.value = index

  if (index === puzzle.value.answer) {
    setTimeout(() => emit('solved'), 700)
    return
  }

  // Échec : on laisse voir l'erreur, puis on rend la main. La même énigme
  // revient — elle ne dépend pas de la tentative, seulement du profil.
  failed.value = true
  setTimeout(() => { picked.value = null; failed.value = false }, 900)
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center px-6" @click.self="emit('close')">
    <div class="absolute inset-0 bg-ink-900/92" />

    <div
      class="relative z-10 w-full max-w-sm bg-ink-900 border border-neon-600/50 p-7 space-y-7"
      style="box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)"
    >
      <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

      <div class="space-y-2 text-center">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ t('game.analysis') }}
        </p>
        <p class="text-steel-400 text-[11px] leading-relaxed">
          {{ t('game.psycho_prompt') }}
        </p>
      </div>

      <!-- La suite à lire -->
      <div class="flex items-center justify-center gap-4" :class="failed && 'animate-deco-pulse'">
        <span
          v-for="(glyph, i) in puzzle.sequence"
          :key="i"
          class="text-3xl text-ink-100 select-none"
        >{{ glyph }}</span>
        <span class="text-3xl text-steel-500 select-none">?</span>
      </div>

      <div class="neon-rule w-20 mx-auto" />

      <!-- Les quatre propositions -->
      <div class="grid grid-cols-4 gap-2">
        <button
          v-for="(glyph, i) in puzzle.choices"
          :key="i"
          class="aspect-square flex items-center justify-center text-2xl border transition-colors"
          :class="picked === i
            ? (i === puzzle.answer ? 'border-neon-400 text-neon-200 bg-neon-700/30' : 'border-red-500/70 text-red-400')
            : 'border-steel-600/60 text-ink-200 hover:border-neon-500 hover:text-neon-300'"
          :disabled="picked !== null"
          @click="choose(i)"
        >{{ glyph }}</button>
      </div>

      <p class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display text-center">
        {{ failed ? t('game.psycho_rejected') : t('game.psycho_sealed') }}
      </p>
    </div>
  </div>
</template>
