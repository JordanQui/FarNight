<script setup lang="ts">
const { t } = useLang()

/**
 * Ce qu'on fait ici, dit avant que le barman parle.
 *
 * Elle s'ouvre à l'arrivée dans l'auberge, une fois par partie, et dit les deux
 * gestes du jeu : chercher dans le décor ce que le récit met en gras et en
 * Majuscule, et ouvrir l'oeil pour lire le nom des gens avant de leur parler.
 *
 * UNE FENÊTRE D'INTERFACE, PAS UN MORCEAU DE RÉCIT : son texte est fixe, dans
 * les paquets de langue, et ne coûte aucun appel. Les `**…**` des chaînes sont
 * rendus dans le même gras que les noms touchables du récit (`GlitchText`).
 */
const emit = defineEmits<{ close: [] }>()

const sections = computed(() => [
  { icon: 'look', title: t('game.howto_look_title'), body: t('game.howto_look_body') },
  { icon: 'eye', title: t('game.howto_talk_title'), body: t('game.howto_talk_body') },
])

/** Découpe une chaîne autour de ses `**…**` : les morceaux impairs sont en gras. */
function parts(text: string) {
  return text.split(/\*\*(.+?)\*\*/g)
}
</script>

<template>
  <!-- Plafonnée à la hauteur visible : tête et bouton fixes, seul le corps défile. -->
  <div
    class="howto-frame fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6"
    @click.self="emit('close')"
  >
    <div class="absolute inset-0 bg-ink-900/92" />

    <div
      class="howto-card relative z-10 w-full max-w-md flex flex-col bg-ink-900 border border-neon-600/50"
      style="box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)"
    >
      <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

      <div class="shrink-0 px-5 pt-5 pb-3 sm:px-7 sm:pt-7 sm:pb-4 border-b border-steel-600/30">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ t('game.howto_eyebrow') }}
        </p>
      </div>

      <div class="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7">
        <div class="space-y-5 py-4 sm:py-5">
          <div v-for="(s, i) in sections" :key="i" class="flex gap-4" :class="i && 'pt-5 border-t border-steel-600/40'">
            <div class="shrink-0 w-8 pt-0.5 text-neon-400">
              <svg v-if="s.icon === 'look'" viewBox="0 0 24 24" class="w-7 h-7" fill="none" stroke="currentColor" stroke-width="1.2">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="M15 15l6 6" />
                <path d="M8 9h5M8 12h3" opacity="0.7" />
              </svg>
              <svg v-else viewBox="0 0 24 16" class="w-8 h-6" fill="none" stroke="currentColor" stroke-width="1.2">
                <path d="M1 8s4-6.5 11-6.5S23 8 23 8s-4 6.5-11 6.5S1 8 1 8Z" />
                <circle cx="12" cy="8" r="3.2" fill="currentColor" opacity="0.85" />
              </svg>
            </div>
            <div class="space-y-1.5 min-w-0">
              <p class="text-neon-300 font-display uppercase tracking-[0.14em] text-[12px]">{{ s.title }}</p>
              <p class="text-ink-200/85 text-[13px] sm:text-sm leading-relaxed">
                <template v-for="(part, j) in parts(s.body)" :key="j"><strong
                  v-if="j % 2"
                  class="font-bold text-parchment"
                >{{ part }}</strong><template v-else>{{ part }}</template></template>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="shrink-0 px-5 pb-5 pt-3 sm:px-7 sm:pb-7 border-t border-steel-600/30">
        <GlowButton class="w-full" @click="emit('close')">{{ t('game.howto_cta') }}</GlowButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.howto-frame {
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
.howto-card {
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
}
</style>
