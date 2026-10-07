<script setup lang="ts">
/**
 * Le plan de la nuit, en boutons.
 *
 * Chaque bouton ouvre une scène par `useProgression().goTo` — le chemin de la
 * sortie jouée, du paiement et de `#scene<n>` : la scène quittée s'inscrit au
 * journal, la copie en session est oubliée, puis on revient sur l'écran de jeu
 * par une navigation interne, pour que le store survive au trajet.
 *
 * Un saut lance une vraie génération : il coûte une scène.
 */
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useProgression, type SceneRef } from '~/composables/useProgression'

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const gameStore = useGameStore()
const playerStore = usePlayerStore()
const progression = useProgression()

/** Les scènes groupées par acte, dans l'ordre du script ; l'auberge à part. */
const groups = computed(() => {
  const out: { act: string; scenes: { ref: SceneRef; n: number }[] }[] = []
  progression.scenes().forEach((scene, i) => {
    const act = scene.kind === 'ending' ? 'Épilogue' : scene.act ?? 'Ouverture'
    const last = out[out.length - 1]
    if (last?.act === act) last.scenes.push({ ref: scene, n: i + 1 })
    else out.push({ act, scenes: [{ ref: scene, n: i + 1 }] })
  })
  return out
})

const here = computed(() => gameStore.pendingSceneId ?? playerStore.scene?.scene_id ?? null)
const busy = ref<string | null>(null)

async function jump(target: SceneRef) {
  busy.value = target.id
  // Une séance de test ferme vite la ville : sans ce verrou levé, l'accueil
  // rebasculerait sur l'écran d'adieu au lieu de construire la scène.
  await $fetch('/api/lockout', { method: 'POST', body: { open: true } }).catch(() => {})
  gameStore.openCity()
  progression.goTo(target)
  await navigateTo('/')
}
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-3xl space-y-10">
      <header class="space-y-4">
        <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Admin — navigation</p>
        <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Toutes les scènes</h1>
        <div class="neon-rule w-32" />
        <p class="text-ink-200/85 text-sm leading-relaxed">
          Un clic ferme la scène en cours, l’inscrit au journal et construit celle-ci — comme
          <code class="text-neon-300">#scene&lt;n&gt;</code>. Chaque saut coûte une génération.
        </p>
      </header>

      <section v-for="g in groups" :key="g.act" class="space-y-3">
        <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">{{ g.act }}</h2>
        <div class="grid gap-2 sm:grid-cols-2">
          <button
            v-for="s in g.scenes" :key="s.ref.id" type="button" :disabled="!!busy"
            class="text-left border p-3 space-y-1 transition-colors disabled:opacity-50"
            :class="s.ref.id === here ? 'border-neon-500/80' : 'border-steel-600/60 hover:border-neon-600/60'"
            @click="jump(s.ref)"
          >
            <p class="font-display text-neon-300/90 text-xs">{{ s.n }}. {{ s.ref.id }}</p>
            <p class="text-ink-100 text-sm leading-snug">{{ s.ref.title }}</p>
            <p v-if="busy === s.ref.id" class="text-steel-400 text-[10px] uppercase tracking-[0.14em]">ouverture…</p>
          </button>
        </div>
      </section>

      <nav class="flex gap-4 text-xs">
        <NuxtLink to="/" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Retour au jeu</NuxtLink>
        <NuxtLink to="/admin/story" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">La trame</NuxtLink>
      </nav>
    </div>
  </div>
</template>
