/** A2S1 s’ouvre avec l’objet trouvé ; on peut ensuite le donner en A2S2. */
export function sceneKeyInventoryKind(sceneId: string): 'key' | 'trade' {
  return sceneId === 'a2s1' ? 'trade' : 'key'
}

/**
 * Ce qu’un personnage tend se reçoit en clair.
 *
 * Il le nomme en le tendant : le brouiller dans le récit, puis le ranger
 * scellé, faisait de la remise un second objet à lire. Le chiffre reste sur ce
 * que le décor cache — l’objet-clé inscrit dans le lieu, les ramassables,
 * l’objet scellé. Ce qu’on obtient en parlant se lit ; ce qu’on trouve en
 * regardant se déchiffre.
 */
export function keyItemNameInClear(acquisition: string | undefined): boolean {
  return acquisition !== 'found'
}

/** La séquence finale ne dépend pas des échanges précédents. */
export function finalSequenceNeedsExchange(_givenItemIds: readonly string[]): boolean {
  return false
}
