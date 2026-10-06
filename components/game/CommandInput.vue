<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
const props = defineProps<{ disabled?: boolean; exitReady?: boolean }>()
const emit = defineEmits<{ command: [value: string]; exit: [] }>()

const gameStore = useGameStore()
const playerStore = usePlayerStore()

const input = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

/**
 * La personne en face, quand il y en a une.
 *
 * Une conversation dure maintenant plus d'une phrase : sans ce repère, le
 * joueur ne saurait pas que sa prochaine ligne part chez quelqu'un plutôt que
 * dans le vide, et il retaperait le nom à chaque fois — ce qu'on lui demandait
 * précisément d'arrêter de faire.
 */
const facing = computed(() =>
  playerStore.npcs.find(n => n.id === gameStore.activeNpcId) ?? null)

function submit() {
  const value = input.value.trim()
  if (!value || props.disabled) return
  emit('command', value)
  input.value = ''
  // La veille de saisie ne doit JAMAIS rester bloquée. Sur mobile, le champ
  // garde le focus après l'envoi : `blur` ne part pas, `typing` reste vrai, et
  // l'oeil demeure endormi — plus un nom révélé, plus une note, sans rien pour
  // l'expliquer. On la relâche donc dès que la commande est partie.
  gameStore.setTyping(false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') submit()
  // Se détourner sans avoir à l'écrire. La phrase — « je m'éloigne » — marche
  // aussi, mais elle coûte un tour ; la touche, elle, ne coûte rien.
  if (e.key === 'Escape') gameStore.leaveConversation()
}

onMounted(() => {
  // Pas d'autofocus sur mobile : le clavier masquerait la scène d'entrée.
  if (!window.matchMedia('(max-width: 640px)').matches) inputRef.value?.focus()
})
</script>

<template>
  <div class="flex items-center gap-3 px-4 py-3 border-t border-neon-700/40 bg-ink-900/80">
    <span class="text-neon-500/70 font-mono text-sm shrink-0 select-none">&#62;</span>
    <button
      v-if="facing"
      class="shrink-0 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wider
             text-neon-300 border border-neon-600/50 px-2 py-0.5 hover:border-neon-400
             hover:text-neon-200 transition-colors"
      :title="t('game.facing_hint')"
      @click="gameStore.leaveConversation()"
    >
      <span>{{ t('game.facing', { name: facing.name }) }}</span>
      <span class="text-neon-600/70">&#215;</span>
    </button>
    <input
      ref="inputRef"
      v-model="input"
      @focus="gameStore.setTyping(true)"
      @blur="gameStore.setTyping(false)"
      type="text"
      :disabled="disabled"
      class="command-prompt flex-1 text-base sm:text-sm placeholder-ink-500 disabled:opacity-40"
      :placeholder="facing ? t('game.replying_to', { name: facing.name }) : t('game.input_ph')"
      enterkeyhint="send"
      autocomplete="off"
      autocorrect="off"
      spellcheck="false"
      @keydown="onKeydown"
    />
    <button
      :disabled="disabled || !input.trim()"
      class="shrink-0 p-2 -m-2 text-neon-700/60 hover:text-neon-400 disabled:opacity-30 transition-colors"
      @click="submit"
    >
      <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
    </button>
    <!-- Issue de secours : éteinte tant que la porte ne cède pas, allumée dès qu'elle cède. -->
    <button
      :disabled="disabled || !exitReady"
      class="exit-sign shrink-0 p-1.5 -my-1.5 border transition-all duration-500"
      :class="exitReady
        ? 'exit-sign--lit text-neon-300 border-neon-400/80 hover:text-neon-100'
        : 'text-ink-600 border-ink-700/60 opacity-40'"
      @click="emit('exit')"
    >
      <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <circle cx="13.5" cy="3.5" r="2" />
        <path d="M11 7.2l-3.6 1.6-1.5 3.4 1.6.7 1.2-2.6 1.6-.7-1.5 6.2-3.6 4.2 1.4 1.2 4-4.6.8-2.6 2 2v5.2h1.8v-6l-2.1-2.3.7-2.8.9 1.6 3.4 1.5.7-1.6-2.8-1.3-1.5-2.8c-.6-1-1.7-1.5-2.8-1.3z" />
        <path d="M19.5 4v16" stroke="currentColor" stroke-width="1.6" fill="none" />
      </svg>
    </button>
  </div>
</template>

<style scoped>
/* Le panneau s'allume comme un néon qu'on rebranche, puis respire. */
.exit-sign--lit {
  box-shadow: 0 0 10px rgb(var(--neon-400) / 0.45), inset 0 0 6px rgb(var(--neon-400) / 0.25);
  filter: drop-shadow(0 0 4px currentColor);
  animation: exit-sign-on 0.9s steps(1) 1, exit-sign-breathe 2.6s ease-in-out 0.9s infinite;
}
@keyframes exit-sign-on {
  0%, 20%, 45% { opacity: 1 }
  10%, 35% { opacity: 0.2 }
}
@keyframes exit-sign-breathe {
  50% { filter: drop-shadow(0 0 8px currentColor) }
}
</style>
