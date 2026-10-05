<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { GLYPHS } from '~/utils/psychotest'

const props = defineProps<{ id: string; label: string }>()

const gameStore = useGameStore()

/**
 * La demande passe par le store, jamais par un événement.
 *
 * Elle remontait autrefois de composant en composant jusqu'à `GameShell`, qui
 * ouvrait l'épreuve de l'objet scellé — le seul qu'il connaissait. Depuis que
 * le décor fouillé et les objets reçus se déchiffrent aussi, c'est CET objet-ci
 * qu'il faut désigner, et le store est déjà le point de rendez-vous des deux
 * chemins de visée : la souris et l'oeil gyroscopique.
 */
function ask() {
  gameStore.requestChallenge(props.id, props.label)
}

/**
 * Le brouillage des OBJETS, distinct de celui des personnages.
 *
 * Les noms de gens sont recouverts de caractères qui défilent ; les objets le
 * sont de blocs géométriques. Le joueur doit voir d'un coup d'oeil à quoi il a
 * affaire — une identité ne se déchiffre pas comme une chose.
 */
const seed = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null

onMounted(() => { ticker = setInterval(() => { seed.value++ }, 170) })
onUnmounted(() => { if (ticker) clearInterval(ticker) })

const decrypted = computed(() => gameStore.decryptedObjectIds.includes(props.id))

/**
 * Densité du bruit : UN BLOC POUR DEUX CARACTÈRES.
 *
 * Les blocs géométriques font environ un cadratin chacun, une lettre de texte
 * courant à peu près la moitié. Un bloc par caractère donnait donc un
 * brouillage deux fois plus large que le nom qu'il recouvre : la couche
 * flottante en rognait la moitié, et l'objet apparaissait comme une bande de
 * blocs coupée aux deux bouts. Les noms de personnages échappent au problème
 * parce qu'ils sont rendus en monospace, où bruit et nom ont la même chasse.
 */
const CHARS_PER_BLOCK = 2

/** Une trame de blocs, de la largeur du vrai nom. */
const shown = computed(() => {
  if (decrypted.value) return props.label

  // Mot par mot : le brouillage garde le RYTHME du nom. Le joueur voit qu'il en
  // compte deux ou trois, et lequel est le plus long, sans pouvoir les lire —
  // c'est ce qui distingue un objet scellé d'une tache dans la phrase.
  return props.label.split(' ').map((word, w) => {
    if (!word) return ''
    const blocks = Math.max(1, Math.round(word.length / CHARS_PER_BLOCK))
    return Array.from({ length: blocks }, (_, i) =>
      GLYPHS[(seed.value * 5 + (w * 31 + i) * 7 + word.charCodeAt(0)) % GLYPHS.length]
    ).join('')
  }).join(' ')
})

/**
 * Temps de pause avant que l'épreuve s'ouvre.
 *
 * Les noms se révèlent au passage, sans délai : c'est sans conséquence. Une
 * épreuve, elle, prend l'écran — l'ouvrir parce que la souris a balayé une
 * ligne serait insupportable. Il faut donc s'arrêter DESSUS, ce qui est aussi
 * le geste juste : on ne hacke pas un objet en passant devant.
 */
const DWELL_MS = 550
let dwell: ReturnType<typeof setTimeout> | null = null

/** Vrai quand la loupe est en main et que l'objet est encore scellé. */
const readable = computed(() =>
  !decrypted.value && gameStore.hasAugmentation && gameStore.activeTool === 'lens')

function onEnter() {
  if (!readable.value) return
  cancel()
  dwell = setTimeout(ask, DWELL_MS)
}

function cancel() {
  if (dwell) { clearTimeout(dwell); dwell = null }
}

onUnmounted(cancel)

/** Le clic reste : au clavier et à la souris, on peut vouloir aller vite. */
function onActivate() {
  if (decrypted.value) return
  cancel()
  // Sans l'augmentation, ou avec l'oeil en main, rien à tenter : seule la
  // loupe ouvre l'épreuve.
  if (!readable.value) {
    gameStore.denyRead()
    return
  }
  ask()
}
</script>

<template>
  <span
    class="glitch-object"
    :class="[
      decrypted ? 'is-clear' : 'is-sealed',
      !decrypted && gameStore.activeTool === 'lens' ? 'cursor-lens' : gameStore.eyeActive ? 'cursor-eye' : null,
    ]"
    :tabindex="decrypted ? -1 : 0"
    :role="decrypted ? undefined : 'button'"
    :aria-label="decrypted ? label : t('game.sealed_object')"
    :data-glitch-object="decrypted ? undefined : id"
    :data-glitch-label="decrypted ? undefined : label"
    @mouseenter="onEnter"
    @mouseleave="cancel"
    @click="onActivate"
    @keydown.enter="onActivate"
  >
    <span class="sizer" aria-hidden="true">{{ label }}</span>
    <span class="overlay">{{ shown }}</span>
  </span>
</template>

<style scoped>
/* Même montage que les noms : une couche invisible réserve la largeur, le
   brouillage flotte au-dessus et ne déplace jamais le texte autour. */
.glitch-object {
  position: relative;
  display: inline-block;
  white-space: nowrap;
  vertical-align: baseline;
  /*
   * PAS d'`overflow` ici, et c'est structurel.
   *
   * Sur un `inline-block`, dès que `overflow` vaut autre chose que `visible`,
   * la ligne de base de l'élément n'est plus celle de son texte mais son BORD
   * INFÉRIEUR. Le mot chiffré descendait donc sous la ligne du paragraphe, et
   * plus il y en avait dans une phrase, plus le texte paraissait décousu.
   *
   * Le rognage du bruit est reporté sur `.overlay`, qui est en position
   * absolue : son débordement ne concerne plus personne.
   */
  outline: none;
  font-size: 0.95em;
  letter-spacing: 0.05em;
  transition: color 0.15s ease;
}

.sizer { visibility: hidden; }
.overlay { position: absolute; inset: 0; overflow: hidden; text-align: center; }

/* Scellé : froid, minéral — ce n'est pas une personne. */
.is-sealed { color: rgb(var(--steel-400)); }

/* Déchiffré : la couleur du texte, l'objet devient un mot comme un autre. */
.is-clear { color: rgb(var(--ink-100)); font-weight: 600; }
</style>
