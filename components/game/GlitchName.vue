<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useNameChime } from '~/composables/useNameChime'
import { voiceOfName } from '~/utils/voices'
import { scramble } from '~/utils/glitch'
import { canChimeName } from '~/utils/name-chime-policy'

const props = defineProps<{ name: string }>()

const gameStore = useGameStore()
const playerStore = usePlayerStore()
const { start: startChime, stop: stopChime } = useNameChime()

/**
 * Le brouillage change à intervalle régulier : c'est ce mouvement qui dit au
 * joueur qu'il y a quelque chose à lire là.
 */
const seed = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  ticker = setInterval(() => {
    // Un nom déjà rencontré ne bouge plus : inutile de le repeindre 9 fois par
    // seconde pour rien.
    if (known.value) return
    seed.value = (seed.value + 1) % 997
  }, 110)
})
onUnmounted(() => { if (ticker) clearInterval(ticker) })

/**
 * L'attribution est faite pour la scène ENTIÈRE, pas nom par nom : c'est la
 * seule façon de garantir que deux personnages ne partagent pas une voix.
 */
const assigned = computed(() => voiceOfName(props.name, playerStore.npcs))

/**
 * Rencontré : le nom cesse définitivement de se chiffrer.
 *
 * C'est le pendant, dans le RÉCIT, de ce que le panneau du haut inscrit déjà :
 * on mémorise pour aborder quelqu'un, jamais pour le réaborder. Une fois la
 * conversation faite, le nom s'écrit en clair et en néon — il devient un mot
 * sur lequel on peut revenir, pas une donnée à repirater.
 *
 * La comparaison est insensible à la casse : le découpage du texte l'est aussi,
 * et le récit écrit le même nom en tête de phrase et au milieu.
 */
const known = computed(() => {
  const npc = playerStore.npcs.find(n => n.name.toLowerCase() === props.name.toLowerCase())
  return !!npc && gameStore.talkedToNpcIds.includes(npc.id)
})

const revealed = computed(() => gameStore.revealing === props.name)
const shown = computed(() =>
  known.value || revealed.value ? props.name : scramble(props.name, seed.value))

/**
 * L'arpège suit la révélation, jamais le montage du composant.
 *
 * Une note au chargement de la page venait d'un déclenchement lié au cycle de
 * vie ; ici, seule une bascule effective de l'état lance le son, et toute
 * bascule inverse l'arrête.
 */
watch(revealed, (isRevealed, wasRevealed) => {
  if (isRevealed && !wasRevealed) void startChime(props.name, assigned.value.mode, assigned.value.voice)
  if (!isRevealed && wasRevealed) stopChime(props.name)
})

onUnmounted(() => { stopChime(props.name) })

/**
 * Survoler un nom l'arme dans la saisie : la prochaine phrase part chez lui.
 *
 * Pour un nom chiffré, ça n'arrive qu'en QUITTANT le nom après l'avoir lu :
 * armer à l'entrée ouvrirait la conversation, l'oeil s'effacerait aussitôt et
 * le nom se rechiffrerait avant d'avoir été vu. Pendant un tour en cours, on
 * ne change pas d'interlocuteur sous les pieds du récit.
 */
function address() {
  if (gameStore.isInputDisabled) return
  const npc = playerStore.npcs.find(n => n.name.toLowerCase() === props.name.toLowerCase())
  if (npc && gameStore.activeNpcId !== npc.id) gameStore.setActiveNpc(npc.id)
}

/** Sur desktop, la souris EST l'instrument — une fois l'oeil ouvert. */
function onEnter() {
  const canRead = canChimeName(gameStore.eyeActive, gameStore.eyeHidden, gameStore.activeTool)
  // Déjà rencontré : il reste lisible sans masquer le récit, mais sa voix
  // doit toujours répondre au survol — avant d'armer la saisie, qui efface
  // l'oeil. Écrit en clair, il s'aborde sans l'oeil.
  if (known.value) {
    if (canRead) void startChime(props.name, assigned.value.mode, assigned.value.voice)
    address()
    return
  }
  // Oeil fermé, rien ne se lit : c'est le bouton qui l'ouvre, sur desktop
  // comme sur mobile.
  if (!canRead) return
  gameStore.setRevealing(props.name)
}
function onLeave() {
  if (known.value) stopChime(props.name)
  if (gameStore.revealing === props.name) {
    gameStore.setRevealing(null)
    address()
  }
}

