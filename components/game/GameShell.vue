<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useNarrative } from '~/composables/useNarrative'
import { useStorylets } from '~/composables/useStorylets'
import { useImageGen } from '~/composables/useImageGen'
import { observationOf } from '~/utils/interactables'
import { usePuzzle } from '~/composables/usePuzzle'
import { useNightClock } from '~/composables/useNightClock'

const gameStore = useGameStore()
const playerStore = usePlayerStore()
const { retryLastTurn } = useNarrative()
const { generateSceneImage } = useImageGen()
// Une saisie n'entre plus par une cascade de `if` : elle tire un moment dans
// le deck, dont l'ordre de priorité se lit d'un bloc dans `utils/storylets.ts`.
const { play } = useStorylets()
const puzzle = usePuzzle()
const night = useNightClock()

/**
 * Ouvert par défaut : le joueur doit voir tout de suite avec qui parler, c'est
 * par là que passe la progression. Il peut toujours replier pour lire.
 */
const showNpcs = ref(true)

/** Refermer l'épreuve, c'est retirer la demande : elle n'a pas d'autre état. */
function closeTest() {
  gameStore.clearChallenge()
}

/**
 * Analyse réussie : le nom de CET objet devient lisible, définitivement.
 *
 * L'épreuve portait autrefois toujours sur l'objet scellé, le seul que cet
 * écran connaissait. Elle porte maintenant sur celui qui était sous la loupe —
 * une carte d'accès, un objet trouvé dans le décor —, et c'est le store qui
 * l'a désigné : les deux chemins de visée, la souris et l'oeil gyroscopique,
 * n'ont que lui en commun.
 */
function onSolved() {
  const target = gameStore.pendingChallenge
  gameStore.clearChallenge()
  if (!target) return

  gameStore.markDecrypted(target.id)
  gameStore.addNarrativeEntry('system', t('game.analysis_done', { label: target.label }))

  // Ce que l'analyse révèle : l'objet scellé le porte, et depuis peu les objets
  // qu'on ramasse dans le décor aussi. Ces textes ont été écrits à la
  // génération de la scène — les afficher ne coûte aucun appel au modèle.
  // Ce que l'analyse révèle vient de la MÊME liste que le brouillage du texte :
  // l'objet scellé, les ramassables du décor, et l'augmentation elle-même, dont
  // le nom est prononcé dès l'ouverture sans que le joueur puisse le lire. Trois
  // recherches séparées laissaient chaque fois un chemin en arrière.
  const observation = observationOf(
    playerStore.scene, gameStore.inventory, target.id,
    playerStore.language, gameStore.revealedInteractableIds)
  if (observation) gameStore.addNarrativeEntry('narration', observation)
  // Un objet porté qui tient un morceau de l'énigme d'ici le livre à la même
  // lecture : le déchiffrer, c'est enfin pouvoir le regarder.
  const carriedClue = playerStore.scene?.puzzle?.clues.find(c => c.item_id === target.id)?.text
  if (carriedClue) gameStore.addNarrativeEntry('narration', carriedClue)

  // LÀ OÙ L'OBJET N'EST SUR PERSONNE, LE LIRE L'OUVRE. Une fréquence affichée
  // par un terminal, un code gravé sur une plaque : il n'y a rien à recevoir
  // des mains de quelqu'un. Sans énigme, le lire suffit à l'obtenir ; avec
  // une énigme, le lire montre le cadran, le clavier, le lecteur — et il
  // reste à trouver la réponse. Voir `usePuzzle`.
  if (isFoundItem.value && target.id === puzzle.keyId.value && !gameStore.hasKeyItem) puzzle.keyItemRead()
}

/**
 * Le joueur tend un objet à celui à qui il parle.
 *
 * Le clic désigne l'objet et le destinataire ; la phrase n'est là que pour
 * laisser une trace au fil, et c'est le deck qui décide de la suite — il le
 * prend et parle, ou il le rend.
 */
function offerItem(itemId: string) {
  const npc = playerStore.npcs.find(n => n.id === gameStore.activeNpcId)
  const item = gameStore.inventory.find(o => o.id === itemId)
  if (!npc || !item) return
  const known = gameStore.decryptedObjectIds.includes(item.id)
  gameStore.offerToNpc(item.id, npc.id)
  void play(`Tu tends ${known ? item.label : 'ce que tu portes'} à ${npc.name}.`)
}

/** La grille de l'inventaire est ouverte : elle recouvre la scène. */
const inventoryOpen = ref(false)

/** La machine à écrire tape encore la dernière réplique. */
const narrationTyping = ref(false)

/**
 * Le bandeau « Prendre » peut paraître.
 *
 * Pas à la fin du flux : à la fin de la RÉPLIQUE, une fois le dernier mot tapé
 * et un temps de silence passé. Affiché plus tôt, il annonçait la remise
 * pendant que le détenteur en était encore à la préparer.
 */
