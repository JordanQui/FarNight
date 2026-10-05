<script setup lang="ts">
const { t } = useLang()

import type { SceneNPC } from '~/types/scene'

defineProps<{ npc: SceneNPC; talked?: boolean }>()
</script>

<template>
  <div
    class="flex items-start gap-3 p-3 bg-ink-800/60 border transition-colors"
    :class="talked ? 'border-neon-600/50' : 'border-steel-600/50'"
  >
    <!-- Portrait -->
    <div class="shrink-0 w-12 h-12 overflow-hidden border border-steel-600/60 bg-ink-700">
      <img
        v-if="npc.portraitUrl"
        :src="npc.portraitUrl"
        :alt="npc.name"
        class="w-full h-full object-cover"
      />
      <div v-else class="w-full h-full flex items-center justify-center text-steel-400 text-xl font-mono">
        ?
      </div>
    </div>

    <!-- Info -->
    <div class="flex-1 min-w-0">
      <p class="flex items-center gap-1.5 text-xs uppercase tracking-wider font-display mb-0.5">
        <!--
          Le panneau est un carnet de rencontres, pas un annuaire. Tant qu'on
          n'a pas parlé à quelqu'un, son nom n'y figure pas — même chiffré.
          C'est dans le récit qu'on le découvre et qu'on le déchiffre.

          Une fois la rencontre faite, le nom s'y inscrit EN CLAIR et n'en
          bouge plus : c'est ce qu'on a gagné en allant parler. Le joueur doit
          mémoriser pour aborder quelqu'un, pas pour le réaborder.
        -->
        <span v-if="talked" class="text-neon-300">{{ npc.name }}</span>
        <span
          v-else
          class="font-mono text-[0.95em] text-steel-500 select-none"
          :title="t('game.unknown_identity')"
        >— — — —</span>

        <!-- Puce pleine : tu lui as déjà parlé -->
        <span
          class="w-1.5 h-1.5 shrink-0"
          :class="talked ? 'bg-neon-500' : 'bg-steel-600'"
          :title="talked ? t('game.already_asked') : t('game.not_asked_yet')"
        />
      </p>
      <p v-if="npc.archetype" class="text-ink-300 text-xs">{{ npc.archetype }}</p>
    </div>
  </div>
</template>
