/** Toute scène remet une carte ou une valeur ; A2S1, la carte cassée contre l’offrande. */
export function sceneKeyInventoryKind(_sceneId: string): 'key' | 'trade' {
  return 'key'
}

/**
 * L’objet-clé d’A2S1 est la première moitié de la carte d’A2S2 : il entre en
 * poche sous l’id que la seconde cherche.
 */
export function keyItemIsFirstHalf(sceneId: string): boolean {
  return sceneId === 'a2s1'
}

/**
 * Ce qu’un personnage tend se reçoit en clair.
 *
 * Il le nomme en le tendant : le brouiller dans le récit, puis le ranger
 * scellé, faisait de la remise un second objet à lire. Le chiffre reste sur ce
 * que le décor cache — l’objet-clé inscrit dans le lieu, les ramassables,
 * l’objet scellé. Ce qu’on obtient en parlant se lit ; ce qu’on trouve en
 * regardant se déchiffre. Seule exception : la relique d’A3S1, que son
 * détenteur tend sans pouvoir la lire — il faut le module pour la nommer.
 */
export function keyItemNameInClear(acquisition: string | undefined, relic?: boolean): boolean {
  return acquisition !== 'found' && !relic
}

/** La séquence finale ne dépend pas des échanges précédents. */
export function finalSequenceNeedsExchange(_givenItemIds: readonly string[]): boolean {
  return false
}