const offerReady = ref(false)
let offerTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => gameStore.pendingKeyItem && !narrationTyping.value && !gameStore.isInputDisabled,
  (ready) => {
    if (offerTimer) { clearTimeout(offerTimer); offerTimer = null }
    if (!ready) { offerReady.value = false; return }
    offerTimer = setTimeout(() => { offerReady.value = true }, 700)
  },
  { immediate: true }
)

onUnmounted(() => { if (offerTimer) clearTimeout(offerTimer) })

/** Ici, l'objet-clé n'a pas de détenteur : il est inscrit dans le lieu. */
const isFoundItem = computed(() => playerStore.scene?.key_item?.acquisition === 'found')

/** Le joueur prend l'objet que le détenteur lui tend. */
function collectItem() {
  puzzle.collect()
}

/**
 * L'énigme est ouverte, pas résolue, et son panneau est refermé : un bandeau
 * permet d'y revenir sans relire l'objet à la loupe.
 */
const puzzleWaiting = computed(() =>
  gameStore.puzzleUnlocked && !gameStore.puzzleOpen && !gameStore.hasKeyItem && Boolean(puzzle.puzzle.value))

function retryImage() {
  const scene = playerStore.scene
  if (!scene) return

  // Illustration figée : il n'y a rien à regénérer, on la repose.
  if (scene.static_image) {
    gameStore.setSceneImage(scene.static_image)
    gameStore.finishSceneImage()
    return
  }

  void generateSceneImage({
    sceneId: scene.scene_id,
    placeName: scene.place.name,
    palette: scene.palette,
    decor: scene.decor,
    planned: scene.planned,
  })
}
</script>

