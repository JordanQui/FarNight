<script setup lang="ts">
import type { NarrativeEntry } from '~/types/game'
import type { Term } from '~/utils/glitch'
import { usePlayerStore } from '~/stores/player'
import { useGameStore } from '~/stores/game'
import { analyzables, visible } from '~/utils/interactables'
import { signalOf } from '~/utils/languages'

const props = defineProps<{ entries: NarrativeEntry[] }>()

const playerStore = usePlayerStore()
const gameStore = useGameStore()

/**
 * Ce qui se brouille dans le texte : les identités et les choses qu'on acquiert.
 *
 * Les gens et les objets ne se brouillent pas pareil — des caractères qui
 * défilent pour une identité, des blocs géométriques pour une chose — et ne se
 * lisent pas pareil : l'oeil révèle un nom, la loupe ouvre une épreuve.
 *
 * NE se brouille QUE ce qui S'ACQUIERT : l'objet-clé, l'objet scellé reçu au fil
 * d'une conversation, et le décor qu'on peut fouiller pour en tirer quelque
 * chose. Le décor ordinaire reste en clair — une voûte de béton ne se ramasse
 * pas, et la chiffrer noierait le signal sous le mobilier.
 *
 * Chaque chose porte SON id : c'est lui qui décide de ce qui est déchiffré. Ils
 * partageaient autrefois celui de l'objet scellé, si bien qu'une seule épreuve
 * réussie les révélait tous.
 */
const names = computed<Term[]>(() => {
  const scene = playerStore.scene
  if (!scene) return []

  const people: Term[] = scene.npcs
    .filter(n => n.name)
    .map(n => ({ value: n.name, kind: 'name' }))

  // La liste vit dans `utils/interactables` : la sortie de l'auberge exige
  // qu'on ait analysé quelque chose, et elle doit interroger exactement ce que
  // le récit a brouillé ici.
  // La LANGUE JOUÉE, pas celle par défaut : `analyzables` reconnaît les objets
  // qu'on ramasse à leur verbe, et le verbe vient du modèle, donc du pack. Le
  // français en dur ne trouvait aucun ramassable ailleurs — ni brouillé dans le
  // récit, ni ouvrable à la loupe, dans onze langues sur douze.
  const things: Term[] = analyzables(
    scene, playerStore.language, gameStore.revealedInteractableIds)
    .map(o => ({ value: o.label, kind: 'object', id: o.id }))

  // SANS CASSE, LE GRAS TIENT LIEU DE MAJUSCULE. Les mêmes noms que ceux que
  // `enforceNameCaps` recale ailleurs : ce qui se touche, le décor qu'on
  // examine, le lieu, l'augmentation. Placés en tête : un nom déjà brouillé
  // comme personne ou comme chose garde son brouillage.
  const marks: Term[] = signalOf(playerStore.language) === 'bold'
    ? [
        ...visible(scene.interactables, gameStore.revealedInteractableIds).map(i => i.label),
        ...(scene.decor ?? []).map(d => d.name),
        scene.place?.name,
        scene.key_item?.name,
      ]
        .filter((v): v is string => Boolean(v?.trim()))
        .map(value => ({ value, kind: 'mark' }))
    : []

  return [...marks, ...people, ...things]
})

const emit = defineEmits<{ typing: [boolean] }>()

/**
 * L'entrée que la machine à écrire tape encore, ou null.
 *
 * Retenue par son id : une entrée qui cesse d'être la dernière perd sa machine
 * à écrire sans avoir fini, et ne doit pas laisser l'écran croire qu'on tape.
 */
const typingEntryId = ref<string | null>(null)

function onTyping(id: string, value: boolean) {
  if (value) typingEntryId.value = id
  else if (typingEntryId.value === id) typingEntryId.value = null
}

watch(
  () => typingEntryId.value !== null && typingEntryId.value === props.entries[props.entries.length - 1]?.id,
  value => emit('typing', value),
  { immediate: true }
)

const scrollContainer = ref<HTMLElement | null>(null)

