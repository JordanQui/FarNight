<script setup lang="ts">
import { splitByNames, type Term } from '~/utils/glitch'
import { useGameStore } from '~/stores/game'

const gameStore = useGameStore()

const props = defineProps<{
  text: string
  names: Array<string | Term>
  /** Nombre de caractères déjà tapés. Omis, tout le texte est affiché. */
  visible?: number
}>()

/**
 * Le texte, découpé autour des noms.
 *
 * La frappe progressive est gérée ici plutôt que dans le composant machine à
 * écrire : tronquer la chaîne AVANT le découpage couperait les noms en deux et
 * en laisserait une moitié lisible en clair — ce qui viderait la mécanique.
 */
/**
 * Le texte sans le gras du modèle. Le gras marque ce qui se touche, et c'est
 * l'interface qui le pose, depuis les noms déclarés : des
 * astérisques laissés par le modèle seraient une marque qui ne promet rien.
 */
const plain = computed(() => props.text.replace(/\*\*(.+?)\*\*/g, '$1'))

const segments = computed(() => {
  const limit = props.visible ?? plain.value.length
  return splitByNames(plain.value, props.names)
    .filter(seg => seg.start < limit)
    .map(seg => ({
      ...seg,
      // Un nom ne s'affiche qu'entier : à moitié tapé, il resterait muet.
      text: seg.name ? seg.text : seg.text.slice(0, Math.max(0, limit - seg.start)),
      complete: !seg.name || seg.start + seg.text.length <= limit,
    }))
    .filter(seg => !seg.name || seg.complete)
})
</script>

<template>
  <span><template v-for="(seg, i) in segments" :key="i"><GlitchObject
    v-if="seg.name && seg.kind === 'object' && seg.id"
    :id="seg.id"
    :label="seg.name"
  /><strong
    v-else-if="seg.name && seg.kind === 'mark'"
    class="mark-link font-bold text-parchment"
    role="button"
    tabindex="0"
    @click="gameStore.requestLook(seg.name)"
    @keydown.enter="gameStore.requestLook(seg.name)"
  >{{ seg.name }}</strong><GlitchName
    v-else-if="seg.name"
    :name="seg.name"
  /><template v-else>{{ seg.text }}</template></template></span>
</template>

<style scoped>
/* Un mot en gras s'examine d'un clic : sous la souris, le curseur redevient
   une flèche et le mot se souligne. Au doigt, pas de survol, pas de trait. */
.mark-link { cursor: default; outline: none; }
@media (hover: hover) {
  .mark-link:hover, .mark-link:focus-visible { text-decoration: underline; text-underline-offset: 3px; }
}
</style>
