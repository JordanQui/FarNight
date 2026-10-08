import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'

/**
 * Ce que le joueur porte, et le geste que chaque chose attend.
 *
 * Deux écrans montrent le même inventaire — la barre, toujours là sous le
 * récit, et la grille, qu'on ouvre pour voir les noms en entier — et ils
 * doivent dire la MÊME chose. Deux copies de `actionFor` et l'une d'elles
 * proposerait un jour d'observer un objet que l'autre tient encore pour
 * scellé.
 */

/** Ce qu'il reste à faire de cet objet-ci, et il n'y en a jamais qu'un. */
export type ItemAction = 'read' | 'observe' | 'locked' | 'none'

export interface CarriedThing {
  id: string
  label: string
  kind: 'key' | 'lore' | 'trade'
  color?: string
  /** La couleur de la carte, figée au ramassage : la pastille en dépend. */
  hex?: string
  from?: string
  observation?: string
  /** Son pictogramme, tel que le serveur l'a reconstruit. */
  icon?: string
  /** Son nom a été déchiffré : il s'écrit en clair partout. */
  known: boolean
  /**
   * Ce qu'il dit de l'énigme du lieu où l'on est, s'il en porte un morceau.
   * Voir `carryOne` dans utils/puzzles.ts.
   */
  clue?: string
}

export function useInventory() {
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()

  const items = computed<CarriedThing[]>(() => gameStore.inventory.map(o => ({
    ...o,
    known: gameStore.decryptedObjectIds.includes(o.id),
    clue: playerStore.scene?.puzzle?.clues.find(c => c.item_id === o.id)?.text,
  })))

  /** Le personnage à qui l'on parle. Sans lui, rien ne se donne. */
  const facing = computed(() =>
    playerStore.npcs.find(n => n.id === gameStore.activeNpcId) ?? null)

  /**
   * Le geste que cet objet-ci attend.
   *
   * Un seul par objet, et il change avec l'état : tant que le nom est scellé,
   * il n'y a rien d'autre à en faire que le lire.
   */
  function actionFor(o: { known: boolean; observation?: string; clue?: string }): ItemAction {
    if (!o.known) return gameStore.lensAvailable ? 'read' : 'locked'
    return o.observation?.trim() || o.clue ? 'observe' : 'none'
  }

  function activate(o: CarriedThing) {
    const action = actionFor(o)
    if (action === 'locked') {
      // Même refus que dans le récit : le texte se brouille un instant.
      gameStore.denyRead()
      return
    }
    if (action === 'read') {
      // Depuis l'inventaire, la loupe n'a pas à être en main : l'objet est déjà
      // dans la paume du joueur, il n'a pas à le viser.
      gameStore.requestChallenge(o.id, o.label)
      return
    }
    if (action === 'observe') {
      // L'indice vient APRÈS ce qu'on savait déjà de l'objet : c'est la même
      // chose, revue sous la lumière de ce lieu.
      const text = [o.observation?.trim(), o.clue].filter(Boolean).join('\n\n')
      if (text) gameStore.addNarrativeEntry('narration', text)
    }
  }

  return { items, facing, actionFor, activate }
}
