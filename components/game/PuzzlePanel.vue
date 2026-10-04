<script setup lang="ts">
const { t } = useLang()

import type { ScenePuzzle } from '~/types/scene'
import { useGameStore } from '~/stores/game'

/**
 * Le panneau de l'énigme : un cadran, un clavier, une séquence, un lecteur.
 *
 * Il ne sait rien de la solution — il propose, `usePuzzle` tranche. Il ne
 * contient AUCUN indice non plus : les indices sont dans le lieu, sur les
 * choses que le récit nomme, et c'est en les regardant qu'on les lit. Le
 * panneau rappelle seulement ce que coûte une réponse fausse.
 *
 * La fouille n'en a pas : elle se joue au clavier, dans le récit.
 */
const props = defineProps<{
  puzzle: ScenePuzzle
  name: string
  submit: (answer: string | number | number[]) => boolean
}>()
const emit = defineEmits<{ close: [] }>()

const gameStore = useGameStore()

const failed = ref(false)
function refuse() {
  failed.value = true
  setTimeout(() => { failed.value = false }, 900)
}
function propose(answer: string | number | number[]): boolean {
  const ok = props.submit(answer)
  if (!ok) refuse()
  return ok
}

// --- fréquence --------------------------------------------------------------
const dial = ref(props.puzzle.kind === 'frequency'
  ? Math.round((props.puzzle.min + props.puzzle.max) / 2)
  : 0)
function nudge(step: number) {
  if (props.puzzle.kind !== 'frequency') return
  dial.value = Math.min(props.puzzle.max, Math.max(props.puzzle.min, dial.value + step))
}

// --- code -------------------------------------------------------------------
const digits = ref('')
function press(d: string) {
  if (digits.value.length >= 4) return
  digits.value += d
  if (digits.value.length === 4) {
    const entered = digits.value
    setTimeout(() => { if (!propose(entered)) digits.value = '' }, 250)
  }
}

// --- séquence ---------------------------------------------------------------
const order = ref<number[]>([])
function pick(i: number) {
  if (props.puzzle.kind !== 'sequence' || order.value.includes(i)) return
  order.value = [...order.value, i]
  if (order.value.length === props.puzzle.steps.length) {
    const entered = order.value
    setTimeout(() => { if (!propose(entered)) order.value = [] }, 350)
  }
}

// --- lecteur ----------------------------------------------------------------
/**
 * Les cartes qu'on peut présenter : ce qui ouvre ET porte une couleur — le
 * même tri que le serveur. Une fréquence ou une séquence ouvrent aussi, et
 * reçoivent la teinte de leur lieu, mais ce ne sont pas des cartes.
 */
const cards = computed(() => gameStore.inventory.filter(o => o.kind === 'key' && o.color && o.id !== 'cle_auberge'))
const known = (id: string) => gameStore.decryptedObjectIds.includes(id)