function scrollToBottom() {
  nextTick(() => {
    const el = scrollContainer.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

// Surveiller la ref de l'élément ne déclenchait jamais rien : elle ne change
// qu'au montage. Il faut suivre le contenu, texte en cours de frappe compris.
watch(
  () => [props.entries.length, props.entries[props.entries.length - 1]?.text] as const,
  scrollToBottom,
  { immediate: true }
)
</script>

<template>
  <div
    ref="scrollContainer"
    class="flex-1 overflow-y-auto px-4 py-4 space-y-4 min-h-0 transition-opacity duration-150"
    :class="[gameStore.revealing && 'is-hacking', gameStore.readDenied && 'is-denied']"
  >
    <TransitionGroup name="entry" tag="div" class="space-y-4">
      <div
        v-for="entry in entries"
        :key="entry.id"
        :class="{
          'narrative-text text-parchment/90 text-[15px] sm:text-sm leading-relaxed whitespace-pre-line': entry.type === 'narration',
          'pl-4 border-l-2 border-neon-700/60 text-neon-200 text-sm italic': entry.type === 'npc_speech',
          'text-neon-500/70 text-xs uppercase tracking-widest whitespace-pre-line': entry.type === 'system',
          'text-ink-400 text-xs font-mono': entry.type === 'player_command',
        }"
      >
        <span v-if="entry.type === 'npc_speech' && entry.npcName" class="block text-neon-400/80 text-xs mb-1 not-italic font-sans uppercase tracking-wider">
          {{ entry.npcName }}
        </span>
        <span v-if="entry.type === 'player_command'" class="text-neon-600/50 mr-1">&gt;</span>
        <TypewriterText
          v-if="entry === entries[entries.length - 1] && ['narration', 'npc_speech'].includes(entry.type)"
          :text="entry.text"
          :names="names"
          @typing="onTyping(entry.id, $event)"
        />
        <GlitchText v-else :text="entry.text" :names="names" />
      </div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
/*
 * Pendant la lecture d'un nom, tout le reste s'efface. On ne lit qu'une chose
 * à la fois : c'est ce qui oblige à mémoriser au lieu de recopier.
 */
.is-hacking :deep(*) {
  color: transparent !important;
  text-shadow: none !important;
}

/*
 * Le nom déchiffré et SES DEUX COUCHES internes doivent survivre à l'effacement.
 * La règle précédente n'épargnait que l'élément portant la classe, pas ses
 * enfants — et comme le texte visible est justement dans un enfant, le nom
 * disparaissait avec le reste.
 */
.is-hacking :deep(.glitch-name),
.is-hacking :deep(.glitch-name *) {
  color: rgb(var(--neon-200)) !important;
  text-shadow:
    0 0 4px rgb(var(--neon-500) / 0.95),
    0 0 14px rgb(var(--neon-500) / 0.7) !important;
}

/*
 * Lecture refusée, faute d'oeil actif. Le texte ne disparaît pas : il se met à
 * trembler comme le nom, pour dire que l'illisibilité vient de gagner du
 * terrain. Aucun message, juste la réaction du système.
 */
.is-denied {
  animation: read-denied 0.7s steps(2, end);
}

@keyframes read-denied {
  0%, 100% { transform: none; filter: none; opacity: 1 }
  10% { transform: translateX(-2px) skewX(-1.5deg); filter: blur(0.6px); opacity: 0.75 }
  25% { transform: translateX(3px); filter: blur(0.3px); opacity: 0.9 }
  40% { transform: translateX(-1px) skewX(1deg); filter: blur(0.9px); opacity: 0.6 }
  60% { transform: translateX(2px); filter: blur(0.4px); opacity: 0.85 }
  80% { transform: translateX(-1px); filter: blur(0.2px); opacity: 0.95 }
}

.entry-enter-active { transition: opacity 0.4s ease, transform 0.4s ease; }
.entry-enter-from { opacity: 0; transform: translateY(6px); }
</style>
