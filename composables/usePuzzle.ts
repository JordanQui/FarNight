import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { translate } from '~/utils/languages'
import { isSolved, searchedSpot } from '~/utils/puzzles'
import { fold } from '~/utils/naming'

/**
 * L'énigme de la scène, côté partie.
 *
 * Tout ce qui se décide est dans `utils/puzzles.ts` — la solution, les
 * indices, la vérification. Ici on branche l'issue sur le store et sur le
 * récit : une bonne réponse remet l'objet-clé, une mauvaise est refusée.
 * Rien ne part au modèle.
 */
export function usePuzzle() {
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()

  const puzzle = computed(() => playerStore.scene?.puzzle ?? null)
  /** L'id sous lequel le récit a chiffré l'objet-clé. */
  const keyId = computed(() => `cle_${playerStore.scene?.scene_id}`)

  const t = (key: string, vars?: Record<string, string | number>) =>
    translate(playerStore.language, key, vars)

  /**
   * L'objet-clé passe dans les mains du joueur.
   *
   * Un seul chemin pour les trois façons de l'obtenir — tendu par quelqu'un,
   * lu dans le décor, gagné à une énigme : l'inventaire doit en garder la même
   * trace quelle que soit la voie.
   */
  function collect() {
    const scene = playerStore.scene
    const item = scene?.key_item
    if (!scene || !item) return
    gameStore.collectKeyItem(scene.grants_augmentation ?? false, {
      // Toujours le même id que celui sous lequel le récit l'a chiffré : déchiffré
      // dans le texte, il doit rester déchiffré dans l'inventaire.
      id: keyId.value,
      name: item.name ?? '',
      from: scene.place?.name,
      color: item.color,
      // La couleur de la carte EST l'accent de la scène où on la prend : on la
      // fige ici, sinon la pastille se repeindrait au lieu suivant.
      hex: scene.palette?.accent?.hex,
      observation: item.observation,
      icon: item.icon,
    })
    // Le récit brouille ce nom tant que la loupe ne l'a pas ouvert : l'écrire
    // ici ne le livre pas.
    gameStore.addNarrativeEntry('system', t('puzzle.holding', { name: item.name }))
  }

  /**
   * Le joueur vient de lire le nom de l'objet-clé, là où personne ne le tend.
   *
   * Sans énigme, le lire est l'obtenir — c'était la règle de toutes ces
   * scènes. Avec une énigme, le lire la MONTRE : le lecteur, le cadran, le
   * clavier s'ouvrent, et il reste à trouver la réponse.
   */
  function keyItemRead() {
    const p = puzzle.value
    const name = playerStore.scene?.key_item?.name ?? ''
    if (!p) { collect(); return }
    if (p.kind === 'search') {
      gameStore.addNarrativeEntry('system', t('puzzle.search_known'))
      return
    }
    gameStore.unlockPuzzle()
    gameStore.addNarrativeEntry('system', t(`puzzle.unlocked_${p.kind}`, { name }))
  }

  /**
   * L'indice vient d'être lu (deuxième objet regardé).
   *
   * Le panneau s'ouvre en lisant à la loupe le nom de l'objet-clé — mais rien
   * n'oblige le modèle à l'écrire dans le récit. Absent, il n'y avait rien à
   * lire : le joueur tenait la fréquence et ne voyait jamais le cadran. Dans ce
   * cas, et seulement celui-là, l'indice débloque le panneau, refermé : le
   * bandeau « Reprendre » le propose sans masquer ce qu'il vient de lire.
   */
  function clueRead() {
    const p = puzzle.value
    const scene = playerStore.scene
    const name = scene?.key_item?.name ?? ''
    if (!p || p.kind === 'search' || gameStore.hasKeyItem || gameStore.puzzleUnlocked) return
    if (scene?.key_item?.acquisition !== 'found') return
    if (name && fold(scene.scene_text ?? '').includes(fold(name))) return
    gameStore.puzzleUnlocked = true
  }

  /**
   * Une réponse proposée au panneau.
   *
   * Vrai si elle ouvre. Fausse, elle est refusée, sans autre prix : la nuit
   * n'est pas chronométrée.
   */
  function submit(answer: string | number | number[]): boolean {
    const p = puzzle.value
    if (!p || gameStore.hasKeyItem) return false
    if (isSolved(p, answer)) {
      gameStore.setPuzzleOpen(false)
      gameStore.addNarrativeEntry('system', t(`puzzle.solved_${p.kind}`))
      collect()
      return true
    }
    gameStore.addNarrativeEntry('system', t('puzzle.wrong'))
    return false
  }

  /**
   * L'endroit que la saisie fouille, s'il y en a un. Le deck s'en sert pour
   * savoir si le moment `fouille` peut se jouer.
   */
  function spotOf(input: string) {
    return searchedSpot(input, puzzle.value, playerStore.language)
  }

  /**
   * Il plonge la main quelque part.
   *
   * Chaque endroit REGARDÉ en innocente un autre : celui qui lit le lieu
   * trouve vite, celui qui fouille tout sans lire ouvre chaque tiroir.
   */
  function search(input: string) {
    const p = puzzle.value
    const spot = spotOf(input)
    if (!p || p.kind !== 'search' || !spot) return
    if (gameStore.searchedSpotIds.includes(spot.id)) {
      gameStore.addNarrativeEntry('system', t('puzzle.search_done', { spot: spot.label }))
      return
    }
    gameStore.recordSearch(spot.id)
    if (spot.id === p.solution) {
      gameStore.addNarrativeEntry('narration', t('puzzle.search_found', { spot: spot.label }))
      collect()
      return
    }
    gameStore.addNarrativeEntry('narration', t('puzzle.search_empty', { spot: spot.label }))
  }

  return { puzzle, keyId, collect, keyItemRead, clueRead, submit, spotOf, search }
}