/*
 * LE PANNEAU NE MONTRE AUCUNE COULEUR. Ni l'anneau, ni les cartes : avec la
 * teinte attendue au-dessus et une pastille par carte en dessous, l'énigme se
 * résolvait en comparant deux carrés, sans avoir rien lu. La couleur est dans
 * l'indice, posé sur l'élément focal, et dans la mémoire du joueur — c'est à
 * lui de se souvenir où il a vu cette teinte.
 */
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center px-6" @click.self="emit('close')">
    <div class="absolute inset-0 bg-ink-900/92" @click="emit('close')" />

    <div
      class="relative z-10 w-full max-w-sm bg-ink-900 border border-neon-600/50 p-7 space-y-6"
      style="box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)"
    >
      <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

      <div class="space-y-2 text-center">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ t(`puzzle.eyebrow_${puzzle.kind}`) }}
        </p>
        <p class="text-ink-100 text-sm">{{ name }}</p>
        <p class="text-steel-400 text-[11px] leading-relaxed">{{ t(puzzle.clues.some(c => c.item_id) ? 'puzzle.hint_carried' : 'puzzle.hint') }}</p>
      </div>

      <!-- Le cadran. Pas de jauge de signal : balayer ne doit rien apprendre. -->
      <div v-if="puzzle.kind === 'frequency'" class="space-y-4" :class="failed && 'animate-deco-pulse'">
        <p class="text-center font-mono text-4xl tabular-nums text-neon-200 select-none">
          {{ dial }}<span class="text-steel-400 text-base ml-2">MHz</span>
        </p>
        <div class="flex items-center gap-3">
          <button class="puzzle-key w-10" @click="nudge(-1)">−</button>
          <input
            v-model.number="dial"
            type="range"
            :min="puzzle.min"
            :max="puzzle.max"
            step="1"
            class="flex-1 accent-[rgb(var(--neon-400))]"
          >
          <button class="puzzle-key w-10" @click="nudge(1)">+</button>
        </div>
        <button class="puzzle-submit" @click="propose(dial)">{{ t('puzzle.submit_frequency') }}</button>
      </div>

      <!-- Le clavier -->
      <div v-else-if="puzzle.kind === 'code'" class="space-y-4">
        <div class="flex justify-center gap-3" :class="failed && 'animate-deco-pulse'">
          <span
            v-for="i in 4"
            :key="i"
            class="w-10 h-12 flex items-center justify-center border font-mono text-2xl text-neon-200"
            :class="failed ? 'border-red-500/70' : 'border-neon-600/50'"
          >{{ digits[i - 1] ?? '' }}</span>
        </div>
        <div class="grid grid-cols-3 gap-2">
          <button v-for="d in ['1','2','3','4','5','6','7','8','9']" :key="d" class="puzzle-key" @click="press(d)">{{ d }}</button>
          <button class="puzzle-key text-steel-400" @click="digits = digits.slice(0, -1)">⌫</button>
          <button class="puzzle-key" @click="press('0')">0</button>
          <span />
        </div>
      </div>

      <!-- La séquence : on touche les gestes dans l'ordre -->
      <div v-else-if="puzzle.kind === 'sequence'" class="space-y-3" :class="failed && 'animate-deco-pulse'">
        <button
          v-for="(step, i) in puzzle.steps"
          :key="i"
          class="w-full flex items-center gap-3 text-left px-3 py-2 border transition-colors"
          :class="order.includes(i)
            ? 'border-neon-400/80 text-neon-200 bg-neon-700/20'
            : 'border-steel-600/60 text-ink-200 hover:border-neon-500'"
          @click="pick(i)"
        >
          <span class="w-5 font-mono text-neon-400">{{ order.includes(i) ? order.indexOf(i) + 1 : '·' }}</span>
          <span class="text-sm">{{ step }}</span>
        </button>
        <button v-if="order.length" class="text-[10px] uppercase tracking-[0.2em] text-steel-400 hover:text-neon-300" @click="order = []">
          {{ t('puzzle.reset') }}
        </button>
      </div>

      <!-- Le lecteur : sa teinte, et les cartes qu'on a sur soi -->
      <div v-else-if="puzzle.kind === 'lock'" class="space-y-4">
        <div class="flex justify-center" :class="failed && 'animate-deco-pulse'">
          <span class="w-16 h-16 rounded-full border-4 border-steel-500 flex items-center justify-center">
            <span class="w-6 h-1 bg-ink-100/60" />
          </span>
        </div>
        <p v-if="!cards.length" class="text-center text-steel-400 text-xs">{{ t('puzzle.no_cards') }}</p>
        <div class="space-y-2">
          <button
            v-for="card in cards"
            :key="card.id"
            class="w-full flex items-center gap-3 px-3 py-2 border border-steel-600/60 hover:border-neon-500 text-left"
            @click="propose(card.id)"
          >
            <ItemIcon :icon="card.icon" kind="key" :known="known(card.id)" class="w-5 h-5 shrink-0 text-steel-300" />
            <span class="flex-1 min-w-0 truncate text-sm text-ink-200">{{ known(card.id) ? card.label : t('game.sealed_object') }}</span>
            <!-- Scellée, elle n'a plus que son lieu pour la distinguer de l'autre. -->
            <span v-if="!known(card.id) && card.from" class="shrink-0 text-[10px] text-steel-400 truncate max-w-[40%]">{{ card.from }}</span>
          </button>
        </div>
      </div>

      <p v-if="failed" class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display text-center">
        {{ t('puzzle.refused') }}
      </p>
      <button class="block mx-auto text-[10px] uppercase tracking-[0.2em] text-steel-400 hover:text-neon-300" @click="emit('close')">
        {{ t('puzzle.later') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.puzzle-key {
  @apply h-11 flex items-center justify-center border border-steel-600/60 font-mono text-lg text-ink-100 transition-colors;
}
.puzzle-key:hover { @apply border-neon-500 text-neon-300; }
.puzzle-submit {
  @apply w-full py-2 border border-neon-500/70 text-neon-200 uppercase tracking-[0.24em] text-[11px] font-display transition-colors;
}
.puzzle-submit:hover { @apply bg-neon-700/30; }
</style>