<template>
  <div
    class="flex flex-col h-[100dvh] bg-ink-900 tool-cursor"
    :class="gameStore.activeTool === 'lens' ? 'cursor-lens' : gameStore.eyeActive && !gameStore.eyeHidden && 'cursor-eye'"
  >
    <!--
      L'outil en main EST le curseur, sur toute la surface de jeu.
      Il ne l'était que sur les noms chiffrés : ailleurs, flèche standard. Le
      joueur ne voyait donc pas ce qu'il tenait tant qu'il n'avait pas trouvé
      quelque chose à lire — alors que sur mobile l'oeil est à l'écran en
      permanence. `tool-cursor` rend leur curseur normal aux commandes.
      L'oeil fermé, pas de curseur-oeil : il ne lirait rien, et c'est le bouton
      « Ouvrir l'œil » qui dit ce qu'il fait.
    -->
    <!-- Le cadre reste 16/9 sur les deux tailles. Mobile : il prend toute la
         largeur. Desktop : c'est la hauteur qui le dimensionne, et il se centre
         — un 16/9 pleine largeur y ferait 810px de haut, sans place pour le
         texte. -->
    <div class="shrink-0 flex justify-center">
      <SceneImage
        :src="gameStore.currentSceneImageUrl"
        :loading="gameStore.sceneImageLoading"
        :error="gameStore.sceneImageError"
        @retry="retryImage"
      />
    </div>

    <!-- Bandeau : lieu + accès aux PNJ -->
    <div class="shrink-0 flex items-center gap-3 px-4 py-2 border-b border-neon-700/30">
      <p class="flex-1 min-w-0 truncate text-neon-400/90 font-display uppercase tracking-[0.14em] text-[11px]">
        {{ playerStore.place?.name ?? playerStore.scene?.scene_title }}
      </p>
      <!-- L'heure de la nuit. Elle ne bouge qu'avec ce qui coûte : une
           réplique, une énigme ratée, un endroit fouillé, un trajet. -->
      <span
        v-if="night.running.value"
        class="shrink-0 font-mono tabular-nums text-[11px] tracking-[0.08em]"
        :class="night.urgent.value ? 'text-neon-200 animate-pulse' : 'text-neon-500/80'"
        :title="t('night.clock_title', { dawn: night.config.value?.dawn ?? '', left: night.duration(night.left.value.total) })"
      >{{ night.clock.value }}</span>
      <button
        v-if="playerStore.npcs.length"
        class="shrink-0 text-xs text-neon-600/80 hover:text-neon-400 transition-colors py-1 px-2 -my-1"
        @click="showNpcs = !showNpcs"
      >
        {{ playerStore.npcs.length }} à qui parler {{ showNpcs ? '▴' : '▾' }}
      </button>

    </div>

    <!-- Outils de lecture, et l'accès à ce que le joueur porte -->
    <ToolRail @inventory="inventoryOpen = true" />

    <!-- Le même inventaire, étalé : les noms en entier et les mêmes gestes -->
    <InventoryGrid
      v-if="inventoryOpen"
      @give="offerItem"
      @close="inventoryOpen = false"
    />

    <!-- Réglages, en surimpression en haut à droite de l'écran -->
    <SettingsPanel />

    <!-- Liste des PNJ -->
    <Transition name="slide">
      <div v-if="showNpcs" class="shrink-0 flex gap-2 px-4 py-2 border-b border-neon-700/30 overflow-x-auto">
        <NPCDialogue
          v-for="npc in playerStore.npcs"
          :key="npc.id"
          :npc="npc"
          :talked="gameStore.talkedToNpcIds.includes(npc.id)"
          class="shrink-0 w-44 sm:w-48"
        />
      </div>
    </Transition>


    <!-- Narration. L'historique tient lieu d'inventaire : l'objet scellé y
         reste visible, et l'on y revient avec la loupe. -->
    <NarrativeText :entries="gameStore.narrativeHistory" @typing="narrationTyping = $event" />

    <!-- Au premier passage à la loupe : ce qu'elle est, et comment s'en servir -->
    <AugmentationPrimer v-if="gameStore.primerOpen" />


    <PsychoTest
      v-if="gameStore.pendingChallenge"
      :object-id="gameStore.pendingChallenge.id"
      :object-name="gameStore.pendingChallenge.label"
      @solved="onSolved"
      @close="closeTest"
    />

    <!-- L'énigme de la scène : cadran, clavier, séquence ou lecteur -->
    <PuzzlePanel
      v-if="gameStore.puzzleOpen && puzzle.puzzle.value"
      :puzzle="puzzle.puzzle.value"
      :name="playerStore.scene?.key_item?.name ?? ''"
      :submit="puzzle.submit"
      @close="gameStore.setPuzzleOpen(false)"
    />

    <Transition name="slide">
      <div
        v-if="puzzleWaiting"
        class="shrink-0 flex items-center gap-3 mx-4 mb-2 px-3 py-2 border border-neon-700/40 bg-ink-900/80"
      >
        <p class="flex-1 min-w-0 text-[11px] text-neon-300/90 font-mono truncate">
          {{ t('puzzle.waiting', { name: playerStore.scene?.key_item?.name ?? '' }) }}
        </p>
        <button
          class="shrink-0 text-[10px] uppercase tracking-[0.2em] font-display text-neon-300 hover:text-neon-100 border border-neon-600/50 px-2 py-1"
          @click="gameStore.setPuzzleOpen(true)"
        >{{ t('puzzle.reopen') }}</button>
      </div>
    </Transition>

    <!--
      L'objet est TENDU, pas donné : c'est la fin de la conversation avec celui
      qui le portait, et c'est le joueur qui referme sa main dessus.
    -->
    <Transition name="slide">
      <PickupPrompt
        v-if="offerReady && playerStore.scene?.key_item"
        :label="t('game.offered_to_you', { item: playerStore.scene.key_item.name })"
        :action="t('game.action_collect')"
        :slide-label="t('game.slide_collect')"
        offered
        @confirm="collectItem"
      />
    </Transition>

    <!-- Tour en échec : la saisie reste ouverte, et on peut relancer -->
    <Transition name="slide">
      <div
        v-if="gameStore.turnError"
        class="shrink-0 flex items-center gap-3 mx-4 mb-2 px-3 py-2 border border-red-900/50 bg-red-950/20"
      >
        <p class="flex-1 min-w-0 text-red-300/70 text-xs leading-snug">
          {{ gameStore.turnError }}
        </p>
        <button
          class="shrink-0 text-neon-400 hover:text-neon-300 text-xs uppercase tracking-wider border border-neon-700/60 px-3 py-1.5 transition-colors"
          @click="retryLastTurn"
        >
          {{ t('common.retry') }}
        </button>
        <button
          class="shrink-0 text-ink-400 hover:text-parchment/60 text-lg leading-none px-1 transition-colors"
          :aria-label="t('common.ignore')"
          @click="gameStore.clearTurnError()"
        >
          ×
        </button>
      </div>
    </Transition>

    <!-- Le bouton de l'oeil, et au tactile son réticule -->
    <HackEye />

    <!-- Saisie -->
    <div class="shrink-0 pb-[env(safe-area-inset-bottom)]">
      <CommandInput
        :disabled="gameStore.isInputDisabled"
        @command="play"
      />
    </div>
  </div>
</template>

<style scoped>
.slide-enter-active, .slide-leave-active { transition: all 0.25s ease; overflow: hidden; }
.slide-enter-from, .slide-leave-to { max-height: 0; opacity: 0; }
.slide-enter-to, .slide-leave-from { max-height: 200px; opacity: 1; }
</style>