/**
 * Au doigt, sans l'oeil actif, on ne lit rien : tout le texte se brouille.
 * C'est la réponse du système à une tentative sans instrument.
 */
function onTouch() {
  if (known.value) return
  if (gameStore.eyeHidden) return
  if (!gameStore.eyeActive) gameStore.denyRead()
}
</script>

<template>
  <!--
    Deux couches superposées. Celle du dessous porte le VRAI nom, invisible :
    c'est elle qui réserve la place. Celle du dessus, en absolu, affiche le
    brouillage. Sans ce montage, chaque cycle de bruit changeait la largeur du
    mot et faisait danser tout le paragraphe autour.

    `data-glitch-name` sert de cible au test de collision de l'oeil : c'est le
    composable qui balaie le document, pas chaque nom qui s'observe lui-même.
  -->
  <span
    class="glitch-name"
    :class="[
      known
        ? 'is-known'
        : gameStore.activeTool === 'lens' ? 'cursor-lens'
          : gameStore.eyeActive && !gameStore.eyeHidden ? (revealed ? 'cursor-eye-open' : 'cursor-eye') : null,
      revealed && 'is-revealed',
    ]"
    :data-glitch-name="known ? undefined : name"
    :data-archetype="assigned.voice.key"
    :tabindex="known ? -1 : 0"
    :role="known ? undefined : 'button'"
    :aria-label="known || revealed ? name : t('game.encrypted_identity')"
    @mouseenter="onEnter"
    @mouseleave="onLeave"
    @focus="onEnter"
    @blur="onLeave"
    @touchstart.prevent="onTouch"
  >
    <span class="sizer" aria-hidden="true">{{ name }}</span>
    <span class="overlay">{{ shown }}</span>
  </span>
</template>

<style scoped>
.glitch-name {
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
  color: rgb(var(--neon-400));
  text-shadow: 0 0 6px rgb(var(--neon-500) / 0.45);
  transition: color 0.12s ease;
  /*
   * Monospace dans TOUS les états. C'est ce qui garantit que le bruit occupe
   * exactement la largeur du vrai nom : en proportionnel, un W prend la place
   * de trois i et le brouillage se faisait rogner. Accessoirement, ça marque le
   * nom comme une donnée plutôt que comme un mot.
   */
  font-family: 'Courier New', Courier, monospace;
  font-size: 0.95em;
}

/* Réserve exactement la largeur du vrai nom, sans jamais le montrer. */
.sizer { visibility: hidden; }

/*
 * Le brouillage flotte au-dessus : il ne participe pas à la mise en page, et
 * c'est ici qu'on le rogne s'il dépasse la largeur du vrai nom.
 */
.overlay {
  position: absolute;
  inset: 0;
  overflow: hidden;
  text-align: center;
}

/*
 * Rencontré : le nom s'écrit pour de bon, en néon.
 *
 * Il quitte le monospace — ce n'est plus une donnée chiffrée mais quelqu'un
 * qu'on connaît — et garde la couleur d'accent de la scène, qui est le signal
 * de ce avec quoi le joueur peut interagir. La halo reste discret : il y a des
 * noms partout dans le texte une fois la scène parcourue.
 */
.is-known {
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  color: rgb(var(--neon-300));
  text-shadow: 0 0 8px rgb(var(--neon-500) / 0.45);
  cursor: default;
}

/* Déchiffré : le nom en clair, une seconde. */
.is-revealed {
  color: rgb(var(--neon-200));
  text-shadow:
    0 0 4px rgb(var(--neon-500) / 0.95),
    0 0 14px rgb(var(--neon-500) / 0.7);
}
</style>
