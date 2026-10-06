<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'
import { useGameStore } from '~/stores/game'
import { interpolate } from '~/utils/prompt-builder'
import { useInputMode } from '~/composables/useInputMode'

/**
 * La fenêtre qui présente l'augmentation, à sa remise.
 *
 * Le joueur vient d'obtenir un objet dont il ne sait rien : ni ce qu'il fait,
 * ni comment s'en servir. Sans ce moment, il repart avec une loupe dans la
 * barre d'outils sans savoir qu'elle existe ni qu'il faut S'ARRÊTER sur un mot.
 *
 * Elle s'ouvre à la REMISE, une seule fois par partie : c'est le moment où le
 * joueur se demande ce qu'il vient de recevoir.
 *
 * Le RÉCIT est brodé à partir des champs déjà générés de l'objet — il change
 * donc d'un joueur à l'autre, comme l'objet lui-même — et ne coûte aucun appel
 * supplémentaire. Le MODE D'EMPLOI, lui, est fixe : c'est une mécanique.
 *
 * C'EST AUSSI LE SEUL ENDROIT OÙ LA RÈGLE D'OBSERVATION SE DIT (`caps_note`).
 * L'augmentation, elle, vient d'un personnage : si rien ne le corrigeait, le
 * joueur en déduirait que tout s'obtient en parlant, et traverserait le reste
 * de la nuit sans jamais ramasser ce que les salles laissent traîner.
 */
const playerStore = usePlayerStore()
const gameStore = useGameStore()

const primer = computed(() => playerStore.scene?.augmentation_primer ?? null)

/** Vrai sur un appareil sans survol : c'est l'oeil gyroscopique qui vise. */
const { usesTouch: usesGyro } = useInputMode()

const story = computed(() => {
  const p = primer.value
  const item = playerStore.scene?.key_item
  if (!p || !item) return []
  // Un champ que le modèle a laissé vide ne doit pas laisser un trou dans la
  // phrase : le script porte un repli pour chacun.
  const f = p.story_fallbacks
  const values: Record<string, string> = {
    item_name: item.name,
    item_description: item.description || f.item_description,
    item_worn: item.worn || f.item_worn,
    item_why: item.why || f.item_why,
    // L'acte que l'augmentation rend possible : c'est le champ le plus
    // personnel de l'objet — il est taillé sur ce que la nuit oppose au joueur
    // et sur la tension de son signe — et la fenêtre est le seul endroit où il
    // lui est dit en clair.
    item_action: item.resolving_action || f.item_action,
  }
  return p.story.map(line => interpolate(line, values)).filter(Boolean)
})

const steps = computed(() =>
  usesGyro.value ? primer.value?.howto_gyro ?? [] : primer.value?.howto_pointer ?? [])

function close() {
  gameStore.markPrimerSeen()
}
</script>

<template>
  <!--
    LA FENÊTRE EST PLUS HAUTE QUE L'ÉCRAN, même sur un iPhone 15 : récit, mode
    d'emploi, note et bouton. Centrée dans un conteneur qui défilait, son haut
    passait sous le bord et ne se rattrapait plus. Elle est donc plafonnée à la
    hauteur VISIBLE (dvh, encoches déduites) : le nom reste en tête, le bouton
    au pied, et seul le texte entre les deux défile.
  -->
  <div
    v-if="primer"
    class="primer-frame fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6"
    @click.self="close"
  >
    <div class="absolute inset-0 bg-ink-900/92" />

    <div
      class="primer-card relative z-10 w-full max-w-md flex flex-col bg-ink-900 border border-neon-600/50"
      style="box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)"
    >
      <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

      <div class="shrink-0 space-y-1.5 px-5 pt-5 pb-3 sm:px-7 sm:pt-7 sm:pb-4 border-b border-steel-600/30">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ primer.eyebrow }}
        </p>
        <p class="neon-text font-display uppercase text-lg sm:text-xl tracking-[0.05em] break-words">
          {{ gameStore.augmentation?.name ?? playerStore.scene?.key_item?.name }}
        </p>
      </div>

      <div class="primer-body relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7">
        <div class="space-y-5 py-4 sm:py-5">
          <div class="space-y-3">
            <p v-for="(line, i) in story" :key="i" class="text-ink-200/85 text-[13px] sm:text-sm leading-relaxed">
              {{ line }}
            </p>
          </div>

          <div class="space-y-3 pt-4 border-t border-steel-600/40">
            <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.28em] font-display">
              {{ primer.howto_title }}
            </p>
            <ol class="space-y-2">
              <li
                v-for="(step, i) in steps"
                :key="i"
                class="text-ink-200/80 text-[13px] leading-relaxed flex gap-3"
              >
                <span class="text-neon-500/70 font-mono shrink-0">{{ i + 1 }}</span>
                <span>{{ step }}</span>
              </li>
            </ol>
          </div>

          <p v-if="primer.caps_note" class="text-ink-200/80 text-[13px] leading-relaxed">
            {{ primer.caps_note }}
          </p>

          <p class="text-steel-400 text-[11px] leading-relaxed italic">
            {{ primer.footer }}
          </p>
        </div>
        <!-- Le texte continue : un fondu au pied le dit sans barre de défilement. -->
        <div class="sticky bottom-0 -mx-5 sm:-mx-7 h-8 bg-gradient-to-t from-ink-900 to-transparent pointer-events-none" />
      </div>

      <div class="shrink-0 px-5 pb-5 pt-3 sm:px-7 sm:pb-7 border-t border-steel-600/30">
        <GlowButton class="w-full" @click="close">{{ primer.cta }}</GlowButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.primer-frame {
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
.primer-card {
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
}
</style>
